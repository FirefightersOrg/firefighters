-- SAN-68: commission selection, settlement ledger postings, and ledger services.
-- Cash/transfer principal movements are deliberately not ledger rows: a single positive ledger
-- row must affect the commission balance, while payment/settlement history remains their audit trail.

create or replace function public.settlement_application_commission(
  p_campaign_id uuid, p_collector_id uuid, p_payment_date date, p_payment_mode text,
  p_installment_number integer, p_installment_count integer, p_amount_applied numeric,
  p_installment_amount numeric
) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when r.percentage is not null then round(p_amount_applied * r.percentage / 100, 2)
      else round(r.fixed_amount * p_amount_applied / p_installment_amount, 2)
    end
    from public.commission_rules r
    where r.campaign_id = p_campaign_id
      and r.status = 'active'
      and (r.applies_to_collector_id is null or r.applies_to_collector_id = p_collector_id)
      and p_payment_date between r.valid_from and coalesce(r.valid_to, p_payment_date)
      and (
        (r.rule_type = 'custom' and r.installment_number = p_installment_number)
        or (r.rule_type = 'cash_full_payment' and p_payment_mode = 'full_payment')
        or (r.rule_type = 'installment_first' and p_payment_mode = 'installments' and p_installment_number = 1)
        or (r.rule_type = 'installment_middle' and p_payment_mode = 'installments'
          and p_installment_number between 2 and p_installment_count - 1)
        or (r.rule_type = 'installment_last' and p_payment_mode = 'installments'
          and p_installment_count > 1 and p_installment_number = p_installment_count)
      )
    order by
      (r.applies_to_collector_id is not null) desc,
      (r.rule_type = 'custom') desc,
      r.valid_from desc,
      r.id desc
    limit 1
  ), 0);
$$;

create or replace function public.collector_ledger_balance(p_campaign_id uuid, p_collector_id uuid)
returns numeric
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.collector_ledger_can_read() or public.collector_ledger_is_own_collector(p_collector_id)) then
    raise exception 'permission denied: collector ledger access is required'
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select sum(case when direction = 'collector_credit' then amount else -amount end)
    from public.collector_ledger_entries
    where campaign_id = p_campaign_id and collector_id = p_collector_id and status <> 'annulled'
  ), 0);
end $$;

