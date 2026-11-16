-- SAN-17: audited, permission-checked write functions for campaigns.
--
-- `authenticated` can only SELECT campaigns (SAN-16). Every write goes through one of these
-- SECURITY DEFINER functions, which, in ONE transaction:
--   1. resolve the caller's ACTIVE profile (public.current_profile_id()),
--   2. check the granular permission (public.has_permission()),
--   3. perform the change (the campaigns_guard_write trigger still enforces the status machine
--      and edit windows; its errors propagate unchanged),
--   4. insert the audit_log row.
-- If any step fails, nothing is written (same pattern as admin_provision_profile).
--
-- Permission mapping (docs/permissions.md):
--   campaign_create                       campaign.create
--   campaign_update (name, dates)         campaign.update
--   campaign_update_rules (draft only)    campaign.update_rules
--   campaign_transition -> active         campaign.update_rules (activation freezes the rules)
--   campaign_transition -> closing/closed campaign.close
--   campaign_transition -> annulled       campaign.close (reason required)
--
-- Errors (SQLSTATE):
--   42501 insufficient_privilege            no active profile, or missing permission
--   22023 invalid_parameter_value           bad input (blank name, money that does not divide
--                                           exactly into the installments, unknown target status,
--                                           annul without reason)
--   P0002 no_data_found                     campaign not found
--   23514 check_violation                   table CHECK constraints (numbering rules, dates order,
--                                           barcode mode, ...) and status-machine violations
--                                           raised by campaigns_guard_write
--   55000 object_not_in_prerequisite_state  edit outside its window (campaigns_guard_write)
--
-- No-op updates (every value equal to the stored one) write nothing, not even an audit row, and
-- return false.

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by API roles; the functions below run as the owner)
-- ---------------------------------------------------------------------------

-- Returns the caller's active profile id after checking p_permission. Raises 42501 otherwise.
create function public.campaign_require_actor(p_permission text)
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
    raise exception 'an active profile is required to change campaigns'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.has_permission(p_permission) then
    raise exception 'permission denied: % is required', p_permission
      using errcode = 'insufficient_privilege';
  end if;
  return v_actor;
end;
$$;

-- installment_value = simple_bond_value / installment_count, which must be exact in cents.
-- Raises 22023 with a readable message instead of letting the CHECK constraint fail.
create function public.campaign_installment_value(
  p_simple_bond_value numeric,
  p_installment_count integer
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_installment_value numeric;
begin
  if p_simple_bond_value is null or p_simple_bond_value <= 0 then
    raise exception 'simple bond value must be greater than 0'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_simple_bond_value <> round(p_simple_bond_value, 2) then
    raise exception 'simple bond value must have at most 2 decimal places'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_installment_count is null or p_installment_count <= 0 then
    raise exception 'installment count must be greater than 0'
      using errcode = 'invalid_parameter_value';
  end if;

  v_installment_value := round(p_simple_bond_value / p_installment_count, 2);
  if v_installment_value * p_installment_count <> p_simple_bond_value then
    raise exception 'simple bond value % cannot be split into % equal installments',
      p_simple_bond_value, p_installment_count
      using errcode = 'invalid_parameter_value',
        hint = 'choose a value and installment count that divide exactly (to the cent)';
  end if;
  return v_installment_value;
end;
$$;

-- Audited representation of a campaign (everything except the server-maintained updated_at).
create function public.campaign_audit_snapshot(p_campaign public.campaigns)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_campaign.id,
    'name', p_campaign.name,
    'status', p_campaign.status,
    'starts_at', p_campaign.starts_at,
    'ends_at', p_campaign.ends_at,
    'simple_bond_value', p_campaign.simple_bond_value,
    'installment_count', p_campaign.installment_count,
    'installment_value', p_campaign.installment_value,
    'number_digits', p_campaign.number_digits,
    'max_number', p_campaign.max_number,
    'associated_number_offset', p_campaign.associated_number_offset,
    'overflow_policy', p_campaign.overflow_policy,
    'barcode_mode', p_campaign.barcode_mode,
    'created_by', p_campaign.created_by
  );
$$;

-- Keys whose value differs between two snapshots: (old_value, new_value) with only those keys.
create function public.campaign_audit_changes(
  p_old jsonb,
  p_new jsonb,
  out old_value jsonb,
  out new_value jsonb
)
language sql
immutable
set search_path = ''
as $$
  select
    (select coalesce(jsonb_object_agg(o.key, o.value), '{}'::jsonb)
       from jsonb_each(p_old) o where o.value is distinct from p_new -> o.key),
    (select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb)
       from jsonb_each(p_new) n where n.value is distinct from p_old -> n.key);
