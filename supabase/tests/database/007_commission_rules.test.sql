begin;
select plan(140);

-- ---------------------------------------------------------------------------
-- Fixtures (created as the test owner)
-- ---------------------------------------------------------------------------
-- auth ids / profiles:
--   ...01 admin (every permission)
--   ...02 operator      (no commission.* permission)
--   ...03 treasurer     (commission.adjust only: no commission.view / commission.rule_manage)
--   ...04 read-only     (no commission.* permission)
--   ...05 no roles
--   ...06 inactive admin
--   ...07 viewer:  test role with commission.view only
--   ...08 manager: test role with commission.rule_manage only (no commission.view)
insert into auth.users (id, email)
select ('a7000000-0000-0000-0000-00000000000' || n)::uuid, 'commission-rules-' || n || '@example.com'
from generate_series(1, 8) as n;

insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b7000000-0000-0000-0000-00000000000' || n)::uuid,
  ('a7000000-0000-0000-0000-00000000000' || n)::uuid,
  'Commission rules user ' || n, 'commission-rules-' || n || '@example.com',
  case when n = 6 then 'inactive' else 'active' end
from generate_series(1, 8) as n;

insert into public.roles (name, description) values
  ('test-commission-viewer', 'pgTAP: commission.view'),
  ('test-commission-manager', 'pgTAP: commission.rule_manage');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  ('test-commission-viewer', 'commission.view'),
  ('test-commission-manager', 'commission.rule_manage')
) as v (role_name, code)
join public.roles r on r.name = v.role_name
join public.permissions p on p.code = v.code;

insert into public.user_roles (user_id, role_id)
select v.profile_id::uuid, r.id
from (values
  ('b7000000-0000-0000-0000-000000000001', 'admin'),
  ('b7000000-0000-0000-0000-000000000002', 'operator'),
  ('b7000000-0000-0000-0000-000000000003', 'treasurer'),
  ('b7000000-0000-0000-0000-000000000004', 'read-only'),
  ('b7000000-0000-0000-0000-000000000006', 'admin'),
  ('b7000000-0000-0000-0000-000000000007', 'test-commission-viewer'),
  ('b7000000-0000-0000-0000-000000000008', 'test-commission-manager')
) as v (profile_id, role_name)
join public.roles r on r.name = v.role_name;

create function pg_temp.act_as(p_n int) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    format('{"sub":"a7000000-0000-0000-0000-00000000000%s","role":"authenticated"}', p_n),
    true
  );
$$;
grant execute on function pg_temp.act_as(int) to authenticated, anon;

create temporary table ids (k text primary key, id uuid not null);
grant select, insert on ids to authenticated;
grant select on ids to service_role;

-- Current versions (updated_at), as the app would have loaded them. They run as the caller, so
-- they return null for users who cannot see the row (those are denied before the version check).
create function pg_temp.rule_version(p_k text) returns timestamptz language sql stable as $$
  select r.updated_at from public.commission_rules r join ids on ids.id = r.id where ids.k = p_k;
$$;
create function pg_temp.campaign_version(p_k text) returns timestamptz language sql stable as $$
  select c.updated_at from public.campaigns c join ids on ids.id = c.id where ids.k = p_k;
$$;
grant execute on function pg_temp.rule_version(text) to authenticated;
grant execute on function pg_temp.campaign_version(text) to authenticated;

-- Campaigns (as the admin): 10 installments, with dates so they can be activated.
set local role authenticated;
select pg_temp.act_as(1);
insert into ids
select v.k, public.campaign_create(
  v.name, 60000, 10, 4, 9999, 4871, 'reject', 'base_number',
  '2026-03-01 00:00-03', '2026-12-31 23:59:59-03', 'req-fixture'
)
from (values ('c-draft', 'Draft'), ('c-other', 'Other'), ('c-active', 'Active'),
  ('c-closing', 'Closing'), ('c-annulled', 'Annulled')) as v (k, name);
select public.campaign_transition((select id from ids where k = 'c-active'), 'active', null, 'req-fixture');
select public.campaign_transition((select id from ids where k = 'c-closing'), 'active', null, 'req-fixture');
select public.campaign_transition((select id from ids where k = 'c-annulled'), 'annulled', 'Mistake', 'req-fixture');
reset role;

