-- SAN-67: immutable commission adjustments and collector current-account history.
-- SAN-68/69 audited SECURITY DEFINER functions will be the only write path.

create table public.commission_adjustments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  collector_id uuid not null references public.collectors (id) on delete restrict,
  settlement_id uuid references public.settlements (id) on delete restrict,
  payment_id uuid references public.payments (id) on delete restrict,
  amount numeric(12,2) not null,
  direction text not null,
  reason text not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint commission_adjustments_amount_positive check (amount > 0 and amount <> 'NaN'::numeric),
  constraint commission_adjustments_direction_check check (direction in ('in_favor_of_collector', 'in_favor_of_firefighters')),
  constraint commission_adjustments_reason_format check (reason = btrim(reason) and reason <> '' and char_length(reason) <= 1000)
);

create table public.collector_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  collector_id uuid not null references public.collectors (id) on delete restrict,
  settlement_id uuid references public.settlements (id) on delete restrict,
  payment_id uuid references public.payments (id) on delete restrict,
  entry_type text not null,
  direction text not null,
  amount numeric(12,2) not null,
  status text not null default 'recorded',
  occurred_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  reason text,
  annulled_by uuid references public.profiles (id) on delete restrict,
  annulled_at timestamptz,
  annul_reason text,
  constraint collector_ledger_entries_amount_positive check (amount > 0 and amount <> 'NaN'::numeric),
  constraint collector_ledger_entries_type_check check (entry_type in (
    'commission_generated', 'commission_settled', 'cash_settled',
    'transfer_received_by_firefighters', 'adjustment_in_favor_of_collector',
    'adjustment_in_favor_of_firefighters', 'annulment'
  )),
  constraint collector_ledger_entries_direction_check check (direction in ('collector_credit', 'collector_debit')),
  constraint collector_ledger_entries_status_check check (status in ('recorded', 'annulled', 'compensated')),
  constraint collector_ledger_entries_reason_format check (
    reason is null or (reason = btrim(reason) and reason <> '' and char_length(reason) <= 1000)
  ),
  constraint collector_ledger_entries_annulment_consistent check (
    (status = 'annulled' and annulled_by is not null and annulled_at is not null and annul_reason is not null)
    or (status <> 'annulled' and annulled_by is null and annulled_at is null and annul_reason is null)
  ),
  constraint collector_ledger_entries_annul_reason_format check (
    annul_reason is null or (annul_reason = btrim(annul_reason) and annul_reason <> '' and char_length(annul_reason) <= 1000)
  )
);

create index commission_adjustments_campaign_idx on public.commission_adjustments (campaign_id);
create index commission_adjustments_collector_idx on public.commission_adjustments (collector_id);
create index commission_adjustments_settlement_idx on public.commission_adjustments (settlement_id);
create index commission_adjustments_payment_idx on public.commission_adjustments (payment_id);
create index commission_adjustments_created_by_idx on public.commission_adjustments (created_by);
create index collector_ledger_entries_collector_campaign_occurred_at_idx
  on public.collector_ledger_entries (collector_id, campaign_id, occurred_at);
create index collector_ledger_entries_campaign_idx on public.collector_ledger_entries (campaign_id);
create index collector_ledger_entries_settlement_idx on public.collector_ledger_entries (settlement_id);
create index collector_ledger_entries_payment_idx on public.collector_ledger_entries (payment_id);
create index collector_ledger_entries_created_by_idx on public.collector_ledger_entries (created_by);
create index collector_ledger_entries_annulled_by_idx on public.collector_ledger_entries (annulled_by);

create function public.commission_ledger_forbid_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% rows are never deleted', tg_table_name using errcode = 'restrict_violation';
end; $$;

-- Settlement and payment references are intentionally checked here rather than by a composite FK:
-- the referenced rows must agree on both campaign and collector.
create function public.commission_ledger_check_references(
  p_campaign_id uuid, p_collector_id uuid, p_settlement_id uuid, p_payment_id uuid
) returns void language plpgsql set search_path = '' as $$
begin
  if p_settlement_id is not null and not exists (
    select 1 from public.settlements
    where id = p_settlement_id and campaign_id = p_campaign_id and collector_id = p_collector_id
  ) then
    raise exception 'settlement must belong to the adjustment or ledger entry campaign and collector'
      using errcode = 'check_violation';
  end if;
  if p_payment_id is not null and not exists (
    select 1 from public.payments
    where id = p_payment_id and campaign_id = p_campaign_id and collector_id = p_collector_id
  ) then
    raise exception 'payment must belong to the adjustment or ledger entry campaign and collector'
      using errcode = 'check_violation';
  end if;
