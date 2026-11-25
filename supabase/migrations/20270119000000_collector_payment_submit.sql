-- SAN-147: collector portal "Registrar cobro" (Phase 16).
--
-- The collector can REGISTER a collection, but it does not replace the settlement with the operator:
--   * `portal_payment_submit` creates a `draft` payment (no settlement). A draft never changes installments, the
--     financial snapshot, commissions or the ledger: `settlement_close` only confirms `pending_in_settlement`.
--   * A draft still RESERVES the installment balance (payment_installments_guard_insert counts every payment that is
--     not annulled/adjusted), so two submissions cannot exceed the installment together.
--   * The operator/treasurer either includes it in an open settlement of that collector
--     (`settlement_attach_collector_payment`: draft -> pending_in_settlement) or rejects it with a reason
--     (`settlement_reject_collector_payment`: draft -> annulled, reason stored in `annulment_reason`).
--   * The collector gets no DML on payments and none of payment.create / payment.annul / settlement.*: it cannot
--     confirm, edit after submitting, or annul.
-- Lock order everywhere: settlement -> payment -> installments (same as settlement_add_payment / settlement_close).

alter table public.payments add column submitted_by_collector boolean not null default false;
alter table public.payments add column collector_note text;
alter table public.payments add constraint payments_collector_note_format check (
  collector_note is null or (submitted_by_collector and collector_note = btrim(collector_note)
    and collector_note <> '' and char_length(collector_note) <= 500));
create index payments_collector_submitted_idx on public.payments (collector_id, campaign_id)
  where status = 'draft' and submitted_by_collector;

-- A collector submission always starts as a settlement-less draft and that flag never changes afterwards.
create function public.payments_collector_submission_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.submitted_by_collector and (new.status <> 'draft' or new.settlement_id is not null) then
      raise exception 'a collector submission must start as a draft without settlement' using errcode = 'check_violation';
    end if;
  elsif (new.submitted_by_collector, new.collector_note) is distinct from (old.submitted_by_collector, old.collector_note) then
    raise exception 'payment origin and collector note are immutable' using errcode = 'restrict_violation';
  end if;
  return new;
end $$;
create trigger payments_collector_submission_guard_insert before insert on public.payments
  for each row execute function public.payments_collector_submission_guard();
create trigger payments_collector_submission_guard_update before update on public.payments
  for each row execute function public.payments_collector_submission_guard();

-- Same guard as 20261214000000 plus the rejection transition draft -> annulled.
create or replace function public.payments_guard_update() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.id, new.campaign_id, new.sale_id, new.collector_id, new.buyer_id, new.amount, new.payment_method,
      new.payment_date, new.created_by, new.created_at) is distinct from
     (old.id, old.campaign_id, old.sale_id, old.collector_id, old.buyer_id, old.amount, old.payment_method,
      old.payment_date, old.created_by, old.created_at) then
    raise exception 'payment amount, method, date and parties are immutable' using errcode = 'restrict_violation';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status = 'pending_in_settlement') or
    -- rejecting a collector submission is the only draft -> annulled path (least privilege)
    (old.status = 'draft' and new.status = 'annulled' and old.submitted_by_collector) or
    (old.status = 'pending_in_settlement' and new.status in ('confirmed', 'annulled')) or
    (old.status = 'confirmed' and new.status in ('annulled', 'adjusted'))
  ) then raise exception 'payment status cannot go from % to %', old.status, new.status using errcode = 'check_violation'; end if;
  if new.status in ('draft', 'pending_in_settlement')
     and (new.status = 'pending_in_settlement') is distinct from (new.settlement_id is not null) then
    raise exception 'pending payment settlement is inconsistent' using errcode = 'check_violation';
  end if;
  if old.status <> 'draft' and new.settlement_id is distinct from old.settlement_id then
    raise exception 'payment settlement is immutable after draft' using errcode = 'restrict_violation';
  end if;
  if new.status = 'annulled' and old.status = 'draft' and new.settlement_id is not null then
    raise exception 'a rejected draft has no settlement' using errcode = 'check_violation';
  end if;
  if new.status = 'pending_in_settlement' or new.settlement_id is distinct from old.settlement_id then
    perform public.payments_check_settlement(new.settlement_id, new.collector_id);
  end if;
  new.updated_at := now(); return new;
end; $$;