-- ---------------------------------------------------------------------------
-- Definitions, grants and RLS
-- ---------------------------------------------------------------------------
select has_table('public', 'commission_rules', 'commission_rules exists');
select ok(
  exists (select 1 from pg_extension where extname = 'btree_gist'),
  'btree_gist is installed (needed by the overlap EXCLUDE constraint)'
);
select col_is_null('public', 'commission_rules', 'applies_to_collector_id', 'applies_to_collector_id is nullable');
select ok(
  not exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.commission_rules'::regclass and c.contype = 'f'
      and a.attname = 'applies_to_collector_id'
  ),
  'applies_to_collector_id has no FK yet (collectors arrive in Phase 5)'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.commission_rules'::regclass
    and conname = 'commission_rules_no_overlap' and contype = 'x'),
  'commission_rules_no_overlap is an exclusion constraint'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.commission_rules'::regclass),
  'RLS is enabled on commission_rules'
);
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('commission_rule_create', 'commission_rule_update', 'commission_rule_annul',
                       'commission_rule_require_actor')),
  'commission rule write functions are SECURITY DEFINER with an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.commission_rule_create(uuid, text, integer, numeric, numeric, date, date, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.commission_rule_update(uuid, text, integer, numeric, numeric, date, date, timestamptz, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.commission_rule_annul(uuid, text, text)', 'execute'),
  'authenticated can execute the three commission rule functions'
);
select ok(
  not has_function_privilege('anon', 'public.commission_rule_create(uuid, text, integer, numeric, numeric, date, date, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.commission_rule_update(uuid, text, integer, numeric, numeric, date, date, timestamptz, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.commission_rule_annul(uuid, text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.commission_rule_create(uuid, text, integer, numeric, numeric, date, date, text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.commission_rule_update(uuid, text, integer, numeric, numeric, date, date, timestamptz, text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.commission_rule_annul(uuid, text, text)', 'execute'),
  'anon and service_role cannot execute the commission rule functions'
);
select ok(
  not exists (
    select 1 from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.pronamespace = 'public'::regnamespace
      and p.proname like 'commission_rule%'
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no EXECUTE on any commission_rule* function'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r (role_name)
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('commission_rule_require_actor', 'commission_rule_lock_campaign',
                        'commission_rule_validate', 'commission_rule_audit_snapshot',
                        'commission_rules_guard_write', 'commission_rules_forbid_delete',
                        'campaigns_guard_commission_installments')
      and has_function_privilege(r.role_name, p.oid, 'execute')
  ),
  'internal helpers and trigger functions are not executable by API roles'
);
select ok(
  has_table_privilege('authenticated', 'public.commission_rules', 'select')
  and not has_table_privilege('authenticated', 'public.commission_rules', 'insert')
  and not has_table_privilege('authenticated', 'public.commission_rules', 'update')
  and not has_table_privilege('authenticated', 'public.commission_rules', 'delete')
  and not has_table_privilege('authenticated', 'public.commission_rules', 'truncate'),
  'authenticated: SELECT only'
);
select ok(
  not has_table_privilege('anon', 'public.commission_rules', 'select')
  and not has_table_privilege('anon', 'public.commission_rules', 'insert'),
  'anon: no access'
);
select ok(
  has_table_privilege('service_role', 'public.commission_rules', 'select')
  and has_table_privilege('service_role', 'public.commission_rules', 'insert')
  and has_table_privilege('service_role', 'public.commission_rules', 'update')
  and not has_table_privilege('service_role', 'public.commission_rules', 'delete')
  and not has_table_privilege('service_role', 'public.commission_rules', 'truncate'),
  'service_role: select/insert/update, never delete or truncate'
);

-- ---------------------------------------------------------------------------
-- Table constraints and guard trigger (direct inserts as the owner)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.commission_rules (campaign_id, rule_type, valid_from)
    values ((select id from ids where k = 'c-draft'), 'cash_full_payment', '2026-01-01')$$,
  '23514', 'new row for relation "commission_rules" violates check constraint "commission_rules_one_value"',
  'constraint: a value is required'
);
select throws_ok(
  $$insert into public.commission_rules (campaign_id, rule_type, percentage, fixed_amount, valid_from)
    values ((select id from ids where k = 'c-draft'), 'cash_full_payment', 10, 100, '2026-01-01')$$,
  '23514', 'new row for relation "commission_rules" violates check constraint "commission_rules_one_value"',
  'constraint: percentage and fixed amount are mutually exclusive'
);
select throws_ok(
  $$insert into public.commission_rules (campaign_id, rule_type, percentage, valid_from)
    values ((select id from ids where k = 'c-draft'), 'cash_full_payment', 0, '2026-01-01')$$,
  '23514', 'new row for relation "commission_rules" violates check constraint "commission_rules_percentage_range"',
  'constraint: percentage 0 is rejected'
);
select throws_ok(
  $$insert into public.commission_rules (campaign_id, rule_type, percentage, valid_from)
    values ((select id from ids where k = 'c-draft'), 'cash_full_payment', 100.01, '2026-01-01')$$,
  '23514', 'new row for relation "commission_rules" violates check constraint "commission_rules_percentage_range"',
  'constraint: percentage above 100 is rejected'
);
select throws_ok(
  $$insert into public.commission_rules (campaign_id, rule_type, fixed_amount, valid_from)
    values ((select id from ids where k = 'c-draft'), 'cash_full_payment', 0, '2026-01-01')$$,
  '23514', 'new row for relation "commission_rules" violates check constraint "commission_rules_fixed_amount_positive"',
  'constraint: fixed amount must be positive'
);
-- numeric accepts 'NaN', which compares greater than every number (NaN > 0 is true).
select throws_ok(
  $$insert into public.commission_rules (campaign_id, rule_type, fixed_amount, valid_from)
    values ((select id from ids where k = 'c-draft'), 'cash_full_payment', 'NaN', '2026-01-01')$$,
  '23514', 'new row for relation "commission_rules" violates check constraint "commission_rules_fixed_amount_positive"',
  'constraint: fixed amount NaN is rejected'
);
select throws_ok(
  $$insert into public.commission_rules (campaign_id, rule_type, percentage, valid_from)
    values ((select id from ids where k = 'c-draft'), 'cash_full_payment', 'NaN', '2026-01-01')$$,
  '23514', 'new row for relation "commission_rules" violates check constraint "commission_rules_percentage_range"',
  'constraint: percentage NaN is rejected (NaN <= 100 is false)'
);
select throws_ok(
  $$insert into public.commission_rules (campaign_id, rule_type, percentage, valid_from)
    values ((select id from ids where k = 'c-draft'), 'custom', 10, '2026-01-01')$$,
  '23514', 'new row for relation "commission_rules" violates check constraint "commission_rules_installment_number_custom"',
  'constraint: custom requires an installment number'
);
select throws_ok(
  $$insert into public.commission_rules (campaign_id, rule_type, installment_number, percentage, valid_from)
    values ((select id from ids where k = 'c-draft'), 'custom', 0, 10, '2026-01-01')$$,
  '23514', 'new row for relation "commission_rules" violates check constraint "commission_rules_installment_number_custom"',
  'constraint: custom installment number must be positive'
);
select throws_ok(
  $$insert into public.commission_rules (campaign_id, rule_type, installment_number, percentage, valid_from)
    values ((select id from ids where k = 'c-draft'), 'installment_first', 1, 10, '2026-01-01')$$,
  '23514', 'new row for relation "commission_rules" violates check constraint "commission_rules_installment_number_custom"',
  'constraint: only custom rules carry an installment number'
);
select throws_ok(
  $$insert into public.commission_rules (campaign_id, rule_type, percentage, valid_from)
    values ((select id from ids where k = 'c-draft'), 'bonus', 10, '2026-01-01')$$,
  '23514', 'new row for relation "commission_rules" violates check constraint "commission_rules_rule_type_check"',
  'constraint: unknown rule type'
);
select throws_ok(
  $$insert into public.commission_rules (campaign_id, rule_type, percentage, valid_from, valid_to)
    values ((select id from ids where k = 'c-draft'), 'cash_full_payment', 10, '2026-02-01', '2026-01-31')$$,
  '23514', 'new row for relation "commission_rules" violates check constraint "commission_rules_validity_order"',
  'constraint: valid_to before valid_from'
);
select throws_ok(
  $$insert into public.commission_rules (campaign_id, rule_type, percentage, valid_from, status, annulled_at, annul_reason)
    values ((select id from ids where k = 'c-draft'), 'cash_full_payment', 10, '2026-01-01', 'annulled', now(), 'x')$$,
  '23514', 'new commission rules must start in active status (got annulled)',
  'guard: rules are created active'
);
select throws_ok(
  $$insert into public.commission_rules (campaign_id, rule_type, installment_number, percentage, valid_from)
    values ((select id from ids where k = 'c-draft'), 'custom', 11, 10, '2026-01-01')$$,
  '23514', 'installment number 11 exceeds the campaign installment count (10)',
  'guard: custom installment number cannot exceed the campaign installment count'
);
select throws_ok(
  $$insert into public.commission_rules (campaign_id, rule_type, percentage, valid_from)
    values ((select id from ids where k = 'c-annulled'), 'cash_full_payment', 10, '2026-01-01')$$,
  '55000', 'commission rules can only be changed while the campaign is draft or active (status: annulled)',
  'guard: no rules for an annulled campaign, whoever writes'
);
select lives_ok(
  $$with r as (insert into public.commission_rules
      (campaign_id, rule_type, installment_number, percentage, valid_from)
    values ((select id from ids where k = 'c-other'), 'custom', 10, 100, '2026-01-01') returning id)
    insert into ids select 'r-max', id from r$$,
  'constraint: custom installment = installment_count and percentage = 100 are accepted'
);

