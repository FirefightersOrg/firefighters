-- SAN-46: correct a staged import row from the preview screen.
--
-- The operator retypes the fields of one live row (type, grupo_pata, base number, barcode) and the
-- session is revalidated. A correction replaces the parsed fields, so it also clears a parser
-- error (parse_*), which revalidation alone keeps. raw_value stays as the source row; the fields
-- that were replaced are kept in the audit entry.

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

  update public.import_session_items
  set item_type = v_type, group_key = v_group, base_number = p_base_number, barcode = v_barcode,
      status = 'pending', error_code = null, error_message = null
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

revoke all on function public.import_session_update_item(uuid, text, text, integer, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.import_session_update_item(uuid, text, text, integer, text, text)
  to authenticated;

comment on function public.import_session_update_item(uuid, text, text, integer, text, text) is
  'Corrects the fields of a live staged row (clearing a parser error) and revalidates the session.';
