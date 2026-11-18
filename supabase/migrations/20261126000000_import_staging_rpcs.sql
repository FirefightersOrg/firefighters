-- SAN-45: import staging and validation functions (Phase 4, docs/imports.md).
--
-- authenticated can only SELECT import_sessions / import_session_items (SAN-44). These SECURITY
-- DEFINER functions are the only writers for the app. Each one, in ONE transaction: resolves the
-- caller's ACTIVE profile, checks the permission (bond.scan for barcode_scan sessions, bond.import
-- for csv_file / excel_file sessions), locks the session (FOR UPDATE) and the campaign (FOR SHARE,
-- serialized against rule changes and transitions), validates, writes, and inserts exactly one
-- audit_log row. A rejected call writes nothing.
--
--   import_session_create        new draft session for a draft/active campaign
--   import_session_add_items     bulk add of file rows (jsonb array, <= 5000 live items/session)
--   import_session_add_scan      one scanned item (row number = next in the session)
--   import_session_update_item   corrects the raw fields of an item (back to pending)
--   import_session_remove_item   soft-removes an item (removed_at/by, optional reason)
--   import_session_cancel        cancels a draft/validated session (optional reason)
--   import_session_validate      re-runs every check against the live campaign data, writes each
--                                live item's status / error, and moves the session to validated
--                                when nothing is blocking (otherwise it stays draft)
--
-- Items store the four raw fields (tipo_bono, grupo_pata, numero_base, barcode), trimmed of
-- spaces/tabs/line breaks (blank = null), in parsed_value. barcode / item_type / group_key /
-- base_number are derived from them with the campaign rules (import_interpret_item) when staged
-- and again on validation (a draft campaign's rules may change in between). Staged and corrected
-- items are `pending`; only validation sets valid / warning / error.
--
-- Barcode interpretation (barcode_mode):
--   base_number           the barcode is the base number (digits, up to number_digits)
--   manual_mapping        the base number comes from numero_base
--   internal_code /
--   external_legacy_code  regexp_match(barcode, barcode_pattern)[1] is the base number; without a
--                         pattern, like manual_mapping
-- numero_base may be empty when the barcode carries the number; when both are present they must
-- agree.
--
-- Validation (same rules, codes and messages as src/lib/domain/imports.ts):
--   error, first of: row checks (missing_type, invalid_type, missing_barcode, barcode_too_long,
--   simple_with_group, missing_group, group_too_long, invalid_barcode, barcode_pattern_mismatch,
--   invalid_base_number, missing_base_number, base_number_mismatch, out_of_range, overflow),
--   pata_incomplete (a grupo_pata with < 2 rows passing the row checks),
--   duplicate_number_in_batch (base or associated number twice among live items),
--   duplicate_barcode_in_batch (row barcodes and pata group codes share one namespace),
--   duplicate_number_in_campaign (live bond_numbers), duplicate_barcode_in_campaign (live
--   bonds.barcode / bond_numbers.barcode).
--   warning: base_number_not_padded (numero_base, or a base_number-mode barcode, written with
--   fewer digits than number_digits).
-- Validation is a snapshot: bonds created afterwards are caught again by confirmation (SAN-47),
-- where the unique indexes are the final word.
--
-- Audit actions (entity_type 'import_session', entity_id = session id; item actions use
-- entity_type 'import_session_item', entity_id = item id):
--   import.create, import.add_items (counts), import.add_item, import.update_item,
--   import.remove_item, import.cancel, import.validate (summary).
--
-- Errors (SQLSTATE):
--   42501 no active profile / missing permission
--   22023 invalid input (source type, file name, notes, items payload, field too long, row number
--         repeated, too many items, wrong add function for the source)
--   P0002 campaign, session or item not found
--   55000 campaign not draft/active; session not draft/validated; item removed; nothing to
--         validate
--   23514 / 23001 / 23505 SAN-44 constraints and triggers (backstops)

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create function public.import_require_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_profile_id();
begin
  if v_actor is null then
    raise exception 'an active profile is required to change imports'
      using errcode = 'insufficient_privilege';
  end if;
  return v_actor;
end;
$$;

-- bond.scan for scan sessions, bond.import for file sessions.
create function public.import_require_permission(p_source_type text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_permission text := case when p_source_type = 'barcode_scan' then 'bond.scan' else 'bond.import' end;
begin
  if not public.has_permission(v_permission) then
    raise exception 'permission denied: % is required', v_permission
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Trims spaces, tabs and line breaks; blank = null (same as normalizeField in TS).
create function public.import_trim(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(p_value, E' \t\r\n'), '');
$$;

-- "row 4" / "rows 2, 5" / "rows 1, ..., 10 and 3 more" (same as rowsLabel in TS).
create function public.import_rows_label(p_rows integer[])
returns text
language sql
immutable
set search_path = ''
as $$
  with r as (select distinct x from unnest(p_rows) x),
  s as (select array_agg(x order by x) a from r)
  select case when cardinality(s.a) = 1 then 'row ' else 'rows ' end
    || array_to_string(s.a[1:10], ', ')
    || case when cardinality(s.a) > 10 then ' and ' || (cardinality(s.a) - 10) || ' more' else '' end
  from s;
$$;

-- Validates and normalizes one item payload into parsed_value: an object whose tipo_bono,
-- grupo_pata, numero_base and barcode are strings or null (other keys ignored), each at most 500
-- characters once trimmed.
create function public.import_parse_payload(p_item jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_result jsonb := '{}'::jsonb;
  v_value text;
begin
  if p_item is null or jsonb_typeof(p_item) <> 'object' then
    raise exception 'each import item must be an object' using errcode = 'invalid_parameter_value';
  end if;
  foreach v_key in array array['tipo_bono', 'grupo_pata', 'numero_base', 'barcode'] loop
    if p_item ? v_key and jsonb_typeof(p_item -> v_key) not in ('string', 'null') then
      raise exception 'import item field % must be text', v_key using errcode = 'invalid_parameter_value';
    end if;
    v_value := public.import_trim(p_item ->> v_key);
    if char_length(v_value) > 500 then
      raise exception 'import item field % is longer than 500 characters', v_key
        using errcode = 'invalid_parameter_value';
    end if;
    v_result := v_result || jsonb_build_object(v_key, v_value);
  end loop;
  return v_result;
end;
$$;

-- Row-level interpretation of one item (mirror of interpretImportItem in TS): derived columns,
-- the first row-level error and the padding warning.
create function public.import_interpret_item(
  p_campaign public.campaigns,
  p_parsed jsonb,
  out barcode text,
  out item_type text,
  out group_key text,
  out base_number integer,
  out error_code text,
  out error_message text,
  out warning_code text,
  out warning_message text
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_type_raw text := public.import_trim(p_parsed ->> 'tipo_bono');
  v_group text := public.import_trim(p_parsed ->> 'grupo_pata');
  v_n text := public.import_trim(p_parsed ->> 'numero_base');
  v_b text := public.import_trim(p_parsed ->> 'barcode');
  v_digits integer := p_campaign.number_digits;
  v_max integer := p_campaign.max_number;
  v_offset integer := p_campaign.associated_number_offset;
  v_kind text;
  v_read_text text;
  v_read bigint;
  v_typed bigint;
  v_value bigint;
  v_manual boolean;
  v_match text[];
  v_written text;
begin
  v_kind := case when lower(v_type_raw) in ('simple', 'pata') then lower(v_type_raw) end;
  barcode := case when char_length(v_b) <= 200 then v_b end;
  group_key := case when v_kind = 'pata' and char_length(v_group) <= 200 then v_group end;
  item_type := case when v_kind = 'simple' then 'simple' when group_key is not null then 'pata' end;

  if v_type_raw is null then
    error_code := 'missing_type'; error_message := 'Bond type is required (simple or pata)';
  elsif v_kind is null then
    error_code := 'invalid_type';
    error_message := format('Unknown bond type "%s" (use simple or pata)', v_type_raw);
  end if;

  if error_code is null and v_b is null then
    error_code := 'missing_barcode'; error_message := 'Barcode is required';
  elsif error_code is null and char_length(v_b) > 200 then
    error_code := 'barcode_too_long'; error_message := 'Barcode must be at most 200 characters';
  end if;

  if error_code is null then
    if v_kind = 'simple' and v_group is not null then
      error_code := 'simple_with_group';
      error_message := format('A simple bond cannot belong to a pata group ("%s")', v_group);
    elsif v_kind = 'pata' and v_group is null then
      error_code := 'missing_group';
      error_message := 'A pata row needs a pata group (grupo_pata)';
    elsif v_kind = 'pata' and char_length(v_group) > 200 then
      error_code := 'group_too_long';
      error_message := 'Pata group must be at most 200 characters';
    end if;
  end if;

  if barcode is null then
    return;
  end if;

  -- What the barcode says about the base number.
  v_manual := p_campaign.barcode_mode = 'manual_mapping'
    or (p_campaign.barcode_mode in ('internal_code', 'external_legacy_code')
        and p_campaign.barcode_pattern is null);

  if p_campaign.barcode_mode = 'base_number' then
    if barcode ~ '^[0-9]+$' and char_length(barcode) <= v_digits then
      v_read_text := barcode;
    elsif error_code is null then
      error_code := 'invalid_barcode';
      error_message := format('Barcode "%s" is not a base number of up to %s digits', barcode, v_digits);
    end if;
    if v_read_text is null then
      return;
    end if;
  elsif not v_manual then
    v_match := regexp_match(barcode, p_campaign.barcode_pattern);
    if v_match is null or v_match[1] is null then
      if error_code is null then
        error_code := 'barcode_pattern_mismatch';
        error_message := format('Barcode "%s" does not match the campaign barcode pattern', barcode);
      end if;
      return;
    end if;
    if not (v_match[1] ~ '^[0-9]+$' and char_length(v_match[1]) <= v_digits) then
      if error_code is null then
        error_code := 'invalid_barcode';
        error_message := format(
          'The base number read from barcode "%s" ("%s") is not a number of up to %s digits',
          barcode, v_match[1], v_digits);
      end if;
      return;
    end if;
    v_read_text := v_match[1];
  end if;

  if v_n is not null and not (v_n ~ '^[0-9]+$' and char_length(v_n) <= v_digits) then
    if error_code is null then
      error_code := 'invalid_base_number';
      error_message := format('Base number "%s" must be a number of up to %s digits', v_n, v_digits);
    end if;
    return;
  end if;
  if v_read_text is null and v_n is null then
    if error_code is null then
      error_code := 'missing_base_number';
      error_message := 'Base number is required: this campaign''s barcodes do not carry it';
    end if;
    return;
  end if;

  v_typed := v_n::bigint;
  v_read := v_read_text::bigint;
  if v_typed is not null and v_read is not null and v_typed <> v_read then
    if error_code is null then
      error_code := 'base_number_mismatch';
      error_message := format('Base number %s does not match the number in barcode "%s" (%s)',
        public.bond_format_number(v_typed, v_digits), barcode,
        public.bond_format_number(v_read, v_digits));
    end if;
    return;
  end if;

  v_value := coalesce(v_read, v_typed);
  if v_value > v_max then
    if error_code is null then
      error_code := 'out_of_range';
      error_message := format('Number %s exceeds the campaign maximum number %s',
        public.bond_format_number(v_value, v_digits), public.bond_format_number(v_max, v_digits));
    end if;
    return;
  end if;

  base_number := v_value;
  if v_value + v_offset > v_max then
    if error_code is null then
      error_code := 'overflow';
      error_message := format(
        'Base number %s overflows: its associated number %s exceeds the campaign maximum number %s (the highest allowed base number is %s)',
        public.bond_format_number(v_value, v_digits),
        public.bond_format_number(v_value + v_offset, v_digits),
        public.bond_format_number(v_max, v_digits),
        public.bond_format_number(v_max - v_offset, v_digits));
    end if;
    return;
  end if;

  if error_code is null then
    v_written := coalesce(v_n, case when p_campaign.barcode_mode = 'base_number' then barcode end);
    if char_length(v_written) < v_digits then
      warning_code := 'base_number_not_padded';
      warning_message := format('Base number "%s" is not padded to %s digits (read as %s)',
        v_written, v_digits, public.bond_format_number(v_value, v_digits));
    end if;
  end if;
end;
$$;

-- The live bond holding a code in the campaign namespace (bonds.barcode not annulled from
-- available, or bond_numbers.barcode not released), or null.
create function public.import_barcode_holder(p_campaign_id uuid, p_code text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select b.id from public.bonds b
     where b.campaign_id = p_campaign_id and b.barcode = p_code
       and (b.commercial_status <> 'annulled' or b.annulled_from_status is distinct from 'available')
     limit 1),
    (select n.bond_id from public.bond_numbers n
     where n.campaign_id = p_campaign_id and n.barcode = p_code and n.released_at is null
     limit 1)
  );
$$;

-- Locks the campaign FOR SHARE and checks it accepts imports (draft or active).
create function public.import_lock_campaign(p_campaign_id uuid)
returns public.campaigns
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_campaign public.campaigns;
begin
  select * into v_campaign from public.campaigns where id = p_campaign_id for share;
  if not found then
    raise exception 'campaign % not found', p_campaign_id using errcode = 'no_data_found';
  end if;
  if v_campaign.status not in ('draft', 'active') then
    raise exception 'imports can only be staged or validated while the campaign is draft or active (status: %)', v_campaign.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  return v_campaign;
end;
$$;

-- Locks a session FOR UPDATE after the permission check for its source; it must be draft or
-- validated.
create function public.import_lock_session(p_session_id uuid)
returns public.import_sessions
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_session public.import_sessions;
begin
  select * into v_session from public.import_sessions where id = p_session_id for update;
  if not found then
    raise exception 'import session % not found', p_session_id using errcode = 'no_data_found';
  end if;
  perform public.import_require_permission(v_session.source_type);
  if v_session.status not in ('draft', 'validated') then
    raise exception 'import session % is % and cannot be changed', p_session_id, v_session.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  return v_session;
end;
$$;

-- The session of an item, locked (see import_lock_session), then the item, locked.
create function public.import_lock_item(p_item_id uuid)
returns public.import_session_items
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_item public.import_session_items;
begin
  select i.import_session_id into v_session_id from public.import_session_items i where i.id = p_item_id;
  if not found then
    raise exception 'import session item % not found', p_item_id using errcode = 'no_data_found';
  end if;
  perform public.import_lock_session(v_session_id);
  select * into v_item from public.import_session_items where id = p_item_id for update;
  if v_item.removed_at is not null then
    raise exception 'import session item % was removed and cannot be changed', p_item_id
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  return v_item;
end;
$$;

create function public.import_session_snapshot(p_session public.import_sessions)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_session.id, 'campaign_id', p_session.campaign_id,
    'source_type', p_session.source_type, 'status', p_session.status,
    'file_name', p_session.file_name, 'notes', p_session.notes,
    'created_by', p_session.created_by
  );
$$;

create function public.import_item_snapshot(p_item public.import_session_items)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_item.id, 'import_session_id', p_item.import_session_id,
    'row_number', p_item.row_number, 'parsed_value', p_item.parsed_value,
    'barcode', p_item.barcode, 'item_type', p_item.item_type, 'group_key', p_item.group_key,
    'base_number', p_item.base_number, 'status', p_item.status,
    'error_code', p_item.error_code, 'removed_at', p_item.removed_at
  );
$$;

-- Default raw text of an item: its four fields joined with commas.
create function public.import_default_raw(p_parsed jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(',', coalesce(p_parsed ->> 'tipo_bono', ''), coalesce(p_parsed ->> 'grupo_pata', ''),
    coalesce(p_parsed ->> 'numero_base', ''), coalesce(p_parsed ->> 'barcode', ''));
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
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.import_require_actor();
  v_file_name text := public.import_trim(p_file_name);
  v_notes text := public.import_trim(p_notes);
  v_session public.import_sessions;
begin
  if p_source_type is null or p_source_type not in ('barcode_scan', 'csv_file', 'excel_file') then
    raise exception 'unknown import source type %', coalesce(p_source_type, 'null')
      using errcode = 'invalid_parameter_value';
  end if;
  perform public.import_require_permission(p_source_type);

  if p_source_type = 'barcode_scan' and v_file_name is not null then
    raise exception 'a barcode scan session has no file name' using errcode = 'invalid_parameter_value';
  end if;
  if p_source_type <> 'barcode_scan' and v_file_name is null then
    raise exception 'a file name is required for a file import' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_file_name) > 255 then
    raise exception 'file name must be at most 255 characters' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_notes) > 2000 then
    raise exception 'notes must be at most 2000 characters' using errcode = 'invalid_parameter_value';
  end if;

  perform public.import_lock_campaign(p_campaign_id);

  insert into public.import_sessions (campaign_id, source_type, file_name, notes, created_by)
  values (p_campaign_id, p_source_type, v_file_name, v_notes, v_actor)
  returning * into v_session;

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (v_actor, 'import.create', 'import_session', v_session.id::text, null,
    public.import_session_snapshot(v_session), null, p_request_id);

  return v_session.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- import_session_add_items: file rows in bulk
