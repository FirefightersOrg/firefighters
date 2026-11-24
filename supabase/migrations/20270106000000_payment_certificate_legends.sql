-- SAN-111: historical settlement balance snapshots and payment-correction print legends.
alter table public.settlements
  add column collector_balance_at_close numeric(12,2);

alter table public.settlements
  add constraint settlements_collector_balance_at_close_valid
  check (collector_balance_at_close is null or collector_balance_at_close = round(collector_balance_at_close, 2));

-- Rebased on SAN-110 (20270105): keeps its audited method-correction exception, which compares
-- the whole row (so collector_balance_at_close cannot change through it either).
create or replace function public.settlements_guard_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.settlement_method_totals_allowed(old, new) then
    new.updated_at := old.updated_at;
    return new;
  end if;
  if (new.id, new.campaign_id, new.settlement_number, new.collector_id, new.opened_at, new.created_by)
     is distinct from (old.id, old.campaign_id, old.settlement_number, old.collector_id, old.opened_at, old.created_by) then
    raise exception 'settlement identity is immutable' using errcode = 'restrict_violation';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'open' and new.status in ('closed', 'annulled')) or (old.status = 'closed' and new.status = 'corrected')
  ) then raise exception 'settlement status cannot go from % to %', old.status, new.status using errcode = 'check_violation'; end if;
  if old.status <> 'open' and (new.total_cash, new.total_transfer, new.total_amount, new.commission_amount,
      new.commission_paid_amount, new.net_to_firefighters, new.notes) is distinct from
     (old.total_cash, old.total_transfer, old.total_amount, old.commission_amount,
      old.commission_paid_amount, old.net_to_firefighters, old.notes) then
    raise exception 'only open settlement totals can change' using errcode = 'restrict_violation';
  end if;
  if old.status <> 'open' and (new.closed_at, new.closed_by, new.collector_balance_at_close) is distinct from
     (old.closed_at, old.closed_by, old.collector_balance_at_close) then
    raise exception 'closed settlement fields are immutable' using errcode = 'restrict_violation';
  end if;
  if new.status in ('open', 'annulled') and new.collector_balance_at_close is not null then
    raise exception 'only closed settlements have a collector balance snapshot' using errcode = 'check_violation';
  end if;
  new.updated_at := now(); return new;
end; $$;

-- This is the SAN-68 settlement_close body with only these additions:
-- deterministic payment/installment locks, the ledger advisory lock, and persistence of
-- settlement_totals.collector_credit_balance in the same closing update.
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
  perform p.id from public.payments p
    where p.settlement_id = p_settlement_id and p.status = 'pending_in_settlement'
    order by p.id for update;
  perform i.id from public.installments i
    join public.payment_installments pi on pi.installment_id = i.id
    join public.payments p on p.id = pi.payment_id
    where p.settlement_id = p_settlement_id order by i.id for update of i;
  perform pg_advisory_xact_lock(hashtextextended(v_set.campaign_id::text || v_set.collector_id::text, 68));
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
    collector_balance_at_close = v_tot.collector_credit_balance,
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

create function public.payment_certificate_legend(p_payment_id uuid)
returns table(
  legend_kind text, event_at timestamptz, actor_name text, reason text,
  related_payment_id uuid, correction_type text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_payment public.payments;
  v_audit public.audit_log;
  v_related uuid;
begin
  if not public.has_permission('payment.view') then
    raise exception 'payment.view required' using errcode = '42501';
  end if;
  select * into v_payment from public.payments where id = p_payment_id;
  if not found then return; end if;
  if v_payment.status = 'annulled' then
    -- Only an annulled CONFIRMED payment (payment_annul writes correction_type) is certified with a
    -- legend. A pending payment removed from an open settlement (settlement_remove_payment) was never
    -- valid and gets no certificate at all: no row.
    if not exists (select 1 from public.audit_log a where a.entity_type = 'payment'
                   and a.entity_id = v_payment.id::text and a.action = 'payment.annul'
                   and a.new_value ? 'correction_type') then
      return;
    end if;
    return query select 'annulled'::text, v_payment.annulled_at, p.full_name,
      v_payment.annulment_reason, null::uuid, 'annul'::text
      from (select 1) one left join public.profiles p on p.id = v_payment.annulled_by;
    return;
  end if;
  if v_payment.status = 'adjusted' then
    select id into v_related from public.payments where replaces_payment_id = v_payment.id;
  elsif v_payment.replaces_payment_id is not null then
    v_related := v_payment.replaces_payment_id;
  else
    return;
  end if;
  select a.* into v_audit from public.audit_log a
    where a.entity_type = 'payment'
      and a.entity_id = coalesce(v_payment.replaces_payment_id, v_payment.id)::text
      and a.action in ('payment.correct_method', 'payment.reassociate_transfer')
    order by a.created_at desc, a.id desc limit 1;
  return query select 'corrected'::text, v_audit.created_at, p.full_name, v_audit.reason,
    v_related, replace(v_audit.action, 'payment.', '')
    from (select 1) one left join public.profiles p on p.id = v_audit.actor_user_id;
end $$;

revoke all on function public.payment_certificate_legend(uuid) from public, anon, service_role;
grant execute on function public.payment_certificate_legend(uuid) to authenticated;