end; $$;

create function public.commission_adjustments_guard_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform public.commission_ledger_check_references(new.campaign_id, new.collector_id, new.settlement_id, new.payment_id);
  return new;
end; $$;

create function public.commission_adjustments_forbid_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'commission adjustments are immutable' using errcode = 'restrict_violation';
end; $$;

create function public.collector_ledger_entries_guard_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform public.commission_ledger_check_references(new.campaign_id, new.collector_id, new.settlement_id, new.payment_id);
  if new.status <> 'recorded' or new.annulled_by is not null or new.annulled_at is not null or new.annul_reason is not null then
    raise exception 'a new ledger entry must start recorded' using errcode = 'check_violation';
  end if;
  return new;
end; $$;

create function public.collector_ledger_entries_guard_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id, new.campaign_id, new.collector_id, new.settlement_id, new.payment_id, new.entry_type,
      new.direction, new.amount, new.occurred_at, new.created_by, new.created_at, new.reason)
     is distinct from
     (old.id, old.campaign_id, old.collector_id, old.settlement_id, old.payment_id, old.entry_type,
       old.direction, old.amount, old.occurred_at, old.created_by, old.created_at, old.reason) then
    raise exception 'ledger entry history is immutable' using errcode = 'restrict_violation';
  end if;
  if old.status <> 'recorded' or new.status not in ('annulled', 'compensated') then
    raise exception 'ledger entry status can only change from recorded to annulled or compensated'
      using errcode = 'check_violation';
  end if;
  return new;
end; $$;

create trigger commission_adjustments_guard_insert before insert on public.commission_adjustments
  for each row execute function public.commission_adjustments_guard_insert();
create trigger commission_adjustments_guard_update before update on public.commission_adjustments
  for each row execute function public.commission_adjustments_forbid_update();
create trigger collector_ledger_entries_guard_insert before insert on public.collector_ledger_entries
  for each row execute function public.collector_ledger_entries_guard_insert();
create trigger collector_ledger_entries_guard_update before update on public.collector_ledger_entries
  for each row execute function public.collector_ledger_entries_guard_update();
create trigger commission_adjustments_forbid_delete before delete on public.commission_adjustments
  for each row execute function public.commission_ledger_forbid_delete();
create trigger commission_adjustments_forbid_truncate before truncate on public.commission_adjustments
  for each statement execute function public.commission_ledger_forbid_delete();
create trigger collector_ledger_entries_forbid_delete before delete on public.collector_ledger_entries
  for each row execute function public.commission_ledger_forbid_delete();
create trigger collector_ledger_entries_forbid_truncate before truncate on public.collector_ledger_entries
  for each statement execute function public.commission_ledger_forbid_delete();

revoke all on table public.commission_adjustments, public.collector_ledger_entries from anon, authenticated, service_role;
grant select on table public.commission_adjustments, public.collector_ledger_entries to authenticated;
alter table public.commission_adjustments enable row level security;
alter table public.collector_ledger_entries enable row level security;

create function public.commission_adjustment_can_read() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_permission('commission.view') or public.has_permission('commission.adjust')
    or public.has_permission('commission.settle'); $$;
create function public.collector_ledger_can_read() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_permission('collector.ledger.view') or public.has_permission('collector.ledger.adjust'); $$;
create function public.collector_ledger_is_own_collector(p_collector_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.collectors c
    where c.id = p_collector_id and c.user_profile_id = public.current_profile_id()); $$;

create policy commission_adjustments_select on public.commission_adjustments for select to authenticated
  using ((select public.commission_adjustment_can_read()));
create policy collector_ledger_entries_select on public.collector_ledger_entries for select to authenticated
  using ((select public.collector_ledger_can_read()) or public.collector_ledger_is_own_collector(collector_id));

do $$ declare f text; begin
  foreach f in array array[
    'public.commission_ledger_forbid_delete()',
    'public.commission_ledger_check_references(uuid, uuid, uuid, uuid)',
    'public.commission_adjustments_guard_insert()',
    'public.commission_adjustments_forbid_update()',
    'public.collector_ledger_entries_guard_insert()',
    'public.collector_ledger_entries_guard_update()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end $$;
revoke all on function public.commission_adjustment_can_read(), public.collector_ledger_can_read(),
  public.collector_ledger_is_own_collector(uuid) from public, anon, service_role;
grant execute on function public.commission_adjustment_can_read(), public.collector_ledger_can_read(),
  public.collector_ledger_is_own_collector(uuid) to authenticated;
