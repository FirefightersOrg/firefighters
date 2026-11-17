-- SAN-22: bonds, bond_numbers and bond_groups tables, invariants, RLS and grants.
--
-- Same model as campaigns (SAN-16) and commission_rules (SAN-20):
--   * authenticated can only SELECT (gated by bond.view). Writes go through permission-checked,
--     audited SECURITY DEFINER functions (SAN-23). service_role has SELECT, INSERT and UPDATE.
--   * Nothing is deleted: bonds are annulled, participating numbers are released, groups are
--     ungrouped. DELETE/TRUNCATE are not granted to any API role and a trigger blocks the owner.
--   * Every invariant is enforced for every role (constraints and triggers also apply to
--     service_role and the table owner), so later functions cannot bypass them by accident.
--
-- Decisions (Phase 3, see docs/data-model.md "bonds", "bond_numbers", "bond_groups"):
--   * Bonds can be created while their campaign is draft or active. Once a campaign has any bond
--     (annulled ones included) its numbering, value/installment and barcode rules are frozen,
--     even in draft (campaigns_rules_frozen_with_bonds below).
--   * Bonds start as `available` (manual entry of simple bonds and printed patas) or `created`
--     (reserved for Phase 4 imports).
--   * A bond loaded by mistake is annulled (available -> annulled, reason required). Annulling
--     frees its participating numbers: the bond_numbers rows are kept and marked released
--     (released_at / released_by), and uniqueness of (campaign_id, number_value) only applies to
--     numbers that are not released, so the same number can be entered again.
--   * Only a mistaken load releases numbers: the guard records the status the bond was annulled
--     from (annulled_from_status, set by the database, immutable) and numbers can be released only
--     when it is `available`. A sold bond can still be annulled (sold -> annulled, Phase 10), but
--     its numbers stay held: nobody else can take them.
--   * A simple bond is always printed (commercial_unit_count = 1). A pata has N >= 2 base
--     numbers (commercial_unit_count = N). total_value = campaigns.simple_bond_value * N.
--   * Printed patas own their numbers (N base + N associated). Manually grouped patas
--     (origin = manual_grouping) own no numbers: their members (simple bonds) keep theirs and are
--     linked through bond_groups. While a simple bond is an active member of a group, its
--     commercial data cannot change (it is blocked from individual operations); there is no
--     separate "grouped" commercial status.
--   * A manual pata can only leave `available` with all its members (commercial_unit_count active
--     rows), except that it can only be annulled after all members are ungrouped. Ungrouping locks
--     the pata row, so it serializes with any concurrent status change: a pata is never
--     delivered/sold without its members, nor annulled while they remain blocked.
--   * barcode and internal_code are unique per campaign among bonds that hold them: like numbers,
--     codes are freed only when the bond was annulled from `available` (mistaken load); codes of
--     a bond annulled from `sold` stay held.
--
-- Errors (SQLSTATE):
--   23514 check_violation                   table CHECKs; new bond not created/available or with
--                                           payments; invalid commercial status transition;
--                                           total_value not simple_bond_value * units; number above
--                                           max_number; associated number not base + offset; too
--                                           many base/associated numbers; numbers on a manual pata;
--                                           invalid group composition
--   23505 unique_violation                  duplicate active number, barcode or internal code;
--                                           member already in an active group
--   23503 foreign_key_violation             bond_numbers.campaign_id differs from its bond's;
--                                           associated number whose base belongs to another bond
--   55000 object_not_in_prerequisite_state  campaign not draft/active (new bond); campaign rules
--                                           changed while it has bonds; annulled/closed bond
--                                           changed; active group member changed; numbers added
--                                           to an annulled bond; number released while its bond
--                                           is not annulled or was not annulled from available;
--                                           released number or ungrouped row changed; grouping
--                                           bonds that are not available; ungrouping a pata that
--                                           is not available; a manual pata leaving available
--                                           without all its members
--   23001 restrict_violation                change to an immutable column (annulled_from_status
--                                           included); delete/truncate