-- ---------------------------------------------------------------------------
-- commission_rule_create
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(1);
select lives_ok(
  $$insert into ids select 'r-cash-q1', public.commission_rule_create(
      (select id from ids where k = 'c-draft'), 'cash_full_payment', null, 25, null,
      '2026-01-01', '2026-03-31', 'req-create-1', 'Initial agreement')$$,
  'create: admin creates a 25 % cash rule'
);
reset role;

select results_eq(
  $$select r.campaign_id, r.rule_type, r.installment_number, r.percentage, r.fixed_amount,
      r.applies_to_collector_id, r.valid_from, r.valid_to, r.status, r.created_by
    from public.commission_rules r join ids on ids.id = r.id and ids.k = 'r-cash-q1'$$,
  $$select (select id from ids where k = 'c-draft'), 'cash_full_payment'::text, null::int,
      25.00::numeric, null::numeric, null::uuid, '2026-01-01'::date, '2026-03-31'::date,
      'active'::text, 'b7000000-0000-0000-0000-000000000001'::uuid$$,
  'create: row stored as a general active rule, created_by = actor'
);
select results_eq(
  $$select a.actor_user_id, a.action, a.entity_type, a.old_value is null,
      a.new_value ->> 'rule_type', (a.new_value ->> 'percentage')::numeric,
      a.new_value ->> 'campaign_id', a.reason, a.request_id
    from public.audit_log a join ids on ids.k = 'r-cash-q1' and a.entity_id = ids.id::text$$,
  $$select 'b7000000-0000-0000-0000-000000000001'::uuid, 'commission_rule.create'::text,
      'commission_rule'::text, true, 'cash_full_payment'::text, 25::numeric,
      (select id::text from ids where k = 'c-draft'), 'Initial agreement'::text, 'req-create-1'::text$$,
  'create: one commission_rule.create audit row with snapshot, reason and request id'
);

