begin;
select plan(129);

-- ---------------------------------------------------------------------------
-- Fixtures (created as the test owner)
-- ---------------------------------------------------------------------------
-- auth ids / profiles:
--   ...01 admin           (bond.create, bond.annul, campaign.update_rules, ...)
--   ...02 operator        (bond.view, bond.create)
--   ...03 treasurer       (bond.view)
--   ...04 read-only       (bond.view)
--   ...05 collector       (nothing)
--   ...06 no roles
--   ...07 inactive admin
insert into auth.users (id, email)
select ('a9000000-0000-0000-0000-00000000000' || n)::uuid, 'bond-rpcs-' || n || '@example.com'
from generate_series(1, 7) as n;

insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b9000000-0000-0000-0000-00000000000' || n)::uuid,
  ('a9000000-0000-0000-0000-00000000000' || n)::uuid,
  'Bond RPCs user ' || n, 'bond-rpcs-' || n || '@example.com',
  case when n = 7 then 'inactive' else 'active' end
from generate_series(1, 7) as n;

insert into public.user_roles (user_id, role_id)
select v.profile_id::uuid, r.id
from (values
  ('b9000000-0000-0000-0000-000000000001', 'admin'),
  ('b9000000-0000-0000-0000-000000000002', 'operator'),
  ('b9000000-0000-0000-0000-000000000003', 'treasurer'),
  ('b9000000-0000-0000-0000-000000000004', 'read-only'),
  ('b9000000-0000-0000-0000-000000000005', 'collector'),
  ('b9000000-0000-0000-0000-000000000007', 'admin')
) as v (profile_id, role_name)
join public.roles r on r.name = v.role_name;

create function pg_temp.act_as(p_n int) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    format('{"sub":"a9000000-0000-0000-0000-00000000000%s","role":"authenticated"}', p_n),
    true
  );
$$;
grant execute on function pg_temp.act_as(int) to authenticated, anon;

create temporary table ids (k text primary key, id uuid not null);
grant select, insert on ids to authenticated, anon, service_role;

create function pg_temp.id(p_k text) returns uuid language sql stable as $$
  select id from ids where k = p_k;
$$;
grant execute on function pg_temp.id(text) to authenticated, anon, service_role;

-- Runs a statement and returns the DETAIL of the error it raises (null if it succeeds).
create function pg_temp.err_detail(p_sql text) returns text language plpgsql as $$
declare
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;
grant execute on function pg_temp.err_detail(text) to authenticated;

-- Campaigns (as the owner).
--   c4        draft,    4 digits, max 9999,  offset 4871, 60000 in 10
--   c4a       active,   same rules
--   c5        draft,    5 digits, max 99999, offset 4871, 90000 in 12
--   c0        draft,    offset 0 (every number is its own associated number)
--   c-closing / c-closed / c-annulled: no new bonds
--   c-tail    active, moved to closing after it has bonds (annul window)
with c as (
  insert into public.campaigns
    (name, simple_bond_value, installment_count, installment_value, number_digits, max_number,
     associated_number_offset, overflow_policy, barcode_mode, starts_at, ends_at)
  select v.name, v.value, v.installments, v.value / v.installments, v.digits, v.max, v.off,
    'reject', 'base_number', '2026-03-01 00:00-03', '2026-12-31 23:59:59-03'
  from (values
    ('c4', 60000, 10, 4, 9999, 4871),
    ('c4a', 60000, 10, 4, 9999, 4871),
    ('c5', 90000, 12, 5, 99999, 4871),
    ('c0', 60000, 10, 4, 9999, 0),
    ('c-closing', 60000, 10, 4, 9999, 4871),
    ('c-closed', 60000, 10, 4, 9999, 4871),
    ('c-annulled', 60000, 10, 4, 9999, 4871),
    ('c-tail', 60000, 10, 4, 9999, 4871)
  ) as v (name, value, installments, digits, max, off)
  returning id, name
)
insert into ids select c.name, c.id from c;
update public.campaigns set status = 'active'
where id in (select id from ids where k in ('c4a', 'c-closing', 'c-closed', 'c-tail'));
update public.campaigns set status = 'closing'
where id in (select id from ids where k in ('c-closing', 'c-closed'));
update public.campaigns set status = 'closed' where id = pg_temp.id('c-closed');
update public.campaigns set status = 'annulled' where id = pg_temp.id('c-annulled');