-- 1. Submit (collector). Everything about "who" comes from the session; the sale must be the caller's own.
create function public.portal_payment_submit(
  p_sale_id uuid, p_amount numeric, p_payment_method text, p_applications jsonb,
  p_payment_date date default null, p_request_id text default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_profile_id();
  v_collector uuid;
  v_sale public.sales;
  v_campaign_status text;
  v_id uuid;
  v_sum numeric := 0;
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_installment uuid;
  v_applied numeric;
  v_existing uuid;
  v_note text := nullif(btrim(p_note), '');
  x jsonb;
begin
  if v_actor is null or not public.has_permission('payment.create_own') then
    raise exception 'permission denied: payment.create_own is required' using errcode = 'insufficient_privilege';
  end if;
  select c.id into v_collector from public.collectors c
    where c.user_profile_id = v_actor and c.status = 'active';
  if v_collector is null then
    raise exception 'permission denied: no active collector for this profile' using errcode = 'insufficient_privilege';
  end if;
  -- Idempotency by request id: a double click returns the payment already created (serialized per request id).
  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('portal_payment_submit:' || p_request_id, 0));
    select a.entity_id::uuid into v_existing from public.audit_log a
      where a.action = 'payment.collector_submit' and a.request_id = p_request_id and a.actor_user_id = v_actor
      order by a.created_at limit 1;
    if v_existing is not null then return v_existing; end if;
  end if;
  if p_amount is null or p_amount <= 0 or p_amount = 'NaN' or p_amount <> round(p_amount, 2)
    or p_amount >= 10000000000 or p_payment_method is null or p_payment_method not in ('cash', 'transfer') then
    raise exception 'invalid payment amount or method' using errcode = 'invalid_parameter_value';
  end if;
  -- Own sale only; a foreign or unknown sale answers exactly the same (not found).
  select * into v_sale from public.sales where id = p_sale_id and collector_id = v_collector for share;
  if not found then
    raise exception 'sale % not found', p_sale_id using errcode = 'no_data_found';
  end if;
  if v_sale.status <> 'active' then
    raise exception 'sale must be active' using errcode = 'invalid_parameter_value';
  end if;
  select status into v_campaign_status from public.campaigns where id = v_sale.campaign_id;
  if v_campaign_status is distinct from 'active' then
    raise exception 'campaign must be active' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_applications) <> 'array' or jsonb_array_length(p_applications) = 0 then
    raise exception 'applications are required' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    raise exception 'note is too long' using errcode = 'invalid_parameter_value';
  end if;
  if p_payment_date > v_today then
    raise exception 'payment date cannot be in the future' using errcode = 'invalid_parameter_value';
  end if;
  if p_payment_date < (v_sale.sold_at at time zone 'America/Argentina/Buenos_Aires')::date then
    raise exception 'payment date cannot be before the sale date' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.payments (
    campaign_id, sale_id, collector_id, buyer_id, settlement_id, amount, payment_method, payment_date,
    status, created_by, submitted_by_collector, collector_note
  ) values (
    v_sale.campaign_id, p_sale_id, v_collector, v_sale.buyer_id, null, p_amount, p_payment_method,
    coalesce(p_payment_date, v_today), 'draft', v_actor, true, v_note
  ) returning id into v_id;
  -- Stable installment order so concurrent submissions cannot deadlock; the guard locks each installment and
  -- counts every non-annulled payment (drafts included), so the remaining balance is never exceeded.
  for x in select value from jsonb_array_elements(p_applications) order by value ->> 'installment_id' loop
    begin
      v_installment := (x ->> 'installment_id')::uuid;
      v_applied := (x ->> 'amount_applied')::numeric;
    exception when others then
      raise exception 'invalid payment application' using errcode = 'invalid_parameter_value';
    end;
    if v_applied is null or v_applied <= 0 or v_applied <> round(v_applied, 2) then
      raise exception 'application amount must be positive' using errcode = 'invalid_parameter_value';
    end if;
    if not exists (select 1 from public.installments where id = v_installment and status in ('pending', 'overdue')) then
      raise exception 'installment is not collectable' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.payment_installments (payment_id, installment_id, amount_applied)
    values (v_id, v_installment, v_applied);
    v_sum := v_sum + v_applied;
  end loop;
  if v_sum <> p_amount then
    raise exception 'payment applications must equal the payment amount' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (v_actor, 'payment.collector_submit', 'payment', v_id::text,
    jsonb_build_object('sale_id', p_sale_id, 'collector_id', v_collector, 'amount', p_amount,
                       'method', p_payment_method, 'status', 'draft'), p_request_id);
  return v_id;
end $$;

