begin;
select plan(100);

-- ---------------------------------------------------------------------------
-- Fixtures (created as the test owner)
-- ---------------------------------------------------------------------------
-- auth ids / profiles:
--   ...01 admin (every campaign.* permission)
--   ...02 operator (campaign.view only)
--   ...03 no roles
--   ...04 inactive admin
--   ...05 editor: test role with campaign.view + campaign.update
--   ...06 closer: test role with campaign.view + campaign.close
insert into auth.users (id, email)
select ('a6000000-0000-0000-0000-00000000000' || n)::uuid, 'campaign-rpc-' || n || '@example.com'
from generate_series(1, 6) as n;

insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b6000000-0000-0000-0000-00000000000' || n)::uuid,
  ('a6000000-0000-0000-0000-00000000000' || n)::uuid,
  'Campaign RPC user ' || n, 'campaign-rpc-' || n || '@example.com',
  case when n = 4 then 'inactive' else 'active' end
from generate_series(1, 6) as n;

insert into public.roles (name, description) values
  ('test-campaign-editor', 'pgTAP: campaign.view + campaign.update'),
  ('test-campaign-closer', 'pgTAP: campaign.view + campaign.close');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  ('test-campaign-editor', 'campaign.view'),
  ('test-campaign-editor', 'campaign.update'),
  ('test-campaign-closer', 'campaign.view'),
  ('test-campaign-closer', 'campaign.close')
) as v (role_name, code)
join public.roles r on r.name = v.role_name
join public.permissions p on p.code = v.code;

insert into public.user_roles (user_id, role_id)
select v.profile_id::uuid, r.id
from (values
  ('b6000000-0000-0000-0000-000000000001', 'admin'),
  ('b6000000-0000-0000-0000-000000000002', 'operator'),
  ('b6000000-0000-0000-0000-000000000004', 'admin'),
  ('b6000000-0000-0000-0000-000000000005', 'test-campaign-editor'),
  ('b6000000-0000-0000-0000-000000000006', 'test-campaign-closer')
) as v (profile_id, role_name)
join public.roles r on r.name = v.role_name;

-- Switches the JWT subject used by auth.uid() (the role itself is set with `set local role`).
create function pg_temp.act_as(p_n int) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    format('{"sub":"a6000000-0000-0000-0000-00000000000%s","role":"authenticated"}', p_n),
    true
  );
$$;
grant execute on function pg_temp.act_as(int) to authenticated, anon;

-- Creates a draft campaign as the admin (helper for later sections; returns its id).
create function pg_temp.new_campaign(p_name text, p_with_dates boolean default true)
returns uuid language sql as $$
  select public.campaign_create(
    p_name, 60000, 10, 4, 9999, 4871, 'reject', 'base_number',
    case when p_with_dates then '2026-03-01 00:00-03'::timestamptz end,
    case when p_with_dates then '2026-12-31 23:59:59-03'::timestamptz end,
    'req-fixture'
  );
$$;
grant execute on function pg_temp.new_campaign(text, boolean) to authenticated;

-- Remembers ids across role switches.
create temporary table ids (k text primary key, id uuid not null);
grant select, insert on ids to authenticated;

-- ---------------------------------------------------------------------------
-- Definitions and grants
-- ---------------------------------------------------------------------------
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('campaign_create', 'campaign_update', 'campaign_update_rules',
                       'campaign_transition', 'campaign_require_actor')),
  'campaign write functions are SECURITY DEFINER with an empty search_path'
);