-- ---------------------------------------------------------------------------
-- Definitions and privileges
-- ---------------------------------------------------------------------------
select has_function('public', 'bond_create', array['uuid', 'integer[]', 'text', 'text', 'text', 'text'], 'bond_create exists');
select has_function('public', 'bond_group_into_pata', array['uuid', 'uuid[]', 'text', 'text', 'text', 'text'], 'bond_group_into_pata exists');
select has_function('public', 'bond_ungroup_pata', array['uuid', 'text', 'text'], 'bond_ungroup_pata exists');
select has_function('public', 'bond_annul', array['uuid', 'text', 'text'], 'bond_annul exists');
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('bond_create', 'bond_group_into_pata', 'bond_ungroup_pata', 'bond_annul')),
  'the bond write functions are SECURITY DEFINER with an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.bond_create(uuid, integer[], text, text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.bond_group_into_pata(uuid, uuid[], text, text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.bond_ungroup_pata(uuid, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.bond_annul(uuid, text, text)', 'execute'),
  'authenticated can execute the bond write functions'
);
select ok(
  not has_function_privilege('anon', 'public.bond_create(uuid, integer[], text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.bond_group_into_pata(uuid, uuid[], text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.bond_ungroup_pata(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.bond_annul(uuid, text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.bond_create(uuid, integer[], text, text, text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.bond_group_into_pata(uuid, uuid[], text, text, text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.bond_ungroup_pata(uuid, text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.bond_annul(uuid, text, text)', 'execute'),
  'anon and service_role cannot execute the bond write functions'
);
select ok(
  not exists (
    select 1 from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('bond_create', 'bond_group_into_pata', 'bond_ungroup_pata', 'bond_annul',
        'bond_require_actor', 'bond_format_number', 'bond_label', 'bond_lock_campaign',
        'bond_validate_base_numbers', 'bond_raise_duplicate', 'bond_audit_snapshot')
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no EXECUTE on the bond functions'
);
select ok(
  not exists (
    select 1 from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('bond_require_actor', 'bond_format_number', 'bond_label', 'bond_lock_campaign',
        'bond_validate_base_numbers', 'bond_raise_duplicate', 'bond_audit_snapshot')
      and has_function_privilege(r, p.oid, 'execute')
  ),
  'internal bond helpers are not executable by API roles'
);
select ok(
  (select prosrc ~* 'for share' from pg_proc where oid = 'public.bond_lock_campaign(uuid)'::regprocedure),
  'bond writes lock the campaign FOR SHARE (serialized against rule changes and transitions)'
);
select ok(
  (select bool_and(prosrc ~* 'bond_lock_campaign') from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('bond_create', 'bond_group_into_pata', 'bond_ungroup_pata', 'bond_annul')),
  'every bond write function locks its campaign first'
);

set local role anon;
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[1])$$,
  '42501', null, 'anon cannot call bond_create'
);
reset role;

-- ---------------------------------------------------------------------------
-- bond_create: simple bonds and printed patas
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(1);
select lives_ok(
  $$insert into ids select 'b-68', public.bond_create(pg_temp.id('c4'), array[68], '  INT-1 ', 'BC-1', 'req-create-1', 'First load')$$,
  'admin creates a simple bond in a draft campaign'
);
reset role;

select results_eq(
  $$select kind, origin, commercial_unit_count, total_value, commercial_status, internal_code, barcode,
      created_by, financial_status_snapshot
    from public.bonds where id = pg_temp.id('b-68')$$,
  $$values ('simple'::text, 'printed'::text, 1, 60000.00::numeric, 'available'::text, 'INT-1'::text,
      'BC-1'::text, 'b9000000-0000-0000-0000-000000000001'::uuid, 'no_payments'::text)$$,
  'create: simple bond, printed, 1 unit, total = simple bond value, available, trimmed codes, created_by = actor'
);
select results_eq(
  $$select n.number_value, n.number_kind, s.number_value
    from public.bond_numbers n left join public.bond_numbers s on s.id = n.source_base_number_id
    where n.bond_id = pg_temp.id('b-68') order by n.number_value$$,
  $$values (68, 'base'::text, null::int), (4939, 'associated'::text, 68)$$,
  'create: base 0068 and associated 4939 (68 + 4871) linked to its base'
);
select results_eq(
  $$select a.actor_user_id, a.action, a.entity_type, a.old_value is null, a.new_value ->> 'kind',
      (a.new_value ->> 'total_value')::numeric, a.new_value -> 'numbers', a.reason, a.request_id
    from public.audit_log a where a.entity_id = pg_temp.id('b-68')::text$$,
  $$values ('b9000000-0000-0000-0000-000000000001'::uuid, 'bond.create'::text, 'bond'::text, true,
      'simple'::text, 60000::numeric,
      '[{"number_value": 68, "number_kind": "base"}, {"number_value": 4939, "number_kind": "associated"}]'::jsonb,
      'First load'::text, 'req-create-1'::text)$$,
  'create: exactly one bond.create audit row with actor, snapshot (numbers), reason and request id'
);

set local role authenticated;
select pg_temp.act_as(2);
select lives_ok(
  $$insert into ids select 'p-100', public.bond_create(pg_temp.id('c4a'), array[300, 100, 200], null, null, 'req-pata')$$,
  'operator creates a printed pata of 3 in an active campaign'
);
reset role;
select results_eq(
  $$select kind, origin, commercial_unit_count, total_value, commercial_status
    from public.bonds where id = pg_temp.id('p-100')$$,
  $$values ('pata'::text, 'printed'::text, 3, 180000.00::numeric, 'available'::text)$$,
  'create: printed pata of 3, total = 60000 * 3 computed in SQL'
);
select results_eq(
  $$select n.number_value, n.number_kind, s.number_value
    from public.bond_numbers n left join public.bond_numbers s on s.id = n.source_base_number_id
    where n.bond_id = pg_temp.id('p-100') order by n.number_value$$,
  $$values (100, 'base'::text, null::int), (200, 'base', null), (300, 'base', null),
      (4971, 'associated', 100), (5071, 'associated', 200), (5171, 'associated', 300)$$,
  'create: a printed pata owns its N base and N associated numbers'
);

