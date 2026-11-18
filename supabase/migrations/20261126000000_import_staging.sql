-- SAN-45: staging and validation of import sessions (Phase 4: barcode entry and imports).
--
-- SAN-44 created the tables and their invariants; this migration adds the audited,
-- permission-checked functions that fill and validate them. Confirmation and rollback are SAN-47.
--
-- Same model as Phases 2-3 (and SAN-44):
--   * authenticated can only SELECT (RLS, bond.import OR bond.scan). Every write goes through a
--     SECURITY DEFINER function here, which in ONE transaction: resolves the active profile,
--     checks the granular permission, locks the session (FOR UPDATE) and the campaign
--     (FOR SHARE), validates, writes and inserts exactly one audit_log row.
--   * Nothing is deleted: items are soft-removed (removed_at), sessions are cancelled.
--   * Errors are staged, not raised: a row that violates a business rule is stored with
--     status = 'error' and an error_code the preview can show. A malformed payload (not an array,
--     a row without row_number, a negative base number...) is a client bug and raises 22023.
--
-- Permissions (docs/permissions.md):
--   barcode_scan sessions            bond.scan
--   csv_file / excel_file sessions   bond.import
--
-- Audit actions (entity_type 'import_session', entity_id = the session id):
--   import.create       new_value: source_type, file_name
--   import.stage        new_value: counts of the staged batch
--   import.scan         new_value: the staged row
--   import.remove_item  old/new: the removed row; reason
--   import.validate     new_value: summary (counts)
--   import.cancel       old/new: status; reason
--
-- Error codes staged on rows (snake_case, <= 63 characters):
--   parse_*              the row could not be parsed from the file (kept as sent by the parser)
--   missing_type         no item_type
--   missing_base_number  no base number
--   missing_group        a pata row without grupo_pata
--   missing_barcode      a pata row without barcode
--   number_out_of_range  base number or its associated number above the campaign maximum
--   number_conflict      the row shares a participating number with another live row
--   duplicate_number     two live rows of the session repeat the same base number
--   number_in_use        a participating number is held by a live bond of the campaign
--   duplicate_barcode    two live rows of the session repeat the same barcode (or a pata group
--                        code collides with a row barcode)
--   barcode_in_use       a barcode (or the pata group code) is held by a live bond/number
--   incomplete_pata      a pata group has fewer than MIN_PATA_SIZE rows at validation
--
-- SQLSTATE:
--   42501 insufficient_privilege            no active profile, missing permission
--   22023 invalid_parameter_value           malformed payload / arguments
--   P0002 no_data_found                     campaign, session or item not found
--   55000 object_not_in_prerequisite_state  campaign/session not editable, already validated...
--   23505 unique_violation                  duplicate row number in the session
--   23514 / 23001                           SAN-44 constraints and triggers (backstops)

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Returns the caller's active profile after checking p_permission (42501 otherwise).
create function public.import_require_actor(p_permission text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  v_actor := public.current_profile_id();
  if v_actor is null then
    raise exception 'an active profile is required to import bonds'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.has_permission(p_permission) then
    raise exception 'permission denied: % is required', p_permission
      using errcode = 'insufficient_privilege';
  end if;
  return v_actor;
end;
$$;

-- A session's required permission depends on its source: scans need bond.scan, files bond.import.
create function public.import_session_permission(p_source_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_source_type = 'barcode_scan' then 'bond.scan' else 'bond.import' end;
$$;

-- Locks the session FOR UPDATE (serializes staging against validation and other writers) and
-- checks it still accepts changes. Returns the row.
create function public.import_lock_session(p_session_id uuid)
returns public.import_sessions
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.import_sessions;
begin
  select * into v_session from public.import_sessions where id = p_session_id for update;
  if not found then
    raise exception 'import session % not found', p_session_id using errcode = 'no_data_found';
  end if;
  if v_session.status not in ('draft', 'validated') then
    raise exception 'import session % is % and cannot be changed', v_session.id, v_session.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  return v_session;
end;
$$;

-- Recomputes status/error_code/error_message of every live, unlinked item of the session from the
-- staged rows and the live bonds of the campaign. Rows already carrying a parse_* error (sent by
-- the file parser) are left alone. Called after every change and before validating.
create function public.import_session_revalidate(p_session_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.import_sessions;
  v_offset integer;
  v_digits integer;
  v_max integer;
begin
  select * into v_session from public.import_sessions where id = p_session_id;
  if not found then
    raise exception 'import session % not found', p_session_id using errcode = 'no_data_found';
  end if;
  select c.number_digits, c.associated_number_offset, c.max_number
  into v_digits, v_offset, v_max
  from public.campaigns c where c.id = v_session.campaign_id;

  -- Back to pending: everything except parser errors (they can only be fixed by re-uploading).
  update public.import_session_items i
  set status = 'pending', error_code = null, error_message = null
  where i.import_session_id = p_session_id
    and i.removed_at is null
    and i.created_bond_id is null
    and (i.error_code is null or i.error_code not like 'parse\_%');

  -- Structural gaps.
  update public.import_session_items i
  set status = 'error', error_code = 'missing_type',
      error_message = 'The row does not say whether it is a simple bond or a pata.'
  where i.import_session_id = p_session_id and i.removed_at is null
    and i.created_bond_id is null and i.error_code is null and i.item_type is null;

  update public.import_session_items i
  set status = 'error', error_code = 'missing_base_number',
      error_message = 'The row has no base number.'
  where i.import_session_id = p_session_id and i.removed_at is null
    and i.created_bond_id is null and i.error_code is null and i.base_number is null;

  update public.import_session_items i
  set status = 'error', error_code = 'missing_barcode',
      error_message = 'Every row of a pata needs its barcode.'
  where i.import_session_id = p_session_id and i.removed_at is null
    and i.created_bond_id is null and i.error_code is null
    and i.item_type = 'pata' and i.barcode is null;

  update public.import_session_items i
  set status = 'error', error_code = 'missing_group',
      error_message = 'Every row of a pata needs its grupo_pata.'
  where i.import_session_id = p_session_id and i.removed_at is null
    and i.created_bond_id is null and i.error_code is null
    and i.item_type = 'pata' and i.group_key is null;

  -- Range: the base number and its associated number must fit the campaign.
  update public.import_session_items i
  set status = 'error', error_code = 'number_out_of_range',
      error_message = format('Number %s does not fit the campaign (maximum %s).',
        public.bond_format_number(i.base_number, v_digits),
        public.bond_format_number(v_max, v_digits))
  where i.import_session_id = p_session_id and i.removed_at is null
    and i.created_bond_id is null and i.error_code is null
    and i.base_number is not null
    and (i.base_number > v_max or i.base_number::bigint + v_offset > v_max);

  -- Participating numbers repeated among the live rows of the session (base or associated).
  with numbers as (
    select i.id, i.base_number as n
    from public.import_session_items i
    where i.import_session_id = p_session_id and i.removed_at is null
      and i.created_bond_id is null and i.base_number is not null
    union all
    select i.id, i.base_number::bigint + v_offset
    from public.import_session_items i
    where i.import_session_id = p_session_id and i.removed_at is null
      and i.created_bond_id is null and i.base_number is not null
  ), repeated as (
    select id from numbers group by id, n having count(*) > 1
    union
    select n2.id
    from numbers n2
    join (
      select n from numbers group by n having count(distinct id) > 1
    ) d on d.n = n2.n
  )
  update public.import_session_items i
  set status = 'error', error_code = 'number_conflict',
      error_message = 'This number (or its associated number) is repeated in the import.'
  from repeated r
  where i.id = r.id and i.error_code is null;

  -- Participating numbers already held by a live bond of the campaign.
  update public.import_session_items i
  set status = 'error', error_code = 'number_in_use',
      error_message = format('Number %s is already used by a bond of this campaign.',
        public.bond_format_number((
          select min(n.number_value)
          from public.bond_numbers n
          where n.campaign_id = v_session.campaign_id and n.released_at is null
            and n.number_value in (i.base_number, i.base_number::bigint + v_offset)
        ), v_digits))
  where i.import_session_id = p_session_id and i.removed_at is null
    and i.created_bond_id is null and i.error_code is null and i.base_number is not null
    and exists (
      select 1 from public.bond_numbers n
      where n.campaign_id = v_session.campaign_id and n.released_at is null
        and n.number_value in (i.base_number, i.base_number::bigint + v_offset)
    );

  -- Barcodes repeated among the live rows of the session.
  with repeated as (
    select i.id
    from public.import_session_items i
    join (
      select barcode
      from public.import_session_items x
      where x.import_session_id = p_session_id and x.removed_at is null
        and x.created_bond_id is null and x.barcode is not null
        and (x.error_code is null or x.error_code not like 'parse\_%')
      group by barcode
      having count(*) > 1
    ) d on d.barcode = i.barcode
    where i.import_session_id = p_session_id and i.removed_at is null
      and i.created_bond_id is null and i.error_code is null
  )
  update public.import_session_items i
  set status = 'error', error_code = 'duplicate_barcode',
      error_message = format('Barcode %s is repeated in the import.', i.barcode)
  from repeated r
  where i.id = r.id and i.error_code is null;

  -- Barcodes already held by a live bond or a live base number of the campaign.
  update public.import_session_items i
  set status = 'error', error_code = 'barcode_in_use',
      error_message = format('Barcode %s is already used in this campaign.', i.barcode)
  where i.import_session_id = p_session_id and i.removed_at is null
    and i.created_bond_id is null and i.error_code is null and i.barcode is not null
    and (
      exists (
        select 1 from public.bonds b
        where b.campaign_id = v_session.campaign_id and b.barcode = i.barcode
          and (b.commercial_status <> 'annulled' or b.annulled_from_status is distinct from 'available')
      )
      or exists (
        select 1 from public.bond_numbers n
        where n.campaign_id = v_session.campaign_id and n.barcode = i.barcode
          and n.released_at is null
      )
    );

  -- The pata bond's code is the grupo_pata: it must not collide with another live code either.
  update public.import_session_items i
  set status = 'error', error_code = 'barcode_in_use',
      error_message = format('The pata code %s is already used in this campaign.', i.group_key)
  where i.import_session_id = p_session_id and i.removed_at is null
    and i.created_bond_id is null and i.error_code is null
    and i.item_type = 'pata' and i.group_key is not null
    and (
      exists (
        select 1 from public.bonds b
        where b.campaign_id = v_session.campaign_id and b.barcode = i.group_key
          and (b.commercial_status <> 'annulled' or b.annulled_from_status is distinct from 'available')
      )
      or exists (
        select 1 from public.bond_numbers n
        where n.campaign_id = v_session.campaign_id and n.barcode = i.group_key
          and n.released_at is null
      )
    );

  update public.import_session_items i
  set status = 'error', error_code = 'duplicate_barcode',
      error_message = format('The pata code %s is also used as a row barcode in this import.', i.group_key)
  where i.import_session_id = p_session_id and i.removed_at is null
    and i.created_bond_id is null and i.error_code is null
    and i.item_type = 'pata' and i.group_key is not null
    and exists (
      select 1 from public.import_session_items x
      where x.import_session_id = p_session_id and x.removed_at is null
        and x.barcode = i.group_key
        and (x.error_code is null or x.error_code not like 'parse\_%')
    );

  -- Whatever survived is valid.
  update public.import_session_items i
  set status = 'valid'
  where i.import_session_id = p_session_id and i.removed_at is null
    and i.created_bond_id is null and i.error_code is null;
end;
$$;

-- Pata groups need at least MIN_PATA_SIZE (2) live rows before the session can be validated.
create function public.import_session_check_groups(p_session_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.import_session_items i
  set status = 'error', error_code = 'incomplete_pata',
      error_message = format('A pata needs at least %s rows (this group has %s).', 2, g.items)
  from (
    select i2.id, i2.group_key, count(*) over (partition by i2.group_key) as items
    from public.import_session_items i2
    where i2.import_session_id = p_session_id and i2.removed_at is null
      and i2.item_type = 'pata' and i2.group_key is not null
  ) g
  where i.id = g.id and g.items < 2 and i.error_code is null;
$$;

-- JSON summary for the preview and the API responses.
create function public.import_session_summary(p_session_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_session public.import_sessions;
  v_offset integer;
  v_summary jsonb;
begin
  if public.current_profile_id() is null
    or not (public.has_permission('bond.import') or public.has_permission('bond.scan')) then
    raise exception 'permission denied: bond.import or bond.scan is required'
      using errcode = 'insufficient_privilege';
  end if;
  select * into v_session from public.import_sessions where id = p_session_id;
  if not found then
    raise exception 'import session % not found', p_session_id using errcode = 'no_data_found';
  end if;
  select c.associated_number_offset into v_offset
  from public.campaigns c where c.id = v_session.campaign_id;

  select jsonb_build_object(
    'session_id', v_session.id,
    'campaign_id', v_session.campaign_id,
    'source_type', v_session.source_type,
    'file_name', v_session.file_name,
    'status', v_session.status,
    'items', count(*),
    'live_items', count(*) filter (where i.removed_at is null),
    'removed_items', count(*) filter (where i.removed_at is not null),
    'simple_items', count(*) filter (where i.removed_at is null and i.item_type = 'simple'),
    'pata_rows', count(*) filter (where i.removed_at is null and i.item_type = 'pata'),
    'pata_groups', count(distinct i.group_key) filter (where i.removed_at is null and i.item_type = 'pata'),
    'errors', count(*) filter (where i.removed_at is null and i.status = 'error'),
    'warnings', count(*) filter (where i.removed_at is null and i.status = 'warning'),
    'pending', count(*) filter (where i.removed_at is null and i.status = 'pending'),
    'duplicates', count(*) filter (
      where i.removed_at is null and i.status = 'error'
        and i.error_code in ('duplicate_number', 'number_conflict', 'duplicate_barcode',
                             'number_in_use', 'barcode_in_use')
    ),
    'valid', (
      count(*) filter (where i.removed_at is null) > 0
      and count(*) filter (where i.removed_at is null and i.status in ('pending', 'error')) = 0
    )
  ) into v_summary
  from public.import_session_items i
  where i.import_session_id = p_session_id;

  v_summary := v_summary || jsonb_build_object(
    'base_numbers', (
      select count(distinct i.base_number)
      from public.import_session_items i
      where i.import_session_id = p_session_id and i.removed_at is null and i.base_number is not null
    ),
    'participating_numbers', (
      select count(distinct n)
      from (
        select i.base_number::bigint as n
        from public.import_session_items i
        where i.import_session_id = p_session_id and i.removed_at is null and i.base_number is not null
        union
        select i.base_number::bigint + v_offset
        from public.import_session_items i
        where i.import_session_id = p_session_id and i.removed_at is null and i.base_number is not null
      ) q
    )
  );
  return v_summary;
end;
$$;

-- ---------------------------------------------------------------------------
-- import_session_create
-- ---------------------------------------------------------------------------
create function public.import_session_create(
  p_campaign_id uuid,
  p_source_type text,
  p_file_name text default null,
  p_notes text default null,
  p_request_id text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_name text := nullif(btrim(p_file_name), '');
  v_session_id uuid;
begin
  v_actor := public.import_require_actor(public.import_session_permission(p_source_type));

  if p_source_type is null or p_source_type not in ('barcode_scan', 'csv_file', 'excel_file') then
    raise exception 'invalid import source type: %', p_source_type using errcode = 'invalid_parameter_value';
  end if;
  if p_source_type = 'barcode_scan' and v_name is not null then
    raise exception 'barcode_scan sessions do not keep a file name' using errcode = 'invalid_parameter_value';
  end if;
  if p_source_type <> 'barcode_scan' and v_name is null then
    raise exception 'a file import needs the original file name' using errcode = 'invalid_parameter_value';
  end if;
  if v_name is not null and char_length(v_name) > 255 then
    raise exception 'file name is too long (maximum 255 characters)' using errcode = 'invalid_parameter_value';
  end if;

  -- Reuses the campaign guard: not found, or not draft/active.
  perform public.bond_lock_campaign(p_campaign_id);

  insert into public.import_sessions (campaign_id, source_type, file_name, notes, created_by)
  values (p_campaign_id, p_source_type, v_name, nullif(btrim(p_notes), ''), v_actor)
  returning id into v_session_id;

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (
    v_actor, 'import.create', 'import_session', v_session_id::text,
    jsonb_build_object('campaign_id', p_campaign_id, 'source_type', p_source_type, 'file_name', v_name),
    p_request_id
  );

  return v_session_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- import_session_add_items: stage parsed file rows (a batch) and revalidate.
-- ---------------------------------------------------------------------------
create function public.import_session_add_items(
  p_session_id uuid,
  p_rows jsonb,
  p_request_id text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_session public.import_sessions;
  v_row jsonb;
  v_index integer := 0;
  v_count integer;
  v_inserted integer := 0;
begin
  v_session := public.import_lock_session(p_session_id);
  v_actor := public.import_require_actor(public.import_session_permission(v_session.source_type));

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count = 0 then
    raise exception 'at least one row is required' using errcode = 'invalid_parameter_value';
  end if;
  if v_count > 1000 then
    raise exception 'a batch can stage at most 1000 rows (got %)', v_count using errcode = 'invalid_parameter_value';
  end if;

  -- Row numbers are the file's rows: duplicated or already staged numbers would abort the batch.
  select count(*) into v_count
  from (
    select (r ->> 'row_number')::integer as row_number
    from jsonb_array_elements(p_rows) r
    where (r ->> 'row_number') ~ '^[1-9][0-9]*$'
    group by 1
    having count(*) > 1
  ) d;
  if v_count > 0 then
    raise exception 'the batch repeats a row_number' using errcode = 'invalid_parameter_value';
  end if;
  select count(*) into v_count
  from jsonb_array_elements(p_rows) r
  join public.import_session_items i
    on i.import_session_id = p_session_id
   and i.row_number = (r ->> 'row_number')::integer
  where (r ->> 'row_number') ~ '^[1-9][0-9]*$';
  if v_count > 0 then
    raise exception 'a row_number of the batch is already used in this session'
      using errcode = 'invalid_parameter_value';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;

    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'row %: every staged row must be a JSON object', v_index using errcode = 'invalid_parameter_value';
    end if;
    if (v_row ->> 'row_number') is null or (v_row ->> 'row_number') !~ '^[1-9][0-9]*$' then
      raise exception 'row %: row_number must be a positive integer', v_index using errcode = 'invalid_parameter_value';
    end if;
    if v_row ->> 'item_type' is not null and v_row ->> 'item_type' not in ('simple', 'pata') then
      raise exception 'row %: item_type must be simple or pata', v_index using errcode = 'invalid_parameter_value';
    end if;
    if v_row ->> 'base_number' is not null
      and ((v_row ->> 'base_number') !~ '^[0-9]+$'
           or char_length(v_row ->> 'base_number') > 10
           or (v_row ->> 'base_number')::bigint > 2147483647) then
      raise exception 'row %: base_number must be a non-negative integer', v_index using errcode = 'invalid_parameter_value';
    end if;
    if char_length(coalesce(v_row ->> 'raw_value', '')) > 2000 then
      raise exception 'row %: raw_value is longer than 2000 characters', v_index using errcode = 'invalid_parameter_value';
    end if;
    if char_length(coalesce(v_row ->> 'barcode', '')) > 200
      or char_length(coalesce(v_row ->> 'group_key', '')) > 200 then
      raise exception 'row %: barcode and grupo_pata are limited to 200 characters', v_index using errcode = 'invalid_parameter_value';
    end if;
    if v_row ->> 'item_type' = 'pata' and nullif(btrim(v_row ->> 'group_key'), '') is null then
      raise exception 'row %: a pata row needs its grupo_pata', v_index using errcode = 'invalid_parameter_value';
    end if;
    if v_row ->> 'item_type' = 'simple' and nullif(btrim(v_row ->> 'group_key'), '') is not null then
      raise exception 'row %: a simple row cannot have a grupo_pata', v_index using errcode = 'invalid_parameter_value';
    end if;
    if (v_row ->> 'error_code') is not null and (v_row ->> 'error_code') !~ '^[a-z][a-z0-9_]{0,62}$' then
      raise exception 'row %: error_code must be snake_case', v_index using errcode = 'invalid_parameter_value';
    end if;
    if (v_row ->> 'error_code') is not null and nullif(btrim(v_row ->> 'error_message'), '') is null then
      raise exception 'row %: an errored row needs a message', v_index using errcode = 'invalid_parameter_value';
    end if;

    insert into public.import_session_items
      (import_session_id, row_number, raw_value, parsed_value, barcode, item_type, group_key,
       base_number, status, error_code, error_message)
    values (
      p_session_id,
      (v_row ->> 'row_number')::integer,
      coalesce(nullif(v_row ->> 'raw_value', ''), 'row ' || (v_row ->> 'row_number')),
      case when jsonb_typeof(v_row -> 'parsed_value') = 'object'
           then v_row -> 'parsed_value' else '{}'::jsonb end,
      nullif(btrim(v_row ->> 'barcode'), ''),
      v_row ->> 'item_type',
      nullif(btrim(v_row ->> 'group_key'), ''),
      (v_row ->> 'base_number')::integer,
      case when v_row ->> 'error_code' is not null then 'error' else 'pending' end,
      v_row ->> 'error_code',
      nullif(btrim(v_row ->> 'error_message'), '')
    );

    v_inserted := v_inserted + 1;
  end loop;

  perform public.import_session_revalidate(p_session_id);

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (
    v_actor, 'import.stage', 'import_session', p_session_id::text,
    jsonb_build_object('rows', v_inserted, 'summary', public.import_session_summary(p_session_id)),
    p_request_id
  );

  return public.import_session_summary(p_session_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- import_session_add_scan: resolve a scanned code to a base number and stage one row.
-- ---------------------------------------------------------------------------
create function public.import_session_add_scan(
  p_session_id uuid,
  p_barcode text,
  p_group_key text default null,
  p_base_number integer default null,
  p_raw_value text default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_session public.import_sessions;
  v_campaign public.campaigns;
  v_code text := nullif(btrim(p_barcode), '');
  v_group text := nullif(btrim(p_group_key), '');
  v_base integer := p_base_number;
  v_match text[];
  v_row_number integer;
  v_error_code text;
  v_error_message text;
begin
  v_session := public.import_lock_session(p_session_id);
  v_actor := public.import_require_actor(public.import_session_permission(v_session.source_type));

  if v_session.source_type <> 'barcode_scan' then
    raise exception 'scans can only be added to a barcode_scan session (this one is %)', v_session.source_type
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if v_code is null then
    raise exception 'a barcode is required' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_code) > 200 then
    raise exception 'barcodes are limited to 200 characters' using errcode = 'invalid_parameter_value';
  end if;
  if v_base is not null and v_base < 0 then
    raise exception 'base_number must be non-negative' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_campaign from public.campaigns where id = v_session.campaign_id;

  -- Interpret the code per the campaign's barcode_mode (docs/imports.md).
  if v_campaign.barcode_mode = 'base_number' then
    if v_code ~ '^[0-9]{1,10}$' and v_code::bigint <= 2147483647 then
      v_base := v_code::bigint::integer;
    else
      v_error_code := 'parse_code_not_a_number';
      v_error_message := format('Barcode %s is not a base number.', v_code);
    end if;
  elsif v_campaign.barcode_mode = 'manual_mapping' then
    if v_base is null then
      v_error_code := 'parse_base_number_required';
      v_error_message := 'This campaign needs the base number typed with the barcode.';
    end if;
  else
    -- internal_code / external_legacy_code: the pattern's first capture group is the base number.
    if v_campaign.barcode_pattern is null then
      if v_base is null then
        v_error_code := 'parse_base_number_required';
        v_error_message := 'This campaign has no barcode pattern: type the base number.';
      end if;
    else
      v_match := regexp_match(v_code, v_campaign.barcode_pattern);
      if v_match is null or v_match[1] is null or v_match[1] !~ '^[0-9]{1,10}$'
        or v_match[1]::bigint > 2147483647 then
        v_error_code := 'parse_code_not_recognized';
        v_error_message := format('Barcode %s does not match the campaign pattern.', v_code);
      else
        v_base := v_match[1]::bigint::integer;
      end if;
    end if;
  end if;

  select coalesce(max(i.row_number), 0) + 1 into v_row_number
  from public.import_session_items i where i.import_session_id = p_session_id;

  insert into public.import_session_items
    (import_session_id, row_number, raw_value, parsed_value, barcode, item_type, group_key,
     base_number, status, error_code, error_message)
  values (
    p_session_id, v_row_number,
    coalesce(nullif(btrim(p_raw_value), ''), 'scan ' || v_row_number),
    jsonb_build_object('barcode', v_code, 'base_number', v_base, 'group_key', v_group,
                       'barcode_mode', v_campaign.barcode_mode),
    v_code,
    case when v_group is null then 'simple' else 'pata' end,
    v_group,
    v_base,
    case when v_error_code is not null then 'error' else 'pending' end,
    v_error_code, v_error_message
  );

  perform public.import_session_revalidate(p_session_id);

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (
    v_actor, 'import.scan', 'import_session', p_session_id::text,
    jsonb_build_object('row_number', v_row_number, 'barcode', v_code, 'base_number', v_base,
                       'group_key', v_group),
    p_request_id
  );

  return public.import_session_summary(p_session_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- import_session_remove_item: soft removal of an erroneous row.
-- ---------------------------------------------------------------------------
create function public.import_session_remove_item(
  p_item_id uuid,
  p_reason text default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_item public.import_session_items;
  v_before jsonb;
  v_session public.import_sessions;
  v_session_id uuid;
begin
  select import_session_id into v_session_id from public.import_session_items where id = p_item_id;
  if not found then
    raise exception 'import session item % not found', p_item_id using errcode = 'no_data_found';
  end if;
  v_session := public.import_lock_session(v_session_id);
  select * into v_item from public.import_session_items where id = p_item_id for update;
  v_actor := public.import_require_actor(public.import_session_permission(v_session.source_type));

  if v_item.removed_at is not null then
    raise exception 'import session item % was already removed', p_item_id
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if v_item.created_bond_id is not null then
    raise exception 'import session item % is linked to a bond and cannot be removed', p_item_id
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  v_before := to_jsonb(v_item);

  update public.import_session_items
  set removed_by = v_actor, remove_reason = nullif(btrim(p_reason), '')
  where id = p_item_id
  returning * into v_item;

  perform public.import_session_revalidate(v_session.id);

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (
    v_actor, 'import.remove_item', 'import_session', v_session.id::text,
    v_before - 'removed_at' - 'removed_by' - 'remove_reason',
    jsonb_build_object('item_id', p_item_id, 'row_number', v_item.row_number),
    nullif(btrim(p_reason), ''), p_request_id
  );

  return public.import_session_summary(v_session.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- import_session_validate: revalidate and move draft -> validated when clean.
-- ---------------------------------------------------------------------------
create function public.import_session_validate(
  p_session_id uuid,
  p_request_id text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_session public.import_sessions;
  v_summary jsonb;
  v_validated boolean := false;
begin
  v_session := public.import_lock_session(p_session_id);
  v_actor := public.import_require_actor(public.import_session_permission(v_session.source_type));

  if v_session.status = 'validated' then
    return public.import_session_summary(p_session_id);
  end if;

  perform public.import_session_revalidate(p_session_id);
  perform public.import_session_check_groups(p_session_id);
  v_summary := public.import_session_summary(p_session_id);

  if (v_summary ->> 'valid')::boolean then
    update public.import_sessions
    set status = 'validated'
    where id = p_session_id;
    v_validated := true;
    v_summary := public.import_session_summary(p_session_id);

    insert into public.audit_log
      (actor_user_id, action, entity_type, entity_id, new_value, request_id)
    values (
      v_actor, 'import.validate', 'import_session', p_session_id::text, v_summary, p_request_id
    );
  end if;

  return v_summary || jsonb_build_object('validated', v_validated);
end;
$$;

-- ---------------------------------------------------------------------------
-- import_session_cancel: draft|validated -> cancelled.
-- ---------------------------------------------------------------------------
create function public.import_session_cancel(
  p_session_id uuid,
  p_reason text default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_session public.import_sessions;
begin
  v_session := public.import_lock_session(p_session_id);
  v_actor := public.import_require_actor(public.import_session_permission(v_session.source_type));

  update public.import_sessions
  set status = 'cancelled', cancelled_by = v_actor, cancel_reason = nullif(btrim(p_reason), '')
  where id = p_session_id;

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (
    v_actor, 'import.cancel', 'import_session', p_session_id::text,
    jsonb_build_object('status', v_session.status),
    jsonb_build_object('status', 'cancelled'),
    nullif(btrim(p_reason), ''), p_request_id
  );

  return public.import_session_summary(p_session_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function public.import_require_actor(text) from public, anon, authenticated, service_role;
revoke all on function public.import_session_permission(text) from public, anon, authenticated, service_role;
revoke all on function public.import_lock_session(uuid) from public, anon, authenticated, service_role;
revoke all on function public.import_session_revalidate(uuid) from public, anon, authenticated, service_role;
revoke all on function public.import_session_check_groups(uuid) from public, anon, authenticated, service_role;
revoke all on function public.import_session_summary(uuid) from public, anon, authenticated, service_role;

revoke all on function public.import_session_create(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.import_session_add_items(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.import_session_add_scan(uuid, text, text, integer, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.import_session_remove_item(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.import_session_validate(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.import_session_cancel(uuid, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.import_session_create(uuid, text, text, text, text) to authenticated;
grant execute on function public.import_session_add_items(uuid, jsonb, text) to authenticated;
grant execute on function public.import_session_add_scan(uuid, text, text, integer, text, text) to authenticated;
grant execute on function public.import_session_remove_item(uuid, text, text) to authenticated;
grant execute on function public.import_session_validate(uuid, text) to authenticated;
grant execute on function public.import_session_cancel(uuid, text, text) to authenticated;
grant execute on function public.import_session_summary(uuid) to authenticated;

comment on function public.import_session_create(uuid, text, text, text, text) is
  'Creates a draft import session for a draft/active campaign (bond.import, or bond.scan for barcode_scan).';
comment on function public.import_session_add_items(uuid, jsonb, text) is
  'Stages parsed file rows, validates them and returns the session summary.';
comment on function public.import_session_add_scan(uuid, text, text, integer, text, text) is
  'Resolves a scanned barcode per the campaign barcode_mode, stages one row and returns the summary.';
comment on function public.import_session_remove_item(uuid, text, text) is
  'Soft-removes an erroneous row (never deleted) and revalidates the session.';
comment on function public.import_session_validate(uuid, text) is
  'Revalidates every live row and moves draft -> validated when there is no pending or erroneous row.';
comment on function public.import_session_cancel(uuid, text, text) is
  'Cancels a draft/validated import session (final).';
comment on function public.import_session_summary(uuid) is
  'Preview counts for an import session (items, patas, numbers, errors, warnings, duplicates).';
