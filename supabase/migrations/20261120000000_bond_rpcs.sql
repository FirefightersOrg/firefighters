-- SAN-23: audited, permission-checked write functions for bonds.
--
-- `authenticated` can only SELECT bonds, bond_numbers and bond_groups (SAN-22). Every write goes
-- through one of these SECURITY DEFINER functions, which, in ONE transaction:
--   1. resolve the caller's ACTIVE profile (public.current_profile_id()),
--   2. check the granular permission (public.has_permission()),
--   3. lock the campaign (FOR SHARE) and the bonds involved,
--   4. validate and perform the change (the SAN-22 triggers still enforce every invariant; their
--      errors propagate unchanged),
--   5. insert exactly one audit_log row.
-- If any step fails, nothing is written (no audit row either).
--
-- Permission mapping (docs/permissions.md):
--   bond_create           bond.create   simple bond (1 base number) or printed pata (N >= 2)
--   bond_group_into_pata  bond.create   manually grouped pata from N >= 2 available simple bonds
--   bond_ungroup_pata     bond.create   ungroups an available manual pata (reason required)
--   bond_annul            bond.annul    annuls an available simple bond / printed pata loaded by
--                                       mistake and releases its numbers (reason required)
--
-- Decisions (Phase 3, docs/data-model.md "Bond write functions"):
--   * Bonds are created, grouped, ungrouped and annulled only while the campaign is draft or
--     active. The campaign row is locked FOR SHARE, so these functions serialize against
--     campaign_update_rules / campaign_transition (FOR UPDATE): the rules read here cannot change
--     before the transaction ends (and once a bond exists they are frozen, SAN-22).
--   * Kind, origin, associated numbers and total_value are computed here from the campaign
--     configuration; the client only sends base numbers (or member bond ids) and optional codes.
--     total_value = simple_bond_value * N. New bonds start `available`.
--   * Participating numbers are unique per campaign among numbers that were not released. A
--     duplicate raises 23505 naming the number (padded to the campaign's digits) and the bond
--     that already uses it; DETAIL carries every conflict as JSON
--     ({"conflicts":[{"number":68,"formatted":"0068","bond_id":"...","number_kind":"base"}]}).
--     The check is the unique index itself (caught and re-raised with that message), so it also
--     holds under concurrent inserts.
--   * A manual pata owns no numbers: its members keep theirs and their own status, linked through
--     bond_groups. Members must be simple, available, of the same campaign and not in another
--     active group. While grouped they cannot be operated (or annulled) individually.
--   * Ungrouping is only allowed while the manual pata is `available`: every active membership
--     row gets ungrouped_at/ungrouped_by/reason (never deleted) and the pata is annulled with the
--     same reason. The members are free again.
--   * Annulling (bond.annul, admin only in the seed) only applies to `available` simple bonds and
--     printed patas that are not active members of a manual pata. Their numbers are released
--     (released_at/released_by) so they can be entered again; rows stay as history. A manual pata
--     is not annulled directly: it is ungrouped. Annulling sold bonds is out of scope (Phase 10).
--
-- Audit actions (entity_type 'bond', entity_id = the bond / pata id):
--   bond.create   new_value: full snapshot (incl. numbers)
--   bond.group    new_value: full snapshot of the new pata (incl. members)
--   bond.ungroup  old/new: status and active members; reason
--   bond.annul    old/new: status and active / released numbers; reason
--
-- Errors (SQLSTATE):
--   42501 insufficient_privilege            no active profile, or missing permission
--   22023 invalid_parameter_value           bad input: no/null/negative base numbers, number above
--                                           max_number, associated number overflow, a number
--                                           repeated inside the same bond, fewer than 2 members,
--                                           repeated/null member ids, member of another campaign
--                                           or not simple, target is not a manual pata, missing
--                                           reason
--   P0002 no_data_found                     campaign or bond not found
--   23505 unique_violation                  participating number, barcode or internal code
--                                           already used in the campaign
--   55000 object_not_in_prerequisite_state  campaign not draft/active; bond not available; member
--                                           already grouped; annulling a grouped member or a
--                                           manual pata
--   23514 / 23001                           SAN-22 constraints and triggers (backstops)

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by API roles; the functions below run as the owner)
-- ---------------------------------------------------------------------------

