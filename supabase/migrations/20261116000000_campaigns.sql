-- SAN-16: campaigns table, invariants, edit windows, status machine, RLS and grants.
--
-- Writes are NOT exposed to end users: authenticated only gets SELECT (gated by campaign.view).
-- Create/update/transition go through permission-checked SQL functions that write the change
-- and its audit_log row in one transaction (SAN-17, same pattern as admin_provision_profile).
-- Campaigns are never deleted: they are annulled (active -> annulled).
--
-- Every invariant below is enforced for every role (constraints and triggers also apply to
-- service_role and the table owner), so later RPCs cannot bypass them by accident.

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,

  -- Installment rules. Money is numeric(14,2) (exact). installment_value is derived and stored:
  -- the CHECK below requires installment_value * installment_count = simple_bond_value exactly,
  -- so a value that does not divide evenly (60000 / 7) is rejected instead of rounded.
  simple_bond_value numeric(14, 2) not null,
  installment_count integer not null,
  installment_value numeric(14, 2) not null,

  -- Numbering rules (per campaign; see docs/open-questions.md "Numbering per campaign").
  number_digits integer not null default 4,
  max_number integer not null default 9999,
  associated_number_offset integer not null default 4871,
  overflow_policy text not null default 'reject',
  -- How a scanned barcode is interpreted (docs/imports.md). No default: chosen at creation.
  barcode_mode text not null,

  -- Creating profile; null for system/seed actions (same convention as audit_log.actor_user_id).
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint campaigns_name_not_blank check (btrim(name) <> ''),
  constraint campaigns_status_check
    check (status in ('draft', 'active', 'closing', 'closed', 'annulled')),
  constraint campaigns_dates_order check (ends_at > starts_at),

  constraint campaigns_simple_bond_value_positive check (simple_bond_value > 0),
  constraint campaigns_installment_count_positive check (installment_count > 0),
  constraint campaigns_installment_value_positive check (installment_value > 0),
  constraint campaigns_installment_value_exact
    check (installment_value * installment_count = simple_bond_value),

  constraint campaigns_number_digits_positive check (number_digits > 0),
  constraint campaigns_max_number_positive check (max_number > 0),
  constraint campaigns_associated_number_offset_nonnegative check (associated_number_offset >= 0),
  -- max_number < 10^number_digits, written without exponentiation so it cannot overflow.
  constraint campaigns_max_number_fits_digits check (length(max_number::text) <= number_digits),
  -- Otherwise no base number could have an associated number within range.
  constraint campaigns_associated_number_offset_within_max
    check (associated_number_offset <= max_number),
  constraint campaigns_overflow_policy_check check (overflow_policy in ('reject')),
  constraint campaigns_barcode_mode_check
    check (barcode_mode in ('base_number', 'internal_code', 'external_legacy_code', 'manual_mapping'))
);

comment on column public.campaigns.installment_value is
  'Derived: simple_bond_value / installment_count. Must divide exactly (campaigns_installment_value_exact).';

create index campaigns_status_idx on public.campaigns (status);
create index campaigns_starts_at_idx on public.campaigns (starts_at);
create index campaigns_created_by_idx on public.campaigns (created_by);

-- ---------------------------------------------------------------------------
-- Write guard: server timestamps, immutable columns, status machine, edit windows
-- ---------------------------------------------------------------------------
-- Edit windows are evaluated against the status the row had BEFORE the update (OLD.status):
--   rules (numbering, installments, barcode_mode): draft only
--   starts_at / ends_at:                           draft, active
--   name:                                          draft, active, closing
-- Closed and annulled campaigns are therefore fully immutable.
--
-- Errors (SQLSTATE):
--   23514 check_violation                  insert with status <> 'draft'; invalid status transition;
--                                          activation without both dates; clearing a date after activation
--   55000 object_not_in_prerequisite_state edit outside its window (rules / dates / name)
--   23001 restrict_violation               change to id, created_at or created_by; delete/truncate

