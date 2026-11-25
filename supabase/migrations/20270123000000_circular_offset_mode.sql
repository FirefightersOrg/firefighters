-- SAN-151: circular associated number mode (campaigns.associated_number_mode).
--
-- Today an associated number (N2) is always `base + associated_number_offset` (mode 'linear', still
-- the default: existing campaigns keep their behaviour). The new mode 'circular' covers the whole
-- lottery range with exactly two numbers per bond: with B = (max_number + 1) / 2 bonds (bases 0..B-1),
--
--   N2 = B + ((base + offset) mod B),   0 <= offset < B
--
-- so the associated numbers visit B..2B-1 exactly once, for any offset, and together with the bases
-- cover 0..2B-1 without collisions or gaps. Example B = 5000, offset 4871: 0129 -> 5000,
-- 0436 -> 5307, 0068 -> 9939, 0000 -> 9871, 0128 -> 9999.
--
-- The mode is a campaign RULE: editable only while the campaign is draft (campaigns_guard_write) and
-- frozen as soon as it has bonds (campaigns_rules_frozen_with_bonds), like the other rules.
--
-- One SQL formula: public.bond_associated_number. Every place that used to compute `base + offset`
-- calls it: bond_numbers_guard_write, bond_validate_base_numbers, bond_create and the import
-- staging / confirmation (import_session_revalidate, import_session_summary, import_session_confirm).
-- The TypeScript twin is src/lib/domain/numbering.ts (associatedNumberFor).
--
-- campaign_create / campaign_update_rules gain a trailing p_associated_number_mode (default
-- 'linear'); like p_barcode_pattern it is part of the full replacement done by update_rules.
--
-- Errors (SQLSTATE): 23514 the CHECKs (circular needs max_number + 1 even and offset < B),
-- 22023 base outside the circular range, 55000 edit outside draft / with bonds.

alter table public.campaigns
  add column associated_number_mode text not null default 'linear';

alter table public.campaigns
  add constraint campaigns_associated_number_mode_check
    check (associated_number_mode in ('linear', 'circular')),
  -- Circular: 2 x B = max_number + 1 (so max_number is odd) ...
  add constraint campaigns_circular_max_number_even_range
    check (associated_number_mode <> 'circular' or (max_number::bigint + 1) % 2 = 0),
  -- ... and the offset stays inside one block (0 <= offset < B).
  add constraint campaigns_circular_offset_below_block
    check (
      associated_number_mode <> 'circular'
      or associated_number_offset < (max_number::bigint + 1) / 2
    );

comment on column public.campaigns.associated_number_mode is
  'How the associated number derives from the base: linear = base + offset; circular = B + ((base + offset) mod B) with B = (max_number + 1) / 2 (public.bond_associated_number).';