select ok(
  has_function_privilege('authenticated', 'public.campaign_create(text, numeric, integer, integer, integer, integer, text, text, timestamptz, timestamptz, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.campaign_update(uuid, text, timestamptz, timestamptz, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.campaign_update_rules(uuid, numeric, integer, integer, integer, integer, text, text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.campaign_transition(uuid, text, text, text)', 'execute'),
  'authenticated can execute the four campaign write functions'
);
select ok(
  not has_function_privilege('anon', 'public.campaign_create(text, numeric, integer, integer, integer, integer, text, text, timestamptz, timestamptz, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.campaign_update(uuid, text, timestamptz, timestamptz, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.campaign_update_rules(uuid, numeric, integer, integer, integer, integer, text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.campaign_transition(uuid, text, text, text)', 'execute'),
  'anon cannot execute the campaign write functions'
);
select ok(
  not has_function_privilege('service_role', 'public.campaign_create(text, numeric, integer, integer, integer, integer, text, text, timestamptz, timestamptz, text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.campaign_update(uuid, text, timestamptz, timestamptz, text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.campaign_update_rules(uuid, numeric, integer, integer, integer, integer, text, text, text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.campaign_transition(uuid, text, text, text)', 'execute'),
  'service_role cannot execute the campaign write functions (they act as auth.uid())'
);
select ok(
  not exists (
    select 1 from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('campaign_create', 'campaign_update', 'campaign_update_rules', 'campaign_transition')
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no EXECUTE on the campaign write functions'
);
select ok(
  not has_function_privilege('authenticated', 'public.campaign_require_actor(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.campaign_installment_value(numeric, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.campaign_audit_snapshot(public.campaigns)', 'execute')
  and not has_function_privilege('authenticated', 'public.campaign_audit_changes(jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.campaign_require_actor(text)', 'execute')
  and not has_function_privilege('service_role', 'public.campaign_require_actor(text)', 'execute'),
  'internal helpers are not executable by API roles'
);

set local role anon;
select throws_ok(
  $$select public.campaign_create('Anon', 60000, 10, 4, 9999, 4871, 'reject', 'base_number')$$,
  '42501', null, 'anon cannot call campaign_create'
);
reset role;

-- ---------------------------------------------------------------------------
-- campaign_create
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(1);
select lives_ok(
  $$insert into ids
    select 'c1', public.campaign_create(
      '  Campaign 2027  ', 60000, 10, 4, 9999, 4871, 'reject', 'base_number',
      null, null, 'req-create-1', 'Kickoff'
    )$$,
  'admin creates a campaign'
);
reset role;

select results_eq(
  $$select c.name, c.status, c.simple_bond_value, c.installment_count, c.installment_value,
      c.number_digits, c.max_number, c.associated_number_offset, c.overflow_policy, c.barcode_mode,
      c.created_by, c.starts_at is null and c.ends_at is null
    from public.campaigns c join ids on ids.id = c.id and ids.k = 'c1'$$,
  $$values ('Campaign 2027'::text, 'draft'::text, 60000.00::numeric, 10, 6000.00::numeric, 4, 9999, 4871,
      'reject'::text, 'base_number'::text, 'b6000000-0000-0000-0000-000000000001'::uuid, true)$$,
  'create: trimmed name, draft, installment_value computed (60000 / 10 = 6000), created_by = actor'
);
select results_eq(
  $$select a.actor_user_id, a.action, a.entity_type, a.entity_id, a.old_value is null,
      a.new_value ->> 'name', a.new_value ->> 'status', (a.new_value ->> 'installment_value')::numeric,
      a.reason, a.request_id
    from public.audit_log a join ids on ids.k = 'c1' and a.entity_id = ids.id::text$$,
  $$select 'b6000000-0000-0000-0000-000000000001'::uuid, 'campaign.create'::text, 'campaign'::text,
      (select id::text from ids where k = 'c1'), true, 'Campaign 2027'::text, 'draft'::text,
      6000::numeric, 'Kickoff'::text, 'req-create-1'::text$$,
  'create: one campaign.create audit row with actor, snapshot, reason and request id'
);

set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$select public.campaign_create('Inexact', 60000, 7, 4, 9999, 4871, 'reject', 'base_number', null, null, 'req-bad')$$,
  '22023', 'simple bond value 60000 cannot be split into 7 equal installments',
  'create: a value that does not divide exactly into the installments is rejected'
);
select throws_ok(
  $$select public.campaign_create('Inexact cents', 100, 3, 4, 9999, 4871, 'reject', 'base_number', null, null, 'req-bad')$$,
  '22023', 'simple bond value 100 cannot be split into 3 equal installments',
  'create: 100 / 3 is rejected (33.33 * 3 <> 100)'
);
select lives_ok(
  $$insert into ids select 'c-cents', public.campaign_create('Cents', 100.02, 2, 4, 9999, 4871, 'reject', 'base_number', null, null, 'req-cents')$$,
  'create: 100.02 / 2 = 50.01 is exact to the cent'
);
select throws_ok(
  $$select public.campaign_create('Three decimals', 60000.005, 5, 4, 9999, 4871, 'reject', 'base_number', null, null, 'req-bad')$$,
  '22023', 'simple bond value must have at most 2 decimal places',
  'create: more than 2 decimals is rejected instead of rounded'
);
select throws_ok(
  $$select public.campaign_create('Zero', 0, 10, 4, 9999, 4871, 'reject', 'base_number', null, null, 'req-bad')$$,
  '22023', 'simple bond value must be greater than 0', 'create: zero value is rejected'
);
select throws_ok(
  $$select public.campaign_create('Zero installments', 60000, 0, 4, 9999, 4871, 'reject', 'base_number', null, null, 'req-bad')$$,
  '22023', 'installment count must be greater than 0', 'create: zero installments is rejected'
);
select throws_ok(
  $$select public.campaign_create('   ', 60000, 10, 4, 9999, 4871, 'reject', 'base_number', null, null, 'req-bad')$$,
  '22023', 'campaign name is required', 'create: blank name is rejected'
);
select throws_ok(
  $$select public.campaign_create('Too wide', 60000, 10, 4, 10000, 4871, 'reject', 'base_number', null, null, 'req-bad')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_max_number_fits_digits"',
  'create: numbering CHECK constraints still apply'
);
select throws_ok(
  $$select public.campaign_create('QR', 60000, 10, 4, 9999, 4871, 'reject', 'qr', null, null, 'req-bad')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_barcode_mode_check"',
  'create: unknown barcode mode is rejected'
);
select throws_ok(
  $$select public.campaign_create('Reversed', 60000, 10, 4, 9999, 4871, 'reject', 'base_number', '2026-12-01', '2026-03-01', 'req-bad')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_dates_order"',
  'create: reversed dates are rejected'
);
select throws_ok(
  $$select public.campaign_create('No mode', 60000, 10, 4, 9999, 4871, 'reject', null, null, null, 'req-bad')$$,
  '23502', null, 'create: barcode mode is required'
);
select lives_ok(
  $$insert into ids select 'c-5d', public.campaign_create('Five digits', 90000, 12, 5, 99999, 4871, 'reject', 'internal_code', '2026-03-01', '2026-12-31', 'req-5d')$$,
  'create: 5-digit configuration with dates'
);

