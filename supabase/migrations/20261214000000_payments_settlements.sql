-- SAN-62: collector settlements, payments and payment-to-installment applications.
-- Writes are reserved for audited SECURITY DEFINER functions (SAN-63).

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  settlement_number integer not null,
  collector_id uuid not null references public.collectors (id) on delete restrict,
  status text not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_by uuid not null references public.profiles (id) on delete restrict,
  closed_by uuid references public.profiles (id) on delete restrict,
  total_cash numeric(12,2) not null default 0,
  total_transfer numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  commission_amount numeric(12,2) not null default 0,
  commission_paid_amount numeric(12,2) not null default 0,
  net_to_firefighters numeric(12,2) not null default 0,
  notes text,
  updated_at timestamptz not null default now(),
  constraint settlements_id_campaign_key unique (id, campaign_id),
  constraint settlements_campaign_number_key unique (campaign_id, settlement_number),
  constraint settlements_number_positive check (settlement_number >= 1),
  constraint settlements_status_check check (status in ('open', 'closed', 'annulled', 'corrected')),
  constraint settlements_totals_nonnegative check (
    total_cash >= 0 and total_transfer >= 0 and total_amount >= 0 and commission_amount >= 0
    and commission_paid_amount >= 0 and net_to_firefighters >= 0
  ),
  constraint settlements_notes_format check (notes is null or (notes = btrim(notes) and notes <> '' and length(notes) <= 2000)),
  constraint settlements_closing_consistent check (
    (status in ('closed', 'corrected') and closed_at is not null and closed_by is not null)
    or (status not in ('closed', 'corrected') and closed_at is null and closed_by is null)
  )
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  sale_id uuid not null,
  collector_id uuid not null references public.collectors (id) on delete restrict,
  buyer_id uuid not null references public.buyers (id) on delete restrict,
  settlement_id uuid,
  amount numeric(12,2) not null,
  payment_method text not null,
  payment_date date not null default current_date,
  status text not null default 'draft',
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  annulled_by uuid references public.profiles (id) on delete restrict,
  annulled_at timestamptz,
  annulment_reason text,
  constraint payments_sale_campaign_fkey foreign key (sale_id, campaign_id)
    references public.sales (id, campaign_id) on delete restrict,
  constraint payments_settlement_campaign_fkey foreign key (settlement_id, campaign_id)
    references public.settlements (id, campaign_id) on delete restrict,
  constraint payments_amount_positive check (amount > 0),
  constraint payments_method_check check (payment_method in ('cash', 'transfer')),
  constraint payments_status_check check (status in ('draft', 'pending_in_settlement', 'confirmed', 'annulled', 'adjusted')),
  constraint payments_annulment_consistent check (
    (status = 'annulled' and annulled_by is not null and annulled_at is not null
      and annulment_reason is not null and annulment_reason = btrim(annulment_reason)
      and annulment_reason <> '' and length(annulment_reason) <= 2000)
    or (status <> 'annulled' and annulled_by is null and annulled_at is null and annulment_reason is null)
  )
);

create table public.payment_installments (
  payment_id uuid not null references public.payments (id) on delete restrict,
  installment_id uuid not null references public.installments (id) on delete restrict,
  amount_applied numeric(12,2) not null,
  primary key (payment_id, installment_id),
  constraint payment_installments_amount_positive check (amount_applied > 0)
);

create index payments_campaign_status_idx on public.payments (campaign_id, status);
create index payments_settlement_idx on public.payments (settlement_id);
create index payments_sale_idx on public.payments (sale_id);
create index payments_collector_idx on public.payments (collector_id);
create index payments_buyer_idx on public.payments (buyer_id);
create index payments_created_by_idx on public.payments (created_by);
create index payment_installments_installment_idx on public.payment_installments (installment_id);

create function public.payments_settlements_forbid_delete() returns trigger language plpgsql set search_path = '' as $$
begin raise exception '% rows are never deleted', tg_table_name using errcode = 'restrict_violation'; end; $$;

create function public.settlements_guard_insert() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status <> 'open' then raise exception 'a new settlement must start open' using errcode = 'check_violation'; end if;
  return new;
end; $$;

create function public.settlements_guard_update() returns trigger language plpgsql set search_path = '' as $$
begin
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
  if old.status <> 'open' and (new.closed_at, new.closed_by) is distinct from (old.closed_at, old.closed_by) then
    raise exception 'closed settlement fields are immutable' using errcode = 'restrict_violation';
  end if;
  new.updated_at := now(); return new;
end; $$;

create function public.payments_guard_insert() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status not in ('draft', 'pending_in_settlement') then
    raise exception 'a new payment must start draft or pending_in_settlement' using errcode = 'check_violation';
  end if;
  if (new.status = 'pending_in_settlement') is distinct from (new.settlement_id is not null) then
    raise exception 'pending payment settlement is inconsistent' using errcode = 'check_violation';
  end if;
  return new;
end; $$;