create or replace function public.settlement_totals(p_settlement_id uuid)
returns table(total_cash numeric, total_transfer numeric, total_amount numeric, commission_amount numeric, commission_paid_amount numeric, net_to_firefighters numeric, collector_credit_balance numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_collector_id uuid;
  v_campaign_id uuid;
begin
  select collector_id, campaign_id into v_collector_id, v_campaign_id from public.settlements where id = p_settlement_id;
  if v_collector_id is null
    or not (public.settlement_can_read() or public.payment_settlement_is_own_collector(v_collector_id)) then
    raise exception 'permission denied: settlement.view is required' using errcode = 'insufficient_privilege';
  end if;
  return query
  with payments as (
    select * from public.payments where settlement_id = p_settlement_id and status = 'pending_in_settlement'
  ), applications as (
    select p.*, pi.installment_id, pi.amount_applied, i.installment_number, i.amount installment_amount,
      s.payment_mode, pp.installment_count
    from payments p join public.payment_installments pi on pi.payment_id = p.id
    join public.installments i on i.id = pi.installment_id join public.sales s on s.id = p.sale_id
    join public.payment_plans pp on pp.id = i.payment_plan_id
  ), commissions as (
    select a.*, public.settlement_application_commission(a.campaign_id, a.collector_id, a.payment_date,
      a.payment_mode, a.installment_number, a.installment_count, a.amount_applied, a.installment_amount) commission
    from applications a
  ), amounts as (
    select coalesce(sum(amount) filter (where payment_method = 'cash'), 0) cash,
      coalesce(sum(amount) filter (where payment_method = 'transfer'), 0) transfer,
      coalesce(sum(amount), 0) total from payments
  ), commission_totals as (
    select coalesce(sum(commission), 0) generated,
      coalesce(sum(commission) filter (where payment_method = 'cash'), 0) paid from commissions
  )
  select a.cash, a.transfer, a.total, c.generated, c.paid, a.total - c.paid,
    coalesce((
      select sum(case when direction = 'collector_credit' then amount else -amount end)
      from public.collector_ledger_entries
      where campaign_id = v_campaign_id and collector_id = v_collector_id and status <> 'annulled'
    ), 0) + c.generated - c.paid
  from amounts a cross join commission_totals c;
end $$;

create or replace function public.settlement_close(p_settlement_id uuid, p_request_id text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settlement_require_actor('settlement.close');
  v_set public.settlements;
  v_tot record;
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  r record;
begin
  select * into v_set from public.settlements where id = p_settlement_id for update;
  if not found then raise exception 'settlement % not found', p_settlement_id using errcode = 'no_data_found'; end if;
  if v_set.status <> 'open' then raise exception 'settlement must be open' using errcode = 'object_not_in_prerequisite_state'; end if;
  if not exists (select 1 from public.payments where settlement_id = p_settlement_id and status = 'pending_in_settlement') then
    raise exception 'settlement has no pending payments' using errcode = 'object_not_in_prerequisite_state';
  end if;
  select * into v_tot from public.settlement_totals(p_settlement_id);
  update public.payments set status = 'confirmed' where settlement_id = p_settlement_id and status = 'pending_in_settlement';
  for r in select distinct i.id, i.amount, i.due_date from public.installments i
    join public.payment_installments pi on pi.installment_id = i.id join public.payments p on p.id = pi.payment_id
    where p.settlement_id = p_settlement_id loop
    if (select coalesce(sum(pi.amount_applied), 0) from public.payment_installments pi
      join public.payments p on p.id = pi.payment_id where pi.installment_id = r.id and p.status = 'confirmed') >= r.amount then
      update public.installments set status = case when r.due_date > v_today then 'paid_advance' else 'paid' end
      where id = r.id and status in ('pending', 'overdue');
    end if;
  end loop;
  update public.bonds b set financial_status_snapshot = public.bond_financial_status_from_installments(b.id)
  where id in (select s.bond_id from public.sales s join public.payments p on p.sale_id = s.id
    where p.settlement_id = p_settlement_id and s.status = 'active');
  update public.settlements set total_cash = v_tot.total_cash, total_transfer = v_tot.total_transfer,
    total_amount = v_tot.total_amount, commission_amount = v_tot.commission_amount,
    commission_paid_amount = v_tot.commission_paid_amount, net_to_firefighters = v_tot.net_to_firefighters,
    status = 'closed', closed_at = now(), closed_by = v_actor where id = p_settlement_id;
  if v_tot.commission_amount > 0 then
    insert into public.collector_ledger_entries(campaign_id, collector_id, settlement_id, entry_type, direction, amount, created_by)
    values(v_set.campaign_id, v_set.collector_id, p_settlement_id, 'commission_generated', 'collector_credit', v_tot.commission_amount, v_actor);
  end if;
  if v_tot.commission_paid_amount > 0 then
    insert into public.collector_ledger_entries(campaign_id, collector_id, settlement_id, entry_type, direction, amount, created_by)
    values(v_set.campaign_id, v_set.collector_id, p_settlement_id, 'commission_settled', 'collector_debit', v_tot.commission_paid_amount, v_actor);
  end if;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (v_actor, 'settlement.close', 'settlement', p_settlement_id::text,
    jsonb_build_object('status', 'closed', 'total_amount', v_tot.total_amount), p_request_id);
end $$;

create function public.commission_settle(
  p_campaign_id uuid, p_collector_id uuid, p_amount numeric, p_reason text, p_request_id text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settlement_require_actor('commission.settle');
  v_reason text := nullif(btrim(p_reason), '');
  v_balance numeric;
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 or p_amount = 'NaN' or p_amount <> round(p_amount, 2) then
    raise exception 'amount must be a positive amount with at most 2 decimal places' using errcode = 'invalid_parameter_value';
  end if;
  if v_reason is null or length(v_reason) > 1000 then
    raise exception 'a trimmed reason of at most 1000 characters is required' using errcode = 'invalid_parameter_value';
  end if;
  perform 1 from public.campaigns where id = p_campaign_id for share;
  if not found then raise exception 'campaign % not found', p_campaign_id using errcode = 'no_data_found'; end if;
  perform 1 from public.collectors where id = p_collector_id for share;
  if not found then raise exception 'collector % not found', p_collector_id using errcode = 'no_data_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text || p_collector_id::text, 68));
  select coalesce(sum(case when direction = 'collector_credit' then amount else -amount end), 0) into v_balance
  from public.collector_ledger_entries where campaign_id = p_campaign_id and collector_id = p_collector_id and status <> 'annulled';
  if p_amount > v_balance then raise exception 'amount cannot exceed current collector balance' using errcode = 'invalid_parameter_value'; end if;
  insert into public.collector_ledger_entries(campaign_id, collector_id, entry_type, direction, amount, reason, created_by)
  values(p_campaign_id, p_collector_id, 'commission_settled', 'collector_debit', p_amount, v_reason, v_actor) returning id into v_id;
  insert into public.audit_log(actor_user_id, action, entity_type, entity_id, new_value, reason, request_id)
  values(v_actor, 'commission.settle', 'collector_ledger_entry', v_id::text,
    jsonb_build_object('campaign_id', p_campaign_id, 'collector_id', p_collector_id, 'amount', p_amount), v_reason, p_request_id);
  return v_id;
end $$;

revoke all on function public.collector_ledger_balance(uuid,uuid), public.commission_settle(uuid,uuid,numeric,text,text)
  from public, anon, service_role;
grant execute on function public.collector_ledger_balance(uuid,uuid), public.commission_settle(uuid,uuid,numeric,text,text)
  to authenticated;