select pg_temp.act_as(2);
select throws_ok(
  $$select public.campaign_create('Operator', 60000, 10, 4, 9999, 4871, 'reject', 'base_number', null, null, 'req-denied')$$,
  '42501', 'permission denied: campaign.create is required', 'create: operator (campaign.view only) is denied'
);
select pg_temp.act_as(3);
select throws_ok(
  $$select public.campaign_create('No roles', 60000, 10, 4, 9999, 4871, 'reject', 'base_number', null, null, 'req-denied')$$,
  '42501', 'permission denied: campaign.create is required', 'create: user without roles is denied'
);
select pg_temp.act_as(4);
select throws_ok(
  $$select public.campaign_create('Inactive', 60000, 10, 4, 9999, 4871, 'reject', 'base_number', null, null, 'req-denied')$$,
  '42501', 'an active profile is required to change campaigns', 'create: inactive admin is rejected'
);
select pg_temp.act_as(5);
select throws_ok(
  $$select public.campaign_create('Editor', 60000, 10, 4, 9999, 4871, 'reject', 'base_number', null, null, 'req-denied')$$,
  '42501', 'permission denied: campaign.create is required', 'create: campaign.update does not imply campaign.create'
);
select set_config('request.jwt.claims', '{"sub":"a6000000-0000-0000-0000-0000000000ff","role":"authenticated"}', true);
select throws_ok(
  $$select public.campaign_create('Ghost', 60000, 10, 4, 9999, 4871, 'reject', 'base_number', null, null, 'req-denied')$$,
  '42501', 'an active profile is required to change campaigns', 'create: auth user without profile is rejected'
);
reset role;

select is(
  (select count(*)::int from public.campaigns where name in ('Inexact', 'Inexact cents', 'Three decimals', 'Zero',
    'Zero installments', 'Too wide', 'QR', 'Reversed', 'No mode', 'Operator', 'No roles', 'Inactive', 'Editor', 'Ghost')),
  0, 'create: rejected calls leave no campaign behind'
);
select is(
  (select count(*)::int from public.audit_log where request_id in ('req-bad', 'req-denied')),
  0, 'create: rejected calls write no audit row'
);
select is(
  (select installment_value from public.campaigns c join ids on ids.id = c.id and ids.k = 'c-cents'),
  50.01::numeric, 'create: 100.02 in 2 installments stores 50.01'
);