-- ---------------------------------------------------------------------------
-- p_items: [{"row_number": 2, "raw": "simple,,0068,0068", "tipo_bono": "simple",
--            "grupo_pata": null, "numero_base": "0068", "barcode": "0068"}, ...]
-- Returns the number of items added.
create function public.import_session_add_items(
  p_session_id uuid,
  p_items jsonb,
  p_request_id text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.import_require_actor();
  v_session public.import_sessions;
  v_campaign public.campaigns;
  v_count integer;
  v_live integer;
  v_repeated integer;
  v_bad integer;
begin
  v_session := public.import_lock_session(p_session_id);
  if v_session.source_type = 'barcode_scan' then
    raise exception 'items of a barcode scan session are added one at a time'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one import item is required' using errcode = 'invalid_parameter_value';
  end if;
  v_count := jsonb_array_length(p_items);

  select count(*) into v_live from public.import_session_items
  where import_session_id = p_session_id and removed_at is null;
  if v_live + v_count > 5000 then
    raise exception 'an import session can have at most 5000 items (it has %, % more were sent)', v_live, v_count
      using errcode = 'invalid_parameter_value';
  end if;

  select count(*) into v_bad
  from jsonb_array_elements(p_items) e
  where jsonb_typeof(e) <> 'object'
    or jsonb_typeof(e -> 'row_number') is distinct from 'number'
    or (e ->> 'row_number') !~ '^[0-9]{1,9}$'
    or (e ->> 'row_number')::integer < 1
    or (e ? 'raw' and jsonb_typeof(e -> 'raw') not in ('string', 'null'));
  if v_bad > 0 then
    raise exception 'each import item needs a positive integer row_number and an optional raw text'
      using errcode = 'invalid_parameter_value';
  end if;

  select r into v_repeated
  from (
    select (e ->> 'row_number')::integer r from jsonb_array_elements(p_items) e
    union all
    select row_number from public.import_session_items where import_session_id = p_session_id
  ) x
  group by r having count(*) > 1 order by r limit 1;
  if v_repeated is not null then
    raise exception 'row % is already in this import session', v_repeated
      using errcode = 'invalid_parameter_value';
  end if;

  v_campaign := public.import_lock_campaign(v_session.campaign_id);

  insert into public.import_session_items
    (import_session_id, row_number, raw_value, parsed_value, barcode, item_type, group_key,
     base_number, status)
  select p_session_id, x.row_number,
    left(coalesce(x.raw, public.import_default_raw(x.parsed)), 2000),
    x.parsed, r.barcode, r.item_type, r.group_key, r.base_number, 'pending'
  from (
    select (e ->> 'row_number')::integer as row_number, e ->> 'raw' as raw,
      public.import_parse_payload(e) as parsed
    from jsonb_array_elements(p_items) e
  ) x
  cross join lateral public.import_interpret_item(v_campaign, x.parsed) r
  order by x.row_number;

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  select v_actor, 'import.add_items', 'import_session', p_session_id::text, null,
    jsonb_build_object('added', v_count, 'first_row', min((e ->> 'row_number')::integer),
      'last_row', max((e ->> 'row_number')::integer), 'live_items', v_live + v_count),
    null, p_request_id
  from jsonb_array_elements(p_items) e;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- import_session_add_scan: one scanned item; returns its id
-- ---------------------------------------------------------------------------
create function public.import_session_add_scan(
  p_session_id uuid,
  p_item jsonb,
  p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.import_require_actor();
  v_session public.import_sessions;
  v_campaign public.campaigns;
  v_parsed jsonb;
  v_live integer;
  v_row integer;
  v_item public.import_session_items;
begin
  v_session := public.import_lock_session(p_session_id);
  if v_session.source_type <> 'barcode_scan' then
    raise exception 'items of a file import are added in bulk' using errcode = 'invalid_parameter_value';
  end if;
  v_parsed := public.import_parse_payload(p_item);
  if p_item ? 'raw' and jsonb_typeof(p_item -> 'raw') not in ('string', 'null') then
    raise exception 'import item raw must be text' using errcode = 'invalid_parameter_value';
  end if;

  select count(*) filter (where removed_at is null), coalesce(max(row_number), 0) + 1
  into v_live, v_row
  from public.import_session_items where import_session_id = p_session_id;
  if v_live >= 5000 then
    raise exception 'an import session can have at most 5000 items' using errcode = 'invalid_parameter_value';
  end if;

  v_campaign := public.import_lock_campaign(v_session.campaign_id);

  insert into public.import_session_items
    (import_session_id, row_number, raw_value, parsed_value, barcode, item_type, group_key,
     base_number, status)
  select p_session_id, v_row,
    left(coalesce(p_item ->> 'raw', v_parsed ->> 'barcode', public.import_default_raw(v_parsed)), 2000),
    v_parsed, r.barcode, r.item_type, r.group_key, r.base_number, 'pending'
  from public.import_interpret_item(v_campaign, v_parsed) r
  returning * into v_item;

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (v_actor, 'import.add_item', 'import_session_item', v_item.id::text, null,
    public.import_item_snapshot(v_item), null, p_request_id);

  return v_item.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- import_session_update_item: corrects the raw fields (raw_value is kept as the original source)
-- ---------------------------------------------------------------------------
create function public.import_session_update_item(
  p_item_id uuid,
  p_item jsonb,
  p_request_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.import_require_actor();
  v_old public.import_session_items;
  v_new public.import_session_items;
  v_campaign public.campaigns;
  v_parsed jsonb;
  v_campaign_id uuid;
begin
  v_old := public.import_lock_item(p_item_id);
  v_parsed := public.import_parse_payload(p_item);
  if v_parsed is not distinct from v_old.parsed_value then
    return false;
  end if;

  select s.campaign_id into v_campaign_id from public.import_sessions s where s.id = v_old.import_session_id;
  v_campaign := public.import_lock_campaign(v_campaign_id);

  update public.import_session_items i
  set parsed_value = v_parsed, barcode = r.barcode, item_type = r.item_type,
      group_key = r.group_key, base_number = r.base_number, status = 'pending',
      error_code = null, error_message = null
  from public.import_interpret_item(v_campaign, v_parsed) r
  where i.id = p_item_id
  returning i.* into v_new;

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (v_actor, 'import.update_item', 'import_session_item', p_item_id::text,
    public.import_item_snapshot(v_old), public.import_item_snapshot(v_new), null, p_request_id);

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- import_session_remove_item: soft removal
-- ---------------------------------------------------------------------------
create function public.import_session_remove_item(
  p_item_id uuid,
  p_reason text default null,
  p_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.import_require_actor();
  v_old public.import_session_items;
  v_new public.import_session_items;
  v_reason text := public.import_trim(p_reason);
begin
  if char_length(v_reason) > 500 then
    raise exception 'reason must be at most 500 characters' using errcode = 'invalid_parameter_value';
  end if;
  v_old := public.import_lock_item(p_item_id);

  update public.import_session_items
  set removed_by = v_actor, remove_reason = v_reason
  where id = p_item_id
  returning * into v_new;

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (v_actor, 'import.remove_item', 'import_session_item', p_item_id::text,
    public.import_item_snapshot(v_old), public.import_item_snapshot(v_new), v_reason, p_request_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- import_session_cancel
-- ---------------------------------------------------------------------------
create function public.import_session_cancel(
  p_session_id uuid,
  p_reason text default null,
  p_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.import_require_actor();
  v_old public.import_sessions;
  v_new public.import_sessions;
  v_reason text := public.import_trim(p_reason);
begin
  if char_length(v_reason) > 500 then
    raise exception 'reason must be at most 500 characters' using errcode = 'invalid_parameter_value';
  end if;
  v_old := public.import_lock_session(p_session_id);

  update public.import_sessions
  set status = 'cancelled', cancelled_by = v_actor, cancel_reason = v_reason
  where id = p_session_id
  returning * into v_new;

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (v_actor, 'import.cancel', 'import_session', p_session_id::text,
    jsonb_build_object('status', v_old.status), jsonb_build_object('status', v_new.status),
    v_reason, p_request_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- import_session_validate
-- ---------------------------------------------------------------------------
-- Returns {"status", "total_items", "valid", "warnings", "errors", "pending", "simple_bonds",
-- "patas", "base_numbers", "participating_numbers", "duplicates"} over the live items.
create function public.import_session_validate(
  p_session_id uuid,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.import_require_actor();
  v_session public.import_sessions;
  v_campaign public.campaigns;
  v_live integer;
  v_status text;
  v_summary jsonb;
begin
  v_session := public.import_lock_session(p_session_id);
  v_campaign := public.import_lock_campaign(v_session.campaign_id);

  select count(*) into v_live from public.import_session_items
  where import_session_id = p_session_id and removed_at is null;
  if v_live = 0 then
    raise exception 'import session % has no items to validate', p_session_id
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  with interp as (
    select i.id, i.row_number, r.*
    from public.import_session_items i
    cross join lateral public.import_interpret_item(v_campaign, i.parsed_value) r
    where i.import_session_id = p_session_id and i.removed_at is null
  ),
  grp as (
    select it.group_key, count(*) filter (where it.error_code is null) as ok
    from interp it where it.item_type = 'pata' and it.group_key is not null
    group by it.group_key
  ),
  nums as (
    select it.id, it.row_number, it.base_number::bigint as v from interp it
    where it.error_code is null and it.base_number is not null
    union all
    select it.id, it.row_number, it.base_number::bigint + v_campaign.associated_number_offset
    from interp it where it.error_code is null and it.base_number is not null
  ),
  num_dup as (
    select n.v, array_agg(n.row_number) as rows from nums n group by n.v having count(*) > 1
  ),
  row_num_dup as (
    select distinct on (n.id) n.id, d.v, d.rows
    from nums n join num_dup d on d.v = n.v
    order by n.id, d.v
  ),
  codes as (
    select it.barcode as code, 'r:' || it.row_number as owner, it.row_number from interp it
    where it.barcode is not null
    union all
    select it.group_key, 'g:' || it.group_key, it.row_number from interp it
    where it.item_type = 'pata' and it.group_key is not null
  ),
  code_dup as (
    select c.code, array_agg(c.row_number) as rows from codes c
    group by c.code having count(distinct c.owner) > 1
  ),
  camp_num as (
    select distinct on (n.id) n.id, n.v, bn.bond_id
    from nums n
    join public.bond_numbers bn
      on bn.campaign_id = v_campaign.id and bn.released_at is null and bn.number_value = n.v
    order by n.id, n.v
  ),
  checked as (
    select it.*,
      case when it.item_type = 'pata' and g.ok < 2 then g.ok end as pata_ok,
      rnd.v as dup_v, rnd.rows as dup_v_rows,
      coalesce(cd_own.code, cd_grp.code) as dup_code,
      coalesce(cd_own.rows, cd_grp.rows) as dup_code_rows,
      cn.v as camp_v, cn.bond_id as camp_v_bond
    from interp it
    left join grp g on g.group_key = it.group_key and it.item_type = 'pata'
    left join row_num_dup rnd on rnd.id = it.id
    left join code_dup cd_own on cd_own.code = it.barcode
    left join code_dup cd_grp on cd_grp.code = it.group_key and it.item_type = 'pata'
    left join camp_num cn on cn.id = it.id
  ),
  issues as (
    select c.id, c.barcode, c.item_type, c.group_key, c.base_number, c.warning_code, c.warning_message,
      case
        when c.error_code is not null then c.error_code
        when c.pata_ok is not null then 'pata_incomplete'
        when c.dup_v is not null then 'duplicate_number_in_batch'
        when c.dup_code is not null then 'duplicate_barcode_in_batch'
        when c.camp_v is not null then 'duplicate_number_in_campaign'
        when h.code is not null then 'duplicate_barcode_in_campaign'
      end as e_code,
      case
        when c.error_code is not null then c.error_message
        when c.pata_ok is not null then
          format('Pata "%s" needs at least 2 valid rows (it has %s)', c.group_key, c.pata_ok)
        when c.dup_v is not null then
          format('Number %s is repeated in this import (%s)',
            public.bond_format_number(c.dup_v, v_campaign.number_digits),
            public.import_rows_label(c.dup_v_rows))
        when c.dup_code is not null then
          format('Barcode "%s" is repeated in this import (%s)', c.dup_code,
            public.import_rows_label(c.dup_code_rows))
        when c.camp_v is not null then
          format('Number %s is already used by bond %s',
            public.bond_format_number(c.camp_v, v_campaign.number_digits), c.camp_v_bond)
        when h.code is not null then
          format('Barcode "%s" is already used by bond %s', h.code, h.bond_id)
      end as e_message
    from checked c
    left join lateral (
      select x.code, x.bond_id
      from (
        select 1 as ord, c.barcode as code, public.import_barcode_holder(v_campaign.id, c.barcode) as bond_id
        where c.barcode is not null
        union all
        select 2, c.group_key, public.import_barcode_holder(v_campaign.id, c.group_key)
        where c.item_type = 'pata' and c.group_key is not null
      ) x
      where x.bond_id is not null
      order by x.ord
      limit 1
    ) h on c.error_code is null and c.pata_ok is null and c.dup_v is null and c.dup_code is null
      and c.camp_v is null
  ),
  final as (
    select s.id, s.barcode, s.item_type, s.group_key, s.base_number,
      case when s.e_code is not null then 'error'
           when s.warning_code is not null then 'warning'
           else 'valid' end as status,
      coalesce(s.e_code, s.warning_code) as error_code,
      coalesce(s.e_message, s.warning_message) as error_message
    from issues s
  )
  update public.import_session_items t
  set barcode = f.barcode, item_type = f.item_type, group_key = f.group_key,
      base_number = f.base_number, status = f.status, error_code = f.error_code,
      error_message = f.error_message
  from final f
  where t.id = f.id
    and (t.barcode, t.item_type, t.group_key, t.base_number, t.status, t.error_code, t.error_message)
      is distinct from
        (f.barcode, f.item_type, f.group_key, f.base_number, f.status, f.error_code, f.error_message);

  select jsonb_build_object(
    'total_items', count(*),
    'valid', count(*) filter (where i.status = 'valid'),
    'warnings', count(*) filter (where i.status = 'warning'),
    'errors', count(*) filter (where i.status = 'error'),
    'pending', count(*) filter (where i.status = 'pending'),
    'simple_bonds', count(*) filter (where i.status in ('valid', 'warning') and i.item_type = 'simple'),
    'patas', count(distinct i.group_key) filter (where i.status in ('valid', 'warning') and i.item_type = 'pata'),
    'base_numbers', count(*) filter (where i.status in ('valid', 'warning')),
    'participating_numbers', 2 * count(*) filter (where i.status in ('valid', 'warning')),
    'duplicates', count(*) filter (where i.status = 'error' and i.error_code like 'duplicate\_%')
  )
  into v_summary
  from public.import_session_items i
  where i.import_session_id = p_session_id and i.removed_at is null;

  -- Item updates of a validated session sent it back to draft (SAN-44 trigger).
  select s.status into v_status from public.import_sessions s where s.id = p_session_id;
  if (v_summary ->> 'errors')::integer = 0 and v_status = 'draft' then
    update public.import_sessions set status = 'validated' where id = p_session_id;
    v_status := 'validated';
  end if;
  v_summary := v_summary || jsonb_build_object('status', v_status);

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (v_actor, 'import.validate', 'import_session', p_session_id::text,
    jsonb_build_object('status', v_session.status), v_summary, null, p_request_id);

  return v_summary;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function public.import_require_actor() from public, anon, authenticated, service_role;
revoke all on function public.import_require_permission(text) from public, anon, authenticated, service_role;
revoke all on function public.import_trim(text) from public, anon, authenticated, service_role;
revoke all on function public.import_rows_label(integer[]) from public, anon, authenticated, service_role;
revoke all on function public.import_parse_payload(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.import_interpret_item(public.campaigns, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.import_barcode_holder(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.import_lock_campaign(uuid) from public, anon, authenticated, service_role;
revoke all on function public.import_lock_session(uuid) from public, anon, authenticated, service_role;
revoke all on function public.import_lock_item(uuid) from public, anon, authenticated, service_role;
revoke all on function public.import_session_snapshot(public.import_sessions) from public, anon, authenticated, service_role;
revoke all on function public.import_item_snapshot(public.import_session_items) from public, anon, authenticated, service_role;
revoke all on function public.import_default_raw(jsonb) from public, anon, authenticated, service_role;

revoke all on function public.import_session_create(uuid, text, text, text, text) from public, anon, service_role;
revoke all on function public.import_session_add_items(uuid, jsonb, text) from public, anon, service_role;
revoke all on function public.import_session_add_scan(uuid, jsonb, text) from public, anon, service_role;
revoke all on function public.import_session_update_item(uuid, jsonb, text) from public, anon, service_role;
revoke all on function public.import_session_remove_item(uuid, text, text) from public, anon, service_role;
revoke all on function public.import_session_cancel(uuid, text, text) from public, anon, service_role;
revoke all on function public.import_session_validate(uuid, text) from public, anon, service_role;

grant execute on function public.import_session_create(uuid, text, text, text, text) to authenticated;
grant execute on function public.import_session_add_items(uuid, jsonb, text) to authenticated;
grant execute on function public.import_session_add_scan(uuid, jsonb, text) to authenticated;
grant execute on function public.import_session_update_item(uuid, jsonb, text) to authenticated;
grant execute on function public.import_session_remove_item(uuid, text, text) to authenticated;
grant execute on function public.import_session_cancel(uuid, text, text) to authenticated;
grant execute on function public.import_session_validate(uuid, text) to authenticated;