-- 2. Include a submitted draft in an open settlement of the same collector and campaign (operator/treasurer).
create function public.settlement_attach_collector_payment(
  p_settlement_id uuid, p_payment_id uuid, p_request_id text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settlement_require_actor('payment.create');
  v_set public.settlements;
  v_payment public.payments;
  v_sale_status text;
begin
  if not public.has_permission('settlement.update_open') then
    raise exception 'permission denied: settlement.update_open is required' using errcode = 'insufficient_privilege';
  end if;
  select * into v_set from public.settlements where id = p_settlement_id for update;
  if not found then
    raise exception 'settlement % not found', p_settlement_id using errcode = 'no_data_found';
  end if;
  if v_set.status <> 'open' then
    raise exception 'settlement must be open' using errcode = 'object_not_in_prerequisite_state';
  end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment % not found', p_payment_id using errcode = 'no_data_found';
  end if;
  if v_payment.status <> 'draft' or not v_payment.submitted_by_collector then
    raise exception 'only a draft submitted by the collector can be included' using errcode = 'object_not_in_prerequisite_state';
  end if;
  if v_payment.collector_id <> v_set.collector_id or v_payment.campaign_id <> v_set.campaign_id then
    raise exception 'payment must belong to the settlement collector and campaign' using errcode = 'invalid_parameter_value';
  end if;
  select status into v_sale_status from public.sales where id = v_payment.sale_id;
  if v_sale_status is distinct from 'active' then
    raise exception 'sale must be active' using errcode = 'invalid_parameter_value';
  end if;
  update public.payments set status = 'pending_in_settlement', settlement_id = p_settlement_id
    where id = p_payment_id;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, old_value, new_value, request_id)
  values (v_actor, 'payment.collector_attach', 'payment', p_payment_id::text,
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'pending_in_settlement', 'settlement_id', p_settlement_id), p_request_id);
end $$;

-- 3. Reject a submitted draft with a reason (draft -> annulled). Its reserved balance is released.
create function public.settlement_reject_collector_payment(
  p_payment_id uuid, p_reason text, p_request_id text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.settlement_require_actor('payment.create');
  v_reason text := nullif(btrim(p_reason), '');
  v_payment public.payments;
begin
  if not public.has_permission('settlement.update_open') then
    raise exception 'permission denied: settlement.update_open is required' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null or char_length(v_reason) > 1000 then
    raise exception 'a rejection reason (up to 1000 characters) is required' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment % not found', p_payment_id using errcode = 'no_data_found';
  end if;
  if v_payment.status <> 'draft' or not v_payment.submitted_by_collector then
    raise exception 'only a draft submitted by the collector can be rejected' using errcode = 'object_not_in_prerequisite_state';
  end if;
  update public.payments
    set status = 'annulled', annulled_by = v_actor, annulled_at = now(), annulment_reason = v_reason
    where id = p_payment_id;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (v_actor, 'payment.collector_reject', 'payment', p_payment_id::text,
    jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'annulled'), v_reason, p_request_id);
end $$;

-- 4. Portal reads: the collector's own submissions (with rejection reason) and the balance reserved by drafts.
create function public.portal_my_sale_submissions(p_sale_id uuid)
returns table (payment_id uuid, payment_date date, amount numeric, payment_method text, status text,
               rejection_reason text, note text, created_at timestamptz, installment_numbers integer[])
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.portal_require_sale_view_own();
  return query
  select p.id, p.payment_date, p.amount, p.payment_method, p.status, p.annulment_reason, p.collector_note, p.created_at,
         coalesce((select array_agg(i.installment_number order by i.installment_number)
                   from public.payment_installments pi join public.installments i on i.id = pi.installment_id
                   where pi.payment_id = p.id), '{}'::integer[])
  from public.payments p
  join public.sales s on s.id = p.sale_id
  where p.sale_id = p_sale_id and public.is_own_collector(s.collector_id) and p.submitted_by_collector
  order by p.created_at desc, p.id;
end $$;

create function public.portal_my_sale_reserved(p_sale_id uuid)
returns table (installment_id uuid, submitted_amount numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.portal_require_sale_view_own();
  return query
  select pi.installment_id, sum(pi.amount_applied)
  from public.payment_installments pi
  join public.payments p on p.id = pi.payment_id
  join public.sales s on s.id = p.sale_id
  where p.sale_id = p_sale_id and p.status = 'draft' and public.is_own_collector(s.collector_id)
  group by pi.installment_id;
end $$;

-- Grants: explicit to authenticated only (never public/anon/service_role).
revoke all on function public.payments_collector_submission_guard() from public, anon, authenticated, service_role;
revoke all on function public.payments_guard_update() from public, anon, authenticated, service_role;
do $$ declare f text; begin
  foreach f in array array[
    'portal_payment_submit(uuid, numeric, text, jsonb, date, text, text)',
    'settlement_attach_collector_payment(uuid, uuid, text)',
    'settlement_reject_collector_payment(uuid, text, text)',
    'portal_my_sale_submissions(uuid)',
    'portal_my_sale_reserved(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, service_role', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
