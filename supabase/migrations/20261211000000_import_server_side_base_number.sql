-- SAN-100: close two SQL gaps in import staging.
--
-- 1. import_session_add_items no longer trusts the client's base_number. The campaign's barcode
--    rule decides: the number is verified against the barcode, and derived from it when missing.
--    A mismatch is staged as an error row with the parse_* code of import_check_code (SAN-46),
--    so it can never be confirmed. manual_mapping, or a pattern mode without a pattern, keeps the
--    client's value.
-- 2. import_session_revalidate produces duplicate_number: two live rows with the same base number.
--    number_conflict stays for a base number that only meets another row's associated number.
--    number_in_use / barcode_in_use are unchanged (numbers already held by bonds). The summary
--    already counts duplicate_number among the duplicates.

-- The base number the campaign's barcode rule reads from a code; null when there is no rule or the
-- code does not follow it (import_check_code reports why).
create function public.import_barcode_base(p_campaign_id uuid, p_barcode text)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_campaign public.campaigns;
  v_text text;
begin
  select * into v_campaign from public.campaigns where id = p_campaign_id;
  if v_campaign.barcode_mode = 'base_number' then
    v_text := p_barcode;
  elsif v_campaign.barcode_mode in ('internal_code', 'external_legacy_code')
        and v_campaign.barcode_pattern is not null then
    v_text := (regexp_match(p_barcode, v_campaign.barcode_pattern))[1];
  else
    return null;
  end if;
  if v_text is null or v_text !~ '^[0-9]{1,10}$' or v_text::bigint > 2147483647 then
    return null;
  end if;
  return v_text::bigint::integer;
end;
$$;

create or replace function public.import_session_revalidate(p_session_id uuid)
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

  -- The same base number on two or more live rows of the session (SAN-100). It goes before the
  -- participating-number check, so number_conflict is left for a base number that only meets
  -- another row's associated number (or its own, when the offset is 0).
  update public.import_session_items i
  set status = 'error', error_code = 'duplicate_number',
      error_message = format('Base number %s is repeated in the import.',
        public.bond_format_number(i.base_number, v_digits))
  where i.import_session_id = p_session_id and i.removed_at is null
    and i.created_bond_id is null and i.error_code is null and i.base_number is not null
    and exists (
      select 1 from public.import_session_items x
      where x.import_session_id = p_session_id and x.removed_at is null
        and x.created_bond_id is null and x.id <> i.id and x.base_number = i.base_number
    );

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

create or replace function public.import_session_add_items(
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
  v_barcode text;
  v_base integer;
  v_error_code text;
  v_error_message text;
  v_check record;
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

    -- SAN-100: the campaign's barcode rule is authoritative. The client's base number is verified
    -- against the barcode (and derived from it when missing); a mismatch is staged as a parse_*
    -- error row, like a correction (import_check_code). Without a rule (manual_mapping, or a
    -- pattern mode without a pattern) the client's value is kept. Parser errors are left as sent.
    v_barcode := nullif(btrim(v_row ->> 'barcode'), '');
    v_base := (v_row ->> 'base_number')::integer;
    v_error_code := v_row ->> 'error_code';
    v_error_message := nullif(btrim(v_row ->> 'error_message'), '');
    if v_error_code is null and v_barcode is not null then
      select * into v_check from public.import_check_code(v_session.campaign_id, v_barcode, v_base);
      if v_check.error_code is not null then
        v_error_code := v_check.error_code;
        v_error_message := v_check.error_message;
      elsif v_base is null then
        v_base := public.import_barcode_base(v_session.campaign_id, v_barcode);
      end if;
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
      v_base,
      case when v_error_code is not null then 'error' else 'pending' end,
      v_error_code,
      v_error_message
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

revoke all on function public.import_barcode_base(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.import_session_revalidate(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.import_session_add_items(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.import_session_add_items(uuid, jsonb, text) to authenticated;

comment on function public.import_session_add_items(uuid, jsonb, text) is
  'Stages parsed file rows (the base number is verified against the barcode per the campaign rule), validates them and returns the session summary.';