-- 5-digit campaign
set local role authenticated;
select pg_temp.act_as(2);
select lives_ok(
  $$insert into ids select 'b5-68', public.bond_create(pg_temp.id('c5'), array[68])$$,
  '5 digits: simple bond 00068'
);
select lives_ok(
  $$insert into ids select 'b5-max', public.bond_create(pg_temp.id('c5'), array[95128])$$,
  '5 digits: highest base 95128 (associated 99999) is accepted'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c5'), array[95129], null, null, 'req-bad')$$,
  '22023', 'base number 95129 overflows: its associated number 100000 exceeds the campaign maximum number 99999',
  '5 digits: base 95129 overflows'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c5'), array[68], null, null, 'req-bad')$$,
  '23505', format('number 00068 is already used by bond %s', pg_temp.id('b5-68')),
  '5 digits: duplicate number formatted with 5 digits, naming the bond'
);
reset role;
select results_eq(
  $$select total_value, (select array_agg(number_value order by number_value) from public.bond_numbers where bond_id = b.id)
    from public.bonds b where id in (pg_temp.id('b5-68'), pg_temp.id('b5-max'))
    order by (select min(number_value) from public.bond_numbers where bond_id = b.id)$$,
  $$values (90000.00::numeric, array[68, 4939]), (90000.00::numeric, array[95128, 99999])$$,
  '5 digits: values from the 5-digit campaign rules (90000, offset 4871)'
);

-- Range, overflow and intra-bond collisions (4 digits)
set local role authenticated;
select pg_temp.act_as(2);
select lives_ok(
  $$insert into ids select 'b-5128', public.bond_create(pg_temp.id('c4'), array[5128])$$,
  '4 digits: highest base 5128 (associated 9999) is accepted'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[5129], null, null, 'req-bad')$$,
  '22023', 'base number 5129 overflows: its associated number 10000 exceeds the campaign maximum number 9999',
  '4 digits: base 5129 overflows'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[10000], null, null, 'req-bad')$$,
  '22023', 'number 10000 exceeds the campaign maximum number 9999',
  'a base number above max_number is rejected'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[-1], null, null, 'req-bad')$$,
  '22023', 'base number -1 is negative', 'a negative base number is rejected'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[]::int[], null, null, 'req-bad')$$,
  '22023', 'at least one base number is required', 'no base numbers is rejected'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), null, null, null, 'req-bad')$$,
  '22023', 'at least one base number is required', 'null base numbers is rejected'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[7, null], null, null, 'req-bad')$$,
  '22023', 'base numbers cannot be empty', 'a null base number is rejected'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[5, 5], null, null, 'req-bad')$$,
  '22023', 'number 0005 appears more than once in this bond (2 as base, 0 as associated)',
  'intra-bond: the same base twice is rejected'
);
set local role authenticated;
select pg_temp.act_as(2);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[10, 4881], null, null, 'req-bad')$$,
  '22023', 'number 4881 appears more than once in this bond (1 as base, 1 as associated)',
  'intra-bond: a base equal to another base''s associated number is rejected'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c0'), array[7], null, null, 'req-bad')$$,
  '22023', 'number 0007 appears more than once in this bond (1 as base, 1 as associated)',
  'intra-bond: with offset 0 a base equals its own associated number'
);
reset role;

-- Campaign-wide duplicates (base or associated, against any live bond of the campaign)
set local role authenticated;
select pg_temp.act_as(2);
select lives_ok(
  $$insert into ids select 'b-5000', public.bond_create(pg_temp.id('c4'), array[5000])$$,
  'simple bond 5000 (associated 9871)'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[68], null, null, 'req-bad')$$,
  '23505', format('number 0068 is already used by bond %s', pg_temp.id('b-68')),
  'duplicate: the same base number is rejected, naming the number and the bond'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[4939], null, null, 'req-bad')$$,
  '23505', format('number 4939 is already used by bond %s', pg_temp.id('b-68')),
  'duplicate: a base equal to another bond''s associated number is rejected'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[129], null, null, 'req-bad')$$,
  '23505', format('number 5000 is already used by bond %s', pg_temp.id('b-5000')),
  'duplicate: an associated number equal to another bond''s base number is rejected'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[1, 2, 5000], null, null, 'req-bad')$$,
  '23505', format('number 5000 is already used by bond %s', pg_temp.id('b-5000')),
  'duplicate: a printed pata with one used number is rejected as a whole'
);
select is(
  pg_temp.err_detail($$select public.bond_create(pg_temp.id('c4'), array[68, 5000], null, null, 'req-bad')$$)::jsonb,
  jsonb_build_object('conflicts', jsonb_build_array(
    jsonb_build_object('number', 68, 'formatted', '0068', 'bond_id', pg_temp.id('b-68'), 'number_kind', 'base'),
    jsonb_build_object('number', 4939, 'formatted', '4939', 'bond_id', pg_temp.id('b-68'), 'number_kind', 'associated'),
    jsonb_build_object('number', 5000, 'formatted', '5000', 'bond_id', pg_temp.id('b-5000'), 'number_kind', 'base'),
    jsonb_build_object('number', 9871, 'formatted', '9871', 'bond_id', pg_temp.id('b-5000'), 'number_kind', 'associated')
  )),
  'duplicate: DETAIL lists every conflicting number with its bond (JSON)'
);
select lives_ok(
  $$insert into ids select 'b4a-68', public.bond_create(pg_temp.id('c4a'), array[68], 'INT-1', 'BC-1')$$,
  'the same number and codes are free in another campaign'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[1], 'INT-1', null, 'req-bad')$$,
  '23505', format('internal code INT-1 is already used by bond %s', pg_temp.id('b-68')),
  'duplicate internal code in the campaign is rejected, naming the bond'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[1], null, ' BC-1 ', 'req-bad')$$,
  '23505', format('barcode BC-1 is already used by bond %s', pg_temp.id('b-68')),
  'duplicate barcode (after trimming) in the campaign is rejected, naming the bond'
);
reset role;
select is(
  (select count(*)::int from public.bond_numbers where campaign_id = pg_temp.id('c4') and number_value in (1, 2, 129, 3)),
  0, 'duplicate: rejected creations leave no numbers behind'
);

