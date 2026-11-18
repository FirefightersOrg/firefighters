-- SAN-44: campaigns.barcode_pattern, the per-campaign rule that extracts a base number from a
-- scanned or imported barcode (Phase 4, docs/imports.md "Barcode modes").
--
-- barcode_mode semantics (product decision):
--   base_number           the barcode IS the base number
--   manual_mapping        the operator types the base number when scanning
--   internal_code /
--   external_legacy_code  the campaign defines a regex (barcode_pattern) whose FIRST capture group
--                         is the base number; without a pattern they behave like manual_mapping
--
-- barcode_pattern is a campaign RULE, like barcode_mode:
--   * only allowed for internal_code / external_legacy_code (null for the other modes);
--   * must compile as a Postgres (ARE) regular expression and contain at least one capture group;
--     at most 200 characters, no surrounding whitespace, not blank;
--   * editable only while the campaign is draft (campaigns_guard_write) and frozen once the
--     campaign has bonds (campaigns_rules_frozen_with_bonds), exactly like the other rules.
--
-- campaign_create and campaign_update_rules gain a trailing p_barcode_pattern (default null), so
-- they are dropped and recreated with the same grants. update_rules is still a full replacement:
-- a caller that omits p_barcode_pattern clears the pattern. PT409 optimistic concurrency is kept.
--
-- Errors (SQLSTATE): 22023 invalid pattern (from the functions), 23514 the CHECKs (backstop),
-- 55000 edit outside draft / with bonds, PT409 stale version.

alter table public.campaigns add column barcode_pattern text;