-- ---------------------------------------------------------------------------
-- campaign_update (general data)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(1);
select is(
  public.campaign_update((select id from ids where k = 'c1'), 'Campaign 2027 (renamed)', null, null, 'req-update-1'),
  true, 'update: admin renames a draft (returns true)'
);
select is(
  public.campaign_update((select id from ids where k = 'c1'), '  Campaign 2027 (renamed) ', null, null, 'req-update-noop'),
  false, 'update: same values (after trimming) is a no-op (returns false)'
);
select throws_ok(
  $$select public.campaign_update((select id from ids where k = 'c1'), '', null, null, 'req-update-bad')$$,
  '22023', 'campaign name is required', 'update: blank name is rejected'
);
select throws_ok(
  $$select public.campaign_update('b6000000-0000-0000-0000-0000000000ff', 'Missing', null, null, 'req-update-bad')$$,
  'P0002', 'campaign b6000000-0000-0000-0000-0000000000ff not found', 'update: unknown campaign is P0002'
);
select throws_ok(
  $$select public.campaign_update((select id from ids where k = 'c1'), 'Reversed', '2026-12-01', '2026-03-01', 'req-update-bad')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_dates_order"',
  'update: reversed dates are rejected'
);

select pg_temp.act_as(5);
select is(
  public.campaign_update((select id from ids where k = 'c1'), 'Campaign 2027 (renamed)', '2027-03-01 00:00-03', '2027-12-31 23:59:59-03', 'req-update-2'),
  true, 'update: editor (campaign.update) sets the dates'
);
select throws_ok(
  $$select public.campaign_update_rules((select id from ids where k = 'c1'), 60000, 12, 4, 9999, 4871, 'reject', 'base_number', 'req-update-bad')$$,
  '42501', 'permission denied: campaign.update_rules is required',
  'update_rules: editor (campaign.update only) is denied'
);
select pg_temp.act_as(2);
select throws_ok(
  $$select public.campaign_update((select id from ids where k = 'c1'), 'Operator rename', null, null, 'req-update-bad')$$,
  '42501', 'permission denied: campaign.update is required', 'update: operator is denied'
);
select pg_temp.act_as(4);
select throws_ok(
  $$select public.campaign_update((select id from ids where k = 'c1'), 'Inactive rename', null, null, 'req-update-bad')$$,
  '42501', 'an active profile is required to change campaigns', 'update: inactive admin is rejected'
);
select pg_temp.act_as(6);
select throws_ok(
  $$select public.campaign_update((select id from ids where k = 'c1'), 'Closer rename', null, null, 'req-update-bad')$$,
  '42501', 'permission denied: campaign.update is required', 'update: closer (campaign.close only) is denied'
);
reset role;

select results_eq(
  $$select a.actor_user_id, a.action, a.old_value, a.new_value, a.reason
    from public.audit_log a where a.request_id = 'req-update-1'$$,
  $$values ('b6000000-0000-0000-0000-000000000001'::uuid, 'campaign.update'::text,
      '{"name": "Campaign 2027"}'::jsonb, '{"name": "Campaign 2027 (renamed)"}'::jsonb, null::text)$$,
  'update: audit row holds only the changed field, before and after'
);
select results_eq(
  $$select a.actor_user_id, a.old_value, (a.new_value ->> 'starts_at')::timestamptz, (a.new_value ->> 'ends_at')::timestamptz,
      a.new_value ? 'name'
    from public.audit_log a where a.request_id = 'req-update-2'$$,
  $$values ('b6000000-0000-0000-0000-000000000005'::uuid, '{"starts_at": null, "ends_at": null}'::jsonb,
      '2027-03-01 00:00-03'::timestamptz, '2027-12-31 23:59:59-03'::timestamptz, false)$$,
  'update: date change audited with the editor as actor (name unchanged, not included)'
);
select is(
  (select count(*)::int from public.audit_log where request_id in ('req-update-noop', 'req-update-bad')),
  0, 'update: no-op and rejected calls write no audit row'
);
select is(
  (select name from public.campaigns c join ids on ids.id = c.id and ids.k = 'c1'),
  'Campaign 2027 (renamed)', 'update: rejected calls did not change the name'
);