-- Returns the caller's active profile id after checking p_permission. Raises 42501 otherwise.
create function public.bond_require_actor(p_permission text)
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
    raise exception 'an active profile is required to change bonds'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.has_permission(p_permission) then
    raise exception 'permission denied: % is required', p_permission
      using errcode = 'insufficient_privilege';
  end if;
  return v_actor;
end;
$$;

-- Visible number: number_value left-padded with zeros to the campaign's digit count.
create function public.bond_format_number(p_value bigint, p_digits integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then 'null'
    when p_value < 0 then p_value::text
    else lpad(p_value::text, greatest(p_digits, length(p_value::text)), '0')
  end;
$$;

-- How a bond is named in error messages: "0068 (<id>)" for a bond with base numbers (the first
-- active base number, padded), "<id>" otherwise.
create function public.bond_label(p_bond_id uuid, p_digits integer)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select public.bond_format_number(n.number_value, p_digits) || ' (' || p_bond_id || ')'
     from public.bond_numbers n
     where n.bond_id = p_bond_id and n.number_kind = 'base' and n.released_at is null
     order by n.number_value
     limit 1),
    p_bond_id::text
  );
$$;

-- Locks the campaign FOR SHARE and checks it accepts bond changes (draft or active).
create function public.bond_lock_campaign(p_campaign_id uuid)
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
    raise exception 'bonds can only be changed while the campaign is draft or active (status: %)', v_campaign.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  return v_campaign;
end;
$$;

