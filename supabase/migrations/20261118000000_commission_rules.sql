-- SAN-20: commission_rules table (general campaign rules), invariants, RLS and audited write
-- functions.
--
-- Same model as campaigns (SAN-16/SAN-17):
--   * authenticated can only SELECT (gated by commission.view). Every write goes through one of
--     the SECURITY DEFINER functions below, which check commission.rule_manage and write the
--     change plus its audit_log row in one transaction.
--   * Rules are never deleted: they are annulled (status active -> annulled, reason required)
--     and annulled rules are immutable.
--   * Every invariant is enforced for every role (constraints and triggers also apply to
--     service_role and the table owner).
--
-- Decisions (see docs/commissions.md "Commission rules (SAN-20)"):
--   * A rule has exactly one value: a percentage (0 < p <= 100, 2 decimals) or a fixed amount
--     (> 0, 2 decimals).
--   * installment_number is required for rule_type = 'custom' (a specific installment, 1..the
--     campaign installment_count) and must be null for every other type.
--   * valid_from / valid_to are calendar days, both inclusive; valid_to null = open-ended.
--   * General rules (applies_to_collector_id is null) of the same campaign + rule_type (+ same
--     installment_number for custom) cannot have overlapping validity among active rules
--     (EXCLUDE constraint, SQLSTATE 23P01). Annulled rules never block. Adjacent ranges
--     (one ends on the 31st, the next starts on the 1st) are fine.
--   * Rules can be created/edited/annulled while the campaign is draft or active; once the
--     campaign is closing, closed or annulled its commission rules are read-only.
--   * The write functions only manage GENERAL rules for now (applies_to_collector_id stays null).
--     Special collector rules arrive with collectors (Phase 5 / Phase 9).
--
-- Errors (SQLSTATE):
--   42501 insufficient_privilege            no active profile, or missing commission.rule_manage
--   22023 invalid_parameter_value           bad input (unknown type, missing / two values,
--                                           percentage out of range, too many decimals,
--                                           installment number missing / not allowed / out of
--                                           range, valid_to before valid_from, annul w/o reason)
--   P0002 no_data_found                     campaign or rule not found
--   23514 check_violation                   table CHECK constraints and the custom installment
--                                           bound (backstops of the 22023 checks)
--   23P01 exclusion_violation               overlapping validity (commission_rules_no_overlap)
--   55000 object_not_in_prerequisite_state  campaign not draft/active; rule already annulled;
--                                           lowering a campaign's installment_count below a
--                                           custom rule's installment
--   23001 restrict_violation                change to id/campaign_id/created_*; delete/truncate

-- btree_gist lets the EXCLUDE constraint combine equality on uuid/text/int with range overlap.
-- Supabase keeps extensions in the `extensions` schema; default operator classes are found by
-- type, so the constraint does not depend on search_path.
create extension if not exists btree_gist with schema extensions;