-- ---------------------------------------------------------------------------
-- campaign_update_rules (draft)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(1);
select is(
  public.campaign_update_rules((select id from ids where k = 'c1'), 60000, 12, 5, 99999, 10000, 'reject', 'internal_code', 'req-rules-1', 'Board decision'),
  true, 'update_rules: admin changes rules of a draft'
);
select is(
  public.campaign_update_rules((select id from ids where k = 'c1'), 60000.00, 12, 5, 99999, 10000, 'reject', 'internal_code', 'req-rules-noop'),
  false, 'update_rules: same values is a no-op'
);
select throws_ok(
  $$select public.campaign_update_rules((select id from ids where k = 'c1'), 60000, 7, 5, 99999, 10000, 'reject', 'internal_code', 'req-rules-bad')$$,
  '22023', 'simple bond value 60000 cannot be split into 7 equal installments',
  'update_rules: non-exact installments are rejected'
);
select throws_ok(
  $$select public.campaign_update_rules((select id from ids where k = 'c1'), 60000, 12, 4, 9999, 10000, 'reject', 'internal_code', 'req-rules-bad')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_associated_number_offset_within_max"',
  'update_rules: numbering CHECK constraints still apply'
);
select throws_ok(
  $$select public.campaign_update_rules('b6000000-0000-0000-0000-0000000000ff', 60000, 12, 4, 9999, 4871, 'reject', 'base_number', 'req-rules-bad')$$,
  'P0002', null, 'update_rules: unknown campaign is P0002'
);
select pg_temp.act_as(2);
select throws_ok(
  $$select public.campaign_update_rules((select id from ids where k = 'c1'), 60000, 10, 4, 9999, 4871, 'reject', 'base_number', 'req-rules-bad')$$,
  '42501', 'permission denied: campaign.update_rules is required', 'update_rules: operator is denied'
);
select pg_temp.act_as(6);
select throws_ok(
  $$select public.campaign_update_rules((select id from ids where k = 'c1'), 60000, 10, 4, 9999, 4871, 'reject', 'base_number', 'req-rules-bad')$$,
  '42501', 'permission denied: campaign.update_rules is required', 'update_rules: closer is denied'
);
reset role;

select results_eq(
  $$select simple_bond_value, installment_count, installment_value, number_digits, max_number,
      associated_number_offset, barcode_mode
    from public.campaigns c join ids on ids.id = c.id and ids.k = 'c1'$$,
  $$values (60000.00::numeric, 12, 5000.00::numeric, 5, 99999, 10000, 'internal_code'::text)$$,
  'update_rules: rules stored and installment_value recomputed (60000 / 12 = 5000)'
);
select results_eq(
  $$select a.action, a.old_value, a.new_value, a.reason
    from public.audit_log a where a.request_id = 'req-rules-1'$$,
  $$values ('campaign.update_rules'::text,
      '{"installment_count": 10, "installment_value": 6000.00, "number_digits": 4, "max_number": 9999, "associated_number_offset": 4871, "barcode_mode": "base_number"}'::jsonb,
      '{"installment_count": 12, "installment_value": 5000.00, "number_digits": 5, "max_number": 99999, "associated_number_offset": 10000, "barcode_mode": "internal_code"}'::jsonb,
      'Board decision'::text)$$,
  'update_rules: audit row holds the changed rule fields and the reason'
);
select is(
  (select count(*)::int from public.audit_log where request_id in ('req-rules-noop', 'req-rules-bad')),
  0, 'update_rules: no-op and rejected calls write no audit row'
);

-- ---------------------------------------------------------------------------
-- campaign_transition
-- ---------------------------------------------------------------------------
-- Fixture campaigns (created by the admin): draft without dates, and drafts with dates.
set local role authenticated;
select pg_temp.act_as(1);
insert into ids values ('t-nodates', pg_temp.new_campaign('No dates', false));
insert into ids values ('t-flow', pg_temp.new_campaign('Full flow'));
insert into ids values ('t-annul-draft', pg_temp.new_campaign('Draft to annul', false));
insert into ids values ('t-annul-active', pg_temp.new_campaign('Active to annul'));

