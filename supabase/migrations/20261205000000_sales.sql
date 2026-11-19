-- SAN-58: sales, payment plans and installments (docs/data-model.md, docs/state-machines.md).
--
--   * sales: the sale of one bond (simple or pata) to a buyer, through the collector that holds
--     it. At most one ACTIVE sale per bond. Annulment and correction ('annulled', 'corrected')
--     are Phase 10 (sale.correct); a corrected sale is replaced by a new active one.
--   * payment_plans: the plan of a sale (full payment = one installment). At most one active plan
--     per sale.
--   * installments: the plan's installments, numbered 1..n per plan.
--
-- Writes: only through audited SECURITY DEFINER functions (registerSale is SAN-59, corrections
-- Phase 10). authenticated can only SELECT; nothing is ever deleted (DELETE/TRUNCATE rejected
-- for every role, so the ON DELETE CASCADE of the plan/installment FKs never fires). Only the
-- status columns change after insert, along the documented transitions.
--
-- Errors: 23001 delete/truncate or change of an immutable column; 23514 bad value or transition.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  bond_id uuid not null,
  buyer_id uuid not null references public.buyers (id) on delete restrict,
  collector_id uuid not null references public.collectors (id) on delete restrict,
  sold_at timestamptz not null default now(),
  payment_mode text not null,
  total_amount numeric(12, 2) not null,
  status text not null default 'active',
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The bond belongs to the sale's campaign.
  constraint sales_bond_fkey foreign key (bond_id, campaign_id)
    references public.bonds (id, campaign_id) on delete restrict,
  -- For composite FKs of payments (Phase 8): a payment's sale is in the payment's campaign.
  constraint sales_id_campaign_key unique (id, campaign_id),
  constraint sales_payment_mode_check check (payment_mode in ('full_payment', 'installments')),
  constraint sales_total_positive check (total_amount > 0),
  constraint sales_status_check check (status in ('active', 'annulled', 'corrected'))
);

comment on table public.sales is
  'Sales of bonds to buyers (SAN-58). One active sale per bond; never deleted.';

create unique index sales_one_active_per_bond on public.sales (bond_id) where status = 'active';
create index sales_campaign_sold_at_idx on public.sales (campaign_id, sold_at desc);
create index sales_buyer_idx on public.sales (buyer_id);
create index sales_collector_idx on public.sales (campaign_id, collector_id);
create index sales_created_by_idx on public.sales (created_by);

create table public.payment_plans (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  installment_count integer not null,
  total_amount numeric(12, 2) not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),

  constraint payment_plans_count_check check (installment_count between 1 and 120),
  constraint payment_plans_total_positive check (total_amount > 0),
  constraint payment_plans_status_check check (status in ('active', 'annulled'))
);

comment on table public.payment_plans is
  'Payment plan of a sale (SAN-58): full payment is a one-installment plan. Never deleted.';

create unique index payment_plans_one_active_per_sale on public.payment_plans (sale_id)
  where status = 'active';
create index payment_plans_sale_idx on public.payment_plans (sale_id);

create table public.installments (
  id uuid primary key default gen_random_uuid(),
  payment_plan_id uuid not null references public.payment_plans (id) on delete cascade,
  installment_number integer not null,
  due_date date not null,
  amount numeric(12, 2) not null,
  status text not null default 'pending',
  updated_at timestamptz not null default now(),

  constraint installments_plan_number_key unique (payment_plan_id, installment_number),
  constraint installments_number_positive check (installment_number >= 1),
  constraint installments_amount_positive check (amount > 0),
  constraint installments_status_check
    check (status in ('pending', 'paid', 'paid_advance', 'overdue', 'annulled'))
);

comment on table public.installments is
  'Installments of a payment plan (SAN-58), numbered 1..n per plan. Never deleted.';

-- Pending/overdue installments by due date (overdue calculation, pending-installment reports).
create index installments_open_due_idx on public.installments (due_date)
  where status in ('pending', 'overdue');

-- ---------------------------------------------------------------------------
-- Guards: no deletion; only the status changes, along the documented transitions
-- ---------------------------------------------------------------------------
create function public.sales_forbid_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are never deleted', tg_table_name using errcode = 'restrict_violation';
end;
$$;

-- sales: active -> annulled | corrected (Phase 10). Everything else is immutable.
create function public.sales_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.campaign_id, new.bond_id, new.buyer_id, new.collector_id, new.sold_at,
      new.payment_mode, new.total_amount, new.created_by, new.created_at)
     is distinct from
     (old.id, old.campaign_id, old.bond_id, old.buyer_id, old.collector_id, old.sold_at,
      old.payment_mode, old.total_amount, old.created_by, old.created_at) then
    raise exception 'only the status of a sale can change' using errcode = 'restrict_violation';
  end if;
  if new.status is distinct from old.status
     and not (old.status = 'active' and new.status in ('annulled', 'corrected')) then
    raise exception 'sale status cannot go from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- payment_plans: active -> annulled. Everything else is immutable.