-- True when p_pattern compiles as an ARE and has at least one capture group. The test matches the
-- empty string against (?:pattern){0}: a capture group that cannot participate yields NULL as the
-- first element, while a pattern without groups yields the (empty) whole match. Embedded options
-- such as a leading (?i) are therefore not supported (they are rejected as invalid).
create function public.campaign_barcode_pattern_valid(p_pattern text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_match text[];
begin
  if p_pattern is null then
    return true;
  end if;
  v_match := regexp_match('', '(?:' || p_pattern || '){0}');
  return v_match is not null and v_match[1] is null;
exception when invalid_regular_expression or program_limit_exceeded then
  return false;
end;
$$;

-- Called by the CHECK below with the writer's privileges: service_role writes campaigns directly.
revoke all on function public.campaign_barcode_pattern_valid(text)
  from public, anon, authenticated, service_role;
grant execute on function public.campaign_barcode_pattern_valid(text) to service_role;

alter table public.campaigns
  add constraint campaigns_barcode_pattern_format check (
    btrim(barcode_pattern) <> '' and barcode_pattern = btrim(barcode_pattern)
      and char_length(barcode_pattern) <= 200
  ),
  add constraint campaigns_barcode_pattern_mode check (
    barcode_pattern is null or barcode_mode in ('internal_code', 'external_legacy_code')
  ),
  add constraint campaigns_barcode_pattern_valid check (
    public.campaign_barcode_pattern_valid(barcode_pattern)
  );

comment on column public.campaigns.barcode_pattern is
  'internal_code / external_legacy_code only: regex whose first capture group is the base number. '
  'Null: the operator types the base number (like manual_mapping). A rule: draft only, frozen with bonds.';

-- ---------------------------------------------------------------------------
-- Rules guard: barcode_pattern joins the draft-only rule columns
-- ---------------------------------------------------------------------------
create or replace function public.campaigns_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_changed_rules text[];
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' then
      raise exception 'new campaigns must start in draft status (got %)', new.status
        using errcode = 'check_violation';
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
    or new.created_at is distinct from old.created_at
    or new.created_by is distinct from old.created_by
  then
    raise exception 'campaigns.id, created_at and created_by cannot be changed'
      using errcode = 'restrict_violation';
  end if;

  if new.status is distinct from old.status
    and (old.status, new.status) not in (
      ('draft', 'active'),
      ('draft', 'annulled'),
      ('active', 'closing'),
      ('closing', 'closed'),
      ('active', 'annulled')
    )
  then
    raise exception 'invalid campaign status transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if old.status = 'draft' and new.status = 'active'
    and (new.starts_at is null or new.ends_at is null)
  then
    raise exception 'campaign cannot be activated without starts_at and ends_at'
      using errcode = 'check_violation';
  end if;

  if old.status <> 'draft'
    and ((old.starts_at is not null and new.starts_at is null)
      or (old.ends_at is not null and new.ends_at is null))
  then
    raise exception 'campaign starts_at and ends_at cannot be cleared once the campaign was activated (status: %)', old.status
      using errcode = 'check_violation';
  end if;

  if old.status <> 'draft' then
    v_changed_rules := array_remove(array[
      case when new.simple_bond_value is distinct from old.simple_bond_value then 'simple_bond_value' end,
      case when new.installment_count is distinct from old.installment_count then 'installment_count' end,
      case when new.installment_value is distinct from old.installment_value then 'installment_value' end,
      case when new.number_digits is distinct from old.number_digits then 'number_digits' end,
      case when new.max_number is distinct from old.max_number then 'max_number' end,
      case when new.associated_number_offset is distinct from old.associated_number_offset
        then 'associated_number_offset' end,
      case when new.overflow_policy is distinct from old.overflow_policy then 'overflow_policy' end,
      case when new.barcode_mode is distinct from old.barcode_mode then 'barcode_mode' end,
      case when new.barcode_pattern is distinct from old.barcode_pattern then 'barcode_pattern' end
    ], null);

    if cardinality(v_changed_rules) > 0 then
      raise exception 'campaign rules can only be changed while the campaign is draft (status: %)', old.status
        using errcode = 'object_not_in_prerequisite_state',
          detail = format('changed rule columns: %s', array_to_string(v_changed_rules, ', '));
    end if;
  end if;

  if old.status not in ('draft', 'active')
    and (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at)
  then
    raise exception 'campaign dates can only be changed while the campaign is draft or active (status: %)', old.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if old.status in ('closed', 'annulled') and new.name is distinct from old.name then
    raise exception 'campaign name cannot be changed once the campaign is %', old.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.campaigns_guard_write() from public, anon, authenticated;

-- Frozen with bonds: same trigger, barcode_pattern added to the watched columns.
drop trigger campaigns_rules_frozen_with_bonds on public.campaigns;
create trigger campaigns_rules_frozen_with_bonds
  before update of simple_bond_value, installment_count, installment_value, number_digits,
    max_number, associated_number_offset, overflow_policy, barcode_mode, barcode_pattern
  on public.campaigns
  for each row
  when (
    (new.simple_bond_value, new.installment_count, new.installment_value, new.number_digits,
      new.max_number, new.associated_number_offset, new.overflow_policy, new.barcode_mode,
      new.barcode_pattern)
    is distinct from
    (old.simple_bond_value, old.installment_count, old.installment_value, old.number_digits,
      old.max_number, old.associated_number_offset, old.overflow_policy, old.barcode_mode,
      old.barcode_pattern)
  )
  execute function public.campaigns_rules_frozen_with_bonds();

-- ---------------------------------------------------------------------------
-- Audit snapshot and input validation
-- ---------------------------------------------------------------------------
create or replace function public.campaign_audit_snapshot(p_campaign public.campaigns)
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
    'barcode_pattern', p_campaign.barcode_pattern,
    'created_by', p_campaign.created_by
  );
$$;

revoke all on function public.campaign_audit_snapshot(public.campaigns)
  from public, anon, authenticated, service_role;

-- Normalizes (trim, blank = null) and validates a barcode pattern for p_barcode_mode. Raises 22023
-- with a readable message instead of letting the CHECKs fail.
create function public.campaign_normalize_barcode_pattern(p_pattern text, p_barcode_mode text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_pattern text := nullif(btrim(p_pattern), '');
begin
  if v_pattern is null then
    return null;
  end if;
  if p_barcode_mode is null or p_barcode_mode not in ('internal_code', 'external_legacy_code') then
    raise exception 'barcode pattern is only used with the internal code or external legacy code barcode modes'
      using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_pattern) > 200 then
    raise exception 'barcode pattern must be at most 200 characters'
      using errcode = 'invalid_parameter_value';
  end if;
  if not public.campaign_barcode_pattern_valid(v_pattern) then
    raise exception 'barcode pattern must be a valid regular expression with a capture group for the base number'
      using errcode = 'invalid_parameter_value',
        hint = 'e.g. ^BC-(\d+)$ (embedded options such as (?i) are not supported)';
  end if;
  return v_pattern;