select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-nodates'), 'active', null, 'req-tr-bad')$$,
  '23514', 'campaign cannot be activated without starts_at and ends_at',
  'transition: activation without dates is rejected (trigger error propagates)'
);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-flow'), 'draft', null, 'req-tr-bad')$$,
  '22023', 'invalid target status: draft', 'transition: draft is not a target status'
);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-flow'), 'paused', null, 'req-tr-bad')$$,
  '22023', 'invalid target status: paused', 'transition: unknown target status is rejected'
);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-flow'), null, null, 'req-tr-bad')$$,
  '22023', 'invalid target status: null', 'transition: null target status is rejected'
);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-flow'), 'closing', null, 'req-tr-bad')$$,
  '23514', 'invalid campaign status transition: draft -> closing', 'transition: draft -> closing is rejected'
);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-flow'), 'closed', null, 'req-tr-bad')$$,
  '23514', 'invalid campaign status transition: draft -> closed', 'transition: draft -> closed is rejected'
);
select throws_ok(
  $$select public.campaign_transition('b6000000-0000-0000-0000-0000000000ff', 'active', null, 'req-tr-bad')$$,
  'P0002', null, 'transition: unknown campaign is P0002'
);

-- Activation needs campaign.update_rules: the closer and the editor cannot activate.
select pg_temp.act_as(6);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-flow'), 'active', null, 'req-tr-bad')$$,
  '42501', 'permission denied: campaign.update_rules is required', 'transition: closer cannot activate'
);
select pg_temp.act_as(5);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-flow'), 'active', null, 'req-tr-bad')$$,
  '42501', 'permission denied: campaign.update_rules is required', 'transition: editor cannot activate'
);
select pg_temp.act_as(2);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-flow'), 'active', null, 'req-tr-bad')$$,
  '42501', 'permission denied: campaign.update_rules is required', 'transition: operator cannot activate'
);
select pg_temp.act_as(4);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-flow'), 'active', null, 'req-tr-bad')$$,
  '42501', 'an active profile is required to change campaigns', 'transition: inactive admin is rejected'
);

select pg_temp.act_as(1);
select lives_ok(
  $$select public.campaign_transition((select id from ids where k = 't-flow'), 'active', null, 'req-tr-activate')$$,
  'transition: admin activates a draft with dates'
);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-flow'), 'active', null, 'req-tr-bad')$$,
  '23514', 'invalid campaign status transition: active -> active',
  'transition: activating an active campaign again is rejected (no duplicate audit)'
);
select throws_ok(
  $$select public.campaign_update_rules((select id from ids where k = 't-flow'), 60000, 12, 4, 9999, 4871, 'reject', 'base_number', 'req-tr-bad')$$,
  '55000', 'campaign rules can only be changed while the campaign is draft (status: active)',
  'update_rules: rules are frozen once active (trigger error propagates)'
);
select is(
  public.campaign_update_rules((select id from ids where k = 't-flow'), 60000, 10, 4, 9999, 4871, 'reject', 'base_number', 'req-tr-noop'),
  false, 'update_rules: re-sending the current rules of an active campaign is a harmless no-op'
);
select throws_ok(
  $$select public.campaign_update((select id from ids where k = 't-flow'), 'Full flow', null, '2026-12-31 23:59:59-03', 'req-tr-bad')$$,
  '23514', 'campaign starts_at and ends_at cannot be cleared once the campaign was activated (status: active)',
  'update: dates cannot be cleared once active'
);

select pg_temp.act_as(5);
select is(
  public.campaign_update((select id from ids where k = 't-flow'), 'Full flow (active)', '2026-03-01 00:00-03', '2027-01-31 23:59:59-03', 'req-tr-edit-active'),
  true, 'update: editor renames and moves the end date of an active campaign'
);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-flow'), 'closing', null, 'req-tr-bad')$$,
  '42501', 'permission denied: campaign.close is required', 'transition: editor cannot start closing'
);
select pg_temp.act_as(2);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-flow'), 'closing', null, 'req-tr-bad')$$,
  '42501', 'permission denied: campaign.close is required', 'transition: operator cannot start closing'
);