-- Validates the base numbers of a new simple bond / printed pata against the campaign rules:
-- at least one, none null or negative, each <= max_number, base + offset <= max_number
-- (overflow_policy 'reject'), and no participating number (base or associated) repeated inside
-- the bond. Raises 22023 with the offending number padded to the campaign's digits.
create function public.bond_validate_base_numbers(
  p_campaign public.campaigns,
  p_base_numbers integer[]
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_base integer;
  v_digits integer := p_campaign.number_digits;
  v_offset integer := p_campaign.associated_number_offset;
  v_max integer := p_campaign.max_number;
  v_repeated bigint;
  v_base_count integer;
  v_associated_count integer;
begin
  if p_base_numbers is null or cardinality(p_base_numbers) = 0 then
    raise exception 'at least one base number is required' using errcode = 'invalid_parameter_value';
  end if;
  if array_ndims(p_base_numbers) <> 1 then
    raise exception 'base numbers must be a flat list' using errcode = 'invalid_parameter_value';
  end if;
  if array_position(p_base_numbers, null) is not null then
    raise exception 'base numbers cannot be empty' using errcode = 'invalid_parameter_value';
  end if;

  foreach v_base in array p_base_numbers loop
    if v_base < 0 then
      raise exception 'base number % is negative', v_base using errcode = 'invalid_parameter_value';
    end if;
    if v_base > v_max then
      raise exception 'number % exceeds the campaign maximum number %',
        public.bond_format_number(v_base, v_digits), public.bond_format_number(v_max, v_digits)
        using errcode = 'invalid_parameter_value';
    end if;
    if v_base::bigint + v_offset > v_max then
      raise exception 'base number % overflows: its associated number % exceeds the campaign maximum number %',
        public.bond_format_number(v_base, v_digits),
        public.bond_format_number(v_base::bigint + v_offset, v_digits),
        public.bond_format_number(v_max, v_digits)
        using errcode = 'invalid_parameter_value',
          hint = format('the highest allowed base number is %s',
            public.bond_format_number(v_max - v_offset, v_digits));
    end if;
  end loop;

  -- A number repeated inside the bond: two equal bases, or a base equal to another base's
  -- associated number (base + offset), or a base equal to its own associated (offset 0).
  select p.n,
    count(*) filter (where p.kind = 'base'),
    count(*) filter (where p.kind = 'associated')
  into v_repeated, v_base_count, v_associated_count
  from (
    select b::bigint as n, 'base' as kind from unnest(p_base_numbers) b
    union all
    select b::bigint + v_offset, 'associated' from unnest(p_base_numbers) b
  ) p
  group by p.n
  having count(*) > 1
  order by p.n
  limit 1;
  if v_repeated is not null then
    raise exception 'number % appears more than once in this bond (% as base, % as associated)',
      public.bond_format_number(v_repeated, v_digits), v_base_count, v_associated_count
      using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- Re-raises a unique_violation from a bond insert with a message the app can show: which
-- number / code is already used and by which bond. Always raises.
create function public.bond_raise_duplicate(
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
      and b.commercial_status <> 'annulled';
    if v_bond_id is not null then
      raise exception 'internal code % is already used by bond %', p_internal_code, v_bond_id
        using errcode = 'unique_violation',
          detail = jsonb_build_object('internal_code', p_internal_code, 'bond_id', v_bond_id)::text;
    end if;
  elsif p_constraint = 'bonds_campaign_barcode_key' then
    select b.id into v_bond_id from public.bonds b
    where b.campaign_id = p_campaign.id and b.barcode = p_barcode
      and b.commercial_status <> 'annulled';
    if v_bond_id is not null then
      raise exception 'barcode % is already used by bond %', p_barcode, v_bond_id
        using errcode = 'unique_violation',
          detail = jsonb_build_object('barcode', p_barcode, 'bond_id', v_bond_id)::text;
    end if;
  end if;

  -- Unknown constraint, or the conflicting row is gone (released meanwhile): original error.
  raise exception '%', p_message
    using errcode = 'unique_violation', detail = jsonb_build_object('constraint', p_constraint)::text;
end;
$$;

-- Audited representation of a bond: its data plus its active numbers (base first, by value) and
-- its active members (by id).
create function public.bond_audit_snapshot(p_bond public.bonds)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_bond.id,
    'campaign_id', p_bond.campaign_id,
    'kind', p_bond.kind,
    'origin', p_bond.origin,
    'internal_code', p_bond.internal_code,
    'barcode', p_bond.barcode,
    'commercial_status', p_bond.commercial_status,
    'commercial_unit_count', p_bond.commercial_unit_count,
    'total_value', p_bond.total_value,
    'created_by', p_bond.created_by,
    'numbers', coalesce(
      (select jsonb_agg(
                jsonb_build_object('number_value', n.number_value, 'number_kind', n.number_kind)
                order by n.number_kind = 'associated', n.number_value)
       from public.bond_numbers n
       where n.bond_id = p_bond.id and n.released_at is null),
      '[]'::jsonb),
    'members', coalesce(
      (select jsonb_agg(g.member_bond_id order by g.member_bond_id)
       from public.bond_groups g
       where g.pata_bond_id = p_bond.id and g.ungrouped_at is null),
      '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- bond_create: simple bond (one base number) or printed pata (N >= 2 base numbers) + one
-- 'bond.create' audit row. Associated numbers and total_value are computed from the campaign.
-- Returns the new bond id.
-- ---------------------------------------------------------------------------
create function public.bond_create(
  p_campaign_id uuid,
  p_base_numbers integer[],
  p_internal_code text default null,
  p_barcode text default null,
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
  v_campaign public.campaigns;
  v_count integer;
  v_internal_code text := nullif(btrim(p_internal_code), '');
  v_barcode text := nullif(btrim(p_barcode), '');
  v_bond public.bonds;
  v_base integer;
  v_base_id uuid;
  v_participating integer[];
  v_constraint text;
  v_message text;
begin
  v_actor := public.bond_require_actor('bond.create');
  v_campaign := public.bond_lock_campaign(p_campaign_id);
  perform public.bond_validate_base_numbers(v_campaign, p_base_numbers);

  v_count := cardinality(p_base_numbers);
  v_participating := p_base_numbers || array(
    select b + v_campaign.associated_number_offset from unnest(p_base_numbers) b
  );

  -- The unique indexes are the duplicate check (race-free); a violation rolls back this block
  -- and is re-raised naming the number / code and the bond that already uses it.
  begin
    insert into public.bonds (
      campaign_id, kind, origin, internal_code, barcode, commercial_status,
      commercial_unit_count, total_value, created_by
    )
    values (
      p_campaign_id, case when v_count = 1 then 'simple' else 'pata' end, 'printed',
      v_internal_code, v_barcode, 'available',
      v_count, v_campaign.simple_bond_value * v_count, v_actor
    )
    returning * into v_bond;

    foreach v_base in array p_base_numbers loop
      insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind)
      values (p_campaign_id, v_bond.id, v_base, 'base')
      returning id into v_base_id;

      insert into public.bond_numbers
        (campaign_id, bond_id, number_value, number_kind, source_base_number_id)
      values (
        p_campaign_id, v_bond.id, v_base + v_campaign.associated_number_offset, 'associated',
        v_base_id
      );
    end loop;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name, v_message = message_text;
    perform public.bond_raise_duplicate(
      v_campaign, v_constraint, v_message, v_participating, v_internal_code, v_barcode
    );
  end;

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (
    v_actor, 'bond.create', 'bond', v_bond.id::text,
    null, public.bond_audit_snapshot(v_bond),
    nullif(btrim(p_reason), ''), p_request_id
  );

  return v_bond.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- bond_group_into_pata: manually grouped pata from N >= 2 available simple bonds of the
-- campaign + one 'bond.group' audit row. The pata owns no numbers; members keep theirs and their
-- status, and are linked through bond_groups. Returns the new pata id.
-- ---------------------------------------------------------------------------
create function public.bond_group_into_pata(
  p_campaign_id uuid,
  p_member_bond_ids uuid[],
  p_internal_code text default null,
  p_barcode text default null,
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
  v_campaign public.campaigns;
  v_count integer;
  v_internal_code text := nullif(btrim(p_internal_code), '');
  v_barcode text := nullif(btrim(p_barcode), '');
  v_member_id uuid;
  v_member public.bonds;
  v_repeated uuid;
  v_other_pata uuid;
  v_pata public.bonds;
  v_constraint text;
  v_message text;
begin
  v_actor := public.bond_require_actor('bond.create');

  if p_member_bond_ids is null or array_ndims(p_member_bond_ids) <> 1
    or cardinality(p_member_bond_ids) < 2
  then
    raise exception 'a pata needs at least 2 simple bonds' using errcode = 'invalid_parameter_value';
  end if;
  if array_position(p_member_bond_ids, null) is not null then
    raise exception 'member bond ids cannot be empty' using errcode = 'invalid_parameter_value';
  end if;
  select m into v_repeated from unnest(p_member_bond_ids) m group by m having count(*) > 1 limit 1;
  if v_repeated is not null then
    raise exception 'bond % is listed more than once', v_repeated
      using errcode = 'invalid_parameter_value';
  end if;
  v_count := cardinality(p_member_bond_ids);

  v_campaign := public.bond_lock_campaign(p_campaign_id);

  -- Lock every member (id order, like bond_groups_guard_write, to avoid deadlocks): their status
  -- and group membership cannot change until this transaction ends.
  perform 1 from public.bonds where id = any (p_member_bond_ids) order by id for no key update;

  foreach v_member_id in array p_member_bond_ids loop
    select * into v_member from public.bonds where id = v_member_id;
    if not found then
      raise exception 'bond % not found', v_member_id using errcode = 'no_data_found';
    end if;
    if v_member.campaign_id <> p_campaign_id then
      raise exception 'bond % belongs to another campaign', v_member_id
        using errcode = 'invalid_parameter_value';
    end if;
    if v_member.kind <> 'simple' then
      raise exception 'only simple bonds can be grouped into a pata (bond % is a %)',
        public.bond_label(v_member_id, v_campaign.number_digits), v_member.kind
        using errcode = 'invalid_parameter_value';
    end if;
    if v_member.commercial_status <> 'available' then
      raise exception 'only available bonds can be grouped (bond % is %)',
        public.bond_label(v_member_id, v_campaign.number_digits), v_member.commercial_status
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    select g.pata_bond_id into v_other_pata
    from public.bond_groups g
    where g.member_bond_id = v_member_id and g.ungrouped_at is null;
    if v_other_pata is not null then
      raise exception 'bond % already belongs to manually grouped pata %',
        public.bond_label(v_member_id, v_campaign.number_digits), v_other_pata
        using errcode = 'object_not_in_prerequisite_state',
          hint = 'ungroup that pata first';
    end if;
  end loop;

  begin
    insert into public.bonds (
      campaign_id, kind, origin, internal_code, barcode, commercial_status,
      commercial_unit_count, total_value, created_by
    )
    values (
      p_campaign_id, 'pata', 'manual_grouping', v_internal_code, v_barcode, 'available',
      v_count, v_campaign.simple_bond_value * v_count, v_actor
    )
    returning * into v_pata;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name, v_message = message_text;
    perform public.bond_raise_duplicate(
      v_campaign, v_constraint, v_message, '{}'::integer[], v_internal_code, v_barcode
    );
  end;

  insert into public.bond_groups (pata_bond_id, member_bond_id, grouped_by)
  select v_pata.id, m.id, v_actor
  from unnest(p_member_bond_ids) with ordinality as m (id, ord)
  order by m.ord;

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (
    v_actor, 'bond.group', 'bond', v_pata.id::text,
    null, public.bond_audit_snapshot(v_pata),
    nullif(btrim(p_reason), ''), p_request_id
  );

  return v_pata.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- bond_ungroup_pata: ungroups an AVAILABLE manually grouped pata (reason required). Every active
-- membership row is marked ungrouped (never deleted), the pata is annulled with the same reason
-- and its members are free again. One 'bond.ungroup' audit row.
-- ---------------------------------------------------------------------------
create function public.bond_ungroup_pata(
  p_pata_bond_id uuid,
  p_reason text,
  p_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_campaign_id uuid;
  v_pata public.bonds;
  v_members jsonb;
begin
  v_actor := public.bond_require_actor('bond.create');

  if v_reason is null then
    raise exception 'a reason is required to ungroup a pata' using errcode = 'invalid_parameter_value';
  end if;

  select campaign_id into v_campaign_id from public.bonds where id = p_pata_bond_id;
  if not found then
    raise exception 'bond % not found', p_pata_bond_id using errcode = 'no_data_found';
  end if;
  perform public.bond_lock_campaign(v_campaign_id);

  select * into v_pata from public.bonds where id = p_pata_bond_id for update;
  if v_pata.kind <> 'pata' or v_pata.origin <> 'manual_grouping' then
    raise exception 'bond % is not a manually grouped pata', p_pata_bond_id
      using errcode = 'invalid_parameter_value';
  end if;
  if v_pata.commercial_status <> 'available' then
    raise exception 'only an available pata can be ungrouped (pata % is %)',
      p_pata_bond_id, v_pata.commercial_status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  select coalesce(jsonb_agg(g.member_bond_id order by g.member_bond_id), '[]'::jsonb)
  into v_members
  from public.bond_groups g
  where g.pata_bond_id = p_pata_bond_id and g.ungrouped_at is null;

  update public.bond_groups
  set ungrouped_at = now(), ungrouped_by = v_actor, reason = v_reason
  where pata_bond_id = p_pata_bond_id and ungrouped_at is null;

  update public.bonds
  set commercial_status = 'annulled', annulled_by = v_actor, annul_reason = v_reason
  where id = p_pata_bond_id;

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (
    v_actor, 'bond.ungroup', 'bond', p_pata_bond_id::text,
    jsonb_build_object('commercial_status', 'available', 'members', v_members),
    jsonb_build_object('commercial_status', 'annulled', 'members', '[]'::jsonb,
      'ungrouped_members', v_members),
    v_reason, p_request_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- bond_annul: annuls an AVAILABLE simple bond or printed pata loaded by mistake (reason
-- required) and releases its participating numbers so they can be entered again. Not for manual
-- patas (ungroup them) nor for active members of one. One 'bond.annul' audit row.
-- ---------------------------------------------------------------------------
create function public.bond_annul(
  p_bond_id uuid,
  p_reason text,
  p_request_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_campaign_id uuid;
  v_campaign public.campaigns;
  v_bond public.bonds;
  v_pata_id uuid;
  v_numbers jsonb;
begin
  v_actor := public.bond_require_actor('bond.annul');

  if v_reason is null then
    raise exception 'a reason is required to annul a bond' using errcode = 'invalid_parameter_value';
  end if;

  select campaign_id into v_campaign_id from public.bonds where id = p_bond_id;
  if not found then
    raise exception 'bond % not found', p_bond_id using errcode = 'no_data_found';
  end if;
  v_campaign := public.bond_lock_campaign(v_campaign_id);

  select * into v_bond from public.bonds where id = p_bond_id for update;
  if v_bond.origin = 'manual_grouping' then
    raise exception 'a manually grouped pata cannot be annulled directly'
      using errcode = 'object_not_in_prerequisite_state',
        hint = 'ungroup the pata instead (bond_ungroup_pata)';
  end if;
  if v_bond.commercial_status = 'annulled' then
    raise exception 'bond % is already annulled', public.bond_label(p_bond_id, v_campaign.number_digits)
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if v_bond.commercial_status <> 'available' then
    raise exception 'only available bonds can be annulled (bond % is %)',
      public.bond_label(p_bond_id, v_campaign.number_digits), v_bond.commercial_status
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  select g.pata_bond_id into v_pata_id
  from public.bond_groups g
  where g.member_bond_id = p_bond_id and g.ungrouped_at is null;
  if v_pata_id is not null then
    raise exception 'bond % belongs to manually grouped pata %',
      public.bond_label(p_bond_id, v_campaign.number_digits), v_pata_id
      using errcode = 'object_not_in_prerequisite_state',
        hint = 'ungroup the pata first';
  end if;

  v_numbers := public.bond_audit_snapshot(v_bond) -> 'numbers';

  update public.bonds
  set commercial_status = 'annulled', annulled_by = v_actor, annul_reason = v_reason
  where id = p_bond_id;

  update public.bond_numbers
  set released_at = now(), released_by = v_actor
  where bond_id = p_bond_id and released_at is null;

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (
    v_actor, 'bond.annul', 'bond', p_bond_id::text,
    jsonb_build_object('commercial_status', 'available', 'numbers', v_numbers),
    jsonb_build_object('commercial_status', 'annulled', 'numbers', '[]'::jsonb,
      'released_numbers', v_numbers),
    v_reason, p_request_id
  );
end;
$$;

comment on function public.bond_create(uuid, integer[], text, text, text, text) is
  'SAN-23: creates a simple bond (1 base number) or printed pata (N base numbers), available. bond.create; audited.';
comment on function public.bond_group_into_pata(uuid, uuid[], text, text, text, text) is
  'SAN-23: groups N >= 2 available simple bonds into a manual pata. bond.create; audited.';
comment on function public.bond_ungroup_pata(uuid, text, text) is
  'SAN-23: ungroups an available manual pata (annuls it, frees its members). bond.create; reason required; audited.';
comment on function public.bond_annul(uuid, text, text) is
  'SAN-23: annuls an available simple bond / printed pata and releases its numbers. bond.annul; reason required; audited.';

-- ---------------------------------------------------------------------------
-- Privileges: the four entry points are for signed-in users only (they act as the caller via
-- auth.uid(); service_role and anon have no profile). Helpers are not callable by API roles.
-- Supabase grants EXECUTE to anon/authenticated/service_role by default: revoke explicitly.
-- ---------------------------------------------------------------------------
revoke all on function public.bond_require_actor(text)
  from public, anon, authenticated, service_role;
revoke all on function public.bond_format_number(bigint, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.bond_label(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.bond_lock_campaign(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.bond_validate_base_numbers(public.campaigns, integer[])
  from public, anon, authenticated, service_role;
revoke all on function public.bond_raise_duplicate(public.campaigns, text, text, integer[], text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.bond_audit_snapshot(public.bonds)
  from public, anon, authenticated, service_role;

revoke all on function public.bond_create(uuid, integer[], text, text, text, text)
  from public, anon, service_role;
grant execute on function public.bond_create(uuid, integer[], text, text, text, text) to authenticated;

revoke all on function public.bond_group_into_pata(uuid, uuid[], text, text, text, text)
  from public, anon, service_role;
grant execute on function public.bond_group_into_pata(uuid, uuid[], text, text, text, text)
  to authenticated;

revoke all on function public.bond_ungroup_pata(uuid, text, text) from public, anon, service_role;
grant execute on function public.bond_ungroup_pata(uuid, text, text) to authenticated;

revoke all on function public.bond_annul(uuid, text, text) from public, anon, service_role;
grant execute on function public.bond_annul(uuid, text, text) to authenticated;