create table public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  rule_type text not null,
  -- Only for rule_type = 'custom': the specific installment (1..campaigns.installment_count).
  installment_number integer,
  -- Exactly one of percentage / fixed_amount is set.
  percentage numeric(5, 2),
  fixed_amount numeric(14, 2),
  -- Special collector rules. No FK yet: public.collectors does not exist until Phase 5, which
  -- adds `references public.collectors (id)`. The write functions keep it null for now.
  applies_to_collector_id uuid,
  -- Calendar days, both inclusive. valid_to null = no end.
  valid_from date not null,
  valid_to date,

  status text not null default 'active',
  annulled_at timestamptz,
  annulled_by uuid references public.profiles (id) on delete restrict,
  annul_reason text,

  -- Creating profile; null for system/seed actions (same convention as campaigns.created_by).
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint commission_rules_rule_type_check check (
    rule_type in (
      'cash_full_payment', 'installment_first', 'installment_middle', 'installment_last', 'custom'
    )
  ),
  constraint commission_rules_status_check check (status in ('active', 'annulled')),
  constraint commission_rules_one_value check ((percentage is null) <> (fixed_amount is null)),
  constraint commission_rules_percentage_range check (percentage > 0 and percentage <= 100),
  constraint commission_rules_fixed_amount_positive check (fixed_amount > 0),
  constraint commission_rules_installment_number_custom check (
    case
      when rule_type = 'custom' then installment_number is not null and installment_number > 0
      else installment_number is null
    end
  ),
  constraint commission_rules_validity_order check (valid_to >= valid_from),
  constraint commission_rules_annulment_consistent check (
    case
      when status = 'annulled' then annulled_at is not null
        and annul_reason is not null and btrim(annul_reason) <> ''
      else annulled_at is null and annulled_by is null and annul_reason is null
    end
  ),
  -- No overlapping validity among ACTIVE GENERAL rules of the same campaign + type (+ installment
  -- for custom). daterange(valid_from, null, '[]') is unbounded above (open-ended rule).
  constraint commission_rules_no_overlap exclude using gist (
    campaign_id with =,
    rule_type with =,
    (coalesce(installment_number, 0)) with =,
    (daterange(valid_from, valid_to, '[]')) with &&
  ) where (applies_to_collector_id is null and status = 'active')
);

comment on table public.commission_rules is
  'Commission rules per campaign (SAN-20). General rules have applies_to_collector_id null. Annulled, never deleted.';
comment on column public.commission_rules.applies_to_collector_id is
  'Special collector rule target. FK to public.collectors added in Phase 5; null = general rule.';
comment on column public.commission_rules.installment_number is
  'Only for rule_type = custom: the installment (1..campaigns.installment_count) the rule applies to.';
comment on column public.commission_rules.valid_to is
  'Last day the rule applies (inclusive); null = open-ended.';

create index commission_rules_campaign_id_idx on public.commission_rules (campaign_id);
create index commission_rules_created_by_idx on public.commission_rules (created_by);
create index commission_rules_annulled_by_idx on public.commission_rules (annulled_by);

-- ---------------------------------------------------------------------------
-- Write guard: server timestamps, immutable columns, annulment, campaign status, installment
-- ---------------------------------------------------------------------------
create function public.commission_rules_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_campaign public.campaigns;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.campaign_id is distinct from old.campaign_id
      or new.created_at is distinct from old.created_at
      or new.created_by is distinct from old.created_by
    then
      raise exception 'commission_rules.id, campaign_id, created_at and created_by cannot be changed'
        using errcode = 'restrict_violation';
    end if;
    if old.status = 'annulled' then
      raise exception 'commission rule % is annulled and cannot be changed', old.id
        using errcode = 'object_not_in_prerequisite_state';
    end if;
  else
    if new.status is distinct from 'active' then
      raise exception 'new commission rules must start in active status (got %)', new.status
        using errcode = 'check_violation';
    end if;
    new.created_at := now();
  end if;

  select * into v_campaign from public.campaigns where id = new.campaign_id;
  -- A missing campaign is reported by the foreign key.
  if found then
    if v_campaign.status not in ('draft', 'active') then
      raise exception 'commission rules can only be changed while the campaign is draft or active (status: %)', v_campaign.status
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    if new.installment_number is not null and new.installment_number > v_campaign.installment_count then
      raise exception 'installment number % exceeds the campaign installment count (%)',
        new.installment_number, v_campaign.installment_count
        using errcode = 'check_violation';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.commission_rules_guard_write() from public, anon, authenticated;

create trigger commission_rules_guard_write
  before insert or update on public.commission_rules
  for each row execute function public.commission_rules_guard_write();

create function public.commission_rules_forbid_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'commission rules cannot be deleted: % is not allowed (annul the rule instead)', tg_op
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function public.commission_rules_forbid_delete() from public, anon, authenticated;

create trigger commission_rules_forbid_delete
  before delete on public.commission_rules
  for each row execute function public.commission_rules_forbid_delete();

create trigger commission_rules_forbid_truncate
  before truncate on public.commission_rules
  for each statement execute function public.commission_rules_forbid_delete();