-- ---------------------------------------------------------------------------
-- bonds
-- ---------------------------------------------------------------------------
create table public.bonds (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  kind text not null,
  origin text not null,
  internal_code text,
  barcode text,
  commercial_status text not null default 'available',
  financial_status_snapshot text not null default 'no_payments',
  -- No FK yet: public.collectors and public.buyers arrive in Phase 5, which adds the references.
  current_collector_id uuid,
  current_buyer_id uuid,
  commercial_unit_count integer not null default 1,
  -- Money is numeric(14,2) (exact): campaigns.simple_bond_value * commercial_unit_count.
  total_value numeric(14, 2) not null,

  annulled_at timestamptz,
  annulled_by uuid references public.profiles (id) on delete restrict,
  annul_reason text,
  -- Status the bond was annulled from (set by bonds_guard_write, never by callers). Only bonds
  -- annulled from `available` (loaded by mistake) release their numbers.
  annulled_from_status text,

  -- Creating profile; null for system/import actions (same convention as campaigns.created_by).
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Target of the composite FK from bond_numbers (a number always belongs to its bond's campaign).
  constraint bonds_id_campaign_key unique (id, campaign_id),

  constraint bonds_kind_check check (kind in ('simple', 'pata')),
  constraint bonds_origin_check check (origin in ('printed', 'manual_grouping')),
  -- Only patas can be assembled manually: a simple bond is always printed.
  constraint bonds_simple_is_printed check (kind = 'pata' or origin = 'printed'),
  constraint bonds_commercial_unit_count_by_kind check (
    case
      when kind = 'simple' then commercial_unit_count = 1
      else commercial_unit_count >= 2
    end
  ),
  constraint bonds_commercial_status_check check (
    commercial_status in (
      'created', 'available', 'delivered_to_collector', 'sold', 'returned', 'lost', 'annulled',
      'closed'
    )
  ),
  constraint bonds_financial_status_snapshot_check check (
    financial_status_snapshot in (
      'no_payments', 'partial_payments', 'up_to_date', 'overdue', 'fully_paid', 'uncollectible',
      'annulled'
    )
  ),
  -- Codes are compared exactly by the unique indexes: no blank and no surrounding whitespace.
  constraint bonds_internal_code_valid
    check (btrim(internal_code) <> '' and internal_code = btrim(internal_code)),
  constraint bonds_barcode_valid check (btrim(barcode) <> '' and barcode = btrim(barcode)),
  -- numeric accepts 'NaN' (greater than every number): reject it explicitly, as in campaigns.
  constraint bonds_total_value_positive check (total_value <> 'NaN' and total_value > 0),
  -- The statuses a bond can be annulled from (see the transitions in bonds_guard_write).
  constraint bonds_annulled_from_status_check
    check (annulled_from_status in ('available', 'sold')),
  constraint bonds_annulment_consistent check (
    case
      when commercial_status = 'annulled' then annulled_at is not null and annulled_by is not null
        and annul_reason is not null and btrim(annul_reason) <> ''
        and annulled_from_status is not null
      else annulled_at is null and annulled_by is null and annul_reason is null
        and annulled_from_status is null
    end
  )
);

comment on table public.bonds is
  'Sellable commercial unit: simple bond or pata (SAN-22). Annulled, never deleted.';
comment on column public.bonds.commercial_unit_count is
  'Number of base numbers: 1 for a simple bond, N >= 2 for a pata.';
comment on column public.bonds.total_value is
  'campaigns.simple_bond_value * commercial_unit_count, fixed at creation.';
comment on column public.bonds.annulled_from_status is
  'Status the bond was annulled from (set by the database). Numbers are released only if available.';
comment on column public.bonds.current_collector_id is
  'Current collector. FK to public.collectors added in Phase 5.';
comment on column public.bonds.current_buyer_id is
  'Current buyer. FK to public.buyers added in Phase 5.';

create index bonds_campaign_status_idx on public.bonds (campaign_id, commercial_status);
create index bonds_campaign_collector_idx on public.bonds (campaign_id, current_collector_id);
create index bonds_created_by_idx on public.bonds (created_by);
create index bonds_annulled_by_idx on public.bonds (annulled_by);
-- Unique per campaign among bonds that hold their codes: only a bond annulled by mistake
-- (annulled from `available`, same rule as number release) frees them for reuse. Codes of a bond
-- annulled from any other status (e.g. sold) stay held.
create unique index bonds_campaign_barcode_key on public.bonds (campaign_id, barcode)
  where barcode is not null
    and (commercial_status <> 'annulled' or annulled_from_status is distinct from 'available');
create unique index bonds_campaign_internal_code_key on public.bonds (campaign_id, internal_code)
  where internal_code is not null
    and (commercial_status <> 'annulled' or annulled_from_status is distinct from 'available');

-- ---------------------------------------------------------------------------
-- bond_numbers
-- ---------------------------------------------------------------------------
create table public.bond_numbers (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  bond_id uuid not null,
  number_value integer not null,
  number_kind text not null,
  -- associated: the base number it derives from (same bond). base: null.
  source_base_number_id uuid,
  created_at timestamptz not null default now(),
  -- Set when the bond is annulled: the number is free to be entered again, the row stays.
  released_at timestamptz,
  released_by uuid references public.profiles (id) on delete restrict,

  -- Target of the self-referencing composite FK below.
  constraint bond_numbers_id_bond_key unique (id, bond_id),
  -- The number's campaign is always its bond's campaign.
  constraint bond_numbers_bond_fkey foreign key (bond_id, campaign_id)
    references public.bonds (id, campaign_id) on delete restrict,
  -- The source base number belongs to the same bond.
  constraint bond_numbers_source_base_number_fkey foreign key (source_base_number_id, bond_id)
    references public.bond_numbers (id, bond_id) on delete restrict,

  constraint bond_numbers_number_value_nonnegative check (number_value >= 0),
  constraint bond_numbers_number_kind_check
    check (number_kind in ('base', 'associated', 'extraordinary')),
  constraint bond_numbers_source_by_kind check (
    case number_kind
      when 'base' then source_base_number_id is null
      when 'associated' then source_base_number_id is not null
      else true
    end
  ),
  constraint bond_numbers_release_consistent check ((released_at is null) = (released_by is null))
);

comment on table public.bond_numbers is
  'Participating numbers of bonds (SAN-22). Released (never deleted) when their bond is annulled.';
comment on column public.bond_numbers.number_value is
  'Internal value; the visible number is number_value padded to campaigns.number_digits.';
comment on column public.bond_numbers.released_at is
  'Set when the bond was annulled: the number no longer counts for uniqueness and can be entered again.';

-- Uniqueness of participating numbers per campaign, among numbers that were not released.
create unique index bond_numbers_campaign_number_key on public.bond_numbers (campaign_id, number_value)
  where released_at is null;
-- A base number has at most one associated number.
create unique index bond_numbers_one_associated_per_base on public.bond_numbers (source_base_number_id)
  where number_kind = 'associated';
create index bond_numbers_bond_id_idx on public.bond_numbers (bond_id, campaign_id);
create index bond_numbers_source_base_number_idx on public.bond_numbers (source_base_number_id, bond_id);
create index bond_numbers_released_by_idx on public.bond_numbers (released_by);

-- ---------------------------------------------------------------------------
-- bond_groups
-- ---------------------------------------------------------------------------
create table public.bond_groups (
  id uuid primary key default gen_random_uuid(),
  pata_bond_id uuid not null references public.bonds (id) on delete restrict,
  member_bond_id uuid not null references public.bonds (id) on delete restrict,
  grouped_at timestamptz not null default now(),
  grouped_by uuid not null references public.profiles (id) on delete restrict,
  ungrouped_at timestamptz,
  ungrouped_by uuid references public.profiles (id) on delete restrict,
  -- Why the member was ungrouped (required when ungrouping, null while the membership is active).
  reason text,

  constraint bond_groups_not_self check (pata_bond_id <> member_bond_id),
  constraint bond_groups_ungrouping_consistent check (
    case
      when ungrouped_at is null then ungrouped_by is null and reason is null
      else ungrouped_by is not null and reason is not null and btrim(reason) <> ''
    end
  )
);

comment on table public.bond_groups is
  'Membership history of manually grouped patas (SAN-22). Ungrouped, never deleted.';
comment on column public.bond_groups.reason is
  'Ungrouping reason: required when ungrouped_at is set, null while the membership is active.';

create index bond_groups_pata_bond_id_idx on public.bond_groups (pata_bond_id);
create index bond_groups_member_bond_id_idx on public.bond_groups (member_bond_id);
-- A simple bond belongs to at most one active pata.
create unique index bond_groups_active_member_key on public.bond_groups (member_bond_id)
  where ungrouped_at is null;
create index bond_groups_grouped_by_idx on public.bond_groups (grouped_by);
create index bond_groups_ungrouped_by_idx on public.bond_groups (ungrouped_by);

-- ---------------------------------------------------------------------------
-- bonds write guard: server timestamps, immutable columns, campaign status, value, status
-- machine, terminal states and active group members
-- ---------------------------------------------------------------------------
create function public.bonds_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_campaign public.campaigns;
  v_members integer;
begin
  if tg_op = 'INSERT' then
    if new.commercial_status not in ('created', 'available') then
      raise exception 'new bonds must start in created or available status (got %)', new.commercial_status
        using errcode = 'check_violation';
    end if;
    if new.financial_status_snapshot is distinct from 'no_payments' then
      raise exception 'new bonds must start with financial status no_payments (got %)', new.financial_status_snapshot
        using errcode = 'check_violation';
    end if;

    -- FOR SHARE serializes with campaign_update_rules / campaign_transition (FOR UPDATE): the
    -- status and the rules read here cannot change until this transaction ends.
    select * into v_campaign from public.campaigns where id = new.campaign_id for share;
    -- A missing campaign is reported by the foreign key.
    if found then
      if v_campaign.status not in ('draft', 'active') then
        raise exception 'bonds can only be created while the campaign is draft or active (status: %)', v_campaign.status
          using errcode = 'object_not_in_prerequisite_state';
      end if;
      if new.total_value is distinct from v_campaign.simple_bond_value * new.commercial_unit_count then
        raise exception 'bond total value must be % (simple bond value % x % units), got %',
          v_campaign.simple_bond_value * new.commercial_unit_count, v_campaign.simple_bond_value,
          new.commercial_unit_count, new.total_value
          using errcode = 'check_violation';
      end if;
    end if;

    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
    or new.campaign_id is distinct from old.campaign_id
    or new.kind is distinct from old.kind
    or new.origin is distinct from old.origin
    or new.commercial_unit_count is distinct from old.commercial_unit_count
    or new.total_value is distinct from old.total_value
    or new.created_at is distinct from old.created_at
    or new.created_by is distinct from old.created_by
  then
    raise exception 'bonds.id, campaign_id, kind, origin, commercial_unit_count, total_value, created_at and created_by cannot be changed'
      using errcode = 'restrict_violation';
  end if;

  -- Commercial data (everything but the financial snapshot, which is recalculated elsewhere).
  if (new.internal_code, new.barcode, new.commercial_status, new.current_collector_id,
      new.current_buyer_id, new.annulled_at, new.annulled_by, new.annul_reason)
    is distinct from
     (old.internal_code, old.barcode, old.commercial_status, old.current_collector_id,
      old.current_buyer_id, old.annulled_at, old.annulled_by, old.annul_reason)
  then
    if old.commercial_status in ('annulled', 'closed') then
      raise exception 'bond % is % and cannot be changed', old.id, old.commercial_status
        using errcode = 'object_not_in_prerequisite_state';
    end if;

    if exists (
      select 1 from public.bond_groups g
      where g.member_bond_id = old.id and g.ungrouped_at is null
    ) then
      raise exception 'bond % belongs to a manually grouped pata and cannot be changed individually', old.id
        using errcode = 'object_not_in_prerequisite_state',
          hint = 'ungroup the pata first';
    end if;
  end if;

  -- Allowed transitions: docs/state-machines.md (Bond), plus available -> annulled for a bond
  -- loaded by mistake.
  if new.commercial_status is distinct from old.commercial_status
    and (old.commercial_status, new.commercial_status) not in (
      ('created', 'available'),
      ('available', 'delivered_to_collector'),
      ('delivered_to_collector', 'sold'),
      ('delivered_to_collector', 'returned'),
      ('returned', 'available'),
      ('available', 'lost'),
      ('delivered_to_collector', 'lost'),
      ('available', 'annulled'),
      ('sold', 'annulled'),
      ('sold', 'closed')
    )
  then
    raise exception 'invalid bond status transition: % -> %', old.commercial_status, new.commercial_status
      using errcode = 'check_violation';
  end if;

  -- A manual pata is sold as a whole: it can only leave available with all its members. It can be
  -- annulled only after ungrouping; otherwise active members would be permanently blocked because
  -- ungrouping itself requires an available pata. Ungrouping locks this row
  -- (bond_groups_guard_write), so the count below cannot be stale.
  if old.origin = 'manual_grouping' and old.commercial_status = 'available'
    and new.commercial_status <> 'available'
  then
    select count(*) into v_members
    from public.bond_groups g
    where g.pata_bond_id = old.id and g.ungrouped_at is null;
    if new.commercial_status = 'annulled' and v_members <> 0 then
      raise exception 'manually grouped pata % has % active members and must be ungrouped before annulment',
        old.id, v_members
        using errcode = 'object_not_in_prerequisite_state';
    elsif v_members <> old.commercial_unit_count then
      raise exception 'manually grouped pata % has % of % members and cannot leave available',
        old.id, v_members, old.commercial_unit_count
        using errcode = 'object_not_in_prerequisite_state';
    end if;
  end if;

  -- annulled_at and annulled_from_status are set here, never by callers.
  if new.commercial_status = 'annulled' and old.commercial_status <> 'annulled' then
    new.annulled_at := now();
    new.annulled_from_status := old.commercial_status;
  elsif new.annulled_from_status is distinct from old.annulled_from_status then
    raise exception 'bonds.annulled_from_status is set by the database when the bond is annulled and cannot be changed'
      using errcode = 'restrict_violation';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger bonds_guard_write
  before insert or update on public.bonds
  for each row execute function public.bonds_guard_write();

-- ---------------------------------------------------------------------------
-- bond_numbers write guard
-- ---------------------------------------------------------------------------
create function public.bond_numbers_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bond public.bonds;
  v_campaign public.campaigns;
  v_source public.bond_numbers;
  v_count integer;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.campaign_id is distinct from old.campaign_id
      or new.bond_id is distinct from old.bond_id
      or new.number_value is distinct from old.number_value
      or new.number_kind is distinct from old.number_kind
      or new.source_base_number_id is distinct from old.source_base_number_id
      or new.created_at is distinct from old.created_at
    then
      raise exception 'bond_numbers.id, campaign_id, bond_id, number_value, number_kind, source_base_number_id and created_at cannot be changed'
        using errcode = 'restrict_violation';
    end if;
    if old.released_at is not null then
      raise exception 'bond number % was released and cannot be changed', old.id
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    if new.released_at is not null then
      select * into v_bond from public.bonds where id = new.bond_id;
      if v_bond.commercial_status <> 'annulled' then
        raise exception 'bond numbers can only be released once their bond is annulled (status: %)', v_bond.commercial_status
          using errcode = 'object_not_in_prerequisite_state';
      end if;
      -- Only a mistaken load (annulled from available) frees its numbers; an annulled sale keeps
      -- them held (Phase 10).
      if v_bond.annulled_from_status is distinct from 'available' then
        raise exception 'bond numbers can only be released when their bond was annulled from available (annulled from: %)',
          v_bond.annulled_from_status
          using errcode = 'object_not_in_prerequisite_state';
      end if;
      new.released_at := now();
    end if;
    return new;
  end if;

  if new.released_at is not null or new.released_by is not null then
    raise exception 'new bond numbers cannot be released'
      using errcode = 'check_violation';
  end if;

  -- FOR NO KEY UPDATE serializes inserts for the same bond (the per-kind counts below) and with
  -- its annulment, without blocking the foreign key checks (FOR KEY SHARE).
  select * into v_bond from public.bonds where id = new.bond_id for no key update;
  -- A missing bond (or one of another campaign) is reported by the foreign key.
  if found and v_bond.campaign_id = new.campaign_id then
    if v_bond.origin = 'manual_grouping' then
      raise exception 'a manually grouped pata has no numbers of its own (its members keep theirs)'
        using errcode = 'check_violation';
    end if;
    if v_bond.commercial_status = 'annulled' then
      raise exception 'numbers cannot be added to annulled bond %', v_bond.id
        using errcode = 'object_not_in_prerequisite_state';
    end if;

    select * into v_campaign from public.campaigns where id = v_bond.campaign_id;
    -- overflow_policy 'reject' (the only policy): numbers above max_number are rejected.
    if new.number_value > v_campaign.max_number then
      raise exception 'number % exceeds the campaign maximum number (%)', new.number_value, v_campaign.max_number
        using errcode = 'check_violation';
    end if;

    if new.number_kind in ('base', 'associated') then
      select count(*) into v_count
      from public.bond_numbers n
      where n.bond_id = new.bond_id and n.number_kind = new.number_kind and n.released_at is null;
      if v_count >= v_bond.commercial_unit_count then
        raise exception 'bond % already has % % number(s) (commercial unit count %)',
          v_bond.id, v_count, new.number_kind, v_bond.commercial_unit_count
          using errcode = 'check_violation';
      end if;
    end if;

    if new.number_kind = 'associated' then
      select * into v_source from public.bond_numbers where id = new.source_base_number_id;
      -- A source of another bond is reported by the foreign key.
      if found and v_source.bond_id = new.bond_id then
        if v_source.number_kind <> 'base' then
          raise exception 'the source of an associated number must be a base number (got %)', v_source.number_kind
            using errcode = 'check_violation';
        end if;
        if new.number_value is distinct from v_source.number_value + v_campaign.associated_number_offset then
          raise exception 'associated number must be % (base % + offset %), got %',
            v_source.number_value + v_campaign.associated_number_offset, v_source.number_value,
            v_campaign.associated_number_offset, new.number_value
            using errcode = 'check_violation';
        end if;
      end if;
    end if;
  end if;

  new.created_at := now();
  return new;
end;
$$;

create trigger bond_numbers_guard_write
  before insert or update on public.bond_numbers
  for each row execute function public.bond_numbers_guard_write();

-- ---------------------------------------------------------------------------
-- bond_groups write guard
-- ---------------------------------------------------------------------------
create function public.bond_groups_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_pata public.bonds;
  v_member public.bonds;
  v_count integer;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.pata_bond_id is distinct from old.pata_bond_id
      or new.member_bond_id is distinct from old.member_bond_id
      or new.grouped_at is distinct from old.grouped_at
      or new.grouped_by is distinct from old.grouped_by
    then
      raise exception 'bond_groups.id, pata_bond_id, member_bond_id, grouped_at and grouped_by cannot be changed'
        using errcode = 'restrict_violation';
    end if;
    if old.ungrouped_at is not null then
      raise exception 'bond group row % was ungrouped and cannot be changed', old.id
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    if new.ungrouped_at is not null then
      -- Lock the pata before reading its status: a concurrent status change (which also locks
      -- the row) either commits first, and is seen here, or waits for this transaction and then
      -- sees the missing members (bonds_guard_write).
      select * into v_pata from public.bonds where id = new.pata_bond_id for update;
      if v_pata.commercial_status <> 'available' then
        raise exception 'only an available pata can be ungrouped (pata status: %)', v_pata.commercial_status
          using errcode = 'object_not_in_prerequisite_state';
      end if;
      new.ungrouped_at := now();
    end if;
    return new;
  end if;

  -- Lock both bonds (in id order, to avoid deadlocks): their status cannot change meanwhile and
  -- concurrent groupings into the same pata are serialized (member count below).
  perform 1 from public.bonds
  where id in (new.pata_bond_id, new.member_bond_id)
  order by id
  for no key update;

  select * into v_pata from public.bonds where id = new.pata_bond_id;
  select * into v_member from public.bonds where id = new.member_bond_id;
  -- Missing bonds are reported by the foreign keys.
  if v_pata.id is not null and v_member.id is not null then
    if v_pata.kind <> 'pata' or v_pata.origin <> 'manual_grouping' then
      raise exception 'bond % is not a manually grouped pata (kind %, origin %)', v_pata.id, v_pata.kind, v_pata.origin
        using errcode = 'check_violation';
    end if;
    if v_member.kind <> 'simple' then
      raise exception 'only simple bonds can be grouped into a pata (bond % is a %)', v_member.id, v_member.kind
        using errcode = 'check_violation';
    end if;
    if v_member.campaign_id <> v_pata.campaign_id then
      raise exception 'a pata and its members must belong to the same campaign'
        using errcode = 'check_violation';
    end if;
    if v_pata.commercial_status <> 'available' or v_member.commercial_status <> 'available' then
      raise exception 'only available bonds can be grouped (pata: %, member: %)',
        v_pata.commercial_status, v_member.commercial_status
        using errcode = 'object_not_in_prerequisite_state';
    end if;

    select count(*) into v_count
    from public.bond_groups g
    where g.pata_bond_id = new.pata_bond_id and g.ungrouped_at is null;
    if v_count >= v_pata.commercial_unit_count then
      raise exception 'pata % already has % member(s) (commercial unit count %)',
        v_pata.id, v_count, v_pata.commercial_unit_count
        using errcode = 'check_violation';
    end if;
  end if;

  new.grouped_at := now();
  return new;
end;
$$;

create trigger bond_groups_guard_write
  before insert or update on public.bond_groups
  for each row execute function public.bond_groups_guard_write();

-- ---------------------------------------------------------------------------
-- No DELETE / TRUNCATE (backstop for the table owner; no API role has these privileges)
-- ---------------------------------------------------------------------------
create function public.bond_tables_forbid_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% cannot be deleted: % is not allowed (annul, release or ungroup instead)', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger bonds_forbid_delete
  before delete on public.bonds
  for each row execute function public.bond_tables_forbid_delete();
create trigger bonds_forbid_truncate
  before truncate on public.bonds
  for each statement execute function public.bond_tables_forbid_delete();

create trigger bond_numbers_forbid_delete
  before delete on public.bond_numbers
  for each row execute function public.bond_tables_forbid_delete();
create trigger bond_numbers_forbid_truncate
  before truncate on public.bond_numbers
  for each statement execute function public.bond_tables_forbid_delete();

create trigger bond_groups_forbid_delete
  before delete on public.bond_groups
  for each row execute function public.bond_tables_forbid_delete();
create trigger bond_groups_forbid_truncate
  before truncate on public.bond_groups
  for each statement execute function public.bond_tables_forbid_delete();

-- ---------------------------------------------------------------------------
-- Campaign rules are frozen once the campaign has bonds (even in draft)
-- ---------------------------------------------------------------------------
-- Any bond row counts, annulled ones included: their numbers and values were derived from the
-- rules. The trigger is named so that it fires after campaigns_guard_write (triggers fire in name
-- order), which reports rule changes outside draft first.
create function public.campaigns_rules_frozen_with_bonds()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.bonds b where b.campaign_id = new.id) then
    raise exception 'campaign rules cannot be changed once the campaign has bonds'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  return new;
