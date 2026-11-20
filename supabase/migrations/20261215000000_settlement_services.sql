-- SAN-63: audited settlement services. Financial history is annulled, never deleted.

create function public.settlement_require_actor(p_permission text)
returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_profile_id();
begin
  if v_actor is null or not public.has_permission(p_permission) then
    raise exception 'permission denied: % is required', p_permission
      using errcode = 'insufficient_privilege';
  end if;
  return v_actor;
end $$;

create function public.settlement_application_commission(
  p_campaign_id uuid, p_collector_id uuid, p_payment_date date, p_payment_mode text,
  p_installment_number integer, p_installment_count integer, p_amount_applied numeric,
  p_installment_amount numeric
) returns numeric
language sql stable security definer set search_path = '' as $$
  -- An installment plan with one installment uses installment_first (not installment_last).
  -- Collector-specific active rules override general rules; ties use newest valid_from then id.
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
    order by (r.applies_to_collector_id is not null) desc, r.valid_from desc, r.id desc
    limit 1
  ), 0);
$$;

create function public.settlement_open(
  p_campaign_id uuid, p_collector_id uuid, p_notes text default null, p_request_id text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settlement_require_actor('settlement.create');
  v_id uuid;
  v_notes text := nullif(btrim(p_notes), '');
begin
  perform 1 from public.campaigns where id = p_campaign_id for share;
  if not found then
    raise exception 'campaign % not found', p_campaign_id using errcode = 'no_data_found';
  end if;
  perform 1 from public.collectors where id = p_collector_id and status = 'active' for share;
  if not found then
    raise exception 'collector % not found', p_collector_id using errcode = 'no_data_found';
  end if;
  if p_notes is not null and (v_notes is null or length(v_notes) > 2000) then
    raise exception 'notes must be trimmed, non-blank and at most 2000 characters'
      using errcode = 'invalid_parameter_value';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text, 63));
  insert into public.settlements (campaign_id, settlement_number, collector_id, created_by, notes)
  values (p_campaign_id, (select coalesce(max(settlement_number), 0) + 1 from public.settlements where campaign_id = p_campaign_id), p_collector_id, v_actor, v_notes)
  returning id into v_id;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (v_actor, 'settlement.open', 'settlement', v_id::text,
    jsonb_build_object('campaign_id', p_campaign_id, 'collector_id', p_collector_id, 'status', 'open'), p_request_id);
  return v_id;
end $$;

create function public.settlement_add_payment(
  p_settlement_id uuid, p_sale_id uuid, p_amount numeric, p_payment_method text,
  p_applications jsonb, p_payment_date date default null, p_request_id text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settlement_require_actor('payment.create');
  v_set public.settlements;
  v_sale public.sales;
  v_id uuid;
  v_sum numeric := 0;
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  x jsonb;
  v_installment uuid;
  v_applied numeric;
begin
  select * into v_set from public.settlements where id = p_settlement_id for update;
  if not found then
    raise exception 'settlement % not found', p_settlement_id using errcode = 'no_data_found';
  end if;
  if v_set.status <> 'open' then
    raise exception 'settlement must be open' using errcode = 'object_not_in_prerequisite_state';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount = 'NaN'
    or p_payment_method not in ('cash', 'transfer') then
    raise exception 'invalid payment amount or method' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_sale from public.sales where id = p_sale_id for share;
  if not found then
    raise exception 'sale % not found', p_sale_id using errcode = 'no_data_found';
  end if;
  if v_sale.campaign_id <> v_set.campaign_id
    or v_sale.collector_id <> v_set.collector_id
    or v_sale.status <> 'active' then
    raise exception 'sale must be active and belong to the settlement collector and campaign'
      using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_applications) <> 'array' or jsonb_array_length(p_applications) = 0 then
    raise exception 'applications are required' using errcode = 'invalid_parameter_value';
  end if;
  if p_payment_date > v_today then
    raise exception 'payment date cannot be in the future' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.payments (
    campaign_id, sale_id, collector_id, buyer_id, settlement_id, amount,
    payment_method, payment_date, status, created_by
  )
  values (
    v_set.campaign_id, p_sale_id, v_set.collector_id, v_sale.buyer_id, p_settlement_id,
    p_amount, p_payment_method, coalesce(p_payment_date, v_today), 'pending_in_settlement', v_actor
  )
  returning id into v_id;
  -- Lock installments in a stable order (by id) so concurrent adds cannot deadlock.
  for x in select value from jsonb_array_elements(p_applications) order by value ->> 'installment_id' loop
    begin
      v_installment := (x ->> 'installment_id')::uuid;
      v_applied := (x ->> 'amount_applied')::numeric;
    exception when others then
      raise exception 'invalid payment application' using errcode = 'invalid_parameter_value';
    end;
    if v_applied is null or v_applied <= 0 then
      raise exception 'application amount must be positive' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.payment_installments (payment_id, installment_id, amount_applied)
    values (v_id, v_installment, v_applied);
    v_sum := v_sum + v_applied;
  end loop;
  if v_sum <> p_amount then
    raise exception 'payment applications must equal the payment amount'
      using errcode = 'invalid_parameter_value';
  end if;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (v_actor, 'payment.add', 'payment', v_id::text,
    jsonb_build_object('settlement_id', p_settlement_id, 'amount', p_amount, 'method', p_payment_method), p_request_id);
  return v_id;
