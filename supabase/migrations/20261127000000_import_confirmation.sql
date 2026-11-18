-- SAN-47: atomically materialize a validated import and functionally roll it back.

-- Each imported bond gets the same bond.create entry as a manual load, so its record shows how it
-- was loaded (the snapshot is taken once its numbers exist) and which import created it.
create function public.import_audit_bond_create(
  p_actor uuid, p_bond public.bonds, p_session_id uuid, p_request_id text
)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (p_actor, 'bond.create', 'bond', p_bond.id::text,
    public.bond_audit_snapshot(p_bond) || jsonb_build_object('import_session_id', p_session_id),
    p_request_id);
$$;

-- A confirmation that found the session stale: back to draft (the user must review the new
-- errors and validate again), audited, reported with `confirmed: false`.
create function public.import_session_reject_confirmation(
  p_actor uuid, p_session_id uuid, p_request_id text
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_summary jsonb;
begin
  update public.import_sessions set status = 'draft' where id = p_session_id and status <> 'draft';
  v_summary := public.import_session_summary(p_session_id);
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (p_actor, 'import.confirm_rejected', 'import_session', p_session_id::text,
    jsonb_build_object('status', 'draft', 'reason', 'session is no longer valid', 'summary', v_summary),
    p_request_id);
  return v_summary || jsonb_build_object('confirmed', false, 'reason', 'session is no longer valid');
end;
$$;

create function public.import_session_confirm(p_session_id uuid, p_request_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_session public.import_sessions;
  v_campaign public.campaigns;
  v_item record;
  v_group record;
  v_bond public.bonds;
  v_base_id uuid;
  v_bonds integer := 0;
  v_numbers integer := 0;
  v_summary jsonb;
begin
  select * into v_session from public.import_sessions where id = p_session_id for update;
  if not found then raise exception 'import session % not found', p_session_id using errcode = 'no_data_found'; end if;
  v_actor := public.import_require_actor(public.import_session_permission(v_session.source_type));
  if v_session.status <> 'validated' then
    raise exception 'only a validated import session can be confirmed (status: %)', v_session.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  v_campaign := public.bond_lock_campaign(v_session.campaign_id);
  -- Validation is a preview, not a reservation: calculate it again while holding the session lock.
  perform public.import_session_revalidate(p_session_id);
  perform public.import_session_check_groups(p_session_id);
  if not (public.import_session_summary(p_session_id) ->> 'valid')::boolean then
    return public.import_session_reject_confirmation(v_actor, p_session_id, p_request_id);
  end if;
  -- Revalidation rewrites item statuses. Its write guard deliberately moves the session back to
  -- draft, so return it to validated only after the fresh preview is clean; item-to-bond links
  -- are permitted exclusively in that state.
  update public.import_sessions set status = 'validated' where id = p_session_id;

  -- A concurrent confirmation of overlapping numbers/codes can commit between the revalidation
  -- above and these inserts: the unique indexes then raise 23505. Roll back this block only and
  -- report the session as stale (revalidated, back to draft) instead of a raw error.
  begin
  -- Simple rows create one printed simple bond each.
  for v_item in select * from public.import_session_items
    where import_session_id = p_session_id and removed_at is null and item_type = 'simple'
    order by row_number for update
  loop
    insert into public.bonds (campaign_id, kind, origin, barcode, commercial_status,
      commercial_unit_count, total_value, created_by, import_session_id)
    values (v_campaign.id, 'simple', 'printed', v_item.barcode, 'available', 1,
      v_campaign.simple_bond_value, v_actor, p_session_id) returning * into v_bond;
    insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind)
    values (v_campaign.id, v_bond.id, v_item.base_number, 'base') returning id into v_base_id;
    insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind, source_base_number_id)
    values (v_campaign.id, v_bond.id, v_item.base_number + v_campaign.associated_number_offset,
      'associated', v_base_id);
    update public.import_session_items set created_bond_id = v_bond.id where id = v_item.id;
    perform public.import_audit_bond_create(v_actor, v_bond, p_session_id, p_request_id);
    v_bonds := v_bonds + 1;
    v_numbers := v_numbers + 2;
  end loop;

  -- Each grupo_pata is one printed pata; row barcodes live on its base numbers.
  for v_group in select group_key, count(*)::integer as units
    from public.import_session_items where import_session_id = p_session_id and removed_at is null
      and item_type = 'pata' group by group_key order by group_key
  loop
    insert into public.bonds (campaign_id, kind, origin, barcode, commercial_status,
      commercial_unit_count, total_value, created_by, import_session_id)
    values (v_campaign.id, 'pata', 'printed', v_group.group_key, 'available', v_group.units,
      v_campaign.simple_bond_value * v_group.units, v_actor, p_session_id) returning * into v_bond;
    for v_item in select * from public.import_session_items
      where import_session_id = p_session_id and removed_at is null and group_key = v_group.group_key
      order by row_number
    loop
      insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind, barcode)
      values (v_campaign.id, v_bond.id, v_item.base_number, 'base', v_item.barcode) returning id into v_base_id;
      insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind, source_base_number_id)
      values (v_campaign.id, v_bond.id, v_item.base_number + v_campaign.associated_number_offset,
        'associated', v_base_id);
      update public.import_session_items set created_bond_id = v_bond.id where id = v_item.id;
      v_numbers := v_numbers + 2;
    end loop;
    perform public.import_audit_bond_create(v_actor, v_bond, p_session_id, p_request_id);
    v_bonds := v_bonds + 1;
  end loop;
  update public.import_sessions set status = 'confirmed', confirmed_by = v_actor where id = p_session_id;
  exception when unique_violation then
    perform public.import_session_revalidate(p_session_id);
    return public.import_session_reject_confirmation(v_actor, p_session_id, p_request_id);
  end;

  v_summary := public.import_session_summary(p_session_id);
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, request_id)
  values (v_actor, 'import.confirm', 'import_session', p_session_id::text,
    jsonb_build_object('status', 'confirmed', 'source_type', v_session.source_type,
      'file_name', v_session.file_name, 'bonds_created', v_bonds, 'numbers_created', v_numbers,
      'summary', v_summary),
    p_request_id);
  return v_summary
    || jsonb_build_object('confirmed', true, 'bonds_created', v_bonds, 'numbers_created', v_numbers);