select pg_temp.act_as(6);
select lives_ok(
  $$select public.campaign_transition((select id from ids where k = 't-flow'), 'closing', null, 'req-tr-closing')$$,
  'transition: closer moves active -> closing'
);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-flow'), 'annulled', 'Too late', 'req-tr-bad')$$,
  '23514', 'invalid campaign status transition: closing -> annulled', 'transition: closing -> annulled is rejected'
);
select pg_temp.act_as(5);
select throws_ok(
  $$select public.campaign_update((select id from ids where k = 't-flow'), 'Full flow (active)', '2026-03-01 00:00-03', '2027-02-28 23:59:59-03', 'req-tr-bad')$$,
  '55000', 'campaign dates can only be changed while the campaign is draft or active (status: closing)',
  'update: dates are frozen while closing'
);
select is(
  public.campaign_update((select id from ids where k = 't-flow'), 'Full flow (closing)', '2026-03-01 00:00-03', '2027-01-31 23:59:59-03', 'req-tr-edit-closing'),
  true, 'update: name can still change while closing'
);
select pg_temp.act_as(6);
select lives_ok(
  $$select public.campaign_transition((select id from ids where k = 't-flow'), 'closed', 'Season over', 'req-tr-closed')$$,
  'transition: closer moves closing -> closed'
);
select pg_temp.act_as(1);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-flow'), 'active', null, 'req-tr-bad')$$,
  '23514', 'invalid campaign status transition: closed -> active', 'transition: closed -> active is rejected'
);
select throws_ok(
  $$select public.campaign_update((select id from ids where k = 't-flow'), 'Closed rename', '2026-03-01 00:00-03', '2027-01-31 23:59:59-03', 'req-tr-bad')$$,
  '55000', 'campaign name cannot be changed once the campaign is closed', 'update: closed campaign name is frozen'
);

-- Annul: requires campaign.close and a reason.
select pg_temp.act_as(6);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-annul-draft'), 'annulled', null, 'req-tr-bad')$$,
  '22023', 'a reason is required to annul a campaign', 'annul: missing reason is rejected'
);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-annul-draft'), 'annulled', '   ', 'req-tr-bad')$$,
  '22023', 'a reason is required to annul a campaign', 'annul: blank reason is rejected'
);
select pg_temp.act_as(2);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-annul-draft'), 'annulled', 'Mistake', 'req-tr-bad')$$,
  '42501', 'permission denied: campaign.close is required', 'annul: operator is denied (checked before the reason)'
);
select pg_temp.act_as(5);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-annul-draft'), 'annulled', 'Mistake', 'req-tr-bad')$$,
  '42501', 'permission denied: campaign.close is required', 'annul: editor is denied'
);
select pg_temp.act_as(6);
select lives_ok(
  $$select public.campaign_transition((select id from ids where k = 't-annul-draft'), 'annulled', '  Created by mistake  ', 'req-tr-annul-draft')$$,
  'annul: closer annuls a draft with a reason'
);
select pg_temp.act_as(1);
select lives_ok(
  $$select public.campaign_transition((select id from ids where k = 't-annul-active'), 'active', null, 'req-tr-activate-2')$$,
  'transition: admin activates a second campaign (several active campaigns are allowed)'
);
select lives_ok(
  $$select public.campaign_transition((select id from ids where k = 't-annul-active'), 'annulled', 'Cancelled by the board', 'req-tr-annul-active')$$,
  'annul: admin annuls an active campaign with a reason'
);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 't-annul-active'), 'active', null, 'req-tr-bad')$$,
  '23514', 'invalid campaign status transition: annulled -> active', 'transition: annulled -> active is rejected'
);
reset role;