set local role authenticated;
select pg_temp.act_as(1);
select lives_ok(
  $$insert into ids select 'r-first', public.commission_rule_create(
      (select id from ids where k = 'c-draft'), 'installment_first', null, null, 1500,
      '2026-01-01', null, 'req-create-2')$$,
  'create: fixed amount rule, open-ended'
);
select lives_ok(
  $$insert into ids select 'r-half', public.commission_rule_create(
      (select id from ids where k = 'c-draft'), 'installment_middle', null, 12.5, null,
      '2026-01-01', null, 'req-create-3')$$,
  'create: 12.5 % rule'
);
select lives_ok(
  $$insert into ids select 'r-custom-4', public.commission_rule_create(
      (select id from ids where k = 'c-draft'), 'custom', 4, 30, null,
      '2026-01-01', null, 'req-create-4')$$,
  'create: custom rule for installment 4'
);
select lives_ok(
  $$insert into ids select 'r-active-campaign', public.commission_rule_create(
      (select id from ids where k = 'c-active'), 'installment_last', null, 10, null,
      '2026-01-01', null, 'req-create-5')$$,
  'create: allowed while the campaign is active'
);
select lives_ok(
  $$insert into ids select 'r-closing', public.commission_rule_create(
      (select id from ids where k = 'c-closing'), 'installment_last', null, 10, null,
      '2026-01-01', null, 'req-create-6')$$,
  'create: rule on a campaign that will move to closing'
);

-- Validation (22023)
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'bonus', null, 10, null, '2026-01-01', null, 'req-bad')$$,
  '22023', 'invalid commission rule type: bonus', 'create: unknown type'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, null, null, '2026-01-01', null, 'req-bad')$$,
  '22023', 'exactly one of percentage or fixed amount is required', 'create: no value'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, 10, 100, '2026-01-01', null, 'req-bad')$$,
  '22023', 'exactly one of percentage or fixed amount is required', 'create: two values'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, 0, null, '2026-01-01', null, 'req-bad')$$,
  '22023', 'percentage must be greater than 0 and at most 100', 'create: percentage 0'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, 100.5, null, '2026-01-01', null, 'req-bad')$$,
  '22023', 'percentage must be greater than 0 and at most 100', 'create: percentage above 100'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, 12.345, null, '2026-01-01', null, 'req-bad')$$,
  '22023', 'percentage must have at most 2 decimal places', 'create: percentage with 3 decimals is rejected, not rounded'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, null, -5, '2026-01-01', null, 'req-bad')$$,
  '22023', 'fixed amount must be greater than 0', 'create: negative fixed amount'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, null, 10.005, '2026-01-01', null, 'req-bad')$$,
  '22023', 'fixed amount must have at most 2 decimal places', 'create: fixed amount with 3 decimals'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, null, 'NaN', '2026-01-01', null, 'req-bad')$$,
  '22023', 'fixed amount must be a finite number', 'create: fixed amount NaN is rejected'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, null, 'Infinity', '2026-01-01', null, 'req-bad')$$,
  '22023', 'fixed amount must be a finite number', 'create: fixed amount Infinity is rejected'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, 'NaN', null, '2026-01-01', null, 'req-bad')$$,
  '22023', 'percentage must be a finite number', 'create: percentage NaN is rejected'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, '-Infinity', null, '2026-01-01', null, 'req-bad')$$,
  '22023', 'percentage must be a finite number', 'create: percentage -Infinity is rejected'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'custom', null, 10, null, '2026-01-01', null, 'req-bad')$$,
  '22023', 'installment number is required for custom rules', 'create: custom without installment'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'custom', 11, 10, null, '2026-01-01', null, 'req-bad')$$,
  '22023', 'installment number must be between 1 and 10', 'create: custom installment above the campaign installment count'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'custom', 0, 10, null, '2026-01-01', null, 'req-bad')$$,
  '22023', 'installment number must be between 1 and 10', 'create: custom installment 0'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', 2, 10, null, '2026-01-01', null, 'req-bad')$$,
  '22023', 'installment number is only allowed for custom rules', 'create: installment number on a non-custom rule'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, 10, null, null, null, 'req-bad')$$,
  '22023', 'valid from date is required', 'create: valid_from is required'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, 10, null, '2026-02-01', '2026-01-31', 'req-bad')$$,
  '22023', 'valid to date must be on or after the valid from date', 'create: reversed validity'
);
select throws_ok(
  $$select public.commission_rule_create('b7000000-0000-0000-0000-0000000000ff', 'installment_last', null, 10, null, '2026-01-01', null, 'req-bad')$$,
  'P0002', 'campaign b7000000-0000-0000-0000-0000000000ff not found', 'create: unknown campaign'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-annulled'), 'installment_last', null, 10, null, '2026-01-01', null, 'req-bad')$$,
  '55000', 'commission rules can only be changed while the campaign is draft or active (status: annulled)',
  'create: rejected on an annulled campaign'
);

-- Permissions
select pg_temp.act_as(2);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, 10, null, '2026-01-01', null, 'req-denied')$$,
  '42501', 'permission denied: commission.rule_manage is required', 'create: operator is denied'
);
select pg_temp.act_as(3);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, 10, null, '2026-01-01', null, 'req-denied')$$,
  '42501', 'permission denied: commission.rule_manage is required', 'create: treasurer is denied'
);
select pg_temp.act_as(4);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, 10, null, '2026-01-01', null, 'req-denied')$$,
  '42501', 'permission denied: commission.rule_manage is required', 'create: read-only is denied'
);
select pg_temp.act_as(5);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, 10, null, '2026-01-01', null, 'req-denied')$$,
  '42501', 'permission denied: commission.rule_manage is required', 'create: user without roles is denied'
);
select pg_temp.act_as(6);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, 10, null, '2026-01-01', null, 'req-denied')$$,
  '42501', 'an active profile is required to manage commission rules', 'create: inactive admin is rejected'
);
select pg_temp.act_as(7);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, 10, null, '2026-01-01', null, 'req-denied')$$,
  '42501', 'permission denied: commission.rule_manage is required', 'create: commission.view does not imply rule_manage'
);
select pg_temp.act_as(8);
select lives_ok(
  $$insert into ids select 'r-by-manager', public.commission_rule_create(
      (select id from ids where k = 'c-other'), 'installment_last', null, 5, null, '2026-01-01', null, 'req-manager')$$,
  'create: commission.rule_manage alone is enough to create'
);
reset role;