-- A draft campaign's installment_count can still change (campaign_update_rules). It cannot drop
-- below the installment of an active custom commission rule (annul or edit the rule first).
create function public.campaigns_guard_commission_installments()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max integer;
begin
  select max(r.installment_number) into v_max
  from public.commission_rules r
  where r.campaign_id = new.id and r.status = 'active' and r.installment_number is not null;

  if v_max is not null and new.installment_count < v_max then
    raise exception 'installment count cannot be lowered below % while an active commission rule applies to installment %', v_max, v_max
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  return new;
end;
$$;

revoke all on function public.campaigns_guard_commission_installments() from public, anon, authenticated;

create trigger campaigns_guard_commission_installments
  before update of installment_count on public.campaigns
  for each row
  when (new.installment_count < old.installment_count)
  execute function public.campaigns_guard_commission_installments();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
revoke all on table public.commission_rules from anon, authenticated, service_role;
grant select on table public.commission_rules to authenticated;
grant select, insert, update on table public.commission_rules to service_role;

alter table public.commission_rules enable row level security;

create policy commission_rules_select on public.commission_rules
  for select to authenticated
  using ((select public.has_permission('commission.view')));

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by API roles; the functions below run as the owner)
-- ---------------------------------------------------------------------------

-- Caller's active profile id after checking commission.rule_manage. Raises 42501 otherwise.
create function public.commission_rule_require_actor()
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
    raise exception 'an active profile is required to manage commission rules'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.has_permission('commission.rule_manage') then
    raise exception 'permission denied: commission.rule_manage is required'
      using errcode = 'insufficient_privilege';
  end if;
  return v_actor;
end;
$$;

-- Locks the campaign (FOR SHARE: serializes with campaign_update_rules / campaign_transition,
-- which lock it FOR UPDATE) and checks that its commission rules may change.
create function public.commission_rule_lock_campaign(p_campaign_id uuid)
returns public.campaigns
language plpgsql
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
    raise exception 'commission rules can only be changed while the campaign is draft or active (status: %)', v_campaign.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  return v_campaign;
end;
$$;

-- Readable 22023 errors for every rule value (the table constraints are the backstop).
create function public.commission_rule_validate(
  p_campaign public.campaigns,
  p_rule_type text,
  p_installment_number integer,
  p_percentage numeric,
  p_fixed_amount numeric,
  p_valid_from date,
  p_valid_to date
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_rule_type is null or p_rule_type not in (
    'cash_full_payment', 'installment_first', 'installment_middle', 'installment_last', 'custom'
  ) then
    raise exception 'invalid commission rule type: %', coalesce(p_rule_type, 'null')
      using errcode = 'invalid_parameter_value';
  end if;

  if p_rule_type = 'custom' then
    if p_installment_number is null then
      raise exception 'installment number is required for custom rules'
        using errcode = 'invalid_parameter_value';
    end if;
    if p_installment_number < 1 or p_installment_number > p_campaign.installment_count then
      raise exception 'installment number must be between 1 and %', p_campaign.installment_count
        using errcode = 'invalid_parameter_value';
    end if;
  elsif p_installment_number is not null then
    raise exception 'installment number is only allowed for custom rules'
      using errcode = 'invalid_parameter_value';
  end if;

  if (p_percentage is null) = (p_fixed_amount is null) then
    raise exception 'exactly one of percentage or fixed amount is required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_percentage is not null then
    if p_percentage <= 0 or p_percentage > 100 then
      raise exception 'percentage must be greater than 0 and at most 100'
        using errcode = 'invalid_parameter_value';
    end if;
    if p_percentage <> round(p_percentage, 2) then
      raise exception 'percentage must have at most 2 decimal places'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if p_fixed_amount is not null then
    if p_fixed_amount <= 0 then
      raise exception 'fixed amount must be greater than 0'
        using errcode = 'invalid_parameter_value';
    end if;
    if p_fixed_amount <> round(p_fixed_amount, 2) then
      raise exception 'fixed amount must have at most 2 decimal places'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if p_valid_from is null then
    raise exception 'valid from date is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_valid_to is not null and p_valid_to < p_valid_from then
    raise exception 'valid to date must be on or after the valid from date'
      using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- Audited representation of a rule (everything except the server-maintained updated_at).
create function public.commission_rule_audit_snapshot(p_rule public.commission_rules)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_rule.id,
    'campaign_id', p_rule.campaign_id,
    'rule_type', p_rule.rule_type,
    'installment_number', p_rule.installment_number,
    'percentage', p_rule.percentage,
    'fixed_amount', p_rule.fixed_amount,
    'applies_to_collector_id', p_rule.applies_to_collector_id,
    'valid_from', p_rule.valid_from,
    'valid_to', p_rule.valid_to,
    'status', p_rule.status,
    'annulled_at', p_rule.annulled_at,
    'annulled_by', p_rule.annulled_by,
    'annul_reason', p_rule.annul_reason,
    'created_by', p_rule.created_by
  );