create function public.payment_plans_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.sale_id, new.installment_count, new.total_amount, new.created_at)
     is distinct from
     (old.id, old.sale_id, old.installment_count, old.total_amount, old.created_at) then
    raise exception 'only the status of a payment plan can change'
      using errcode = 'restrict_violation';
  end if;
  if new.status is distinct from old.status
     and not (old.status = 'active' and new.status = 'annulled') then
    raise exception 'payment plan status cannot go from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- installments (docs/state-machines.md "Installment"):
--   pending -> paid | paid_advance | overdue;  overdue -> paid;  paid | paid_advance -> annulled.
create function public.installments_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.payment_plan_id, new.installment_number, new.due_date, new.amount)
     is distinct from
     (old.id, old.payment_plan_id, old.installment_number, old.due_date, old.amount) then
    raise exception 'only the status of an installment can change'
      using errcode = 'restrict_violation';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'pending' and new.status in ('paid', 'paid_advance', 'overdue'))
    or (old.status = 'overdue' and new.status = 'paid')
    or (old.status in ('paid', 'paid_advance') and new.status = 'annulled')
  ) then
    raise exception 'installment status cannot go from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- A new sale, plan or installment starts in its initial status.
create function public.sales_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_initial text := case tg_table_name when 'installments' then 'pending' else 'active' end;
begin
  if new.status is distinct from v_initial then
    raise exception 'a new % row must start as %', tg_table_name, v_initial
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger sales_guard_insert before insert on public.sales
  for each row execute function public.sales_guard_insert();
create trigger payment_plans_guard_insert before insert on public.payment_plans
  for each row execute function public.sales_guard_insert();
create trigger installments_guard_insert before insert on public.installments
  for each row execute function public.sales_guard_insert();

create trigger sales_guard_update before update on public.sales
  for each row execute function public.sales_guard_update();
create trigger payment_plans_guard_update before update on public.payment_plans
  for each row execute function public.payment_plans_guard_update();
create trigger installments_guard_update before update on public.installments
  for each row execute function public.installments_guard_update();

create trigger sales_forbid_delete before delete on public.sales
  for each row execute function public.sales_forbid_delete();
create trigger sales_forbid_truncate before truncate on public.sales
  for each statement execute function public.sales_forbid_delete();
create trigger payment_plans_forbid_delete before delete on public.payment_plans
  for each row execute function public.sales_forbid_delete();
create trigger payment_plans_forbid_truncate before truncate on public.payment_plans
  for each statement execute function public.sales_forbid_delete();
create trigger installments_forbid_delete before delete on public.installments
  for each row execute function public.sales_forbid_delete();
create trigger installments_forbid_truncate before truncate on public.installments
  for each statement execute function public.sales_forbid_delete();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
-- No direct writes for API roles: sales are registered (sale.create, SAN-59) and corrected
-- (sale.correct, Phase 10) only through audited SECURITY DEFINER functions, which check those
-- permissions themselves.
revoke all on table public.sales, public.payment_plans, public.installments
  from anon, authenticated, service_role;
grant select on table public.sales, public.payment_plans, public.installments to authenticated;
grant select, insert, update on table public.sales, public.payment_plans, public.installments
  to service_role;

alter table public.sales enable row level security;
alter table public.payment_plans enable row level security;
alter table public.installments enable row level security;

-- Who reads a sale: readers of bonds (bond.view: admin, operator, treasurer, read-only), the
-- sale permissions themselves, and the collector's own login for its sales ("own" scope).
create function public.sale_can_read(p_collector_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission('bond.view') or public.has_permission('sale.create')
    or public.has_permission('sale.correct')
    or exists (select 1 from public.collectors c
               where c.id = p_collector_id and c.user_profile_id is not null
                 and c.user_profile_id = public.current_profile_id());
$$;

create policy sales_select on public.sales for select to authenticated
  using ((select public.sale_can_read(collector_id)));
-- Plans and installments follow their sale's visibility.
create policy payment_plans_select on public.payment_plans for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));
create policy installments_select on public.installments for select to authenticated
  using (exists (select 1 from public.payment_plans p where p.id = payment_plan_id));

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.sales_forbid_delete()', 'public.sales_guard_update()',
    'public.payment_plans_guard_update()', 'public.installments_guard_update()',
    'public.sales_guard_insert()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end;
$$;
-- The RLS helper runs for the reading user.
revoke all on function public.sale_can_read(uuid) from public, anon, service_role;
grant execute on function public.sale_can_read(uuid) to authenticated;