end;
$$;

create trigger campaigns_rules_frozen_with_bonds
  before update of simple_bond_value, installment_count, installment_value, number_digits,
    max_number, associated_number_offset, overflow_policy, barcode_mode
  on public.campaigns
  for each row
  when (
    (new.simple_bond_value, new.installment_count, new.installment_value, new.number_digits,
      new.max_number, new.associated_number_offset, new.overflow_policy, new.barcode_mode)
    is distinct from
    (old.simple_bond_value, old.installment_count, old.installment_value, old.number_digits,
      old.max_number, old.associated_number_offset, old.overflow_policy, old.barcode_mode)
  )
  execute function public.campaigns_rules_frozen_with_bonds();

revoke all on function public.bonds_guard_write() from public, anon, authenticated, service_role;
revoke all on function public.bond_numbers_guard_write() from public, anon, authenticated, service_role;
revoke all on function public.bond_groups_guard_write() from public, anon, authenticated, service_role;
revoke all on function public.bond_tables_forbid_delete() from public, anon, authenticated, service_role;
revoke all on function public.campaigns_rules_frozen_with_bonds()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
-- Supabase grants ALL to anon, authenticated and service_role by default: revoke and grant back.
-- authenticated: read only (writes go through the SAN-23 functions). anon: nothing.
-- service_role: select/insert/update (trusted server code); never delete or truncate.
revoke all on table public.bonds from anon, authenticated, service_role;
revoke all on table public.bond_numbers from anon, authenticated, service_role;
revoke all on table public.bond_groups from anon, authenticated, service_role;
grant select on table public.bonds, public.bond_numbers, public.bond_groups to authenticated;
grant select, insert, update on table public.bonds, public.bond_numbers, public.bond_groups
  to service_role;

alter table public.bonds enable row level security;
alter table public.bond_numbers enable row level security;
alter table public.bond_groups enable row level security;

create policy bonds_select on public.bonds
  for select to authenticated
  using ((select public.has_permission('bond.view')));

create policy bond_numbers_select on public.bond_numbers
  for select to authenticated
  using ((select public.has_permission('bond.view')));

create policy bond_groups_select on public.bond_groups
  for select to authenticated
  using ((select public.has_permission('bond.view')));