end;
$$;

create function public.import_session_rollback(p_session_id uuid, p_reason text, p_request_id text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.import_require_actor('bond.annul');
  v_session public.import_sessions;
  v_reason text := nullif(btrim(p_reason), '');
  v_count integer;
  v_bond record;
begin
  if v_reason is null then raise exception 'a rollback reason is required' using errcode = 'invalid_parameter_value'; end if;
  select * into v_session from public.import_sessions where id = p_session_id for update;
  if not found then raise exception 'import session % not found', p_session_id using errcode = 'no_data_found'; end if;
  if v_session.status <> 'confirmed' or v_session.rolled_back_at is not null then
    raise exception 'import session % cannot be rolled back', p_session_id using errcode = 'object_not_in_prerequisite_state';
  end if;
  -- Like bond_annul: imported bonds can only be annulled while the campaign is draft or active.
  perform public.bond_lock_campaign(v_session.campaign_id);
  perform 1 from public.bonds where import_session_id = p_session_id order by id for update;
  select count(*) into v_count from public.bonds b where b.import_session_id = p_session_id
    and (b.commercial_status <> 'available' or exists (
      select 1 from public.bond_groups g where (g.member_bond_id = b.id or g.pata_bond_id = b.id)
        and g.ungrouped_at is null));
  if v_count > 0 then raise exception 'import session % has % bond(s) that cannot be rolled back', p_session_id, v_count
    using errcode = 'object_not_in_prerequisite_state'; end if;
  -- One bond.annul entry per bond (same shape as bond_annul), snapshotted before the release.
  for v_bond in
    select b.id, public.bond_audit_snapshot(b) -> 'numbers' as numbers
    from public.bonds b where b.import_session_id = p_session_id order by b.id
  loop
    insert into public.audit_log
      (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
    values (v_actor, 'bond.annul', 'bond', v_bond.id::text,
      jsonb_build_object('commercial_status', 'available', 'numbers', v_bond.numbers),
      jsonb_build_object('commercial_status', 'annulled', 'numbers', '[]'::jsonb,
        'released_numbers', v_bond.numbers, 'import_session_id', p_session_id),
      v_reason, p_request_id);
  end loop;
  update public.bonds set commercial_status = 'annulled', annulled_by = v_actor, annul_reason = v_reason
  where import_session_id = p_session_id;
  update public.bond_numbers set released_at = now(), released_by = v_actor
  where bond_id in (select id from public.bonds where import_session_id = p_session_id) and released_at is null;
  update public.import_sessions set rolled_back_by = v_actor, rollback_reason = v_reason where id = p_session_id;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, new_value, reason, request_id)
  values (v_actor, 'import.rollback', 'import_session', p_session_id::text,
    jsonb_build_object('status', 'confirmed', 'rolled_back', true), v_reason, p_request_id);
end;
$$;

revoke all on function public.import_audit_bond_create(uuid, public.bonds, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.import_session_reject_confirmation(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.import_session_confirm(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.import_session_rollback(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.import_session_confirm(uuid, text) to authenticated;
grant execute on function public.import_session_rollback(uuid, text, text) to authenticated;