create function public.campaigns_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_changed_rules text[];
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' then
      raise exception 'new campaigns must start in draft status (got %)', new.status
        using errcode = 'check_violation';
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
    or new.created_at is distinct from old.created_at
    or new.created_by is distinct from old.created_by
  then
    raise exception 'campaigns.id, created_at and created_by cannot be changed'
      using errcode = 'restrict_violation';
  end if;

  -- Allowed transitions: docs/state-machines.md (Campaign). A draft created by mistake is
  -- annulled (draft -> annulled), never deleted.
  if new.status is distinct from old.status
    and (old.status, new.status) not in (
      ('draft', 'active'),
      ('draft', 'annulled'),
      ('active', 'closing'),
      ('closing', 'closed'),
      ('active', 'annulled')
    )
  then
    raise exception 'invalid campaign status transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- An active campaign always has both dates: they are required to activate and, once set,
  -- cannot be cleared (dates stay editable while active, but never back to null).
  if old.status = 'draft' and new.status = 'active'
    and (new.starts_at is null or new.ends_at is null)
  then
    raise exception 'campaign cannot be activated without starts_at and ends_at'
      using errcode = 'check_violation';
  end if;

  if old.status <> 'draft'
    and ((old.starts_at is not null and new.starts_at is null)
      or (old.ends_at is not null and new.ends_at is null))
  then
    raise exception 'campaign starts_at and ends_at cannot be cleared once the campaign was activated (status: %)', old.status
      using errcode = 'check_violation';
  end if;

  if old.status <> 'draft' then
    v_changed_rules := array_remove(array[
      case when new.simple_bond_value is distinct from old.simple_bond_value then 'simple_bond_value' end,
      case when new.installment_count is distinct from old.installment_count then 'installment_count' end,
      case when new.installment_value is distinct from old.installment_value then 'installment_value' end,
      case when new.number_digits is distinct from old.number_digits then 'number_digits' end,
      case when new.max_number is distinct from old.max_number then 'max_number' end,
      case when new.associated_number_offset is distinct from old.associated_number_offset
        then 'associated_number_offset' end,
      case when new.overflow_policy is distinct from old.overflow_policy then 'overflow_policy' end,
      case when new.barcode_mode is distinct from old.barcode_mode then 'barcode_mode' end
    ], null);

    if cardinality(v_changed_rules) > 0 then
      raise exception 'campaign rules can only be changed while the campaign is draft (status: %)', old.status
        using errcode = 'object_not_in_prerequisite_state',
          detail = format('changed rule columns: %s', array_to_string(v_changed_rules, ', '));
    end if;
  end if;

  if old.status not in ('draft', 'active')
    and (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at)
  then
    raise exception 'campaign dates can only be changed while the campaign is draft or active (status: %)', old.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if old.status in ('closed', 'annulled') and new.name is distinct from old.name then
    raise exception 'campaign name cannot be changed once the campaign is %', old.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.campaigns_guard_write() from public, anon, authenticated;

create trigger campaigns_guard_write
  before insert or update on public.campaigns
  for each row execute function public.campaigns_guard_write();

-- Campaigns are annulled, never deleted. Privileges already deny DELETE/TRUNCATE to every API
-- role; this is the backstop for the table owner (same approach as audit_log).
create function public.campaigns_forbid_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'campaigns cannot be deleted: % is not allowed (annul the campaign instead)', tg_op
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function public.campaigns_forbid_delete() from public, anon, authenticated;

create trigger campaigns_forbid_delete
  before delete on public.campaigns
  for each row execute function public.campaigns_forbid_delete();

create trigger campaigns_forbid_truncate
  before truncate on public.campaigns
  for each statement execute function public.campaigns_forbid_delete();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
-- Supabase grants ALL to anon, authenticated and service_role by default: revoke and grant back.
-- authenticated: read only (writes go through SAN-17 SQL functions). anon: nothing.
-- service_role: select/insert/update (trusted server code); never delete or truncate.

revoke all on table public.campaigns from anon, authenticated, service_role;
grant select on table public.campaigns to authenticated;
grant select, insert, update on table public.campaigns to service_role;

alter table public.campaigns enable row level security;

create policy campaigns_select on public.campaigns
  for select to authenticated
  using ((select public.has_permission('campaign.view')));