set local role anon;
select throws_ok(
  $$select public.commission_rule_create(null, 'installment_last', null, 10, null, '2026-01-01')$$,
  '42501', null, 'create: anon cannot call it'
);
reset role;

select is(
  (select count(*)::int from public.audit_log where request_id in ('req-bad', 'req-denied')),
  0, 'create: rejected calls write no audit row'
);
select is(
  (select count(*)::int from public.commission_rules r join ids on ids.id = r.campaign_id and ids.k = 'c-draft'),
  4, 'create: rejected calls leave no rule behind (4 valid rules on the draft campaign)'
);

-- ---------------------------------------------------------------------------
-- Overlapping validity (active general rules, same campaign + type [+ installment])
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'cash_full_payment', null, 20, null, '2026-03-31', '2026-04-30', 'req-overlap')$$,
  '23P01', 'conflicting key value violates exclusion constraint "commission_rules_no_overlap"',
  'overlap: sharing a single day (inclusive bounds) is rejected'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'cash_full_payment', null, 20, null, '2025-06-01', null, 'req-overlap')$$,
  '23P01', 'conflicting key value violates exclusion constraint "commission_rules_no_overlap"',
  'overlap: a new open-ended rule starting before an existing one is rejected'
);
select lives_ok(
  $$insert into ids select 'r-cash-q2', public.commission_rule_create(
      (select id from ids where k = 'c-draft'), 'cash_full_payment', null, 20, null, '2026-04-01', null, 'req-adjacent')$$,
  'overlap: an adjacent range (starts the day after the previous ends) is accepted'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'cash_full_payment', null, 20, null, '2030-01-01', '2030-12-31', 'req-overlap')$$,
  '23P01', 'conflicting key value violates exclusion constraint "commission_rules_no_overlap"',
  'overlap: a range inside an open-ended rule is rejected'
);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'custom', 4, 20, null, '2026-06-01', '2026-06-30', 'req-overlap')$$,
  '23P01', 'conflicting key value violates exclusion constraint "commission_rules_no_overlap"',
  'overlap: same custom installment is rejected'
);
select lives_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'custom', 5, 20, null, '2026-01-01', null, 'req-other-installment')$$,
  'overlap: another custom installment is independent'
);
select lives_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'installment_last', null, 20, null, '2026-01-01', null, 'req-other-type')$$,
  'overlap: another rule type is independent'
);
select lives_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-other'), 'cash_full_payment', null, 20, null, '2026-01-01', null, 'req-other-campaign')$$,
  'overlap: the same type in another campaign is independent'
);
reset role;

select lives_ok(
  $$insert into public.commission_rules (campaign_id, rule_type, percentage, valid_from, applies_to_collector_id)
    values ((select id from ids where k = 'c-draft'), 'cash_full_payment', 40, '2026-01-01', gen_random_uuid())$$,
  'overlap: special collector rules are not part of the general-rule exclusion'
);
select is(
  (select count(*)::int from public.audit_log where request_id = 'req-overlap'),
  0, 'overlap: rejected calls write no audit row'
);

-- ---------------------------------------------------------------------------
-- commission_rule_update
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(1);
select is(
  public.commission_rule_update((select id from ids where k = 'r-first'), 'installment_first', null, null, 1750.5,
    '2026-01-01', null, pg_temp.rule_version('r-first'), 'req-update-1', 'New agreement'),
  true, 'update: admin changes the fixed amount (returns true)'
);
select is(
  public.commission_rule_update((select id from ids where k = 'r-first'), 'installment_first', null, null, 1750.50,
    '2026-01-01', null, pg_temp.rule_version('r-first'), 'req-update-noop'),
  false, 'update: same values is a no-op (returns false)'
);
reset role;

select results_eq(
  $$select a.action, a.entity_type, a.old_value, a.new_value, a.reason
    from public.audit_log a join ids on ids.k = 'r-first' and a.entity_id = ids.id::text
    where a.request_id = 'req-update-1'$$,
  $$select 'commission_rule.update'::text, 'commission_rule'::text,
      jsonb_build_object('campaign_id', (select id from ids where k = 'c-draft'), 'fixed_amount', 1500.00),
      jsonb_build_object('campaign_id', (select id from ids where k = 'c-draft'), 'fixed_amount', 1750.50),
      'New agreement'::text$$,
  'update: audit keeps only the changed keys (plus campaign_id)'
);
select is(
  (select count(*)::int from public.audit_log where request_id = 'req-update-noop'),
  0, 'update: a no-op writes no audit row'
);