-- Campaign status windows and missing campaign
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c-closing'), array[1], null, null, 'req-bad')$$,
  '55000', 'bonds can only be changed while the campaign is draft or active (status: closing)',
  'create: closing campaign is rejected'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c-closed'), array[1], null, null, 'req-bad')$$,
  '55000', 'bonds can only be changed while the campaign is draft or active (status: closed)',
  'create: closed campaign is rejected'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c-annulled'), array[1], null, null, 'req-bad')$$,
  '55000', 'bonds can only be changed while the campaign is draft or active (status: annulled)',
  'create: annulled campaign is rejected'
);
select throws_ok(
  $$select public.bond_create('00000000-0000-0000-0000-000000000000', array[1], null, null, 'req-bad')$$,
  'P0002', 'campaign 00000000-0000-0000-0000-000000000000 not found',
  'create: unknown campaign is rejected'
);

-- Permissions
select pg_temp.act_as(3);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[1], null, null, 'req-denied')$$,
  '42501', 'permission denied: bond.create is required', 'create: treasurer is denied'
);
select pg_temp.act_as(4);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[1], null, null, 'req-denied')$$,
  '42501', 'permission denied: bond.create is required', 'create: read-only is denied'
);
select pg_temp.act_as(5);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[1], null, null, 'req-denied')$$,
  '42501', 'permission denied: bond.create is required', 'create: collector is denied'
);
select pg_temp.act_as(6);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[1], null, null, 'req-denied')$$,
  '42501', 'permission denied: bond.create is required', 'create: user without roles is denied'
);
select pg_temp.act_as(7);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[1], null, null, 'req-denied')$$,
  '42501', 'an active profile is required to change bonds', 'create: inactive admin is rejected'
);
select set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-0000000000ff","role":"authenticated"}', true);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c4'), array[1], null, null, 'req-denied')$$,
  '42501', 'an active profile is required to change bonds', 'create: auth user without profile is rejected'
);
reset role;

select is(
  (select count(*)::int from public.bonds
   where campaign_id in (pg_temp.id('c-closing'), pg_temp.id('c-closed'), pg_temp.id('c-annulled'), pg_temp.id('c0'))),
  0, 'create: rejected calls leave no bond behind'
);
select is(
  (select count(*)::int from public.bonds where campaign_id = pg_temp.id('c4')),
  3, 'create: only the 3 successful bonds exist in c4 (0068, 5128, 5000)'
);

-- Rule freeze: the draft campaign now has bonds, so its rules cannot change
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$select public.campaign_update_rules(pg_temp.id('c4'), 70000, 10, 4, 9999, 4871, 'reject', 'base_number',
      (select updated_at from public.campaigns where id = pg_temp.id('c4')), 'req-bad')$$,
  '55000', 'campaign rules cannot be changed once the campaign has bonds',
  'freeze: a draft campaign with bonds rejects rule changes'
);
reset role;

-- ---------------------------------------------------------------------------
-- bond_group_into_pata
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(2);
select lives_ok($$insert into ids select 's1', public.bond_create(pg_temp.id('c4'), array[1000])$$, 'simple 1000');
select lives_ok($$insert into ids select 's2', public.bond_create(pg_temp.id('c4'), array[1001])$$, 'simple 1001');
select lives_ok($$insert into ids select 's3', public.bond_create(pg_temp.id('c4'), array[1002])$$, 'simple 1002');
select lives_ok($$insert into ids select 's4', public.bond_create(pg_temp.id('c4'), array[1003])$$, 'simple 1003');
select lives_ok($$insert into ids select 's5', public.bond_create(pg_temp.id('c4'), array[1004])$$, 'simple 1004');
select lives_ok($$insert into ids select 'pp', public.bond_create(pg_temp.id('c4'), array[2000, 2001])$$, 'printed pata 2000/2001');
select lives_ok(
  $$insert into ids select 'p1', public.bond_group_into_pata(pg_temp.id('c4'), array[pg_temp.id('s2'), pg_temp.id('s1')], ' PATA-1 ', null, 'req-group', 'Sold together')$$,
  'operator groups two available simple bonds into a manual pata'
);
reset role;

