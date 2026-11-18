-- SAN-46: correct a staged import row from the preview screen.
--
-- The operator retypes the fields of one live row (type, grupo_pata, base number, barcode) and the
-- session is revalidated. A correction replaces the parsed fields, so it also clears a parser
-- error (parse_*), which revalidation alone keeps. raw_value stays as the source row; the fields
-- that were replaced are kept in the audit entry.

-- The campaign's barcode rule applied to a typed (code, base number) pair, the same way the file
-- path does it in TypeScript (`readBarcode` / `interpretImportRow`, SAN-98):
--   base_number            the code must be the base number (1..10 digits);
--   internal_code /
--   external_legacy_code   with a pattern, its first capture group must be the base number;
--   manual_mapping, or a pattern mode without a pattern: no rule (the number is typed).
-- Returns the parse_* code and message of the mismatch, or nulls when the pair is consistent.
create function public.import_check_code(
  p_campaign_id uuid, p_barcode text, p_base_number integer,
  out error_code text, out error_message text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_campaign public.campaigns;
  v_text text;
  v_match text[];
begin
  if p_barcode is null then
    return;
  end if;
  select * into v_campaign from public.campaigns where id = p_campaign_id;
  if v_campaign.barcode_mode = 'base_number' then
    v_text := p_barcode;
  elsif v_campaign.barcode_mode in ('internal_code', 'external_legacy_code')
        and v_campaign.barcode_pattern is not null then
    v_match := regexp_match(p_barcode, v_campaign.barcode_pattern);
    v_text := v_match[1];
    if v_text is null or v_text !~ '^[0-9]{1,10}$' or v_text::bigint > 2147483647 then
      error_code := 'parse_code_not_recognized';
      error_message := format('Barcode %s does not match the campaign pattern.', p_barcode);
      return;
    end if;
  else
    return;
  end if;
  if v_text !~ '^[0-9]{1,10}$' or v_text::bigint > 2147483647 then
    error_code := 'parse_code_not_a_number';
    error_message := format('Barcode %s is not a base number.', p_barcode);
  elsif p_base_number is not null and v_text::bigint <> p_base_number then
    error_code := 'parse_base_number_mismatch';
    error_message := format('Base number %s does not match barcode %s (%s).',
      p_base_number, p_barcode, v_text::bigint);
  end if;
end;
$$;

create function public.import_session_update_item(
  p_item_id uuid,
  p_item_type text,
  p_group_key text,
  p_base_number integer,
  p_barcode text,
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
  v_session public.import_sessions;
  v_session_id uuid;
  v_type text := nullif(btrim(p_item_type), '');
  v_group text := nullif(btrim(p_group_key), '');
  v_barcode text := nullif(btrim(p_barcode), '');
  v_before jsonb;
  v_after jsonb;
  v_check record;
begin
  select import_session_id into v_session_id from public.import_session_items where id = p_item_id;
  if not found then
    raise exception 'import session item % not found', p_item_id using errcode = 'no_data_found';
  end if;
  -- Locks the session and rejects one that is no longer draft or validated (55000).
  v_session := public.import_lock_session(v_session_id);
  select * into v_item from public.import_session_items where id = p_item_id for update;
  v_actor := public.import_require_actor(public.import_session_permission(v_session.source_type));

  if v_item.removed_at is not null then
    raise exception 'import session item % was removed and cannot be changed', p_item_id
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- Malformed input is a client bug (same rules as import_session_add_items).
  if v_type is not null and v_type not in ('simple', 'pata') then
    raise exception 'item_type must be simple or pata' using errcode = 'invalid_parameter_value';
  end if;
  if v_type = 'pata' and v_group is null then
    raise exception 'a pata row needs its grupo_pata' using errcode = 'invalid_parameter_value';
  end if;
  if v_type is distinct from 'pata' and v_group is not null then
    raise exception 'only a pata row can have a grupo_pata' using errcode = 'invalid_parameter_value';
  end if;
  if p_base_number < 0 then
    raise exception 'base_number must be a non-negative integer' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(coalesce(v_barcode, '')) > 200 or char_length(coalesce(v_group, '')) > 200 then
    raise exception 'barcode and grupo_pata are limited to 200 characters' using errcode = 'invalid_parameter_value';
  end if;

  v_before := jsonb_build_object('item_type', v_item.item_type, 'group_key', v_item.group_key,
    'base_number', v_item.base_number, 'barcode', v_item.barcode,
    'status', v_item.status, 'error_code', v_item.error_code);
  v_after := jsonb_build_object('item_type', v_type, 'group_key', v_group,
    'base_number', p_base_number, 'barcode', v_barcode);

  -- The typed values replace the parsed ones, so the old parser error goes away, but the campaign's
  -- barcode rule is applied again: a code that does not match its number stays a parse_* error
  -- (revalidation keeps those), so it can never be confirmed.
  select * into v_check from public.import_check_code(v_session.campaign_id, v_barcode, p_base_number);
  update public.import_session_items
  set item_type = v_type, group_key = v_group, base_number = p_base_number, barcode = v_barcode,
      status = case when v_check.error_code is null then 'pending' else 'error' end,
      error_code = v_check.error_code, error_message = v_check.error_message
  where id = p_item_id;

  perform public.import_session_revalidate(v_session.id);

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, request_id)
  values (
    v_actor, 'import.update_item', 'import_session', v_session.id::text,
    v_before || jsonb_build_object('item_id', p_item_id, 'row_number', v_item.row_number),
    v_after || jsonb_build_object('item_id', p_item_id, 'row_number', v_item.row_number),
    p_request_id
  );

  return public.import_session_summary(v_session.id);
end;
$$;

revoke all on function public.import_check_code(uuid, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.import_session_update_item(uuid, text, text, integer, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.import_session_update_item(uuid, text, text, integer, text, text)
  to authenticated;

comment on function public.import_session_update_item(uuid, text, text, integer, text, text) is
  'Corrects the fields of a live staged row (clearing a parser error) and revalidates the session.';

-- SAN-46 review: import_session_add_scan (SAN-45) also returns the row it staged (item_id,
-- row_number) so concurrent scans are reported on their own row. Same body otherwise.
create or replace function public.import_session_add_scan(
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
  v_item_id uuid;
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
  )
  returning id into v_item_id;

  perform public.import_session_revalidate(p_session_id);

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (
    v_actor, 'import.scan', 'import_session', p_session_id::text,
    jsonb_build_object('row_number', v_row_number, 'barcode', v_code, 'base_number', v_base,
                       'group_key', v_group),
    p_request_id
  );

  -- The staged row itself: the scanner reports on this row, not on the session's last one (scans
  -- of a fast scanner run concurrently).
  return public.import_session_summary(p_session_id)
    || jsonb_build_object('item_id', v_item_id, 'row_number', v_row_number);
end;
$$;

comment on function public.import_session_add_scan(uuid, text, text, integer, text, text) is
  'Resolves a scanned barcode per the campaign barcode_mode, stages one row and returns the summary plus the staged item_id and row_number.';