-- ---------------------------------------------------------------------------
-- The one formula. Pure: no table access. Returns NULL for a circular base outside 0..B-1.
-- Linear may return a value above max_number: the caller applies the overflow policy.
-- ---------------------------------------------------------------------------
create function public.bond_associated_number(
  p_base bigint,
  p_offset integer,
  p_max_number integer,
  p_mode text
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case p_mode
    when 'circular' then
      case
        when p_base between 0 and (p_max_number::bigint + 1) / 2 - 1
          then (p_max_number::bigint + 1) / 2
            + ((p_base + p_offset) % ((p_max_number::bigint + 1) / 2))
      end
    else p_base + p_offset
  end;
$$;

revoke all on function public.bond_associated_number(bigint, integer, integer, text)
  from public, anon, authenticated, service_role;
-- import_session_summary is SECURITY INVOKER and calls it on behalf of signed-in users.
grant execute on function public.bond_associated_number(bigint, integer, integer, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Rules guard: associated_number_mode joins the draft-only rule columns
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
      case when new.barcode_pattern is distinct from old.barcode_pattern then 'barcode_pattern' end,
      case when new.associated_number_mode is distinct from old.associated_number_mode
        then 'associated_number_mode' end
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

revoke all on function public.campaigns_guard_write() from public, anon, authenticated, service_role;

-- Frozen with bonds: same trigger, associated_number_mode added to the watched columns.
drop trigger campaigns_rules_frozen_with_bonds on public.campaigns;
create trigger campaigns_rules_frozen_with_bonds
  before update of simple_bond_value, installment_count, installment_value, number_digits,
    max_number, associated_number_offset, associated_number_mode, overflow_policy, barcode_mode,
    barcode_pattern
  on public.campaigns
  for each row
  when (
    (new.simple_bond_value, new.installment_count, new.installment_value, new.number_digits,
      new.max_number, new.associated_number_offset, new.associated_number_mode,
      new.overflow_policy, new.barcode_mode, new.barcode_pattern)
    is distinct from
    (old.simple_bond_value, old.installment_count, old.installment_value, old.number_digits,
      old.max_number, old.associated_number_offset, old.associated_number_mode,
      old.overflow_policy, old.barcode_mode, old.barcode_pattern)
  )
  execute function public.campaigns_rules_frozen_with_bonds();

-- ---------------------------------------------------------------------------
-- Audit snapshot: the mode is part of the campaign diff (campaign_audit_changes compares keys)
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
    'associated_number_mode', p_campaign.associated_number_mode,
    'overflow_policy', p_campaign.overflow_policy,
    'barcode_mode', p_campaign.barcode_mode,
    'barcode_pattern', p_campaign.barcode_pattern,
    'created_by', p_campaign.created_by
  );
$$;

revoke all on function public.campaign_audit_snapshot(public.campaigns)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- campaign_create / campaign_update_rules: + p_associated_number_mode (trailing, default 'linear')
-- ---------------------------------------------------------------------------
drop function public.campaign_create(
  text, numeric, integer, integer, integer, integer, text, text, timestamptz, timestamptz, text, text, text
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
  p_barcode_pattern text default null,
  p_associated_number_mode text default 'linear'
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
    number_digits, max_number, associated_number_offset, associated_number_mode, overflow_policy,
    barcode_mode, barcode_pattern, created_by
  )
  values (
    btrim(p_name), p_starts_at, p_ends_at,
    p_simple_bond_value, p_installment_count, v_installment_value,
    p_number_digits, p_max_number, p_associated_number_offset, coalesce(p_associated_number_mode, 'linear'),
    p_overflow_policy, p_barcode_mode, v_barcode_pattern, v_actor
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

drop function public.campaign_update_rules(
  uuid, numeric, integer, integer, integer, integer, text, text, timestamptz, text, text, text
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
  p_barcode_pattern text default null,
  p_associated_number_mode text default 'linear'
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
    v_old.overflow_policy, v_old.barcode_mode, v_old.barcode_pattern, v_old.associated_number_mode
  ) is not distinct from (
    p_simple_bond_value, p_installment_count, v_installment_value,
    p_number_digits, p_max_number, p_associated_number_offset,
    p_overflow_policy, p_barcode_mode, v_barcode_pattern, coalesce(p_associated_number_mode, 'linear')
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
      associated_number_mode = coalesce(p_associated_number_mode, 'linear'),
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
  text, numeric, integer, integer, integer, integer, text, text, timestamptz, timestamptz, text, text, text, text
) from public, anon, service_role;
grant execute on function public.campaign_create(
  text, numeric, integer, integer, integer, integer, text, text, timestamptz, timestamptz, text, text, text, text
) to authenticated;

revoke all on function public.campaign_update_rules(
  uuid, numeric, integer, integer, integer, integer, text, text, timestamptz, text, text, text, text
) from public, anon, service_role;
grant execute on function public.campaign_update_rules(
  uuid, numeric, integer, integer, integer, integer, text, text, timestamptz, text, text, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- bond_numbers_guard_write: the expected associated number comes from the one formula.
-- Same body as 20270102000000 otherwise; SECURITY DEFINER is kept (SAN-141).
-- ---------------------------------------------------------------------------
create or replace function public.bond_numbers_guard_write()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_bond public.bonds;
  v_campaign public.campaigns;
  v_source public.bond_numbers;
  v_count integer;
  v_expected bigint;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.campaign_id is distinct from old.campaign_id
      or new.bond_id is distinct from old.bond_id
      or new.number_value is distinct from old.number_value
      or new.number_kind is distinct from old.number_kind
      or new.source_base_number_id is distinct from old.source_base_number_id
      or new.created_at is distinct from old.created_at
    then
      raise exception 'bond_numbers.id, campaign_id, bond_id, number_value, number_kind, source_base_number_id and created_at cannot be changed'
        using errcode = 'restrict_violation';
    end if;
    if old.released_at is not null then
      raise exception 'bond number % was released and cannot be changed', old.id
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    if new.released_at is not null then
      -- The audited annul RPC holds campaign -> draw -> rosters -> seed-77 lock.
      -- This narrow exception does not relax release rules for ordinary numbers.
      if old.number_kind = 'extraordinary'
        and exists (select 1 from public.draw_roster_entries e
          join public.draw_rosters r on r.id = e.draw_roster_id
          join public.draws d on d.id = r.draw_id
          where e.bond_number_id = old.id and d.status = 'annulled'
            and d.draw_type = 'extraordinary_full_payment')
        and not exists (select 1 from public.draw_roster_entries e
          join public.draw_rosters r on r.id = e.draw_roster_id
          join public.draws d on d.id = r.draw_id
          where e.bond_number_id = old.id and d.status <> 'annulled') then
        new.released_at := now();
        return new;
      end if;
      select * into v_bond from public.bonds where id = new.bond_id;
      if v_bond.commercial_status <> 'annulled' then
        raise exception 'bond numbers can only be released once their bond is annulled (status: %)', v_bond.commercial_status
          using errcode = 'object_not_in_prerequisite_state';
      end if;
      if v_bond.annulled_from_status is distinct from 'available' then
        raise exception 'bond numbers can only be released when their bond was annulled from available (annulled from: %)',
          v_bond.annulled_from_status using errcode = 'object_not_in_prerequisite_state';
      end if;
      new.released_at := now();
    end if;
    return new;
  end if;
  if new.released_at is not null or new.released_by is not null then
    raise exception 'new bond numbers cannot be released' using errcode = 'check_violation';
  end if;
  select * into v_bond from public.bonds where id = new.bond_id for no key update;
  if found and v_bond.campaign_id = new.campaign_id then
    if v_bond.origin = 'manual_grouping' then
      raise exception 'a manually grouped pata has no numbers of its own (its members keep theirs)'
        using errcode = 'check_violation';
    end if;
    if v_bond.commercial_status = 'annulled' then
      raise exception 'numbers cannot be added to annulled bond %', v_bond.id
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    select * into v_campaign from public.campaigns where id = v_bond.campaign_id;
    if new.number_value > v_campaign.max_number then
      raise exception 'number % exceeds the campaign maximum number (%)', new.number_value, v_campaign.max_number
        using errcode = 'check_violation';
    end if;
    if new.number_kind in ('base', 'associated') then
      select count(*) into v_count from public.bond_numbers n
        where n.bond_id = new.bond_id and n.number_kind = new.number_kind and n.released_at is null;
      if v_count >= v_bond.commercial_unit_count then
        raise exception 'bond % already has % % number(s) (commercial unit count %)',
          v_bond.id, v_count, new.number_kind, v_bond.commercial_unit_count using errcode = 'check_violation';
      end if;
    end if;
    if new.number_kind = 'associated' then
      select * into v_source from public.bond_numbers where id = new.source_base_number_id;
      if found and v_source.bond_id = new.bond_id then
        if v_source.number_kind <> 'base' then
          raise exception 'the source of an associated number must be a base number (got %)', v_source.number_kind
            using errcode = 'check_violation';
        end if;
        v_expected := public.bond_associated_number(
          v_source.number_value, v_campaign.associated_number_offset, v_campaign.max_number,
          v_campaign.associated_number_mode);
        if v_expected is null then
          raise exception 'base number % is outside the circular range 0..% of this campaign',
            v_source.number_value, (v_campaign.max_number::bigint + 1) / 2 - 1
            using errcode = 'check_violation';
        end if;
        if new.number_value is distinct from v_expected then
          raise exception 'associated number must be % (base % + offset %), got %',
            v_expected, v_source.number_value,
            v_campaign.associated_number_offset, new.number_value using errcode = 'check_violation';
        end if;
      end if;
    end if;
  end if;
  new.created_at := now();
  return new;
end; $$;

alter function public.bond_numbers_guard_write() security definer;
revoke all on function public.bond_numbers_guard_write() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- bond_validate_base_numbers: associated numbers by mode; circular bases must be < B
-- ---------------------------------------------------------------------------
create or replace function public.bond_validate_base_numbers(
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
  v_mode text := p_campaign.associated_number_mode;
  v_associated bigint;
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
    v_associated := public.bond_associated_number(v_base, v_offset, v_max, v_mode);
    if v_associated is null then
      -- Circular mode: base numbers are 0..B-1 with B = (max_number + 1) / 2.
      raise exception 'base number % is outside the circular range: base numbers go from 0 to %',
        public.bond_format_number(v_base, v_digits),
        public.bond_format_number((v_max::bigint + 1) / 2 - 1, v_digits)
        using errcode = 'invalid_parameter_value';
    end if;
    if v_associated > v_max then
      raise exception 'base number % overflows: its associated number % exceeds the campaign maximum number %',
        public.bond_format_number(v_base, v_digits),
        public.bond_format_number(v_associated, v_digits),
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
    select public.bond_associated_number(b, v_offset, v_max, v_mode), 'associated'
    from unnest(p_base_numbers) b
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

revoke all on function public.bond_validate_base_numbers(public.campaigns, integer[])
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- bond_create: participating and stored associated numbers from the one formula
-- ---------------------------------------------------------------------------
create or replace function public.bond_create(
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
    select public.bond_associated_number(
      b, v_campaign.associated_number_offset, v_campaign.max_number,
      v_campaign.associated_number_mode)::integer
    from unnest(p_base_numbers) b
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
        p_campaign_id, v_bond.id,
        public.bond_associated_number(
          v_base, v_campaign.associated_number_offset, v_campaign.max_number,
          v_campaign.associated_number_mode),
        'associated', v_base_id
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

revoke all on function public.bond_create(uuid, integer[], text, text, text, text)
  from public, anon, service_role;
grant execute on function public.bond_create(uuid, integer[], text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- import_session_revalidate: range, repetition and in-use checks use the one formula.
-- Circular: a base >= B has no associated number and fails number_out_of_range.
-- ---------------------------------------------------------------------------
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
  v_mode text;
begin
  select * into v_session from public.import_sessions where id = p_session_id;
  if not found then
    raise exception 'import session % not found', p_session_id using errcode = 'no_data_found';
  end if;
  select c.number_digits, c.associated_number_offset, c.max_number, c.associated_number_mode
  into v_digits, v_offset, v_max, v_mode
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
      error_message = case
        when v_mode = 'circular' and i.base_number <= v_max then
          format('Number %s does not fit the campaign (circular mode: base numbers go up to %s).',
            public.bond_format_number(i.base_number, v_digits),
            public.bond_format_number((v_max::bigint + 1) / 2 - 1, v_digits))
        else
          format('Number %s does not fit the campaign (maximum %s).',
            public.bond_format_number(i.base_number, v_digits),
            public.bond_format_number(v_max, v_digits))
      end
  where i.import_session_id = p_session_id and i.removed_at is null
    and i.created_bond_id is null and i.error_code is null
    and i.base_number is not null
    and (i.base_number > v_max
      or public.bond_associated_number(i.base_number, v_offset, v_max, v_mode) is null
      or public.bond_associated_number(i.base_number, v_offset, v_max, v_mode) > v_max);

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
    select i.id, i.base_number::bigint as n
    from public.import_session_items i
    where i.import_session_id = p_session_id and i.removed_at is null
      and i.created_bond_id is null and i.base_number is not null
    union all
    select i.id, public.bond_associated_number(i.base_number, v_offset, v_max, v_mode)
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
            and n.number_value in (
              i.base_number,
              public.bond_associated_number(i.base_number, v_offset, v_max, v_mode))
        ), v_digits))
  where i.import_session_id = p_session_id and i.removed_at is null
    and i.created_bond_id is null and i.error_code is null and i.base_number is not null
    and exists (
      select 1 from public.bond_numbers n
      where n.campaign_id = v_session.campaign_id and n.released_at is null
        and n.number_value in (
          i.base_number,
          public.bond_associated_number(i.base_number, v_offset, v_max, v_mode))
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

revoke all on function public.import_session_revalidate(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- import_session_summary: participating numbers from the one formula
-- ---------------------------------------------------------------------------
create or replace function public.import_session_summary(p_session_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_session public.import_sessions;
  v_offset integer;
  v_max integer;
  v_mode text;
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
  select c.associated_number_offset, c.max_number, c.associated_number_mode
  into v_offset, v_max, v_mode
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
        select public.bond_associated_number(i.base_number, v_offset, v_max, v_mode)
        from public.import_session_items i
        where i.import_session_id = p_session_id and i.removed_at is null and i.base_number is not null
      ) q
    )
  );
  return v_summary;
end;
$$;

revoke all on function public.import_session_summary(uuid) from public, anon, authenticated, service_role;
grant execute on function public.import_session_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- import_session_confirm: stored associated numbers from the one formula
-- ---------------------------------------------------------------------------
create or replace function public.import_session_confirm(p_session_id uuid, p_request_id text default null)
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
    values (v_campaign.id, v_bond.id, public.bond_associated_number(
        v_item.base_number, v_campaign.associated_number_offset, v_campaign.max_number,
        v_campaign.associated_number_mode),
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
      values (v_campaign.id, v_bond.id, public.bond_associated_number(
        v_item.base_number, v_campaign.associated_number_offset, v_campaign.max_number,
        v_campaign.associated_number_mode),
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

revoke all on function public.import_session_confirm(uuid, text) from public, anon, service_role;
grant execute on function public.import_session_confirm(uuid, text) to authenticated;