select results_eq(
  $$select c.status from public.campaigns c join ids on ids.id = c.id
    where ids.k in ('t-nodates', 't-flow', 't-annul-draft', 't-annul-active') order by ids.k$$,
  $$values ('annulled'::text), ('annulled'::text), ('closed'::text), ('draft'::text)$$,
  'transition: campaigns end in the expected statuses'
);
select results_eq(
  $$select a.request_id, a.actor_user_id, a.action, a.old_value, a.new_value, a.reason
    from public.audit_log a where a.request_id like 'req-tr-%' and a.action = 'campaign.transition'
    order by a.request_id$$,
  $$values
    ('req-tr-activate', 'b6000000-0000-0000-0000-000000000001'::uuid, 'campaign.transition'::text,
      '{"status": "draft"}'::jsonb, '{"status": "active"}'::jsonb, null::text),
    ('req-tr-activate-2', 'b6000000-0000-0000-0000-000000000001'::uuid, 'campaign.transition'::text,
      '{"status": "draft"}'::jsonb, '{"status": "active"}'::jsonb, null::text),
    ('req-tr-annul-active', 'b6000000-0000-0000-0000-000000000001'::uuid, 'campaign.transition'::text,
      '{"status": "active"}'::jsonb, '{"status": "annulled"}'::jsonb, 'Cancelled by the board'::text),
    ('req-tr-annul-draft', 'b6000000-0000-0000-0000-000000000006'::uuid, 'campaign.transition'::text,
      '{"status": "draft"}'::jsonb, '{"status": "annulled"}'::jsonb, 'Created by mistake'::text),
    ('req-tr-closed', 'b6000000-0000-0000-0000-000000000006'::uuid, 'campaign.transition'::text,
      '{"status": "closing"}'::jsonb, '{"status": "closed"}'::jsonb, 'Season over'::text),
    ('req-tr-closing', 'b6000000-0000-0000-0000-000000000006'::uuid, 'campaign.transition'::text,
      '{"status": "active"}'::jsonb, '{"status": "closing"}'::jsonb, null::text)$$,
  'transition: one audit row per successful transition with actor, statuses and (trimmed) reason'
);
select is(
  (select count(*)::int from public.audit_log where request_id in ('req-tr-bad', 'req-tr-noop')),
  0, 'transition: rejected calls and no-ops write no audit row'
);
select is(
  (select count(*)::int from public.audit_log where request_id in ('req-tr-edit-active', 'req-tr-edit-closing')
     and action = 'campaign.update'),
  2, 'update: edits of active/closing campaigns are audited'
);

-- ---------------------------------------------------------------------------
-- Atomicity: if the audit insert fails, the campaign change rolls back too.
-- ---------------------------------------------------------------------------
create function pg_temp.reject_campaign_audit() returns trigger language plpgsql as $$
begin
  if new.action like 'campaign.%' then
    raise exception 'audit rejected' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger reject_campaign_audit before insert on public.audit_log
  for each row execute function pg_temp.reject_campaign_audit();

set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$select public.campaign_create('Audit fails', 60000, 10, 4, 9999, 4871, 'reject', 'base_number', null, null, 'req-atomic')$$,
  'P0001', 'audit rejected', 'atomicity: audit failure aborts create'
);
select throws_ok(
  $$select public.campaign_update((select id from ids where k = 'c-5d'), 'Audit fails rename', '2026-03-01', '2026-12-31', 'req-atomic')$$,
  'P0001', 'audit rejected', 'atomicity: audit failure aborts update'
);
select throws_ok(
  $$select public.campaign_update_rules((select id from ids where k = 'c-5d'), 90000, 9, 5, 99999, 4871, 'reject', 'internal_code', 'req-atomic')$$,
  'P0001', 'audit rejected', 'atomicity: audit failure aborts update_rules'
);
select throws_ok(
  $$select public.campaign_transition((select id from ids where k = 'c-5d'), 'active', null, 'req-atomic')$$,
  'P0001', 'audit rejected', 'atomicity: audit failure aborts transition'
);
reset role;
drop trigger reject_campaign_audit on public.audit_log;

select is(
  (select count(*)::int from public.campaigns where name = 'Audit fails'),
  0, 'atomicity: no campaign left behind by a failed create'
);
select results_eq(
  $$select name, installment_count, installment_value, status
    from public.campaigns c join ids on ids.id = c.id and ids.k = 'c-5d'$$,
  $$values ('Five digits'::text, 12, 7500.00::numeric, 'draft'::text)$$,
  'atomicity: failed update / update_rules / transition left the campaign unchanged'
);

-- ---------------------------------------------------------------------------
-- Direct writes are still impossible for end users (writes only through the functions)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$update public.campaigns set name = 'Direct' where id = (select id from ids where k = 'c-5d')$$,
  '42501', null, 'admin still cannot update campaigns directly'
);
select throws_ok(
  $$insert into public.audit_log (actor_user_id, action, entity_type) values (null, 'campaign.create', 'campaign')$$,
  '42501', null, 'end users cannot forge a campaign audit row without an actor'
);
reset role;

select * from finish();
rollback;