select results_eq(
  $$select kind, origin, commercial_unit_count, total_value, commercial_status, internal_code, created_by
    from public.bonds where id = pg_temp.id('p1')$$,
  $$values ('pata'::text, 'manual_grouping'::text, 2, 120000.00::numeric, 'available'::text, 'PATA-1'::text,
      'b9000000-0000-0000-0000-000000000002'::uuid)$$,
  'group: manual pata of 2, total = 60000 * 2, available, created_by = actor'
);
select is(
  (select count(*)::int from public.bond_numbers where bond_id = pg_temp.id('p1')),
  0, 'group: the manual pata owns no numbers'
);
select results_eq(
  $$select member_bond_id, grouped_by, ungrouped_at is null from public.bond_groups
    where pata_bond_id = pg_temp.id('p1') order by member_bond_id$$,
  $$select id, 'b9000000-0000-0000-0000-000000000002'::uuid, true from ids where k in ('s1', 's2') order by id$$,
  'group: one active bond_groups row per member, grouped_by = actor'
);
select results_eq(
  $$select commercial_status, (select count(*)::int from public.bond_numbers n where n.bond_id = b.id and n.released_at is null)
    from public.bonds b where id in (pg_temp.id('s1'), pg_temp.id('s2'))$$,
  $$values ('available'::text, 2), ('available'::text, 2)$$,
  'group: members keep their status and their numbers'
);
select results_eq(
  $$select a.action, a.entity_type, a.new_value ->> 'origin', a.new_value -> 'members', a.reason, a.request_id
    from public.audit_log a where a.entity_id = pg_temp.id('p1')::text$$,
  $$values ('bond.group'::text, 'bond'::text, 'manual_grouping'::text,
      (select jsonb_agg(id order by id) from ids where k in ('s1', 's2')), 'Sold together'::text, 'req-group'::text)$$,
  'group: exactly one bond.group audit row with the members (sorted by id)'
);

set local role authenticated;
select pg_temp.act_as(2);
select throws_ok(
  $$select public.bond_group_into_pata(pg_temp.id('c4'), array[pg_temp.id('s3'), pg_temp.id('s1')], null, null, 'req-bad')$$,
  '55000', format('bond 1000 (%s) already belongs to manually grouped pata %s', pg_temp.id('s1'), pg_temp.id('p1')),
  'group: a member of an active group is rejected, naming its number and the pata'
);
select throws_ok(
  $$select public.bond_group_into_pata(pg_temp.id('c4'), array[pg_temp.id('s3')], null, null, 'req-bad')$$,
  '22023', 'a pata needs at least 2 simple bonds', 'group: a single member is rejected'
);
select throws_ok(
  $$select public.bond_group_into_pata(pg_temp.id('c4'), null, null, null, 'req-bad')$$,
  '22023', 'a pata needs at least 2 simple bonds', 'group: no members is rejected'
);
select throws_ok(
  $$select public.bond_group_into_pata(pg_temp.id('c4'), array[pg_temp.id('s3'), pg_temp.id('s3')], null, null, 'req-bad')$$,
  '22023', format('bond %s is listed more than once', pg_temp.id('s3')), 'group: a repeated member is rejected'
);
select throws_ok(
  $$select public.bond_group_into_pata(pg_temp.id('c4'), array[pg_temp.id('s3'), null], null, null, 'req-bad')$$,
  '22023', 'member bond ids cannot be empty', 'group: a null member is rejected'
);
select throws_ok(
  $$select public.bond_group_into_pata(pg_temp.id('c4'), array[pg_temp.id('s3'), pg_temp.id('b4a-68')], null, null, 'req-bad')$$,
  '22023', format('bond %s belongs to another campaign', pg_temp.id('b4a-68')),
  'group: a member of another campaign is rejected'
);
select throws_ok(
  $$select public.bond_group_into_pata(pg_temp.id('c4a'), array[pg_temp.id('s3'), pg_temp.id('s4')], null, null, 'req-bad')$$,
  '22023', format('bond %s belongs to another campaign', pg_temp.id('s3')),
  'group: members must belong to the given campaign'
);
select throws_ok(
  $$select public.bond_group_into_pata(pg_temp.id('c4'), array[pg_temp.id('s3'), pg_temp.id('pp')], null, null, 'req-bad')$$,
  '22023', format('only simple bonds can be grouped into a pata (bond 2000 (%s) is a pata)', pg_temp.id('pp')),
  'group: a printed pata cannot be a member'
);
select throws_ok(
  $$select public.bond_group_into_pata(pg_temp.id('c4'), array[pg_temp.id('s3'), pg_temp.id('p1')], null, null, 'req-bad')$$,
  '22023', format('only simple bonds can be grouped into a pata (bond %s is a pata)', pg_temp.id('p1')),
  'group: a manual pata cannot be a member'
);
select throws_ok(
  $$select public.bond_group_into_pata(pg_temp.id('c4'), array[pg_temp.id('s3'), '00000000-0000-0000-0000-000000000000'], null, null, 'req-bad')$$,
  'P0002', 'bond 00000000-0000-0000-0000-000000000000 not found', 'group: an unknown member is rejected'
);
select throws_ok(
  $$select public.bond_group_into_pata(pg_temp.id('c4'), array[pg_temp.id('s3'), pg_temp.id('s4')], 'PATA-1', null, 'req-bad')$$,
  '23505', format('internal code PATA-1 is already used by bond %s', pg_temp.id('p1')),
  'group: a duplicate pata code is rejected, naming the bond'
);
select throws_ok(
  $$select public.bond_group_into_pata(pg_temp.id('c-closing'), array[pg_temp.id('s3'), pg_temp.id('s4')], null, null, 'req-bad')$$,
  '55000', 'bonds can only be changed while the campaign is draft or active (status: closing)',
  'group: a closing campaign is rejected'
);
select pg_temp.act_as(3);
select throws_ok(
  $$select public.bond_group_into_pata(pg_temp.id('c4'), array[pg_temp.id('s3'), pg_temp.id('s4')], null, null, 'req-denied')$$,
  '42501', 'permission denied: bond.create is required', 'group: treasurer is denied'
);
reset role;

