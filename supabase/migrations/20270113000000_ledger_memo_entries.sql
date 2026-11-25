-- SAN-107 + SAN-108 (Proposal A, approved in #50 on 2026-11-25).
--
-- 1. Reference (memo) entries. `affects_balance` is false for `cash_settled` and
--    `transfer_received_by_firefighters`: they record what the collector handed in (cash) or what
--    reached Firefighters directly (transfer) at each settlement close, without moving the
--    commission balance. Every balance (collector_ledger_balance, the running balance, commission_settle,
--    settlement_totals, the account report) adds only `affects_balance` entries. A payment method
--    correction on a closed settlement (SAN-110) compensates the old memo and records the new one, so
--    the memos always add up to the settlement's total_cash / total_transfer.
-- 2. Compensation. `original_entry_id` points a compensating entry (an `annulment` or a manual
--    adjustment) at the entry it offsets: same campaign and collector, opposite direction, same
--    `affects_balance`, and never more than what is left of the original. When the compensations
--    add up to the whole original, the original becomes `compensated` (it keeps counting in the
--    balance, offset by its compensations). Compensated entries, compensating entries and entries
--    that already have compensations cannot be annulled.
-- 3. SAN-109: the compensating `annulment` rows of payment corrections (SAN-71), sale collector
--    corrections and closed-settlement corrections (SAN-72) now reference the settlement's
--    `commission_generated` / `commission_settled` entry they offset, when one has enough left.

alter table public.collector_ledger_entries
  add column affects_balance boolean not null default true,
  add column original_entry_id uuid references public.collector_ledger_entries (id) on delete restrict;

alter table public.collector_ledger_entries
  add constraint collector_ledger_entries_memo_types check (
    case
      when entry_type in ('cash_settled', 'transfer_received_by_firefighters') then not affects_balance
      when entry_type = 'annulment' then true
      else affects_balance
    end
  ),
  add constraint collector_ledger_entries_original_not_self check (original_entry_id <> id),
  add constraint collector_ledger_entries_original_types check (
    original_entry_id is null
    or entry_type in ('annulment', 'adjustment_in_favor_of_collector', 'adjustment_in_favor_of_firefighters')
  );

create index collector_ledger_entries_original_idx
  on public.collector_ledger_entries (original_entry_id) where original_entry_id is not null;

comment on column public.collector_ledger_entries.affects_balance is
  'False for reference entries (cash_settled, transfer_received_by_firefighters and their annulments): shown in the current account, excluded from every balance (SAN-107).';
comment on column public.collector_ledger_entries.original_entry_id is
  'The entry this one compensates (SAN-108): same campaign and collector, opposite direction, never more than what is left of it.';

-- What is left of an entry after its compensations.
create function public.collector_ledger_uncompensated(p_entry_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select e.amount - coalesce((
    select sum(c.amount) from public.collector_ledger_entries c
    where c.original_entry_id = e.id and c.status <> 'annulled'
  ), 0)
  from public.collector_ledger_entries e where e.id = p_entry_id
$$;

-- The recorded entry of a settlement that a correction compensates (null when there is none or it
-- has less left than the amount). Used by the correction functions, never by clients.
create function public.ledger_compensation_target(
  p_settlement_id uuid, p_collector_id uuid, p_entry_type text, p_amount numeric
) returns uuid language sql stable security definer set search_path = '' as $$
  select e.id from public.collector_ledger_entries e
  where p_settlement_id is not null and p_entry_type is not null
    and e.settlement_id = p_settlement_id and e.collector_id = p_collector_id
    and e.entry_type = p_entry_type and e.status = 'recorded'
    and public.collector_ledger_uncompensated(e.id) >= p_amount
  order by e.occurred_at, e.created_at, e.id
  limit 1
$$;

revoke all on function public.collector_ledger_uncompensated(uuid) from public, anon, authenticated, service_role;
revoke all on function public.ledger_compensation_target(uuid, uuid, text, numeric) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.collector_ledger_entries_guard_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_orig public.collector_ledger_entries;
begin
  perform public.commission_ledger_check_references(new.campaign_id, new.collector_id, new.settlement_id, new.payment_id);
  if new.status <> 'recorded' or new.annulled_by is not null or new.annulled_at is not null or new.annul_reason is not null then
    raise exception 'a new ledger entry must start recorded' using errcode = 'check_violation';
  end if;
  if new.original_entry_id is not null then
    select * into v_orig from public.collector_ledger_entries where id = new.original_entry_id for update;
    if not found or v_orig.campaign_id <> new.campaign_id or v_orig.collector_id <> new.collector_id then
      raise exception 'the compensated entry must belong to the same campaign and collector'
        using errcode = 'check_violation';
    end if;
    if v_orig.status <> 'recorded' then
      raise exception 'only a recorded entry can be compensated' using errcode = 'object_not_in_prerequisite_state';
    end if;
    if v_orig.direction = new.direction then
      raise exception 'a compensation must have the opposite direction of the entry it compensates'
        using errcode = 'check_violation';
    end if;
    if v_orig.affects_balance <> new.affects_balance then
      raise exception 'a reference entry is only compensated by a reference entry, and a balance entry by a balance entry'
        using errcode = 'check_violation';
    end if;
    if new.amount > public.collector_ledger_uncompensated(v_orig.id) then
      raise exception 'the compensation exceeds what is left of the original entry'
        using errcode = 'invalid_parameter_value';
    end if;
  elsif new.entry_type = 'annulment' and not new.affects_balance then
    raise exception 'a reference annulment must name the reference entry it compensates'
      using errcode = 'check_violation';
  end if;
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.collector_ledger_entries_guard_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if (new.id, new.campaign_id, new.collector_id, new.settlement_id, new.payment_id, new.entry_type,
      new.direction, new.amount, new.occurred_at, new.created_by, new.created_at, new.reason,
      new.affects_balance, new.original_entry_id)
     is distinct from
     (old.id, old.campaign_id, old.collector_id, old.settlement_id, old.payment_id, old.entry_type,
       old.direction, old.amount, old.occurred_at, old.created_by, old.created_at, old.reason,
       old.affects_balance, old.original_entry_id) then
    raise exception 'ledger entry history is immutable' using errcode = 'restrict_violation';
  end if;
  if old.status <> 'recorded' or new.status not in ('annulled', 'compensated') then
    raise exception 'ledger entry status can only change from recorded to annulled or compensated'
      using errcode = 'check_violation';
  end if;
  if new.status = 'compensated' and (
    current_setting('app.ledger_compensation', true) is distinct from old.id::text
    or public.collector_ledger_uncompensated(old.id) <> 0
  ) then
    raise exception 'an entry becomes compensated only when its compensations add up to its amount'
      using errcode = 'check_violation';
  end if;
  if new.status = 'annulled' and (old.original_entry_id is not null or exists (
    select 1 from public.collector_ledger_entries c where c.original_entry_id = old.id and c.status <> 'annulled'
  )) then
    raise exception 'a compensating or compensated entry cannot be annulled; record a compensation instead'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  return new;
end; $function$;

-- Marks the original entry compensated once its compensations cover it.
create function public.collector_ledger_entries_mark_compensated() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_flag text := current_setting('app.ledger_compensation', true);
begin
  if new.original_entry_id is not null and public.collector_ledger_uncompensated(new.original_entry_id) = 0 then
    perform set_config('app.ledger_compensation', new.original_entry_id::text, true);
    update public.collector_ledger_entries set status = 'compensated' where id = new.original_entry_id;
    perform set_config('app.ledger_compensation', coalesce(v_flag, ''), true);
  end if;
  return null;
end $$;
revoke all on function public.collector_ledger_entries_mark_compensated() from public, anon, authenticated, service_role;

create trigger collector_ledger_entries_mark_compensated
  after insert on public.collector_ledger_entries
  for each row execute function public.collector_ledger_entries_mark_compensated();

CREATE OR REPLACE FUNCTION public.collector_ledger_balance(p_campaign_id uuid, p_collector_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (public.collector_ledger_can_read() or public.collector_ledger_is_own_collector(p_collector_id)) then
    raise exception 'permission denied: collector ledger access is required'
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select sum(case when direction = 'collector_credit' then amount else -amount end)
    from public.collector_ledger_entries
    where campaign_id = p_campaign_id and collector_id = p_collector_id and status <> 'annulled'
      and affects_balance
  ), 0);
end $function$;

CREATE OR REPLACE FUNCTION public.commission_settle(p_campaign_id uuid, p_collector_id uuid, p_amount numeric, p_reason text, p_request_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  from public.collector_ledger_entries where campaign_id = p_campaign_id and collector_id = p_collector_id and status <> 'annulled' and affects_balance;
  if p_amount > v_balance then raise exception 'amount cannot exceed current collector balance' using errcode = 'invalid_parameter_value'; end if;
  insert into public.collector_ledger_entries(campaign_id, collector_id, entry_type, direction, amount, reason, created_by)
  values(p_campaign_id, p_collector_id, 'commission_settled', 'collector_debit', p_amount, v_reason, v_actor) returning id into v_id;
  insert into public.audit_log(actor_user_id, action, entity_type, entity_id, new_value, reason, request_id)
  values(v_actor, 'commission.settle', 'collector_ledger_entry', v_id::text,
    jsonb_build_object('campaign_id', p_campaign_id, 'collector_id', p_collector_id, 'amount', p_amount), v_reason, p_request_id);
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.settlement_totals(p_settlement_id uuid)
 RETURNS TABLE(total_cash numeric, total_transfer numeric, total_amount numeric, commission_amount numeric, commission_paid_amount numeric, net_to_firefighters numeric, collector_credit_balance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        and affects_balance
    ), 0) + c.generated - c.paid
  from amounts a cross join commission_totals c;
end $function$;

-- entry_count keeps counting reference entries (they are rows of the account); the totals do not.
CREATE OR REPLACE FUNCTION public.report_collector_accounts(p_campaign_id uuid, p_collector_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(collector_id uuid, collector_name text, entry_count bigint, credit_total text, debit_total text, balance text, last_entry_on date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.report_require_financial(p_campaign_id);
  return query
  select e.collector_id, c.display_name, count(*),
    coalesce(sum(e.amount) filter (where e.direction = 'collector_credit' and e.affects_balance), 0)::numeric(14,2)::text,
    coalesce(sum(e.amount) filter (where e.direction = 'collector_debit' and e.affects_balance), 0)::numeric(14,2)::text,
    coalesce(sum(case when not e.affects_balance then 0 when e.direction = 'collector_credit' then e.amount else -e.amount end), 0)::numeric(14,2)::text,
    max((e.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date)
  from public.collector_ledger_entries e
  join public.collectors c on c.id = e.collector_id
  where e.campaign_id = p_campaign_id and e.status <> 'annulled'
    and (p_collector_id is null or e.collector_id = p_collector_id)
  group by e.collector_id, c.display_name
  order by c.display_name, e.collector_id;
end $function$;

drop function public.collector_ledger_entries_with_balance(uuid, uuid);
CREATE FUNCTION public.collector_ledger_entries_with_balance(p_campaign_id uuid, p_collector_id uuid)
 RETURNS TABLE(id uuid, occurred_at timestamp with time zone, entry_type text, direction text, amount numeric, status text, settlement_id uuid, payment_id uuid, reason text, annul_reason text, running_balance numeric, affects_balance boolean, original_entry_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not (public.collector_ledger_can_read() or public.collector_ledger_is_own_collector(p_collector_id)) then raise exception 'permission denied: collector ledger access is required' using errcode='insufficient_privilege'; end if;
 return query select e.id,e.occurred_at,e.entry_type,e.direction,e.amount,e.status,e.settlement_id,e.payment_id,e.reason,e.annul_reason,
   sum(case when e.status='annulled' or not e.affects_balance then 0 when e.direction='collector_credit' then e.amount else -e.amount end) over(order by e.occurred_at,e.created_at,case when e.affects_balance then 0 else 1 end,case when e.direction='collector_credit' then 0 else 1 end,e.id),
   e.affects_balance,e.original_entry_id
 from public.collector_ledger_entries e where e.campaign_id=p_campaign_id and e.collector_id=p_collector_id order by e.occurred_at,e.created_at,case when e.affects_balance then 0 else 1 end,case when e.direction='collector_credit' then 0 else 1 end,e.id;
end $function$;
revoke all on function public.collector_ledger_entries_with_balance(uuid, uuid) from public, anon, service_role;
grant execute on function public.collector_ledger_entries_with_balance(uuid, uuid) to authenticated;

drop function public.report_collector_ledger(uuid, uuid, date, date, integer, integer);
CREATE FUNCTION public.report_collector_ledger(p_campaign_id uuid, p_collector_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0)
 RETURNS TABLE(entry_id uuid, occurred_on date, occurred_time text, entry_type text, direction text, amount text, status text, settlement_number integer, reason text, running_balance text, affects_balance boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.report_require_financial(p_campaign_id);
  if p_collector_id is null then
    raise exception 'collector is required' using errcode = 'invalid_parameter_value';
  end if;
  return query
  select x.id, x.on_date, x.at_time, x.entry_type, x.direction, x.amount::numeric(14,2)::text, x.status,
    x.settlement_number, x.reason, x.balance::numeric(14,2)::text, x.affects_balance
  from (
    select e.id, e.entry_type, e.direction, e.amount, e.status, e.reason, s.settlement_number, e.affects_balance,
      (e.occurred_at at time zone 'America/Argentina/Buenos_Aires')::date as on_date,
      to_char(e.occurred_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI') as at_time,
      e.occurred_at, e.created_at,
      sum(case when e.status = 'annulled' or not e.affects_balance then 0 when e.direction = 'collector_credit' then e.amount else -e.amount end)
        over (order by e.occurred_at, e.created_at, case when e.affects_balance then 0 else 1 end, case when e.direction = 'collector_credit' then 0 else 1 end, e.id) as balance
    from public.collector_ledger_entries e
    left join public.settlements s on s.id = e.settlement_id
    where e.campaign_id = p_campaign_id and e.collector_id = p_collector_id
  ) x
  where (p_from is null or x.on_date >= p_from) and (p_to is null or x.on_date <= p_to)
  order by x.occurred_at, x.created_at, case when x.affects_balance then 0 else 1 end, case when x.direction = 'collector_credit' then 0 else 1 end, x.id
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end $function$;
revoke all on function public.report_collector_ledger(uuid, uuid, date, date, integer, integer) from public, anon, service_role;
grant execute on function public.report_collector_ledger(uuid, uuid, date, date, integer, integer) to authenticated;

drop function public.collector_ledger_adjust(uuid, uuid, numeric, text, text, text);
CREATE FUNCTION public.collector_ledger_adjust(p_campaign_id uuid, p_collector_id uuid, p_amount numeric, p_direction text, p_reason text, p_request_id text DEFAULT NULL::text, p_original_entry_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.settlement_require_actor('collector.ledger.adjust'); v_reason text := nullif(btrim(p_reason),''); v_id uuid;
begin
  if p_amount is null or p_amount<=0 or p_amount='NaN' or p_amount<>round(p_amount,2) then raise exception 'amount must be a positive amount with at most 2 decimal places' using errcode='invalid_parameter_value'; end if;
  if v_reason is null or length(v_reason)>1000 then raise exception 'a trimmed reason of at most 1000 characters is required' using errcode='invalid_parameter_value'; end if;
  if p_direction not in ('collector_credit','collector_debit') then raise exception 'invalid ledger direction' using errcode='invalid_parameter_value'; end if;
  if not exists(select 1 from public.collectors where id=p_collector_id) then raise exception 'collector % not found',p_collector_id using errcode='no_data_found'; end if;
  -- Debits and every compensation take the collector's advisory lock first (uniform lock order, #130).
  if p_direction='collector_debit' or p_original_entry_id is not null then perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text || p_collector_id::text, 68)); end if;
  insert into public.collector_ledger_entries(campaign_id,collector_id,entry_type,direction,amount,reason,created_by,original_entry_id)
  values(p_campaign_id,p_collector_id,case when p_direction='collector_credit' then 'adjustment_in_favor_of_collector' else 'adjustment_in_favor_of_firefighters' end,p_direction,p_amount,v_reason,v_actor,p_original_entry_id) returning id into v_id;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,new_value,reason,request_id)
  values(v_actor,'collector_ledger.adjust','collector_ledger_entry',v_id::text,jsonb_build_object('campaign_id',p_campaign_id,'collector_id',p_collector_id,'amount',p_amount,'direction',p_direction,'original_entry_id',p_original_entry_id),v_reason,p_request_id);
  return v_id;
end $function$;
revoke all on function public.collector_ledger_adjust(uuid, uuid, numeric, text, text, text, uuid) from public, anon, service_role;
grant execute on function public.collector_ledger_adjust(uuid, uuid, numeric, text, text, text, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.settlement_close(p_settlement_id uuid, p_request_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Reference entries: what the collector handed in and what reached Firefighters by transfer.
  if v_tot.total_cash > 0 then
    insert into public.collector_ledger_entries(campaign_id, collector_id, settlement_id, entry_type, direction, amount, affects_balance, created_by)
    values(v_set.campaign_id, v_set.collector_id, p_settlement_id, 'cash_settled', 'collector_credit', v_tot.total_cash, false, v_actor);
  end if;
  if v_tot.total_transfer > 0 then
    insert into public.collector_ledger_entries(campaign_id, collector_id, settlement_id, entry_type, direction, amount, affects_balance, created_by)
    values(v_set.campaign_id, v_set.collector_id, p_settlement_id, 'transfer_received_by_firefighters', 'collector_credit', v_tot.total_transfer, false, v_actor);
  end if;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (v_actor, 'settlement.close', 'settlement', p_settlement_id::text,
    jsonb_build_object('status', 'closed', 'total_amount', v_tot.total_amount), p_request_id);
end $function$;

CREATE OR REPLACE FUNCTION public.payment_apply_correction(p_type text, p_payment_id uuid, p_new_method text, p_new_sale_id uuid, p_applications jsonb, p_reason text, p_request_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.settlement_require_actor('payment.annul');
  v_reason text := nullif(btrim(p_reason),'');
  v_old public.payments; v_new public.payments; v_set public.settlements; v_sale public.sales;
  v_apps jsonb; v_ids uuid[]; v_id uuid; v_result uuid; v_sum numeric:=0; v_amount numeric;
  v_old_comm numeric; v_movements jsonb:='[]';
  v_flag text := current_setting('app.payment_correction',true);
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  x jsonb; r record; v_previous jsonb; v_memo text;
begin
  if v_reason is null or char_length(v_reason)>1000 then
    raise exception 'a trimmed reason of at most 1000 characters is required' using errcode='invalid_parameter_value';
  end if;
  if p_type not in ('annul','correct_method','reassociate_transfer') or p_type is null then
    raise exception 'invalid correction type' using errcode='invalid_parameter_value';
  end if;
  select * into v_old from public.payments where id=p_payment_id;
  if not found then raise exception 'payment not found' using errcode='no_data_found'; end if;
  -- Settlement -> payment -> ALL old/new installments ordered by id -> ledger lock.
  select * into v_set from public.settlements where id=v_old.settlement_id for update;
  select * into v_old from public.payments where id=p_payment_id for update;
  if not (v_old.status='confirmed' or
    (p_type='annul' and v_old.status='pending_in_settlement' and v_set.status='open')) then
    raise exception 'payment is not eligible for this correction' using errcode='object_not_in_prerequisite_state';
  end if;
  if p_type='correct_method' and (p_new_method is null or p_new_method not in ('cash','transfer') or p_new_method=v_old.payment_method) then
    raise exception 'a different valid payment method is required' using errcode='invalid_parameter_value';
  end if;
  if p_type='reassociate_transfer' then
    if v_old.payment_method<>'transfer' or p_new_sale_id is null or p_new_sale_id=v_old.sale_id then
      raise exception 'reassociation requires a transfer and a different sale' using errcode='invalid_parameter_value';
    end if;
    select * into v_sale from public.sales where id=p_new_sale_id for share;
    if not found then raise exception 'sale not found' using errcode='no_data_found'; end if;
    if v_sale.status<>'active' or (v_sale.campaign_id,v_sale.collector_id) is distinct from (v_old.campaign_id,v_old.collector_id) then
      raise exception 'sale must be active and have the same campaign and collector' using errcode='invalid_parameter_value';
    end if;
    v_apps:=p_applications;
  else
    select * into v_sale from public.sales where id=v_old.sale_id;
    select jsonb_agg(jsonb_build_object('installment_id',installment_id,'amount_applied',amount_applied))
      into v_apps from public.payment_installments where payment_id=p_payment_id;
  end if;
  if v_apps is null or jsonb_typeof(v_apps)<>'array' then
    raise exception 'applications must be a nonempty array' using errcode='invalid_parameter_value';
  end if;
  if jsonb_array_length(v_apps)=0 then
    raise exception 'applications must be a nonempty array' using errcode='invalid_parameter_value';
  end if;
  for x in select value from jsonb_array_elements(v_apps) loop
    begin v_id:=(x->>'installment_id')::uuid; v_amount:=(x->>'amount_applied')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid payment application' using errcode='invalid_parameter_value';
    end;
    if v_id is null or v_amount is null or v_amount<=0 or v_amount='NaN'
      or v_amount>=10000000000 or v_amount<>round(v_amount,2) or v_id=any(coalesce(v_ids,'{}')) then
      raise exception 'invalid or duplicate payment application' using errcode='invalid_parameter_value';
    end if;
    v_ids:=array_append(v_ids,v_id); v_sum:=v_sum+v_amount;
  end loop;
  if v_sum<>v_old.amount then
    raise exception 'applications must equal payment amount' using errcode='invalid_parameter_value';
  end if;
  perform i.id from public.installments i where i.id=any(v_ids) or i.id in (
    select installment_id from public.payment_installments where payment_id=p_payment_id
  ) order by i.id for update;
  -- Validate destination against ALL live reservations, not just confirmed coverage.
  if p_type='reassociate_transfer' then
    for x in select value from jsonb_array_elements(v_apps) loop
      if not exists (
        select 1 from public.installments i join public.payment_plans pp on pp.id=i.payment_plan_id
        where i.id=(x->>'installment_id')::uuid and pp.sale_id=v_sale.id and pp.status='active'
          and i.status<>'annulled' and (x->>'amount_applied')::numeric<=i.amount-coalesce((
            select sum(pi.amount_applied) from public.payment_installments pi
            join public.payments p on p.id=pi.payment_id where pi.installment_id=i.id
              and p.status not in ('annulled','adjusted')
          ),0)
      ) then raise exception 'invalid destination installment or insufficient remaining amount' using errcode='invalid_parameter_value'; end if;
    end loop;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_old.campaign_id::text||v_old.collector_id::text,68));
  v_old_comm:=public.payment_correction_commission(p_payment_id);
  v_previous:=jsonb_build_object('payment',to_jsonb(v_old),'applications',(
    select jsonb_agg(to_jsonb(pi)) from public.payment_installments pi where payment_id=p_payment_id));
  perform set_config('app.payment_correction',p_payment_id::text,true);
  if p_type='annul' then
    update public.payments set status='annulled',annulled_by=v_actor,annulled_at=now(),annulment_reason=v_reason
      where id=p_payment_id returning * into v_new;
    v_result:=p_payment_id;
  else
    update public.payments set status='adjusted' where id=p_payment_id;
    insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,settlement_id,amount,payment_method,payment_date,status,created_by,replaces_payment_id)
      values(v_old.campaign_id,v_sale.id,v_old.collector_id,
        case when p_type='correct_method' then v_old.buyer_id else v_sale.buyer_id end,v_old.settlement_id,v_old.amount,
        case when p_type='correct_method' then p_new_method else 'transfer' end,
        v_old.payment_date,'confirmed',v_actor,p_payment_id) returning * into v_new;
    v_result:=v_new.id;
    insert into public.payment_installments(payment_id,installment_id,amount_applied)
      select v_result,(value->>'installment_id')::uuid,(value->>'amount_applied')::numeric
      from jsonb_array_elements(v_apps) order by value->>'installment_id';
  end if;
  -- Method changes preserve coverage and installment statuses exactly.
  if p_type<>'correct_method' and v_old.status='confirmed' then
    for r in select i.* from public.installments i where i.id=any(v_ids) or i.id in (
      select installment_id from public.payment_installments where payment_id=p_payment_id
    ) order by i.id loop
      select coalesce(sum(pi.amount_applied),0) into v_amount from public.payment_installments pi
        join public.payments p on p.id=pi.payment_id where pi.installment_id=r.id and p.status='confirmed';
      update public.installments set status=case when v_amount>=r.amount then
        case when r.due_date>v_today then 'paid_advance' else 'paid' end
        else case when r.due_date<v_today then 'overdue' else 'pending' end end
        where id=r.id and status<>'annulled';
    end loop;
    update public.bonds b set financial_status_snapshot=public.bond_financial_status_from_installments(b.id)
      where b.id in (select bond_id from public.sales where id in (v_old.sale_id,v_sale.id));
  end if;
  perform set_config('app.payment_correction',coalesce(v_flag,''),true);
  -- Every compensating row uses annulment, including replacement commission credits.
  -- No principal cash/transfer ledger entries (SAN-68); zero commission writes no row.
  for r in
    select p_payment_id payment_id,'collector_debit' direction,v_old_comm amount,'commission_generated' original_type
      where v_old.status='confirmed' and p_type in ('annul','reassociate_transfer')
    union all select p_payment_id,'collector_credit',v_old_comm,'commission_settled'
      where v_old.status='confirmed' and v_old.payment_method='cash' and p_type in ('annul','correct_method')
    union all select v_result,'collector_debit',v_old_comm,null::text
      where p_type='correct_method' and p_new_method='cash'
    union all select v_result,'collector_credit',public.payment_correction_commission(v_result),null::text
      where p_type='reassociate_transfer'
  loop
    if r.amount>0 then
      insert into public.collector_ledger_entries(campaign_id,collector_id,settlement_id,payment_id,entry_type,direction,amount,reason,created_by,original_entry_id)
        values(v_old.campaign_id,v_old.collector_id,v_old.settlement_id,r.payment_id,'annulment',r.direction,r.amount,v_reason,v_actor,
          public.ledger_compensation_target(v_old.settlement_id,v_old.collector_id,r.original_type,r.amount))
        returning id into v_id;
      v_movements:=v_movements||jsonb_build_array(v_id);
    end if;
  end loop;
  -- SAN-107: a method change on a closed settlement moves the amount between its reference entries,
  -- so they keep adding up to total_cash / total_transfer.
  if p_type='correct_method' and v_set.status in ('closed','corrected') then
    v_memo:=case when v_old.payment_method='cash' then 'cash_settled' else 'transfer_received_by_firefighters' end;
    insert into public.collector_ledger_entries(campaign_id,collector_id,settlement_id,payment_id,entry_type,direction,amount,affects_balance,reason,created_by,original_entry_id)
      values(v_old.campaign_id,v_old.collector_id,v_old.settlement_id,p_payment_id,'annulment','collector_debit',v_old.amount,false,v_reason,v_actor,
        public.ledger_compensation_target(v_old.settlement_id,v_old.collector_id,v_memo,v_old.amount))
      returning id into v_id;
    v_movements:=v_movements||jsonb_build_array(v_id);
    insert into public.collector_ledger_entries(campaign_id,collector_id,settlement_id,payment_id,entry_type,direction,amount,affects_balance,reason,created_by)
      values(v_old.campaign_id,v_old.collector_id,v_old.settlement_id,v_result,
        case when p_new_method='cash' then 'cash_settled' else 'transfer_received_by_firefighters' end,
        'collector_credit',v_old.amount,false,v_reason,v_actor)
      returning id into v_id;
    v_movements:=v_movements||jsonb_build_array(v_id);
  end if;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,old_value,new_value,reason,request_id)
    values(v_actor,'payment.'||p_type,'payment',p_payment_id::text,v_previous,
      jsonb_build_object('correction_type',p_type,'affected_entity',jsonb_build_object('type','payment','id',p_payment_id),
        'related_entity',jsonb_build_object('type',case when p_type='annul' then 'settlement' else 'payment' end,
          'id',case when p_type='annul' then v_old.settlement_id else v_result end),
        'reason',v_reason,'user',v_actor,'date',now(),'previous_value',v_previous,
        'new_value',jsonb_build_object('original_status',case when p_type='annul' then 'annulled' else 'adjusted' end,
          'payment',to_jsonb(v_new),'applications',v_apps),'generated_compensatory_movements',v_movements),
      v_reason,p_request_id);
  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.sale_apply_correction(p_sale_id uuid, p_target_id uuid, p_kind text, p_reason text, p_request_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.settlement_require_actor('sale.correct');
  v_reason text := nullif(btrim(p_reason),'');
  v_old public.sales; v_new public.sales; v_note public.delivery_notes;
  v_payments uuid[]; v_current uuid[]; v_collector uuid;
  v_previous jsonb; v_next jsonb; v_movements jsonb := '[]';
  v_flag text := current_setting('app.sale_correction',true);
  v_amount numeric; v_commission numeric; v_id uuid; p record; r record;
begin
  if v_reason is null or char_length(v_reason)>1000 or p_target_id is null
    or p_kind is null or p_kind not in ('buyer','collector') then
    raise exception 'invalid correction or reason (1..1000 characters)' using errcode='invalid_parameter_value';
  end if;
  select * into v_old from public.sales where id=p_sale_id;
  if not found then raise exception 'sale not found' using errcode='no_data_found'; end if;
  -- Lock every existing campaign settlement: admission takes settlement then sale SHARE.
  -- New settlements can appear meanwhile; the payment-id recheck below refuses that race.
  -- NO KEY UPDATE still serializes state changes/admission, but permits FK KEY SHARE
  -- from existing manual ledger services (which may already hold a ledger lock).
  -- A collector correction may move commission between collectors, so it serializes against
  -- every settlement of the campaign. A buyer correction touches no payment or ledger row:
  -- it only locks the settlements of this sale's own payments (review of #72).
  if p_kind='collector' then
    perform id from public.settlements where campaign_id=v_old.campaign_id order by id for no key update;
  else
    perform s.id from public.settlements s
    where s.id in (select pay.settlement_id from public.payments pay where pay.sale_id=p_sale_id)
    order by s.id for no key update;
  end if;
  select coalesce(array_agg(id order by id),'{}') into v_payments from public.payments where sale_id=p_sale_id;
  perform id from public.payments where id=any(v_payments) order by id for no key update;
  select * into v_old from public.sales where id=p_sale_id for update;
  select coalesce(array_agg(id order by id),'{}') into v_current from public.payments where sale_id=p_sale_id;
  if v_current is distinct from v_payments then
    raise exception 'sale payments changed; reload and retry' using errcode='object_not_in_prerequisite_state';
  end if;
  if v_old.status<>'active' then raise exception 'sale must be active' using errcode='object_not_in_prerequisite_state'; end if;
  perform i.id from public.installments i join public.payment_plans pp on pp.id=i.payment_plan_id
    where pp.sale_id=p_sale_id order by i.id for update of i;
  if p_kind='buyer' then
    perform 1 from public.buyers where id=p_target_id for share;
    if not found then raise exception 'buyer not found' using errcode='no_data_found'; end if;
    if v_old.buyer_id=p_target_id then raise exception 'buyer must differ' using errcode='invalid_parameter_value'; end if;
  else
    perform public.delivery_require_collector(p_target_id);
    if v_old.collector_id=p_target_id then raise exception 'collector must differ' using errcode='invalid_parameter_value'; end if;
    if exists(select 1 from public.payments pay join public.settlements s on s.id=pay.settlement_id
      where pay.sale_id=p_sale_id and s.status='open' and pay.status not in ('annulled','adjusted')) then
      raise exception 'remove payments from open settlements before correcting the collector' using errcode='object_not_in_prerequisite_state';
    end if;
    -- Draft payments are immutable historical parties too; remove/correct them first.
    if exists(select 1 from public.payments where sale_id=p_sale_id and status='draft') then
      raise exception 'resolve draft payments before correcting the collector' using errcode='object_not_in_prerequisite_state';
    end if;
    for v_collector in select distinct c from unnest(array[v_old.collector_id,p_target_id]) c order by c loop
      perform pg_advisory_xact_lock(hashtextextended(v_old.campaign_id::text||v_collector::text,68));
    end loop;
  end if;
  perform 1 from public.bonds where id=v_old.bond_id for update;
  if not exists(select 1 from public.bonds where id=v_old.bond_id and commercial_status='sold') then
    raise exception 'sale bond must be sold' using errcode='object_not_in_prerequisite_state';
  end if;
  v_previous:=jsonb_build_object('sale',to_jsonb(v_old),'buyer',(
    select to_jsonb(b) from public.buyers b where id=v_old.buyer_id));
  perform set_config('app.sale_correction',p_sale_id::text,true);
  if p_kind='collector' then
    for p in select * from public.payments where sale_id=p_sale_id and status='confirmed' order by id loop
      -- SAN-71 helper supplies original attribution on the first move; subsequent moves
      -- use the sale's current collector, not the immutable payment collector.
      if p.collector_id=v_old.collector_id then
        v_commission:=public.payment_correction_commission(p.id);
      else
        select coalesce(sum(public.settlement_application_commission(p.campaign_id,v_old.collector_id,
          p.payment_date,v_old.payment_mode,i.installment_number,pp.installment_count,pi.amount_applied,i.amount)),0)
          into v_commission from public.payment_installments pi join public.installments i on i.id=pi.installment_id
          join public.payment_plans pp on pp.id=i.payment_plan_id where pi.payment_id=p.id;
      end if;
      select coalesce(sum(public.settlement_application_commission(p.campaign_id,p_target_id,
        p.payment_date,v_old.payment_mode,i.installment_number,pp.installment_count,pi.amount_applied,i.amount)),0)
        into v_amount from public.payment_installments pi join public.installments i on i.id=pi.installment_id
        join public.payment_plans pp on pp.id=i.payment_plan_id where pi.payment_id=p.id;
      for r in
        select v_old.collector_id collector,'collector_debit' direction,v_commission amount,'commission_generated' original_type
        union all select v_old.collector_id,'collector_credit',v_commission,'commission_settled' where p.payment_method='cash'
        union all select p_target_id,'collector_credit',v_amount,null::text
        union all select p_target_id,'collector_debit',v_amount,null::text where p.payment_method='cash'
      loop
        if r.amount>0 then
          insert into public.collector_ledger_entries(campaign_id,collector_id,corrects_sale_id,entry_type,direction,amount,reason,created_by,original_entry_id)
            values(v_old.campaign_id,r.collector,p_sale_id,'annulment',r.direction,r.amount,v_reason,v_actor,
              public.ledger_compensation_target(p.settlement_id,r.collector,r.original_type,r.amount)) returning id into v_id;
          v_movements:=v_movements||jsonb_build_array(v_id);
        end if;
      end loop;
    end loop;
    v_note:=public.delivery_issue_note(v_old.campaign_id,p_target_id,v_actor,v_reason,'reassignment');
    update public.bond_assignments set status='reassigned' where bond_id=v_old.bond_id and status='active';
    insert into public.delivery_note_items(delivery_note_id,bond_id,campaign_id)
      values(v_note.id,v_old.bond_id,v_old.campaign_id);
    insert into public.bond_assignments(campaign_id,bond_id,collector_id,assignment_type,status,created_by,delivery_note_id)
      values(v_old.campaign_id,v_old.bond_id,p_target_id,'reassignment','active',v_actor,v_note.id);
  end if;
  update public.sales set buyer_id=case when p_kind='buyer' then p_target_id else buyer_id end,
    collector_id=case when p_kind='collector' then p_target_id else collector_id end
    where id=p_sale_id returning * into v_new;
  update public.bonds set current_buyer_id=v_new.buyer_id,current_collector_id=v_new.collector_id where id=v_old.bond_id;
  v_next:=jsonb_build_object('sale',to_jsonb(v_new),'buyer',(
    select to_jsonb(b) from public.buyers b where id=v_new.buyer_id),'delivery_note_id',v_note.id);
  perform public.correction_audit(v_actor,'correct_'||p_kind,'sale',p_sale_id,
    jsonb_build_object('type','bond','id',v_old.bond_id),v_reason,v_previous,v_next,v_movements,p_request_id);
  perform set_config('app.sale_correction',coalesce(v_flag,''),true);
end $function$;

CREATE OR REPLACE FUNCTION public.settlement_correct(p_settlement_id uuid, p_reason text, p_adjustments jsonb DEFAULT NULL::jsonb, p_request_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid:=public.settlement_require_actor('settlement.correct');
  v_reason text:=nullif(btrim(p_reason),''); v_old public.settlements; v_new public.settlements;
  v_comm numeric; v_cash numeric; v_id uuid; v_result uuid; r record;
  v_movements jsonb:='[]'; v_flag text:=current_setting('app.settlement_correction',true);
begin
  if v_reason is null or char_length(v_reason)>1000 then
    raise exception 'reason required (1..1000 characters)' using errcode='invalid_parameter_value';
  end if;
  if p_adjustments is null or jsonb_typeof(p_adjustments)<>'object'
    or not (p_adjustments ?& array['commission_delta','cash_retained_delta'])
    or (p_adjustments-array['commission_delta','cash_retained_delta'])<>'{}'::jsonb then
    raise exception 'adjustments require commission_delta and cash_retained_delta only' using errcode='invalid_parameter_value';
  end if;
  begin
    v_comm:=(p_adjustments->>'commission_delta')::numeric;
    v_cash:=(p_adjustments->>'cash_retained_delta')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid adjustment amount' using errcode='invalid_parameter_value';
  end;
  if v_comm is null or v_cash is null or v_comm='NaN' or v_cash='NaN'
    or abs(v_comm)>=10000000000 or abs(v_cash)>=10000000000
    or v_comm<>round(v_comm,2) or v_cash<>round(v_cash,2) or (v_comm=0 and v_cash=0) then
    raise exception 'adjustments must be nonzero signed numeric(12,2) deltas' using errcode='invalid_parameter_value';
  end if;
  select * into v_old from public.settlements where id=p_settlement_id for no key update;
  if not found then raise exception 'settlement not found' using errcode='no_data_found'; end if;
  if v_old.status<>'closed' then raise exception 'only closed settlements can be corrected once' using errcode='object_not_in_prerequisite_state'; end if;
  if v_old.commission_amount+v_comm<0 or v_old.commission_paid_amount+v_cash<0
    or v_old.commission_paid_amount+v_cash>v_old.total_cash
    or v_old.commission_paid_amount+v_cash>v_old.commission_amount+v_comm then
    raise exception 'adjusted commission and cash retention are inconsistent' using errcode='invalid_parameter_value';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_old.campaign_id::text||v_old.collector_id::text,68));
  perform set_config('app.settlement_correction',p_settlement_id::text,true);
  insert into public.settlement_corrections(settlement_id,commission_delta,cash_retained_delta,reason,created_by)
    values(p_settlement_id,v_comm,v_cash,v_reason,v_actor) returning id into v_result;
  for r in select v_comm delta, case when v_comm<0 then 'commission_generated' end original_type
    union all select -v_cash, case when v_cash<0 then 'commission_settled' end loop
    if r.delta<>0 then
      insert into public.collector_ledger_entries(campaign_id,collector_id,settlement_id,entry_type,direction,amount,reason,created_by,original_entry_id)
        values(v_old.campaign_id,v_old.collector_id,p_settlement_id,'annulment',
          case when r.delta>0 then 'collector_credit' else 'collector_debit' end,abs(r.delta),v_reason,v_actor,
          public.ledger_compensation_target(p_settlement_id,v_old.collector_id,r.original_type,abs(r.delta))) returning id into v_id;
      v_movements:=v_movements||jsonb_build_array(v_id);
    end if;
  end loop;
  update public.settlements set status='corrected' where id=p_settlement_id returning * into v_new;
  perform set_config('app.settlement_correction',coalesce(v_flag,''),true);
  perform public.correction_audit(v_actor,'correct','settlement',p_settlement_id,
    jsonb_build_object('type','settlement_correction','id',v_result),v_reason,to_jsonb(v_old),
    jsonb_build_object('settlement',to_jsonb(v_new),'adjustment',p_adjustments),v_movements,p_request_id);
  return v_result;
end $function$;

-- Backfill: settlements closed before this migration get their reference entries, from the stored
-- totals (which already include SAN-110 method corrections), dated at their close.
insert into public.collector_ledger_entries(campaign_id, collector_id, settlement_id, entry_type, direction, amount, affects_balance, occurred_at, created_by)
select s.campaign_id, s.collector_id, s.id, m.entry_type, 'collector_credit', m.amount, false, s.closed_at, s.closed_by
from public.settlements s
cross join lateral (values ('cash_settled', s.total_cash), ('transfer_received_by_firefighters', s.total_transfer)) m(entry_type, amount)
where s.status in ('closed', 'corrected') and m.amount > 0 and s.closed_by is not null
  and not exists (
    select 1 from public.collector_ledger_entries e
    where e.settlement_id = s.id and e.entry_type in ('cash_settled', 'transfer_received_by_firefighters')
  );