set local role authenticated;
select pg_temp.act_as(1);
select is(
  public.commission_rule_update((select id from ids where k = 'r-first'), 'installment_first', null, 3, null,
    '2026-01-01', '2026-12-31', pg_temp.rule_version('r-first'), 'req-update-2'),
  true, 'update: switch from fixed amount to percentage and set an end date'
);
select throws_ok(
  $$select public.commission_rule_update((select id from ids where k = 'r-cash-q1'), 'cash_full_payment', null, 25, null, '2026-01-01', '2026-04-01', pg_temp.rule_version('r-cash-q1'), 'req-update-bad')$$,
  '23P01', 'conflicting key value violates exclusion constraint "commission_rules_no_overlap"',
  'update: extending into the next rule is rejected'
);
select throws_ok(
  $$select public.commission_rule_update((select id from ids where k = 'r-cash-q1'), 'cash_full_payment', null, 25, 5, '2026-01-01', '2026-03-31', pg_temp.rule_version('r-cash-q1'), 'req-update-bad')$$,
  '22023', 'exactly one of percentage or fixed amount is required', 'update: input is validated'
);
select throws_ok(
  $$select public.commission_rule_update('b7000000-0000-0000-0000-0000000000ff', 'cash_full_payment', null, 25, null, '2026-01-01', null, now(), 'req-update-bad')$$,
  'P0002', 'commission rule b7000000-0000-0000-0000-0000000000ff not found', 'update: unknown rule'
);
select pg_temp.act_as(2);
select throws_ok(
  $$select public.commission_rule_update((select id from ids where k = 'r-cash-q1'), 'cash_full_payment', null, 30, null, '2026-01-01', '2026-03-31', pg_temp.rule_version('r-cash-q1'), 'req-update-bad')$$,
  '42501', 'permission denied: commission.rule_manage is required', 'update: operator is denied'
);
select pg_temp.act_as(3);
select throws_ok(
  $$select public.commission_rule_update((select id from ids where k = 'r-cash-q1'), 'cash_full_payment', null, 30, null, '2026-01-01', '2026-03-31', pg_temp.rule_version('r-cash-q1'), 'req-update-bad')$$,
  '42501', 'permission denied: commission.rule_manage is required', 'update: treasurer is denied'
);
select pg_temp.act_as(1);
select throws_ok(
  $$select public.commission_rule_update((select id from ids where k = 'r-cash-q1'), 'cash_full_payment', null, null, 'NaN', '2026-01-01', '2026-03-31', pg_temp.rule_version('r-cash-q1'), 'req-update-bad')$$,
  '22023', 'fixed amount must be a finite number', 'update: fixed amount NaN is rejected'
);
select throws_ok(
  $$select public.commission_rule_update((select id from ids where k = 'r-cash-q1'), 'cash_full_payment', null, 'NaN', null, '2026-01-01', '2026-03-31', pg_temp.rule_version('r-cash-q1'), 'req-update-bad')$$,
  '22023', 'percentage must be a finite number', 'update: percentage NaN is rejected'
);
reset role;
select is(
  (select count(*)::int from public.audit_log where request_id = 'req-update-bad'),
  0, 'update: rejected calls write no audit row'
);

-- Optimistic concurrency (updated_at as version). All writes here share one transaction (so one
-- now()): 'r-ver' first gets an older updated_at with microseconds, written with the guard
-- trigger (which forces now()) disabled for that fixture update only.
set local role authenticated;
select pg_temp.act_as(1);
insert into ids select 'r-ver', public.commission_rule_create(
  (select id from ids where k = 'c-active'), 'installment_first', null, 5, null, '2026-01-01', null, 'req-ver-fixture');
reset role;
alter table public.commission_rules disable trigger commission_rules_guard_write;
update public.commission_rules set updated_at = '2026-01-01 10:00:00.123456+00'
where id = (select id from ids where k = 'r-ver');
alter table public.commission_rules enable trigger commission_rules_guard_write;