-- A member that is not available (as the owner: Phase 5 operations do not exist yet)
update public.bonds set commercial_status = 'delivered_to_collector' where id = pg_temp.id('s5');
set local role authenticated;
select pg_temp.act_as(2);
select throws_ok(
  $$select public.bond_group_into_pata(pg_temp.id('c4'), array[pg_temp.id('s3'), pg_temp.id('s5')], null, null, 'req-bad')$$,
  '55000', format('only available bonds can be grouped (bond 1004 (%s) is delivered_to_collector)', pg_temp.id('s5')),
  'group: a member that is not available is rejected'
);
reset role;
select is(
  (select count(*)::int from public.bond_groups where member_bond_id in (pg_temp.id('s3'), pg_temp.id('s4'), pg_temp.id('s5'))),
  0, 'group: rejected calls leave no membership behind'
);
select is(
  (select count(*)::int from public.bonds where campaign_id = pg_temp.id('c4') and origin = 'manual_grouping'),
  1, 'group: rejected calls leave no pata behind'
);

-- Grouped members are blocked from individual operations
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$select public.bond_annul(pg_temp.id('s1'), 'Mistake', 'req-bad')$$,
  '55000', format('bond 1000 (%s) belongs to manually grouped pata %s', pg_temp.id('s1'), pg_temp.id('p1')),
  'annul: an active member of a manual pata cannot be annulled'
);
select throws_ok(
  $$select public.bond_annul(pg_temp.id('p1'), 'Mistake', 'req-bad')$$,
  '55000', 'a manually grouped pata cannot be annulled directly',
  'annul: a manual pata is ungrouped, not annulled'
);
reset role;

-- 5-digit manual pata
set local role authenticated;
select pg_temp.act_as(2);
select lives_ok(
  $$insert into ids select 'p5', public.bond_group_into_pata(pg_temp.id('c5'), array[pg_temp.id('b5-68'), pg_temp.id('b5-max')])$$,
  '5 digits: manual pata of two simple bonds'
);
reset role;
select is(
  (select total_value from public.bonds where id = pg_temp.id('p5')),
  180000.00::numeric, '5 digits: manual pata total = 90000 * 2'
);

-- ---------------------------------------------------------------------------
-- bond_ungroup_pata
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(2);
select throws_ok(
  $$select public.bond_ungroup_pata(pg_temp.id('p1'), '   ', 'req-bad')$$,
  '22023', 'a reason is required to ungroup a pata', 'ungroup: a blank reason is rejected'
);
select throws_ok(
  $$select public.bond_ungroup_pata(pg_temp.id('p1'), null, 'req-bad')$$,
  '22023', 'a reason is required to ungroup a pata', 'ungroup: a missing reason is rejected'
);
select throws_ok(
  $$select public.bond_ungroup_pata(pg_temp.id('s3'), 'Mistake', 'req-bad')$$,
  '22023', format('bond %s is not a manually grouped pata', pg_temp.id('s3')),
  'ungroup: a simple bond is rejected'
);
select throws_ok(
  $$select public.bond_ungroup_pata(pg_temp.id('pp'), 'Mistake', 'req-bad')$$,
  '22023', format('bond %s is not a manually grouped pata', pg_temp.id('pp')),
  'ungroup: a printed pata is rejected'
);
select throws_ok(
  $$select public.bond_ungroup_pata('00000000-0000-0000-0000-000000000000', 'Mistake', 'req-bad')$$,
  'P0002', 'bond 00000000-0000-0000-0000-000000000000 not found', 'ungroup: an unknown bond is rejected'
);
select pg_temp.act_as(3);
select throws_ok(
  $$select public.bond_ungroup_pata(pg_temp.id('p1'), 'Mistake', 'req-denied')$$,
  '42501', 'permission denied: bond.create is required', 'ungroup: treasurer is denied'
);
select pg_temp.act_as(4);
select throws_ok(
  $$select public.bond_ungroup_pata(pg_temp.id('p1'), 'Mistake', 'req-denied')$$,
  '42501', 'permission denied: bond.create is required', 'ungroup: read-only is denied'
);