end $$;

create function public.settlement_remove_payment(
  p_payment_id uuid, p_reason text, p_request_id text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settlement_require_actor('settlement.update_open');
  v_payment public.payments;
  v_set public.settlements;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_reason is null or length(v_reason) > 1000 then
    raise exception 'a trimmed annulment reason of at most 1000 characters is required'
      using errcode = 'invalid_parameter_value';
  end if;
  -- Lock order matches settlement_add_payment / settlement_close: settlement first, then payment.
  select * into v_payment from public.payments where id = p_payment_id;
  if not found then
    raise exception 'payment % not found', p_payment_id using errcode = 'no_data_found';
  end if;
  select * into v_set from public.settlements where id = v_payment.settlement_id for update;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.status <> 'pending_in_settlement' or v_set.status <> 'open' then
    raise exception 'only a pending payment in an open settlement can be removed'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  update public.payments
  set status = 'annulled',
      annulled_by = v_actor,
      annulled_at = now(),
      annulment_reason = v_reason
  where id = p_payment_id;
  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id
  )
  values (
    v_actor, 'payment.annul', 'payment', p_payment_id::text,
    jsonb_build_object('status', 'pending_in_settlement'), jsonb_build_object('status', 'annulled'),
    v_reason, p_request_id
  );
end $$;

create function public.settlement_totals(p_settlement_id uuid)
returns table(total_cash numeric, total_transfer numeric, total_amount numeric, commission_amount numeric, commission_paid_amount numeric, net_to_firefighters numeric, collector_credit_balance numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_collector_id uuid;
begin
  select collector_id into v_collector_id from public.settlements where id = p_settlement_id;
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
    select a.*, public.settlement_application_commission(a.campaign_id, a.collector_id, a.payment_date, a.payment_mode, a.installment_number, a.installment_count, a.amount_applied, a.installment_amount) commission from applications a
  )
  select coalesce((select sum(amount) from payments where payment_method = 'cash'), 0),
    coalesce((select sum(amount) from payments where payment_method = 'transfer'), 0),
    coalesce((select sum(amount) from payments), 0),
    coalesce(sum(commission), 0),
    coalesce(sum(commission), 0),
    greatest(coalesce((select sum(amount) from payments), 0) - coalesce(sum(commission), 0), 0),
    0::numeric
  from commissions;
end $$;

create function public.bond_financial_status_from_installments(p_bond_id uuid)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_status text;
begin
  -- No active sale retains the existing snapshot; paid-only plans are fully paid.
  -- An overdue installment wins; otherwise plans due through today are up to date.
  select case
    when not exists (select 1 from public.sales s where s.bond_id = b.id and s.status = 'active') then b.financial_status_snapshot
    when not exists (select 1 from public.sales s join public.payment_plans pp on pp.sale_id = s.id and pp.status = 'active' join public.installments i on i.payment_plan_id = pp.id where s.bond_id = b.id and s.status = 'active' and i.status in ('paid', 'paid_advance')) then 'no_payments'
    when not exists (select 1 from public.sales s join public.payment_plans pp on pp.sale_id = s.id and pp.status = 'active' join public.installments i on i.payment_plan_id = pp.id where s.bond_id = b.id and s.status = 'active' and i.status not in ('paid', 'paid_advance')) then 'fully_paid'
    when exists (select 1 from public.sales s join public.payment_plans pp on pp.sale_id = s.id and pp.status = 'active' join public.installments i on i.payment_plan_id = pp.id where s.bond_id = b.id and s.status = 'active' and (i.status = 'overdue' or (i.status = 'pending' and i.due_date < v_today))) then 'overdue'
    when not exists (select 1 from public.sales s join public.payment_plans pp on pp.sale_id = s.id and pp.status = 'active' join public.installments i on i.payment_plan_id = pp.id where s.bond_id = b.id and s.status = 'active' and i.due_date <= v_today and i.status not in ('paid', 'paid_advance')) then 'up_to_date'
    else 'partial_payments'
  end into v_status
  from public.bonds b
  where b.id = p_bond_id;
  return v_status;
