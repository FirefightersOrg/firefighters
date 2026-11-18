-- SAN-44: import_sessions and import_session_items (Phase 4: barcode entry and imports), plus the
-- bond columns imports need: bonds.import_session_id and bond_numbers.barcode, with one barcode
-- namespace per campaign.
--
-- Same model as Phases 2-3:
--   * authenticated can only SELECT (gated by bond.import OR bond.scan). Writes go through
--     permission-checked, audited SECURITY DEFINER functions (SAN-45 staging/validation, SAN-47
--     confirmation/rollback). service_role has SELECT, INSERT and UPDATE. anon: nothing.
--   * Nothing is deleted: sessions are cancelled (or marked failed / rolled back), items are
--     soft-removed (removed_at). DELETE/TRUNCATE are not granted and a trigger blocks the owner.
--   * Every invariant is enforced for every role by constraints and triggers.
--
-- Decisions (docs/imports.md "Decisions (SAN-44)"):
--   * source_type: barcode_scan, csv_file, excel_file (legacy_system_export is post-MVP). File
--     imports keep the original file name; scan sessions have none.
--   * Session states: draft <-> validated (editing items of a validated session returns it to
--     draft automatically), validated -> confirmed, draft|validated -> cancelled|failed.
--     confirmed, cancelled and failed are final; a confirmed session can only receive the
--     functional rollback marker (rolled_back_at/by/reason), once, after all its bonds are annulled.
--   * A session is created only for a draft or active campaign; validating and confirming also
--     require it (campaign locked FOR SHARE).
--   * validated requires at least one live (not removed) item and none pending or in error.
--     confirmed requires every live item to point to the bond it created (created_bond_id) and
--     that the bond is the right one: a simple item maps one-to-one to a simple bond, all the rows
--     of a grupo_pata map to one printed pata with one row per unit, no bond of the session is left
--     unlinked, and every bond is `available` with its complete set of base and associated numbers
--     (each row's base number and barcode actually exists).
--   * Bonds are created only on confirmation, directly as `available`, with import_session_id
--     (immutable) set; a bond can be attached to a session only while the session is validated
--     (SAN-47 inserts the bonds, links the items and then confirms, in one transaction). An import
--     bond cannot start in `created`: the guard rejects it on insert.
--   * A pata imported from rows sharing grupo_pata stores grupo_pata as the pata bond's barcode
--     and each row's barcode on its base number (bond_numbers.barcode, base numbers only).
--   * One barcode namespace per campaign: a code cannot be held by two live things among
--     bonds.barcode (live = not annulled from available) and bond_numbers.barcode (live = not
--     released). Freeing follows the Phase 3 rule: only bonds annulled from `available` (and
--     their released numbers) free their codes.
--
-- Errors (SQLSTATE):
--   23514 check_violation                   CHECKs; new session not draft; invalid session status
--                                           transition; new item already linked/removed
--   23505 unique_violation                  duplicate row number in a session; barcode already
--                                           held in the campaign (constraint
--                                           campaign_barcode_unique or the unique indexes)
--   55000 object_not_in_prerequisite_state  campaign not draft/active; items of a final session
--                                           changed; validating with pending/error items or none;
--                                           confirming with unlinked items; leaving validated
--                                           with linked items; final session changed; rollback
--                                           marker with live bonds or set twice; removed or linked
--                                           item edited; bond attached to a session not validated
--   23001 restrict_violation                change to an immutable column; delete/truncate

-- ---------------------------------------------------------------------------
-- import_sessions
-- ---------------------------------------------------------------------------
create table public.import_sessions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  source_type text not null,
  status text not null default 'draft',
  -- Original file name (csv_file / excel_file); null for barcode_scan.
  file_name text,
  notes text,

  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Timestamps below are set by import_sessions_guard_write; callers set the *_by columns.
  validated_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete restrict,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete restrict,
  cancel_reason text,
  failed_at timestamptz,
  -- Null for system actions.
  failed_by uuid references public.profiles (id) on delete restrict,
  failure_reason text,
  -- Functional rollback of a confirmed import (SAN-47): its bonds were annulled.
  rolled_back_at timestamptz,
  rolled_back_by uuid references public.profiles (id) on delete restrict,
  rollback_reason text,

  -- Target of the composite FK from bonds (a bond belongs to its session's campaign).
  constraint import_sessions_id_campaign_key unique (id, campaign_id),

  constraint import_sessions_source_type_check
    check (source_type in ('barcode_scan', 'csv_file', 'excel_file')),
  constraint import_sessions_status_check
    check (status in ('draft', 'validated', 'confirmed', 'cancelled', 'failed')),
  constraint import_sessions_file_name_by_source check (
    case when source_type = 'barcode_scan' then file_name is null else file_name is not null end
  ),
  constraint import_sessions_file_name_valid check (
    btrim(file_name) <> '' and file_name = btrim(file_name) and char_length(file_name) <= 255
  ),
  constraint import_sessions_notes_valid
    check (btrim(notes) <> '' and char_length(notes) <= 2000),
  constraint import_sessions_validated_consistent check (
    case
      when status = 'draft' then validated_at is null
      when status in ('validated', 'confirmed') then validated_at is not null
      else true
    end
  ),
  constraint import_sessions_confirmation_consistent check (
    (status = 'confirmed') = (confirmed_at is not null)
    and (confirmed_at is null) = (confirmed_by is null)
  ),
  constraint import_sessions_cancellation_consistent check (
    (status = 'cancelled') = (cancelled_at is not null)
    and (cancelled_at is null) = (cancelled_by is null)
    and (cancel_reason is null or (cancelled_at is not null and btrim(cancel_reason) <> ''))
  ),
  constraint import_sessions_failure_consistent check (
    (status = 'failed') = (failed_at is not null)
    and (failed_at is null) = (failure_reason is null)
    and (failure_reason is null or btrim(failure_reason) <> '')
    and (failed_by is null or failed_at is not null)
  ),
  constraint import_sessions_rollback_consistent check (
    case
      when rolled_back_at is null then rolled_back_by is null and rollback_reason is null
      else status = 'confirmed' and rolled_back_by is not null and rollback_reason is not null
        and btrim(rollback_reason) <> ''
    end
  )
);

comment on table public.import_sessions is
  'Bulk/scan bond loads (SAN-44). Every load has a session; never deleted (cancel / rollback).';
comment on column public.import_sessions.rolled_back_at is
  'Functional rollback of a confirmed import: set once all its bonds are annulled (SAN-47).';

create index import_sessions_campaign_status_idx on public.import_sessions (campaign_id, status);
create index import_sessions_created_by_idx on public.import_sessions (created_by);
create index import_sessions_confirmed_by_idx on public.import_sessions (confirmed_by);
create index import_sessions_cancelled_by_idx on public.import_sessions (cancelled_by);
create index import_sessions_failed_by_idx on public.import_sessions (failed_by);
create index import_sessions_rolled_back_by_idx on public.import_sessions (rolled_back_by);

-- ---------------------------------------------------------------------------
-- bonds.import_session_id and bond_numbers.barcode
-- ---------------------------------------------------------------------------
alter table public.bonds
  add column import_session_id uuid,
  -- The session belongs to the bond's campaign.
  add constraint bonds_import_session_fkey foreign key (import_session_id, campaign_id)
    references public.import_sessions (id, campaign_id) on delete restrict,
  -- Target of the composite FK from import_session_items (an item's bond is of its session).
  add constraint bonds_id_import_session_key unique (id, import_session_id);

comment on column public.bonds.import_session_id is
  'Import session that created the bond (SAN-44); null for manual entry. Immutable.';

create index bonds_import_session_idx on public.bonds (import_session_id)
  where import_session_id is not null;

alter table public.bond_numbers
  add column barcode text,
  add constraint bond_numbers_barcode_valid
    check (btrim(barcode) <> '' and barcode = btrim(barcode)),
  add constraint bond_numbers_barcode_base_only check (barcode is null or number_kind = 'base');

comment on column public.bond_numbers.barcode is
  'Barcode of an imported pata row (base numbers only; the pata bond holds grupo_pata). Immutable; '
  'unique per campaign with bonds.barcode among live codes.';

-- Unique among numbers that were not released (same rule as number_value).
create unique index bond_numbers_campaign_barcode_key on public.bond_numbers (campaign_id, barcode)
  where barcode is not null and released_at is null;

-- ---------------------------------------------------------------------------
-- import_session_items
-- ---------------------------------------------------------------------------
create table public.import_session_items (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT, not CASCADE: sessions are never deleted.
  import_session_id uuid not null references public.import_sessions (id) on delete restrict,
  -- Position in the source (file row or scan order), from 1.
  row_number integer not null,
  raw_value text not null,
  parsed_value jsonb,
  barcode text,
  item_type text,
  -- grupo_pata: rows of the same pata share it.
  group_key text,
  base_number integer,
  status text not null default 'pending',
  error_code text,
  -- Message of an error or warning.
  error_message text,
  -- The bond created from this item on confirmation (a pata: the same bond for all its rows).
  created_bond_id uuid,
  -- Soft removal of an erroneous row (draft/validated sessions only); the row stays as history.
  removed_at timestamptz,
  removed_by uuid references public.profiles (id) on delete restrict,
  remove_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint import_session_items_row_key unique (import_session_id, row_number),
  constraint import_session_items_created_bond_fkey foreign key (created_bond_id, import_session_id)
    references public.bonds (id, import_session_id) on delete restrict,

  constraint import_session_items_row_number_positive check (row_number >= 1),
  constraint import_session_items_raw_value_length check (char_length(raw_value) <= 2000),
  constraint import_session_items_parsed_value_object
    check (jsonb_typeof(parsed_value) = 'object'),
  constraint import_session_items_barcode_valid
    check (btrim(barcode) <> '' and barcode = btrim(barcode) and char_length(barcode) <= 200),
  constraint import_session_items_group_key_valid
    check (btrim(group_key) <> '' and group_key = btrim(group_key) and char_length(group_key) <= 200),
  constraint import_session_items_item_type_check check (item_type in ('simple', 'pata')),
  constraint import_session_items_group_by_type check (
    (item_type is distinct from 'simple' or group_key is null)
    and (item_type is distinct from 'pata' or group_key is not null)
  ),
  constraint import_session_items_base_number_nonnegative check (base_number >= 0),
  constraint import_session_items_status_check
    check (status in ('pending', 'valid', 'warning', 'error')),
  constraint import_session_items_parsed_when_accepted check (
    status not in ('valid', 'warning') or (item_type is not null and base_number is not null)
  ),
  constraint import_session_items_error_consistent check (
    case
      when status in ('pending', 'valid') then error_code is null and error_message is null
      else error_message is not null and btrim(error_message) <> ''
    end
  ),
  constraint import_session_items_error_code_format check (error_code ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint import_session_items_bond_when_accepted check (
    created_bond_id is null or (status in ('valid', 'warning') and removed_at is null)
  ),
  constraint import_session_items_removal_consistent check (
    (removed_at is null) = (removed_by is null)
    and (remove_reason is null or (removed_at is not null and btrim(remove_reason) <> ''))
  )
);

comment on table public.import_session_items is
  'Staged rows/scans of an import session (SAN-44). Immutable once the session is final; soft-removed.';

create index import_session_items_session_status_idx
  on public.import_session_items (import_session_id, status);
create index import_session_items_session_group_idx
  on public.import_session_items (import_session_id, group_key) where group_key is not null;
create index import_session_items_session_barcode_idx
  on public.import_session_items (import_session_id, barcode) where barcode is not null;
create index import_session_items_created_bond_idx
  on public.import_session_items (created_bond_id, import_session_id) where created_bond_id is not null;
create index import_session_items_removed_by_idx on public.import_session_items (removed_by);

-- ---------------------------------------------------------------------------
-- import_sessions write guard
-- ---------------------------------------------------------------------------
create function public.import_sessions_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_campaign_status text;
  v_count integer;
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' then
      raise exception 'new import sessions must start in draft status (got %)', new.status
        using errcode = 'check_violation';
    end if;
    -- FOR SHARE serializes with campaign_transition (FOR UPDATE). A missing campaign is reported
    -- by the foreign key.
    select c.status into v_campaign_status from public.campaigns c where c.id = new.campaign_id for share;
    if found and v_campaign_status not in ('draft', 'active') then
      raise exception 'import sessions can only be created while the campaign is draft or active (status: %)', v_campaign_status
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
    or new.campaign_id is distinct from old.campaign_id
    or new.source_type is distinct from old.source_type
    or new.file_name is distinct from old.file_name
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'import_sessions.id, campaign_id, source_type, file_name, created_by and created_at cannot be changed'
      using errcode = 'restrict_violation';
  end if;

  if old.status in ('cancelled', 'failed') then
    raise exception 'import session % is % and cannot be changed', old.id, old.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- Confirmed is final: only the functional rollback marker can be set, once.
  if old.status = 'confirmed' then
    if (new.status, new.notes, new.validated_at, new.confirmed_at, new.confirmed_by,
        new.cancelled_at, new.cancelled_by, new.cancel_reason, new.failed_at, new.failed_by,
        new.failure_reason)
      is distinct from
       (old.status, old.notes, old.validated_at, old.confirmed_at, old.confirmed_by,
        old.cancelled_at, old.cancelled_by, old.cancel_reason, old.failed_at, old.failed_by,
        old.failure_reason)
    then
      raise exception 'import session % is confirmed and cannot be changed (only rolled back)', old.id
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    if (new.rolled_back_at, new.rolled_back_by, new.rollback_reason)
      is not distinct from (old.rolled_back_at, old.rolled_back_by, old.rollback_reason)
    then
      new.updated_at := now();
      return new;
    end if;
    if old.rolled_back_at is not null then
      raise exception 'import session % was already rolled back', old.id
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    select count(*) into v_count
    from public.bonds b
    where b.import_session_id = old.id and b.commercial_status <> 'annulled';
    if v_count > 0 then
      raise exception 'import session % still has % bond(s) that are not annulled', old.id, v_count
        using errcode = 'object_not_in_prerequisite_state',
          hint = 'annul every bond of the import before marking it as rolled back';
    end if;
    if new.rolled_back_by is not null then
      new.rolled_back_at := now();
    end if;
    new.updated_at := now();
    return new;
  end if;

  -- old.status is draft or validated.
  if new.rolled_back_at is not null or new.rolled_back_by is not null or new.rollback_reason is not null then
    raise exception 'only a confirmed import session can be rolled back (status: %)', old.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if new.status is distinct from old.status
    and (old.status, new.status) not in (
      ('draft', 'validated'),
      ('validated', 'draft'),
      ('validated', 'confirmed'),
      ('draft', 'cancelled'),
      ('validated', 'cancelled'),
      ('draft', 'failed'),
      ('validated', 'failed')
    )
  then
    raise exception 'invalid import session status transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Timestamps are the database's: set on the transition, otherwise unchanged.
  new.validated_at := old.validated_at;
  new.confirmed_at := old.confirmed_at;
  new.cancelled_at := old.cancelled_at;
  new.failed_at := old.failed_at;

  if new.status = 'validated' and old.status = 'draft' then
    new.validated_at := now();
  elsif new.status = 'draft' and old.status = 'validated' then
    new.validated_at := null;
  elsif new.status = 'confirmed' then
    new.confirmed_at := now();
  elsif new.status = 'cancelled' then
    new.cancelled_at := now();
  elsif new.status = 'failed' then
    new.failed_at := now();
  end if;

  if new.status in ('validated', 'confirmed') and new.status is distinct from old.status then
    select c.status into v_campaign_status from public.campaigns c where c.id = old.campaign_id for share;
    if v_campaign_status not in ('draft', 'active') then
      raise exception 'import sessions can only be validated or confirmed while the campaign is draft or active (status: %)', v_campaign_status
        using errcode = 'object_not_in_prerequisite_state';
    end if;
  end if;

  if new.status = 'validated' and old.status = 'draft' then
    select count(*) into v_count
    from public.import_session_items i
    where i.import_session_id = old.id and i.removed_at is null;
    if v_count = 0 then
      raise exception 'import session % has no items to validate', old.id
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    select count(*) into v_count
    from public.import_session_items i
    where i.import_session_id = old.id and i.removed_at is null and i.status in ('pending', 'error');
    if v_count > 0 then
      raise exception 'import session % has % item(s) pending or in error', old.id, v_count
        using errcode = 'object_not_in_prerequisite_state',
          hint = 'fix or remove the items in error before validating';
    end if;
  end if;

  if new.status = 'confirmed' then
    -- Keep the session's bonds stable while validating them: a concurrent annulment or barcode
    -- change of one of them cannot interleave with the confirmation.
    perform 1 from public.bonds b
    where b.import_session_id = old.id
    order by b.id
    for share;

    -- Every live item must point to the bond it created (the composite FK keeps it in this
    -- session; the checks below make sure it is the right shape and that the bond is complete).
    select count(*) into v_count
    from public.import_session_items i
    where i.import_session_id = old.id and i.removed_at is null and i.created_bond_id is null;
    if v_count > 0 then
      raise exception 'import session % has % item(s) without a created bond', old.id, v_count
        using errcode = 'object_not_in_prerequisite_state';
    end if;

    -- A simple item needs a simple bond; a pata row needs a printed pata.
    select count(*) into v_count
    from public.import_session_items i
    join public.bonds b on b.id = i.created_bond_id
    where i.import_session_id = old.id and i.removed_at is null
      and (
        (i.item_type = 'simple' and b.kind <> 'simple')
        or (i.item_type = 'pata' and (b.kind <> 'pata' or b.origin <> 'printed'))
      );
    if v_count > 0 then
      raise exception 'import session % has % item(s) linked to a bond of the wrong kind', old.id, v_count
        using errcode = 'object_not_in_prerequisite_state',
          hint = 'a simple item maps to a simple bond; a grupo_pata maps to one printed pata';
    end if;

    -- A simple item maps one-to-one to its bond (no two simple rows share a bond).
    select count(*) into v_count
    from (
      select i.created_bond_id
      from public.import_session_items i
      where i.import_session_id = old.id and i.removed_at is null and i.item_type = 'simple'
      group by i.created_bond_id
      having count(*) <> 1
    ) g;
    if v_count > 0 then
      raise exception 'import session % has % simple bond(s) shared by more than one item', old.id, v_count
        using errcode = 'object_not_in_prerequisite_state';
    end if;

    -- All the rows of one grupo_pata share exactly one bond.
    select count(*) into v_count
    from (
      select i.group_key
      from public.import_session_items i
      where i.import_session_id = old.id and i.removed_at is null and i.item_type = 'pata'
      group by i.group_key
      having count(distinct i.created_bond_id) <> 1
    ) g;
    if v_count > 0 then
      raise exception 'import session % has % pata group(s) split across bonds', old.id, v_count
        using errcode = 'object_not_in_prerequisite_state';
    end if;

    -- And one pata bond holds exactly one grupo_pata.
    select count(*) into v_count
    from (
      select i.created_bond_id
      from public.import_session_items i
      where i.import_session_id = old.id and i.removed_at is null and i.item_type = 'pata'
      group by i.created_bond_id
      having count(distinct i.group_key) <> 1
    ) g;
    if v_count > 0 then
      raise exception 'import session % has % pata bond(s) shared by more than one group', old.id, v_count
        using errcode = 'object_not_in_prerequisite_state';
    end if;

    -- The pata has one row per unit and its barcode is the grupo_pata.
    select count(*) into v_count
    from (
      select i.group_key, i.created_bond_id, count(*) as items
      from public.import_session_items i
      where i.import_session_id = old.id and i.removed_at is null and i.item_type = 'pata'
      group by i.group_key, i.created_bond_id
    ) g
    join public.bonds b on b.id = g.created_bond_id
    where b.commercial_unit_count <> g.items
      or b.barcode is distinct from g.group_key;
    if v_count > 0 then
      raise exception 'import session % has % pata group(s) whose bond is incomplete or has a different barcode', old.id, v_count
        using errcode = 'object_not_in_prerequisite_state',
          hint = 'the pata bond needs one row per unit and its barcode must be the grupo_pata';
    end if;

    -- A simple bond carries the item barcode.
    select count(*) into v_count
    from public.import_session_items i
    join public.bonds b on b.id = i.created_bond_id
    where i.import_session_id = old.id and i.removed_at is null and i.item_type = 'simple'
      and b.barcode is distinct from i.barcode;
    if v_count > 0 then
      raise exception 'import session % has % simple item(s) whose bond barcode differs from the item barcode', old.id, v_count
        using errcode = 'object_not_in_prerequisite_state';
    end if;

    -- A bond cannot be attached to the session without a live item: the confirmation certifies
    -- every bond it leaves behind.
    select count(*) into v_count
    from public.bonds b
    where b.import_session_id = old.id
      and not exists (
        select 1 from public.import_session_items i
        where i.created_bond_id = b.id and i.removed_at is null
      );
    if v_count > 0 then
      raise exception 'import session % has % bond(s) not linked to a live item', old.id, v_count
        using errcode = 'object_not_in_prerequisite_state';
    end if;

    -- Every bond of the import must still be available (never created/annulled).
    select count(*) into v_count
    from public.bonds b
    where b.import_session_id = old.id and b.commercial_status <> 'available';
    if v_count > 0 then
      raise exception 'import session % has % bond(s) that are not available', old.id, v_count
        using errcode = 'object_not_in_prerequisite_state';
    end if;

    -- Each unit needs its base and associated number (the pata without numbers case).
    select count(*) into v_count
    from public.bonds b
    where b.import_session_id = old.id
      and (
        (select count(*) from public.bond_numbers n
         where n.bond_id = b.id and n.number_kind = 'base' and n.released_at is null)
          <> b.commercial_unit_count
        or (select count(*) from public.bond_numbers n
            where n.bond_id = b.id and n.number_kind = 'associated' and n.released_at is null)
          <> b.commercial_unit_count
      );
    if v_count > 0 then
      raise exception 'import session % has % bond(s) without a complete set of base and associated numbers', old.id, v_count
        using errcode = 'object_not_in_prerequisite_state',
          hint = 'create one base and one associated number per unit before confirming';
    end if;

    -- The numbers must be the ones the rows announced: each item's base number, and for a pata
    -- row its barcode on that base number.
    select count(*) into v_count
    from public.import_session_items i
    where i.import_session_id = old.id and i.removed_at is null
      and not exists (
        select 1 from public.bond_numbers n
        where n.bond_id = i.created_bond_id
          and n.number_kind = 'base'
          and n.released_at is null
          and n.number_value = i.base_number
          and (i.item_type <> 'pata' or n.barcode is not distinct from i.barcode)
      );
    if v_count > 0 then
      raise exception 'import session % has % item(s) whose base number or barcode was not created', old.id, v_count
        using errcode = 'object_not_in_prerequisite_state',
          hint = 'create the base number (and its barcode for a pata row) before confirming';
    end if;
  end if;

  -- Bonds are linked only inside the confirming transaction: a validated session that already
  -- has bonds can only be confirmed.
  if old.status = 'validated' and new.status in ('draft', 'cancelled', 'failed') then
    if exists (select 1 from public.bonds b where b.import_session_id = old.id)
      or exists (
        select 1 from public.import_session_items i
        where i.import_session_id = old.id and i.created_bond_id is not null
      )
    then
      raise exception 'import session % already has bonds and can only be confirmed', old.id
        using errcode = 'object_not_in_prerequisite_state';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger import_sessions_guard_write
  before insert or update on public.import_sessions
  for each row execute function public.import_sessions_guard_write();

-- ---------------------------------------------------------------------------
-- import_session_items write guard
-- ---------------------------------------------------------------------------
create function public.import_session_items_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_session_status text;
  v_content_changed boolean;
begin
  -- Lock the session: item writes serialize with its status transitions (validation counts the
  -- items under this lock). A missing session is reported by the foreign key.
  select s.status into v_session_status
  from public.import_sessions s
  where s.id = new.import_session_id
  for no key update;
  if not found then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if v_session_status not in ('draft', 'validated') then
      raise exception 'items cannot be added to a % import session', v_session_status
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    if new.created_bond_id is not null or new.removed_at is not null or new.removed_by is not null then
      raise exception 'new import session items cannot be linked to a bond or removed'
        using errcode = 'check_violation';
    end if;
    if v_session_status = 'validated' then
      update public.import_sessions set status = 'draft' where id = new.import_session_id;
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
    or new.import_session_id is distinct from old.import_session_id
    or new.row_number is distinct from old.row_number
    or new.created_at is distinct from old.created_at
  then
    raise exception 'import_session_items.id, import_session_id, row_number and created_at cannot be changed'
      using errcode = 'restrict_violation';
  end if;

  if v_session_status not in ('draft', 'validated') then
    raise exception 'items of a % import session cannot be changed', v_session_status
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if old.removed_at is not null then
    raise exception 'import session item % was removed and cannot be changed', old.id
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if old.created_bond_id is not null and new.created_bond_id is distinct from old.created_bond_id then
    raise exception 'import_session_items.created_bond_id cannot be changed once set'
      using errcode = 'restrict_violation';
  end if;

  v_content_changed :=
    (new.raw_value, new.parsed_value, new.barcode, new.item_type, new.group_key, new.base_number,
     new.status, new.error_code, new.error_message, new.removed_at, new.removed_by, new.remove_reason)
    is distinct from
    (old.raw_value, old.parsed_value, old.barcode, old.item_type, old.group_key, old.base_number,
     old.status, old.error_code, old.error_message, old.removed_at, old.removed_by, old.remove_reason);

  if v_content_changed and new.created_bond_id is not null then
    raise exception 'import session item % is linked to a bond and cannot be edited', old.id
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if new.created_bond_id is not null and old.created_bond_id is null and v_session_status <> 'validated' then
    raise exception 'items can only be linked to bonds while the import session is validated (status: %)', v_session_status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if new.removed_by is not null and old.removed_by is null then
    new.removed_at := now();
  end if;

  -- Editing the items of a validated session sends it back to draft (validate again).
  if v_content_changed and v_session_status = 'validated' then
    update public.import_sessions set status = 'draft' where id = new.import_session_id;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger import_session_items_guard_write
  before insert or update on public.import_session_items
  for each row execute function public.import_session_items_guard_write();

-- ---------------------------------------------------------------------------
-- bonds.import_session_id: set on insert only, while the session is validated
-- ---------------------------------------------------------------------------
-- Named after bonds_guard_write so it fires after it (triggers fire in name order).
create function public.bonds_guard_write_import_session()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_session_status text;
begin
  if tg_op = 'UPDATE' then
    if new.import_session_id is distinct from old.import_session_id then
      raise exception 'bonds.import_session_id cannot be changed'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  if new.import_session_id is not null then
    -- Imports create definitive data directly as `available`: a bond that starts in `created`
    -- (reserved for future phases) must never be left behind by a confirmed import.
    if new.commercial_status <> 'available' then
      raise exception 'bonds created by an import must start as available (got %)', new.commercial_status
        using errcode = 'check_violation';
    end if;
    select s.status into v_session_status
    from public.import_sessions s
    where s.id = new.import_session_id
    for share;
    -- A missing session (or one of another campaign) is reported by the foreign key.
    if found and v_session_status <> 'validated' then
      raise exception 'bonds can only be created for a validated import session (status: %)', v_session_status
        using errcode = 'object_not_in_prerequisite_state';
    end if;
  end if;
  return new;
end;
$$;

create trigger bonds_guard_write_import_session
  before insert or update on public.bonds
  for each row execute function public.bonds_guard_write_import_session();

-- ---------------------------------------------------------------------------
-- One barcode namespace per campaign: bonds.barcode and bond_numbers.barcode
-- ---------------------------------------------------------------------------
-- Within each table the partial unique indexes enforce uniqueness. Across tables, writers of a
-- code take a transaction-level advisory lock on (campaign, code) and then look for a live holder
-- in the other table, so two concurrent writers of the same code serialize and the second one
-- sees the first. Live: a bond not annulled from available (bonds_campaign_barcode_key's
-- predicate) / a number not released. bond_numbers.barcode is immutable.
create function public.campaign_barcode_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_holder uuid;
begin
  if tg_table_name = 'bond_numbers' and tg_op = 'UPDATE' then
    if new.barcode is distinct from old.barcode then
      raise exception 'bond_numbers.barcode cannot be changed'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  if new.barcode is null
    or (tg_op = 'UPDATE' and new.barcode is not distinct from old.barcode)
  then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('campaign_barcode:' || new.campaign_id::text || ':' || new.barcode, 0)
  );

  if tg_table_name = 'bonds' then
    select n.bond_id into v_holder
    from public.bond_numbers n
    where n.campaign_id = new.campaign_id and n.barcode = new.barcode and n.released_at is null
    limit 1;
  else
    select b.id into v_holder
    from public.bonds b
    where b.campaign_id = new.campaign_id and b.barcode = new.barcode
      and (b.commercial_status <> 'annulled' or b.annulled_from_status is distinct from 'available')
    limit 1;
  end if;

  if v_holder is not null then
    raise exception 'barcode % is already used by bond %', new.barcode, v_holder
      using errcode = 'unique_violation',
        constraint = 'campaign_barcode_unique',
        detail = jsonb_build_object('barcode', new.barcode, 'bond_id', v_holder)::text;
  end if;
  return new;
end;
$$;

create trigger bonds_guard_write_barcode
  before insert or update of barcode on public.bonds
  for each row execute function public.campaign_barcode_guard();

create trigger bond_numbers_guard_write_barcode
  before insert or update on public.bond_numbers
  for each row execute function public.campaign_barcode_guard();

-- bond_create / bond_group_into_pata report duplicate barcodes through bond_raise_duplicate: it
-- now also recognizes campaign_barcode_unique and finds the holder among bond numbers too.
create or replace function public.bond_raise_duplicate(
  p_campaign public.campaigns,
  p_constraint text,
  p_message text,
  p_numbers integer[],
  p_internal_code text,
  p_barcode text
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_conflicts jsonb;
  v_first jsonb;
  v_bond_id uuid;
begin
  if p_constraint = 'bond_numbers_campaign_number_key' then
    select jsonb_agg(
             jsonb_build_object(
               'number', n.number_value,
               'formatted', public.bond_format_number(n.number_value, p_campaign.number_digits),
               'bond_id', n.bond_id,
               'number_kind', n.number_kind
             ) order by n.number_value)
    into v_conflicts
    from public.bond_numbers n
    where n.campaign_id = p_campaign.id
      and n.released_at is null
      and n.number_value = any (p_numbers);

    if v_conflicts is not null then
      v_first := v_conflicts -> 0;
      raise exception 'number % is already used by bond %', v_first ->> 'formatted', v_first ->> 'bond_id'
        using errcode = 'unique_violation',
          detail = jsonb_build_object('conflicts', v_conflicts)::text,
          hint = 'a participating number (base or associated) can belong to only one bond per campaign; '
            || 'annul the other bond first if it was loaded by mistake';
    end if;
  elsif p_constraint = 'bonds_campaign_internal_code_key' then
    select b.id into v_bond_id from public.bonds b
    where b.campaign_id = p_campaign.id and b.internal_code = p_internal_code
      and (b.commercial_status <> 'annulled' or b.annulled_from_status is distinct from 'available');
    if v_bond_id is not null then
      raise exception 'internal code % is already used by bond %', p_internal_code, v_bond_id
        using errcode = 'unique_violation',
          detail = jsonb_build_object('internal_code', p_internal_code, 'bond_id', v_bond_id)::text;
    end if;
  elsif p_constraint in ('bonds_campaign_barcode_key', 'campaign_barcode_unique') then
    select b.id into v_bond_id from public.bonds b
    where b.campaign_id = p_campaign.id and b.barcode = p_barcode
      and (b.commercial_status <> 'annulled' or b.annulled_from_status is distinct from 'available');
    if v_bond_id is null then
      select n.bond_id into v_bond_id from public.bond_numbers n
      where n.campaign_id = p_campaign.id and n.barcode = p_barcode and n.released_at is null
      limit 1;
    end if;
    if v_bond_id is not null then
      raise exception 'barcode % is already used by bond %', p_barcode, v_bond_id
        using errcode = 'unique_violation',
          detail = jsonb_build_object('barcode', p_barcode, 'bond_id', v_bond_id)::text;
    end if;
  end if;

  raise exception '%', p_message
    using errcode = 'unique_violation', detail = jsonb_build_object('constraint', p_constraint)::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- No DELETE / TRUNCATE (backstop for the table owner; no API role has these privileges)
-- ---------------------------------------------------------------------------
create function public.import_tables_forbid_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% cannot be deleted: % is not allowed (cancel the session or remove the item instead)', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger import_sessions_forbid_delete
  before delete on public.import_sessions
  for each row execute function public.import_tables_forbid_delete();
create trigger import_sessions_forbid_truncate
  before truncate on public.import_sessions
  for each statement execute function public.import_tables_forbid_delete();

create trigger import_session_items_forbid_delete
  before delete on public.import_session_items
  for each row execute function public.import_tables_forbid_delete();
create trigger import_session_items_forbid_truncate
  before truncate on public.import_session_items
  for each statement execute function public.import_tables_forbid_delete();

revoke all on function public.import_sessions_guard_write() from public, anon, authenticated, service_role;
revoke all on function public.import_session_items_guard_write() from public, anon, authenticated, service_role;
revoke all on function public.bonds_guard_write_import_session() from public, anon, authenticated, service_role;
revoke all on function public.campaign_barcode_guard() from public, anon, authenticated, service_role;
revoke all on function public.import_tables_forbid_delete() from public, anon, authenticated, service_role;
revoke all on function public.bond_raise_duplicate(public.campaigns, text, text, integer[], text, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
-- authenticated: read only (writes go through the SAN-45/47 functions). anon: nothing.
-- service_role: select/insert/update (trusted server code); never delete or truncate.
revoke all on table public.import_sessions from anon, authenticated, service_role;
revoke all on table public.import_session_items from anon, authenticated, service_role;
grant select on table public.import_sessions, public.import_session_items to authenticated;
grant select, insert, update on table public.import_sessions, public.import_session_items
  to service_role;

alter table public.import_sessions enable row level security;
alter table public.import_session_items enable row level security;

create policy import_sessions_select on public.import_sessions
  for select to authenticated
  using ((select public.has_permission('bond.import')) or (select public.has_permission('bond.scan')));

create policy import_session_items_select on public.import_session_items
  for select to authenticated
  using ((select public.has_permission('bond.import')) or (select public.has_permission('bond.scan')));