create function public.payments_guard_update() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.id, new.campaign_id, new.sale_id, new.collector_id, new.buyer_id, new.amount, new.payment_method,
      new.payment_date, new.created_by, new.created_at) is distinct from
     (old.id, old.campaign_id, old.sale_id, old.collector_id, old.buyer_id, old.amount, old.payment_method,
      old.payment_date, old.created_by, old.created_at) then
    raise exception 'payment amount, method, date and parties are immutable' using errcode = 'restrict_violation';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status = 'pending_in_settlement') or
    (old.status = 'pending_in_settlement' and new.status in ('confirmed', 'annulled')) or
    (old.status = 'confirmed' and new.status in ('annulled', 'adjusted'))
  ) then raise exception 'payment status cannot go from % to %', old.status, new.status using errcode = 'check_violation'; end if;
  if old.status <> 'draft' and new.settlement_id is distinct from old.settlement_id then
    raise exception 'payment settlement is immutable after draft' using errcode = 'restrict_violation';
  end if;
  new.updated_at := now(); return new;
end; $$;

create function public.payment_installments_guard_insert() returns trigger language plpgsql set search_path = '' as $$
declare v_sale_id uuid; v_plan_id uuid; v_amount numeric(12,2); v_applied numeric(12,2);
begin
  select sale_id into v_sale_id from public.payments where id = new.payment_id;
  select payment_plan_id, amount into v_plan_id, v_amount from public.installments
    where id = new.installment_id for update;
  if v_sale_id is null or v_plan_id is null or not exists (
    select 1 from public.payment_plans where id = v_plan_id and sale_id = v_sale_id and status = 'active'
  ) then raise exception 'installment must belong to the payment sale active plan' using errcode = 'check_violation'; end if;
  select coalesce(sum(pi.amount_applied), 0) into v_applied from public.payment_installments pi
    join public.payments p on p.id = pi.payment_id where pi.installment_id = new.installment_id and p.status <> 'annulled';
  if v_applied + new.amount_applied > v_amount then
    raise exception 'payment applications exceed installment amount' using errcode = 'check_violation'; end if;
  return new;
end; $$;

create function public.payment_installments_forbid_update() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'payment installment applications are immutable' using errcode = 'restrict_violation'; end; $$;

create trigger settlements_guard_insert before insert on public.settlements for each row execute function public.settlements_guard_insert();
create trigger settlements_guard_update before update on public.settlements for each row execute function public.settlements_guard_update();
create trigger payments_guard_insert before insert on public.payments for each row execute function public.payments_guard_insert();
create trigger payments_guard_update before update on public.payments for each row execute function public.payments_guard_update();
create trigger payment_installments_guard_insert before insert on public.payment_installments for each row execute function public.payment_installments_guard_insert();
create trigger payment_installments_guard_update before update on public.payment_installments for each row execute function public.payment_installments_forbid_update();

create trigger settlements_forbid_delete before delete on public.settlements for each row execute function public.payments_settlements_forbid_delete();
create trigger settlements_forbid_truncate before truncate on public.settlements for each statement execute function public.payments_settlements_forbid_delete();
create trigger payments_forbid_delete before delete on public.payments for each row execute function public.payments_settlements_forbid_delete();
create trigger payments_forbid_truncate before truncate on public.payments for each statement execute function public.payments_settlements_forbid_delete();
create trigger payment_installments_forbid_delete before delete on public.payment_installments for each row execute function public.payments_settlements_forbid_delete();
create trigger payment_installments_forbid_truncate before truncate on public.payment_installments for each statement execute function public.payments_settlements_forbid_delete();

revoke all on table public.settlements, public.payments, public.payment_installments from anon, authenticated, service_role;
grant select on table public.settlements, public.payments, public.payment_installments to authenticated;
grant select, insert, update on table public.settlements, public.payments, public.payment_installments to service_role;
alter table public.settlements enable row level security;
alter table public.payments enable row level security;
alter table public.payment_installments enable row level security;

create function public.payment_can_read() returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_permission('payment.view') or public.has_permission('payment.create') or public.has_permission('payment.annul'); $$;
create function public.settlement_can_read() returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_permission('settlement.view') or public.has_permission('settlement.create')
    or public.has_permission('settlement.update_open') or public.has_permission('settlement.close') or public.has_permission('settlement.correct'); $$;
create function public.payment_settlement_is_own_collector(p_collector_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.collectors c where c.id = p_collector_id and c.user_profile_id = public.current_profile_id()); $$;
create policy payments_select on public.payments for select to authenticated using ((select public.payment_can_read()) or public.payment_settlement_is_own_collector(collector_id));
create policy settlements_select on public.settlements for select to authenticated using ((select public.settlement_can_read()) or public.payment_settlement_is_own_collector(collector_id));
create policy payment_installments_select on public.payment_installments for select to authenticated using (exists (select 1 from public.payments p where p.id = payment_id));

do $$ declare f text; begin
  foreach f in array array['public.payments_settlements_forbid_delete()', 'public.settlements_guard_insert()', 'public.settlements_guard_update()', 'public.payments_guard_insert()', 'public.payments_guard_update()', 'public.payment_installments_guard_insert()', 'public.payment_installments_forbid_update()'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end $$;
revoke all on function public.payment_can_read(), public.settlement_can_read(), public.payment_settlement_is_own_collector(uuid) from public, anon, service_role;
grant execute on function public.payment_can_read(), public.settlement_can_read(), public.payment_settlement_is_own_collector(uuid) to authenticated;