set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$select public.commission_rule_update(p_id => (select id from ids where k = 'r-ver'), p_rule_type => 'installment_first',
      p_installment_number => null, p_percentage => 6, p_fixed_amount => null, p_valid_from => '2026-01-01',
      p_valid_to => null, p_request_id => 'req-ver-bad')$$,
  '42883', null, 'version: commission_rule_update without p_expected_updated_at does not resolve (required)'
);
select is(
  public.commission_rule_update((select id from ids where k = 'r-ver'), 'installment_first', null, 6, null,
    '2026-01-01', null, (select to_json(pg_temp.rule_version('r-ver')) #>> '{}')::timestamptz, 'req-ver-fresh'),
  true, 'version: update with the loaded version (sent back as its JSON text) succeeds'
);
select throws_ok(
  $$select public.commission_rule_update((select id from ids where k = 'r-ver'), 'installment_first', null, 7, null,
      '2026-01-01', null, '2026-01-01 10:00:00.123456+00', 'req-ver-stale')$$,
  'PT409', 'commission rule was modified by someone else', 'version: update with a stale version is rejected (PT409)'
);
select throws_ok(
  $$select public.commission_rule_update((select id from ids where k = 'r-ver'), 'installment_first', null, 6, null,
      '2026-01-01', null, '2026-01-01 10:00:00.123456+00', 'req-ver-stale')$$,
  'PT409', 'commission rule was modified by someone else', 'version: a stale no-op is rejected too'
);
select throws_ok(
  $$select public.commission_rule_update((select id from ids where k = 'r-ver'), 'installment_first', null, 7, null,
      '2026-01-01', null, pg_temp.rule_version('r-ver') - interval '1 microsecond', 'req-ver-stale')$$,
  'PT409', 'commission rule was modified by someone else', 'version: the comparison is exact (1 microsecond off is stale)'
);
select throws_ok(
  $$select public.commission_rule_update((select id from ids where k = 'r-ver'), 'installment_first', null, 7, null,
      '2026-01-01', null, null, 'req-ver-stale')$$,
  'PT409', 'commission rule was modified by someone else', 'version: a null version is never current'
);
select pg_temp.act_as(2);
select throws_ok(
  $$select public.commission_rule_update((select id from ids where k = 'r-ver'), 'installment_first', null, 7, null,
      '2026-01-01', null, '2026-01-01 10:00:00.123456+00', 'req-ver-bad')$$,
  '42501', 'permission denied: commission.rule_manage is required', 'version: permission is checked before the version'
);
reset role;
select is(
  (select percentage from public.commission_rules r join ids on ids.id = r.id and ids.k = 'r-ver'),
  6.00::numeric, 'version: stale calls left the rule as the fresh save wrote it'
);
select is(
  (select count(*)::int from public.audit_log where request_id in ('req-ver-stale', 'req-ver-bad')),
  0, 'version: stale and rejected calls write no audit row'
);
select is(
  (select count(*)::int from public.audit_log where request_id = 'req-ver-fresh' and action = 'commission_rule.update'),
  1, 'version: the fresh save wrote exactly one audit row'
);

-- ---------------------------------------------------------------------------
-- commission_rule_annul
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$select public.commission_rule_annul((select id from ids where k = 'r-cash-q1'), '   ', 'req-annul-bad')$$,
  '22023', 'a reason is required to annul a commission rule', 'annul: blank reason is rejected'
);
select throws_ok(
  $$select public.commission_rule_annul((select id from ids where k = 'r-cash-q1'), null, 'req-annul-bad')$$,
  '22023', 'a reason is required to annul a commission rule', 'annul: missing reason is rejected'
);
select pg_temp.act_as(2);
select throws_ok(
  $$select public.commission_rule_annul((select id from ids where k = 'r-cash-q1'), 'Operator', 'req-annul-bad')$$,
  '42501', 'permission denied: commission.rule_manage is required', 'annul: operator is denied'
);
select pg_temp.act_as(1);
select lives_ok(
  $$select public.commission_rule_annul((select id from ids where k = 'r-cash-q1'), '  Wrong percentage  ', 'req-annul-1')$$,
  'annul: admin annuls with a reason'
);
reset role;

select results_eq(
  $$select r.status, r.annulled_by, r.annul_reason, r.annulled_at is not null
    from public.commission_rules r join ids on ids.id = r.id and ids.k = 'r-cash-q1'$$,
  $$values ('annulled'::text, 'b7000000-0000-0000-0000-000000000001'::uuid, 'Wrong percentage'::text, true)$$,
  'annul: status, actor, trimmed reason and timestamp are stored'
);
select results_eq(
  $$select a.action, a.old_value ->> 'status', a.new_value ->> 'status', a.reason, a.request_id
    from public.audit_log a join ids on ids.k = 'r-cash-q1' and a.entity_id = ids.id::text
    where a.action = 'commission_rule.annul'$$,
  $$values ('commission_rule.annul'::text, 'active'::text, 'annulled'::text, 'Wrong percentage'::text, 'req-annul-1'::text)$$,
  'annul: one commission_rule.annul audit row with the reason'
);
select is(
  (select count(*)::int from public.audit_log where request_id = 'req-annul-bad'),
  0, 'annul: rejected calls write no audit row'
);

set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$select public.commission_rule_annul((select id from ids where k = 'r-cash-q1'), 'Again', 'req-annul-2')$$,
  '55000', null, 'annul: annulling twice is rejected (no second audit row)'
);
select throws_ok(
  $$select public.commission_rule_update((select id from ids where k = 'r-cash-q1'), 'cash_full_payment', null, 30, null, '2026-01-01', '2026-03-31', pg_temp.rule_version('r-cash-q1'), 'req-annul-2')$$,
  '55000', null, 'annul: an annulled rule cannot be edited'
);
select lives_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-draft'), 'cash_full_payment', null, 22, null, '2026-02-01', '2026-03-31', 'req-after-annul')$$,
  'overlap: an annulled rule no longer blocks its validity range'
);
reset role;
select is(
  (select count(*)::int from public.audit_log where request_id = 'req-annul-2'),
  0, 'annul: second annul / edit after annul write no audit row'
);
select throws_ok(
  $$update public.commission_rules set percentage = 99 where id = (select id from ids where k = 'r-cash-q1')$$,
  '55000', null, 'guard: annulled rules are immutable for every role'
);

-- An annulment always records who annulled: a direct write (bypassing commission_rule_annul)
-- without annulled_by is rejected, as the owner and as service_role.
select throws_ok(
  $$update public.commission_rules
    set status = 'annulled', annulled_at = now(), annul_reason = 'Direct write'
    where id = (select id from ids where k = 'r-ver')$$,
  '23514', 'new row for relation "commission_rules" violates check constraint "commission_rules_annulment_consistent"',
  'constraint: an annulled rule requires annulled_by (owner)'
);
set local role service_role;
select throws_ok(
  $$update public.commission_rules
    set status = 'annulled', annulled_at = now(), annul_reason = 'Direct write'
    where id = (select id from ids where k = 'r-ver')$$,
  '23514', 'new row for relation "commission_rules" violates check constraint "commission_rules_annulment_consistent"',
  'constraint: an annulled rule requires annulled_by (service_role)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Campaign status gating: closing / closed / annulled campaigns have read-only rules
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(1);
select public.campaign_transition((select id from ids where k = 'c-closing'), 'closing', null, 'req-fixture');
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-closing'), 'installment_first', null, 10, null, '2026-01-01', null, 'req-closing')$$,
  '55000', 'commission rules can only be changed while the campaign is draft or active (status: closing)',
  'status: no new rules once the campaign is closing'
);
select throws_ok(
  $$select public.commission_rule_update((select id from ids where k = 'r-closing'), 'installment_last', null, 15, null, '2026-01-01', null, pg_temp.rule_version('r-closing'), 'req-closing')$$,
  '55000', 'commission rules can only be changed while the campaign is draft or active (status: closing)',
  'status: no edits once the campaign is closing'
);
select throws_ok(
  $$select public.commission_rule_annul((select id from ids where k = 'r-closing'), 'Late', 'req-closing')$$,
  '55000', 'commission rules can only be changed while the campaign is draft or active (status: closing)',
  'status: no annulment once the campaign is closing'
);
select is(
  public.commission_rule_update((select id from ids where k = 'r-active-campaign'), 'installment_last', null, 11, null,
    '2026-01-01', null, pg_temp.rule_version('r-active-campaign'), 'req-active'),
  true, 'status: rules of an active campaign can still be edited'
);
reset role;