end;
$$;

revoke all on function public.campaign_normalize_barcode_pattern(text, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- campaign_create: + p_barcode_pattern (trailing, default null)
-- ---------------------------------------------------------------------------
drop function public.campaign_create(
  text, numeric, integer, integer, integer, integer, text, text, timestamptz, timestamptz, text, text
);

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
  p_reason text default null,
  p_barcode_pattern text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_installment_value numeric;
  v_barcode_pattern text;
  v_campaign public.campaigns;
begin
  v_actor := public.campaign_require_actor('campaign.create');

  if p_name is null or btrim(p_name) = '' then
    raise exception 'campaign name is required' using errcode = 'invalid_parameter_value';
  end if;
  v_installment_value := public.campaign_installment_value(p_simple_bond_value, p_installment_count);
  v_barcode_pattern := public.campaign_normalize_barcode_pattern(p_barcode_pattern, p_barcode_mode);

  insert into public.campaigns (
    name, starts_at, ends_at,
    simple_bond_value, installment_count, installment_value,
    number_digits, max_number, associated_number_offset, overflow_policy, barcode_mode,
    barcode_pattern, created_by
  )
  values (
    btrim(p_name), p_starts_at, p_ends_at,
    p_simple_bond_value, p_installment_count, v_installment_value,
    p_number_digits, p_max_number, p_associated_number_offset, p_overflow_policy, p_barcode_mode,
    v_barcode_pattern, v_actor
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
-- campaign_update_rules: + p_barcode_pattern (trailing, default null; full replacement)
-- ---------------------------------------------------------------------------
drop function public.campaign_update_rules(
  uuid, numeric, integer, integer, integer, integer, text, text, timestamptz, text, text
);

create function public.campaign_update_rules(
  p_id uuid,
  p_simple_bond_value numeric,
  p_installment_count integer,
  p_number_digits integer,
  p_max_number integer,
  p_associated_number_offset integer,
  p_overflow_policy text,
  p_barcode_mode text,
  p_expected_updated_at timestamptz,
  p_request_id text default null,
  p_reason text default null,
  p_barcode_pattern text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_installment_value numeric;
  v_barcode_pattern text;
  v_old public.campaigns;
  v_new public.campaigns;
  v_changes record;
begin
  v_actor := public.campaign_require_actor('campaign.update_rules');
  v_installment_value := public.campaign_installment_value(p_simple_bond_value, p_installment_count);
  v_barcode_pattern := public.campaign_normalize_barcode_pattern(p_barcode_pattern, p_barcode_mode);

  select * into v_old from public.campaigns where id = p_id for update;
  if not found then
    raise exception 'campaign % not found', p_id using errcode = 'no_data_found';
  end if;
  perform public.campaign_require_version(v_old, p_expected_updated_at);

  if (
    v_old.simple_bond_value, v_old.installment_count, v_old.installment_value,
    v_old.number_digits, v_old.max_number, v_old.associated_number_offset,
    v_old.overflow_policy, v_old.barcode_mode, v_old.barcode_pattern
  ) is not distinct from (
    p_simple_bond_value, p_installment_count, v_installment_value,
    p_number_digits, p_max_number, p_associated_number_offset,
    p_overflow_policy, p_barcode_mode, v_barcode_pattern
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
      barcode_mode = p_barcode_mode,
      barcode_pattern = v_barcode_pattern
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

revoke all on function public.campaign_create(
  text, numeric, integer, integer, integer, integer, text, text, timestamptz, timestamptz, text, text, text
) from public, anon, service_role;
grant execute on function public.campaign_create(
  text, numeric, integer, integer, integer, integer, text, text, timestamptz, timestamptz, text, text, text
) to authenticated;

revoke all on function public.campaign_update_rules(
  uuid, numeric, integer, integer, integer, integer, text, text, timestamptz, text, text, text
) from public, anon, service_role;
grant execute on function public.campaign_update_rules(
  uuid, numeric, integer, integer, integer, integer, text, text, timestamptz, text, text, text
) to authenticated;