$$;

-- ---------------------------------------------------------------------------
-- campaign_create: new draft campaign + 'campaign.create' audit row. Returns the new id.
-- ---------------------------------------------------------------------------
create function public.campaign_create(
  p_name text,
  p_simple_bond_value numeric,
  p_installment_count integer,
  p_number_digits integer,
  p_max_number integer,
  p_associated_number_offset integer,
  p_overflow_policy text,
  p_barcode_mode text,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_request_id text default null,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_installment_value numeric;
  v_campaign public.campaigns;
begin
  v_actor := public.campaign_require_actor('campaign.create');

  if p_name is null or btrim(p_name) = '' then
    raise exception 'campaign name is required' using errcode = 'invalid_parameter_value';
  end if;
  v_installment_value := public.campaign_installment_value(p_simple_bond_value, p_installment_count);

  insert into public.campaigns (
    name, starts_at, ends_at,
    simple_bond_value, installment_count, installment_value,
    number_digits, max_number, associated_number_offset, overflow_policy, barcode_mode,
    created_by
  )
  values (
    btrim(p_name), p_starts_at, p_ends_at,
    p_simple_bond_value, p_installment_count, v_installment_value,
    p_number_digits, p_max_number, p_associated_number_offset, p_overflow_policy, p_barcode_mode,
    v_actor
  )
  returning * into v_campaign;

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (
    v_actor, 'campaign.create', 'campaign', v_campaign.id::text,
    null, public.campaign_audit_snapshot(v_campaign),
    nullif(btrim(p_reason), ''), p_request_id
  );

  return v_campaign.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- campaign_update: general data (name, starts_at, ends_at). Full replacement: a null date clears
-- it (the write guard rejects clearing dates once the campaign was activated).
-- Returns true when something changed, false for a no-op (nothing written).
-- ---------------------------------------------------------------------------
create function public.campaign_update(
  p_id uuid,
  p_name text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_request_id text default null,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_old public.campaigns;
  v_new public.campaigns;
  v_changes record;
begin
  v_actor := public.campaign_require_actor('campaign.update');

  if p_name is null or btrim(p_name) = '' then
    raise exception 'campaign name is required' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_old from public.campaigns where id = p_id for update;
  if not found then
    raise exception 'campaign % not found', p_id using errcode = 'no_data_found';
  end if;

  if (v_old.name, v_old.starts_at, v_old.ends_at)
    is not distinct from (btrim(p_name), p_starts_at, p_ends_at)
  then
    return false;
  end if;

  update public.campaigns
  set name = btrim(p_name), starts_at = p_starts_at, ends_at = p_ends_at
  where id = p_id
  returning * into v_new;

  select * into v_changes from public.campaign_audit_changes(
    public.campaign_audit_snapshot(v_old), public.campaign_audit_snapshot(v_new)
  );

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (
    v_actor, 'campaign.update', 'campaign', p_id::text,
    v_changes.old_value, v_changes.new_value,
    nullif(btrim(p_reason), ''), p_request_id
  );

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- campaign_update_rules: numbering, installments, overflow policy and barcode mode. Full
-- replacement; installment_value is recomputed here. Only while draft (enforced by the trigger).
-- Returns true when something changed, false for a no-op (nothing written).
-- ---------------------------------------------------------------------------
create function public.campaign_update_rules(
  p_id uuid,
  p_simple_bond_value numeric,
  p_installment_count integer,
  p_number_digits integer,
  p_max_number integer,
  p_associated_number_offset integer,
  p_overflow_policy text,
  p_barcode_mode text,
  p_request_id text default null,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_installment_value numeric;
  v_old public.campaigns;
  v_new public.campaigns;
  v_changes record;
begin
  v_actor := public.campaign_require_actor('campaign.update_rules');
  v_installment_value := public.campaign_installment_value(p_simple_bond_value, p_installment_count);

  select * into v_old from public.campaigns where id = p_id for update;
  if not found then
    raise exception 'campaign % not found', p_id using errcode = 'no_data_found';
  end if;

  if (
    v_old.simple_bond_value, v_old.installment_count, v_old.installment_value,
    v_old.number_digits, v_old.max_number, v_old.associated_number_offset,
    v_old.overflow_policy, v_old.barcode_mode
  ) is not distinct from (
    p_simple_bond_value, p_installment_count, v_installment_value,
    p_number_digits, p_max_number, p_associated_number_offset,
    p_overflow_policy, p_barcode_mode
  ) then
    return false;
  end if;

  update public.campaigns
  set simple_bond_value = p_simple_bond_value,
      installment_count = p_installment_count,
      installment_value = v_installment_value,
      number_digits = p_number_digits,
      max_number = p_max_number,
      associated_number_offset = p_associated_number_offset,
      overflow_policy = p_overflow_policy,
      barcode_mode = p_barcode_mode
  where id = p_id
  returning * into v_new;

  select * into v_changes from public.campaign_audit_changes(
    public.campaign_audit_snapshot(v_old), public.campaign_audit_snapshot(v_new)
  );

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (
    v_actor, 'campaign.update_rules', 'campaign', p_id::text,
    v_changes.old_value, v_changes.new_value,
    nullif(btrim(p_reason), ''), p_request_id
  );

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- campaign_transition: status change + 'campaign.transition' audit row.
-- The permission depends on the target status (see the mapping at the top). Whether the
-- transition is allowed from the current status (and activation's date requirement) is decided
-- by campaigns_guard_write. Requesting the current status is rejected like any invalid
-- transition (23514), so a double submit never writes a second audit row.
-- ---------------------------------------------------------------------------
create function public.campaign_transition(
  p_id uuid,
  p_to_status text,
  p_reason text default null,
  p_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_permission text;
  v_reason text := nullif(btrim(p_reason), '');
  v_old public.campaigns;
begin
  v_permission := case p_to_status
    when 'active' then 'campaign.update_rules'
    when 'closing' then 'campaign.close'
    when 'closed' then 'campaign.close'
    when 'annulled' then 'campaign.close'
  end;
  if v_permission is null then
    raise exception 'invalid target status: %', coalesce(p_to_status, 'null')
      using errcode = 'invalid_parameter_value';
  end if;

  v_actor := public.campaign_require_actor(v_permission);

  if p_to_status = 'annulled' and v_reason is null then
    raise exception 'a reason is required to annul a campaign'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_old from public.campaigns where id = p_id for update;
  if not found then
    raise exception 'campaign % not found', p_id using errcode = 'no_data_found';
  end if;

  if v_old.status = p_to_status then
    raise exception 'invalid campaign status transition: % -> %', v_old.status, p_to_status
      using errcode = 'check_violation';
  end if;

  update public.campaigns set status = p_to_status where id = p_id;

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (
    v_actor, 'campaign.transition', 'campaign', p_id::text,
    jsonb_build_object('status', v_old.status),
    jsonb_build_object('status', p_to_status),
    v_reason, p_request_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: the four entry points are for signed-in users only (they act as the caller via
-- auth.uid(); service_role and anon have no profile). Helpers are not callable by API roles.
-- Supabase grants EXECUTE to anon/authenticated/service_role by default: revoke explicitly.
-- ---------------------------------------------------------------------------
revoke all on function public.campaign_require_actor(text)
  from public, anon, authenticated, service_role;
revoke all on function public.campaign_installment_value(numeric, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.campaign_audit_snapshot(public.campaigns)
  from public, anon, authenticated, service_role;
revoke all on function public.campaign_audit_changes(jsonb, jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.campaign_create(
  text, numeric, integer, integer, integer, integer, text, text, timestamptz, timestamptz, text, text
) from public, anon, service_role;
grant execute on function public.campaign_create(
  text, numeric, integer, integer, integer, integer, text, text, timestamptz, timestamptz, text, text
) to authenticated;

revoke all on function public.campaign_update(uuid, text, timestamptz, timestamptz, text, text)
  from public, anon, service_role;
grant execute on function public.campaign_update(uuid, text, timestamptz, timestamptz, text, text)
  to authenticated;

revoke all on function public.campaign_update_rules(
  uuid, numeric, integer, integer, integer, integer, text, text, text, text
) from public, anon, service_role;
grant execute on function public.campaign_update_rules(
  uuid, numeric, integer, integer, integer, integer, text, text, text, text
) to authenticated;

revoke all on function public.campaign_transition(uuid, text, text, text)
  from public, anon, service_role;
grant execute on function public.campaign_transition(uuid, text, text, text) to authenticated;