-- Success: operator ungroups p1
select pg_temp.act_as(2);
select lives_ok(
  $$select public.bond_ungroup_pata(pg_temp.id('p1'), '  Buyer wants them separately ', 'req-ungroup')$$,
  'operator ungroups an available manual pata'
);
reset role;
select results_eq(
  $$select count(*)::int, bool_and(ungrouped_at is not null), bool_and(ungrouped_by = 'b9000000-0000-0000-0000-000000000002'),
      bool_and(reason = 'Buyer wants them separately')
    from public.bond_groups where pata_bond_id = pg_temp.id('p1')$$,
  $$values (2, true, true, true)$$,
  'ungroup: membership rows are kept and marked ungrouped (by, reason)'
);
select results_eq(
  $$select commercial_status, annulled_by, annul_reason, annulled_at is not null, annulled_from_status
    from public.bonds where id = pg_temp.id('p1')$$,
  $$values ('annulled'::text, 'b9000000-0000-0000-0000-000000000002'::uuid, 'Buyer wants them separately'::text, true,
      'available'::text)$$,
  'ungroup: the manual pata is annulled with the same reason'
);
select results_eq(
  $$select a.action, a.old_value, a.new_value, a.reason, a.request_id
    from public.audit_log a where a.entity_id = pg_temp.id('p1')::text and a.action = 'bond.ungroup'$$,
  $$values ('bond.ungroup'::text,
      jsonb_build_object('commercial_status', 'available', 'members', (select jsonb_agg(id order by id) from ids where k in ('s1', 's2'))),
      jsonb_build_object('commercial_status', 'annulled', 'members', '[]'::jsonb,
        'ungrouped_members', (select jsonb_agg(id order by id) from ids where k in ('s1', 's2'))),
      'Buyer wants them separately'::text, 'req-ungroup'::text)$$,
  'ungroup: exactly one bond.ungroup audit row describing the members'
);
select is(
  (select count(*)::int from public.audit_log where entity_id = pg_temp.id('p1')::text),
  2, 'ungroup: the pata has only its group and ungroup audit rows'
);

set local role authenticated;
select pg_temp.act_as(2);
select throws_ok(
  $$select public.bond_ungroup_pata(pg_temp.id('p1'), 'Again', 'req-bad')$$,
  '55000', format('only an available pata can be ungrouped (pata %s is annulled)', pg_temp.id('p1')),
  'ungroup: an already ungrouped (annulled) pata is rejected'
);
select lives_ok(
  $$insert into ids select 'p2', public.bond_group_into_pata(pg_temp.id('c4'), array[pg_temp.id('s1'), pg_temp.id('s3')])$$,
  'ungroup: freed members can be grouped again'
);
reset role;

-- A pata that is no longer available cannot be ungrouped
update public.bonds set commercial_status = 'delivered_to_collector' where id = pg_temp.id('p2');
set local role authenticated;
select pg_temp.act_as(2);
select throws_ok(
  $$select public.bond_ungroup_pata(pg_temp.id('p2'), 'Mistake', 'req-bad')$$,
  '55000', format('only an available pata can be ungrouped (pata %s is delivered_to_collector)', pg_temp.id('p2')),
  'ungroup: a delivered pata is rejected'
);
reset role;
select is(
  (select count(*)::int from public.bond_groups where pata_bond_id = pg_temp.id('p2') and ungrouped_at is null),
  2, 'ungroup: rejected calls leave the memberships unchanged'
);

-- ---------------------------------------------------------------------------
-- bond_annul
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(2);
select throws_ok(
  $$select public.bond_annul(pg_temp.id('b-68'), 'Mistake', 'req-denied')$$,
  '42501', 'permission denied: bond.annul is required', 'annul: operator is denied (admin only)'
);
select pg_temp.act_as(3);
select throws_ok(
  $$select public.bond_annul(pg_temp.id('b-68'), 'Mistake', 'req-denied')$$,
  '42501', 'permission denied: bond.annul is required', 'annul: treasurer is denied'
);
select pg_temp.act_as(4);
select throws_ok(
  $$select public.bond_annul(pg_temp.id('b-68'), 'Mistake', 'req-denied')$$,
  '42501', 'permission denied: bond.annul is required', 'annul: read-only is denied'
);
select pg_temp.act_as(7);
select throws_ok(
  $$select public.bond_annul(pg_temp.id('b-68'), 'Mistake', 'req-denied')$$,
  '42501', 'an active profile is required to change bonds', 'annul: inactive admin is rejected'
);
select pg_temp.act_as(1);
select throws_ok(
  $$select public.bond_annul(pg_temp.id('b-68'), '  ', 'req-bad')$$,
  '22023', 'a reason is required to annul a bond', 'annul: a blank reason is rejected'
);
select throws_ok(
  $$select public.bond_annul('00000000-0000-0000-0000-000000000000', 'Mistake', 'req-bad')$$,
  'P0002', 'bond 00000000-0000-0000-0000-000000000000 not found', 'annul: an unknown bond is rejected'
);
select throws_ok(
  $$select public.bond_annul(pg_temp.id('s5'), 'Mistake', 'req-bad')$$,
  '55000', format('only available bonds can be annulled (bond 1004 (%s) is delivered_to_collector)', pg_temp.id('s5')),
  'annul: a delivered bond is rejected'
);
select lives_ok(
  $$select public.bond_annul(pg_temp.id('b-68'), ' Loaded by mistake ', 'req-annul')$$,
  'admin annuls an available simple bond'
);
reset role;
select results_eq(
  $$select commercial_status, annulled_by, annul_reason, annulled_at is not null, annulled_from_status
    from public.bonds where id = pg_temp.id('b-68')$$,
  $$values ('annulled'::text, 'b9000000-0000-0000-0000-000000000001'::uuid, 'Loaded by mistake'::text, true,
      'available'::text)$$,
  'annul: status, actor, trimmed reason and annulled-from status (available: numbers released) are recorded'
);
select results_eq(
  $$select number_value, released_at is not null, released_by from public.bond_numbers
    where bond_id = pg_temp.id('b-68') order by number_value$$,
  $$values (68, true, 'b9000000-0000-0000-0000-000000000001'::uuid), (4939, true, 'b9000000-0000-0000-0000-000000000001'::uuid)$$,
  'annul: the numbers are kept and released by the actor'
);
select results_eq(
  $$select a.actor_user_id, a.action, a.old_value, a.new_value, a.reason, a.request_id
    from public.audit_log a where a.entity_id = pg_temp.id('b-68')::text and a.action = 'bond.annul'$$,
  $$values ('b9000000-0000-0000-0000-000000000001'::uuid, 'bond.annul'::text,
      '{"commercial_status": "available", "numbers": [{"number_value": 68, "number_kind": "base"}, {"number_value": 4939, "number_kind": "associated"}]}'::jsonb,
      '{"commercial_status": "annulled", "numbers": [], "released_numbers": [{"number_value": 68, "number_kind": "base"}, {"number_value": 4939, "number_kind": "associated"}]}'::jsonb,
      'Loaded by mistake'::text, 'req-annul'::text)$$,
  'annul: exactly one bond.annul audit row with the released numbers'
);