-- ---------------------------------------------------------------------------
-- Campaign installment_count cannot drop below an active custom rule
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$select public.campaign_update_rules((select id from ids where k = 'c-draft'), 60000, 4, 4, 9999, 4871, 'reject', 'base_number', pg_temp.campaign_version('c-draft'), 'req-shrink')$$,
  '55000', 'installment count cannot be lowered below 5 while an active commission rule applies to installment 5',
  'campaign: installments cannot drop below a custom rule installment'
);
select is(
  public.campaign_update_rules((select id from ids where k = 'c-draft'), 60000, 5, 4, 9999, 4871, 'reject', 'base_number', pg_temp.campaign_version('c-draft'), 'req-shrink'),
  true, 'campaign: installments can drop down to the highest custom rule installment'
);
reset role;

-- ---------------------------------------------------------------------------
-- RLS: SELECT requires commission.view
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(1);
select ok((select count(*) from public.commission_rules) > 0, 'rls: admin sees commission rules');
select pg_temp.act_as(7);
select ok((select count(*) from public.commission_rules) >= 10, 'rls: viewer sees every rule');
select pg_temp.act_as(2);
select is((select count(*)::int from public.commission_rules), 0, 'rls: operator sees no rules');
select pg_temp.act_as(3);
select is((select count(*)::int from public.commission_rules), 0, 'rls: treasurer sees no rules (no commission.view)');
select pg_temp.act_as(4);
select is((select count(*)::int from public.commission_rules), 0, 'rls: read-only sees no rules');
select pg_temp.act_as(6);
select is((select count(*)::int from public.commission_rules), 0, 'rls: inactive admin sees no rules');
select pg_temp.act_as(8);
select is((select count(*)::int from public.commission_rules), 0, 'rls: rule_manage without commission.view sees no rules');

select pg_temp.act_as(1);
select throws_ok(
  $$insert into public.commission_rules (campaign_id, rule_type, percentage, valid_from)
    values ((select id from ids where k = 'c-draft'), 'installment_middle', 1, '2030-01-01')$$,
  '42501', null, 'direct insert is denied even to the admin'
);
select throws_ok(
  $$update public.commission_rules set percentage = 1 where id = (select id from ids where k = 'r-half')$$,
  '42501', null, 'direct update is denied even to the admin'
);
select throws_ok(
  $$delete from public.commission_rules where id = (select id from ids where k = 'r-half')$$,
  '42501', null, 'direct delete is denied even to the admin'
);
reset role;

set local role anon;
select throws_ok($$select * from public.commission_rules$$, '42501', null, 'anon cannot read commission rules');
reset role;

-- Owner backstops
select throws_ok(
  $$delete from public.commission_rules where id = (select id from ids where k = 'r-half')$$,
  '23001', null, 'guard: rules are never deleted (owner)'
);
select throws_ok(
  $$truncate public.commission_rules$$, '23001', null, 'guard: commission_rules cannot be truncated'
);
select throws_ok(
  $$update public.commission_rules set campaign_id = (select id from ids where k = 'c-other') where id = (select id from ids where k = 'r-half')$$,
  '23001', null, 'guard: a rule cannot move to another campaign'
);

-- ---------------------------------------------------------------------------
-- Atomicity: if the audit insert fails, the rule change rolls back too.
-- ---------------------------------------------------------------------------
create function pg_temp.reject_rule_audit() returns trigger language plpgsql as $$
begin
  if new.action like 'commission_rule.%' then
    raise exception 'audit rejected' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger reject_rule_audit before insert on public.audit_log
  for each row execute function pg_temp.reject_rule_audit();

set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$select public.commission_rule_create((select id from ids where k = 'c-other'), 'installment_middle', null, 9, null, '2026-01-01', null, 'req-atomic')$$,
  'P0001', 'audit rejected', 'atomicity: audit failure aborts create'
);
select throws_ok(
  $$select public.commission_rule_update((select id from ids where k = 'r-half'), 'installment_middle', null, 13, null, '2026-01-01', null, pg_temp.rule_version('r-half'), 'req-atomic')$$,
  'P0001', 'audit rejected', 'atomicity: audit failure aborts update'
);
select throws_ok(
  $$select public.commission_rule_annul((select id from ids where k = 'r-half'), 'Atomic', 'req-atomic')$$,
  'P0001', 'audit rejected', 'atomicity: audit failure aborts annul'
);
reset role;
drop trigger reject_rule_audit on public.audit_log;

select is(
  (select count(*)::int from public.commission_rules r join ids on ids.id = r.campaign_id and ids.k = 'c-other'
    where r.rule_type = 'installment_middle'),
  0, 'atomicity: no rule left behind by a failed create'
);
select results_eq(
  $$select r.percentage, r.status from public.commission_rules r join ids on ids.id = r.id and ids.k = 'r-half'$$,
  $$values (12.50::numeric, 'active'::text)$$,
  'atomicity: failed update / annul left the rule unchanged'
);

select * from finish();
rollback;