end $$;

comment on function public.bond_financial_status_from_installments(uuid) is
  'Returns the bond financial snapshot: no payments, fully paid, overdue, up to date, or partial payments; inactive sales preserve the current snapshot.';

create function public.settlement_close(p_settlement_id uuid, p_request_id text default null)
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
  if not found then
    raise exception 'settlement % not found', p_settlement_id using errcode = 'no_data_found';
  end if;
  if v_set.status <> 'open' then
    raise exception 'settlement must be open' using errcode = 'object_not_in_prerequisite_state';
  end if;
  if not exists (
    select 1 from public.payments
    where settlement_id = p_settlement_id and status = 'pending_in_settlement'
  ) then
    raise exception 'settlement has no pending payments' using errcode = 'object_not_in_prerequisite_state';
  end if;
  select * into v_tot from public.settlement_totals(p_settlement_id);
  update public.payments
  set status = 'confirmed'
  where settlement_id = p_settlement_id and status = 'pending_in_settlement';
  for r in
    select distinct i.id, i.amount, i.due_date
    from public.installments i
    join public.payment_installments pi on pi.installment_id = i.id
    join public.payments p on p.id = pi.payment_id
    where p.settlement_id = p_settlement_id
  loop
    if (
      select coalesce(sum(pi.amount_applied), 0)
      from public.payment_installments pi
      join public.payments p on p.id = pi.payment_id
      where pi.installment_id = r.id and p.status = 'confirmed'
    ) >= r.amount then
      update public.installments
      set status = case when r.due_date > v_today then 'paid_advance' else 'paid' end
      where id = r.id and status in ('pending', 'overdue');
    end if;
  end loop;
  update public.bonds b
  set financial_status_snapshot = public.bond_financial_status_from_installments(b.id)
  where id in (
    select s.bond_id
    from public.sales s
    join public.payments p on p.sale_id = s.id
    where p.settlement_id = p_settlement_id and s.status = 'active'
  );
  update public.settlements
  set total_cash = v_tot.total_cash,
      total_transfer = v_tot.total_transfer,
      total_amount = v_tot.total_amount,
      commission_amount = v_tot.commission_amount,
      commission_paid_amount = v_tot.commission_paid_amount,
      net_to_firefighters = v_tot.net_to_firefighters,
      status = 'closed',
      closed_at = now(),
      closed_by = v_actor
  where id = p_settlement_id;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (v_actor, 'settlement.close', 'settlement', p_settlement_id::text,
    jsonb_build_object('status', 'closed', 'total_amount', v_tot.total_amount), p_request_id);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'settlement_require_actor(text)',
    'settlement_application_commission(uuid,uuid,date,text,integer,integer,numeric,numeric)',
    'settlement_open(uuid,uuid,text,text)',
    'settlement_add_payment(uuid,uuid,numeric,text,jsonb,date,text)',
    'settlement_remove_payment(uuid,text,text)',
    'settlement_totals(uuid)',
    'bond_financial_status_from_installments(uuid)',
    'settlement_close(uuid,text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, service_role', f);
  end loop;
end $$;

grant execute on function public.settlement_open(uuid,uuid,text,text),
  public.settlement_add_payment(uuid,uuid,numeric,text,jsonb,date,text),
  public.settlement_remove_payment(uuid,text,text), public.settlement_totals(uuid),
  public.settlement_close(uuid,text) to authenticated;
revoke all on function public.settlement_require_actor(text),
  public.settlement_application_commission(uuid,uuid,date,text,integer,integer,numeric,numeric),
  public.bond_financial_status_from_installments(uuid)
from public, anon, authenticated, service_role;