set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$select public.bond_annul(pg_temp.id('b-68'), 'Again', 'req-bad')$$,
  '55000', format('bond %s is already annulled', pg_temp.id('b-68')),
  'annul: an annulled bond cannot be annulled again'
);
select pg_temp.act_as(2);
select lives_ok(
  $$insert into ids select 'b-68-again', public.bond_create(pg_temp.id('c4'), array[68], 'INT-1', 'BC-1', 'req-reentry')$$,
  're-entry: after annulment the same number and codes can be entered again'
);
reset role;
select is(
  (select count(*)::int from public.bond_numbers where campaign_id = pg_temp.id('c4') and number_value = 68),
  2, 're-entry: the released number stays as history next to the new one'
);

-- Printed pata annulment releases all 2N numbers
set local role authenticated;
select pg_temp.act_as(1);
select lives_ok(
  $$select public.bond_annul(pg_temp.id('pp'), 'Wrong pata', 'req-annul-pata')$$,
  'admin annuls an available printed pata'
);
reset role;
select is(
  (select count(*)::int from public.bond_numbers where bond_id = pg_temp.id('pp') and released_at is not null),
  4, 'annul: every number of the printed pata is released'
);
set local role authenticated;
select pg_temp.act_as(2);
select lives_ok(
  $$insert into ids select 'pp-again', public.bond_create(pg_temp.id('c4'), array[2001, 2000])$$,
  're-entry: the printed pata numbers can be entered again'
);

-- Ungrouped members can be annulled individually again (s2 was freed by the ungroup)
select pg_temp.act_as(1);
select lives_ok(
  $$select public.bond_annul(pg_temp.id('s2'), 'Mistake', 'req-annul-member')$$,
  'annul: a former member of an ungrouped pata can be annulled'
);

-- Campaign window for annul: a bond in a closing campaign
select pg_temp.act_as(2);
select lives_ok(
  $$insert into ids select 'b-tail', public.bond_create(pg_temp.id('c-tail'), array[42])$$,
  'bond in an active campaign'
);
reset role;
update public.campaigns set status = 'closing' where id = pg_temp.id('c-tail');
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$select public.bond_annul(pg_temp.id('b-tail'), 'Mistake', 'req-bad')$$,
  '55000', 'bonds can only be changed while the campaign is draft or active (status: closing)',
  'annul: rejected once the campaign is closing'
);
reset role;

-- ---------------------------------------------------------------------------
-- Rejected calls write nothing; direct writes stay impossible
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.audit_log where request_id in ('req-bad', 'req-denied')),
  0, 'every rejected call wrote no audit row'
);
select results_eq(
  $$select action, count(*)::int from public.audit_log
    where entity_type = 'bond' and actor_user_id::text like 'b9000000-%' group by action order by action$$,
  $$values ('bond.annul'::text, 3), ('bond.create'::text, 16), ('bond.group'::text, 3), ('bond.ungroup'::text, 1)$$,
  'one audit row per successful call'
);

set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$insert into public.bonds (campaign_id, kind, origin, total_value) values (pg_temp.id('c4'), 'simple', 'printed', 60000)$$,
  '42501', null, 'admin still cannot insert bonds directly'
);
select throws_ok(
  $$update public.bonds set commercial_status = 'annulled' where id = pg_temp.id('s3')$$,
  '42501', null, 'admin still cannot update bonds directly'
);
reset role;

select * from finish();
rollback;