$$;

-- ---------------------------------------------------------------------------
-- commission_rule_create: new active general rule + 'commission_rule.create' audit row.
-- Returns the new rule id.
-- ---------------------------------------------------------------------------
create function public.commission_rule_create(
  p_campaign_id uuid,
  p_rule_type text,
  p_installment_number integer,
  p_percentage numeric,
  p_fixed_amount numeric,
  p_valid_from date,
  p_valid_to date default null,
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
  v_rule public.commission_rules;
begin
  v_actor := public.commission_rule_require_actor();
  v_campaign := public.commission_rule_lock_campaign(p_campaign_id);
  perform public.commission_rule_validate(
    v_campaign, p_rule_type, p_installment_number, p_percentage, p_fixed_amount,
    p_valid_from, p_valid_to
  );

  insert into public.commission_rules (
    campaign_id, rule_type, installment_number, percentage, fixed_amount,
    valid_from, valid_to, created_by
  )
  values (
    p_campaign_id, p_rule_type, p_installment_number, p_percentage, p_fixed_amount,
    p_valid_from, p_valid_to, v_actor
  )
  returning * into v_rule;

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (
    v_actor, 'commission_rule.create', 'commission_rule', v_rule.id::text,
    null, public.commission_rule_audit_snapshot(v_rule),
    nullif(btrim(p_reason), ''), p_request_id
  );

  return v_rule.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- commission_rule_update: full replacement of type, installment, value and validity of an
-- active rule. The audit row keeps only the changed keys (plus campaign_id for context).
-- Returns true when something changed, false for a no-op (nothing written).
-- ---------------------------------------------------------------------------
create function public.commission_rule_update(
  p_id uuid,
  p_rule_type text,
  p_installment_number integer,
  p_percentage numeric,
  p_fixed_amount numeric,
  p_valid_from date,
  p_valid_to date default null,
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
  v_campaign_id uuid;
  v_campaign public.campaigns;
  v_old public.commission_rules;
  v_new public.commission_rules;
  v_old_json jsonb;
  v_new_json jsonb;
begin
  v_actor := public.commission_rule_require_actor();

  -- Campaign first, then the rule: same lock order as commission_rule_create.
  select campaign_id into v_campaign_id from public.commission_rules where id = p_id;
  if not found then
    raise exception 'commission rule % not found', p_id using errcode = 'no_data_found';
  end if;
  v_campaign := public.commission_rule_lock_campaign(v_campaign_id);

  select * into v_old from public.commission_rules where id = p_id for update;
  if v_old.status = 'annulled' then
    raise exception 'commission rule % is annulled and cannot be changed', p_id
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  perform public.commission_rule_validate(
    v_campaign, p_rule_type, p_installment_number, p_percentage, p_fixed_amount,
    p_valid_from, p_valid_to
  );

  if (
    v_old.rule_type, v_old.installment_number, v_old.percentage, v_old.fixed_amount,
    v_old.valid_from, v_old.valid_to
  ) is not distinct from (
    p_rule_type, p_installment_number, p_percentage, p_fixed_amount, p_valid_from, p_valid_to
  ) then
    return false;
  end if;

  update public.commission_rules
  set rule_type = p_rule_type,
      installment_number = p_installment_number,
      percentage = p_percentage,
      fixed_amount = p_fixed_amount,
      valid_from = p_valid_from,
      valid_to = p_valid_to
  where id = p_id
  returning * into v_new;

  v_old_json := public.commission_rule_audit_snapshot(v_old);
  v_new_json := public.commission_rule_audit_snapshot(v_new);

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (
    v_actor, 'commission_rule.update', 'commission_rule', p_id::text,
    (select jsonb_object_agg(o.key, o.value) from jsonb_each(v_old_json) o
      where o.key = 'campaign_id' or o.value is distinct from v_new_json -> o.key),
    (select jsonb_object_agg(n.key, n.value) from jsonb_each(v_new_json) n
      where n.key = 'campaign_id' or n.value is distinct from v_old_json -> n.key),
    nullif(btrim(p_reason), ''), p_request_id
  );

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- commission_rule_annul: active -> annulled (reason required) + 'commission_rule.annul' audit
-- row. Annulling an already annulled rule is rejected (55000), so a double submit never writes
-- a second audit row.
-- ---------------------------------------------------------------------------
create function public.commission_rule_annul(
  p_id uuid,
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
  v_old public.commission_rules;
  v_new public.commission_rules;
begin
  v_actor := public.commission_rule_require_actor();

  if v_reason is null then
    raise exception 'a reason is required to annul a commission rule'
      using errcode = 'invalid_parameter_value';
  end if;

  select campaign_id into v_campaign_id from public.commission_rules where id = p_id;
  if not found then
    raise exception 'commission rule % not found', p_id using errcode = 'no_data_found';
  end if;
  perform public.commission_rule_lock_campaign(v_campaign_id);

  select * into v_old from public.commission_rules where id = p_id for update;
  if v_old.status = 'annulled' then
    raise exception 'commission rule % is already annulled', p_id
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  update public.commission_rules
  set status = 'annulled', annulled_at = now(), annulled_by = v_actor, annul_reason = v_reason
  where id = p_id
  returning * into v_new;

  insert into public.audit_log
    (actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id)
  values (
    v_actor, 'commission_rule.annul', 'commission_rule', p_id::text,
    jsonb_build_object('campaign_id', v_old.campaign_id, 'status', v_old.status),
    jsonb_build_object(
      'campaign_id', v_new.campaign_id, 'status', v_new.status,
      'annulled_at', v_new.annulled_at, 'annulled_by', v_new.annulled_by
    ),
    v_reason, p_request_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: the three entry points are for signed-in users only (they act as the caller via
-- auth.uid()). Helpers are not callable by API roles. Supabase grants EXECUTE to
-- anon/authenticated/service_role by default: revoke explicitly.
-- ---------------------------------------------------------------------------
revoke all on function public.commission_rule_require_actor()
  from public, anon, authenticated, service_role;
revoke all on function public.commission_rule_lock_campaign(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.commission_rule_validate(
  public.campaigns, text, integer, numeric, numeric, date, date
) from public, anon, authenticated, service_role;
revoke all on function public.commission_rule_audit_snapshot(public.commission_rules)
  from public, anon, authenticated, service_role;

revoke all on function public.commission_rule_create(
  uuid, text, integer, numeric, numeric, date, date, text, text
) from public, anon, service_role;
grant execute on function public.commission_rule_create(
  uuid, text, integer, numeric, numeric, date, date, text, text
) to authenticated;

revoke all on function public.commission_rule_update(
  uuid, text, integer, numeric, numeric, date, date, text, text
) from public, anon, service_role;
grant execute on function public.commission_rule_update(
  uuid, text, integer, numeric, numeric, date, date, text, text
) to authenticated;

revoke all on function public.commission_rule_annul(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.commission_rule_annul(uuid, text, text) to authenticated;
