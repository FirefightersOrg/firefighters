begin;
select plan(108);

-- ---------------------------------------------------------------------------
-- Fixtures (created as the test owner, which bypasses RLS)
-- ---------------------------------------------------------------------------
-- auth ids: a1 admin, a2 treasurer, a3 operator, a4 no roles, a5 inactive admin, a6 spare (no profile)
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-00000000000' || n)::uuid, 'rls-user-' || n || '@example.com'
from generate_series(1, 6) as n;

insert into public.profiles (id, auth_user_id, full_name, email, status) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Admin', 'rls-user-1@example.com', 'active'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Treasurer', 'rls-user-2@example.com', 'active'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'Operator', 'rls-user-3@example.com', 'active'),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', 'No roles', 'rls-user-4@example.com', 'active'),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000005', 'Inactive admin', 'rls-user-5@example.com', 'inactive');

insert into public.user_roles (user_id, role_id)
select v.profile_id::uuid, r.id
from (values
  ('10000000-0000-0000-0000-000000000001', 'admin'),
  ('10000000-0000-0000-0000-000000000002', 'treasurer'),
  ('10000000-0000-0000-0000-000000000003', 'operator'),
  ('10000000-0000-0000-0000-000000000005', 'admin')
) as v (profile_id, role_name)
join public.roles r on r.name = v.role_name;

-- Keep a1 as the only active user.manage holder for the lockout guard checks.
-- This is inside the test transaction, so seeded users are restored by rollback.
update public.profiles p
set status = 'inactive'
where p.status = 'active'
  and p.id not between '10000000-0000-0000-0000-000000000001'::uuid
                   and '10000000-0000-0000-0000-000000000005'::uuid
  and public.has_permission_for_user(p.auth_user_id, 'user.manage');

insert into public.audit_log (id, actor_user_id, action, entity_type, entity_id)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'seed.fixture', 'profile', 'x');

-- ---------------------------------------------------------------------------
-- Meta checks
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('profiles', 'roles', 'permissions', 'role_permissions', 'user_roles', 'audit_log')
     and c.relrowsecurity),
  6, 'RLS is enabled on all 6 tables'
);
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('profiles', 'roles', 'permissions', 'role_permissions', 'user_roles', 'audit_log')
     and c.relforcerowsecurity),
  0, 'RLS is enabled but not forced'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'audit_log'
   and cmd in ('UPDATE', 'DELETE', 'ALL')),
  0, 'audit_log has no UPDATE/DELETE/ALL policies'
);
select is(
  (select array_agg(cmd order by cmd) from pg_policies where schemaname = 'public' and tablename = 'audit_log'),
  array['SELECT'], 'audit_log only has a SELECT policy (SAN-94: no direct insert)'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public'
   and 'anon' = any (roles)),
  0, 'no policy targets anon'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('current_profile_id', 'has_permission_for_user', 'has_permission', 'my_permissions')
     and p.prosecdef
     and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')),
  4, 'permission functions are security definer with pinned search_path'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public'
   and tablename in ('roles', 'permissions', 'role_permissions') and cmd <> 'SELECT'),
  0, 'catalog tables (roles, permissions, role_permissions) have only SELECT policies'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public'
   and tablename = 'profiles' and cmd in ('DELETE', 'ALL')),
  0, 'profiles has no DELETE policy (deactivate instead)'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public'
   and regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                      'SELECT (public\.)?has_permission\(', '', 'g') ~ 'has_permission\('),
  0, 'every has_permission call in a policy is wrapped in (select ...)'
);
select ok(not has_table_privilege('service_role', 'public.permissions', 'insert,update,delete,truncate'), 'service_role cannot write the permission catalog');
select ok(not has_table_privilege('service_role', 'public.roles', 'truncate'), 'service_role cannot truncate roles');
select ok(not has_column_privilege('authenticated', 'public.audit_log', 'created_at', 'insert'), 'authenticated cannot supply audit_log.created_at');
select ok(not has_column_privilege('authenticated', 'public.audit_log', 'id', 'insert'), 'authenticated cannot supply audit_log.id');

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.has_permission_for_user(uuid, text)', 'execute'), 'anon cannot execute has_permission_for_user');
select ok(not has_function_privilege('authenticated', 'public.has_permission_for_user(uuid, text)', 'execute'), 'authenticated cannot execute has_permission_for_user');
select ok(has_function_privilege('service_role', 'public.has_permission_for_user(uuid, text)', 'execute'), 'service_role can execute has_permission_for_user');
select ok(not has_function_privilege('anon', 'public.current_profile_id()', 'execute'), 'anon cannot execute current_profile_id');
select ok(not has_function_privilege('anon', 'public.has_permission(text)', 'execute'), 'anon cannot execute has_permission');
select ok(has_function_privilege('authenticated', 'public.has_permission(text)', 'execute'), 'authenticated can execute has_permission');
select ok(not has_function_privilege('anon', 'public.my_permissions()', 'execute'), 'anon cannot execute my_permissions');
select ok(has_function_privilege('authenticated', 'public.my_permissions()', 'execute'), 'authenticated can execute my_permissions');

-- has_permission_for_user (as owner) is the reference the end-user functions must agree with
select ok(public.has_permission_for_user('00000000-0000-0000-0000-000000000001', 'user.manage'), 'for_user: admin has user.manage');
select ok(public.has_permission_for_user('00000000-0000-0000-0000-000000000002', 'audit.view'), 'for_user: treasurer has audit.view');
select ok(not public.has_permission_for_user('00000000-0000-0000-0000-000000000002', 'user.manage'), 'for_user: treasurer lacks user.manage');
select ok(not public.has_permission_for_user('00000000-0000-0000-0000-000000000005', 'user.manage'), 'for_user: inactive admin has nothing');
select ok(not public.has_permission_for_user('00000000-0000-0000-0000-000000000006', 'user.manage'), 'for_user: user without profile has nothing');

-- ---------------------------------------------------------------------------
-- anon: denied everywhere
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select * from public.profiles$$, '42501', null, 'anon cannot select profiles');
select throws_ok($$select * from public.roles$$, '42501', null, 'anon cannot select roles');
select throws_ok($$select * from public.permissions$$, '42501', null, 'anon cannot select permissions');
select throws_ok($$select * from public.role_permissions$$, '42501', null, 'anon cannot select role_permissions');
select throws_ok($$select * from public.user_roles$$, '42501', null, 'anon cannot select user_roles');
select throws_ok($$select * from public.audit_log$$, '42501', null, 'anon cannot select audit_log');
select throws_ok($$select public.has_permission('user.manage')$$, '42501', null, 'anon cannot call has_permission');
reset role;

-- Every profile the owner sees (fixtures plus any seeded users): the admin must see exactly these.
create temporary table owner_profile_count as select count(*)::int as n from public.profiles;
grant select on owner_profile_count to authenticated;

-- ---------------------------------------------------------------------------
-- Admin (a1)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.profiles
   where id between '10000000-0000-0000-0000-000000000001'::uuid
                and '10000000-0000-0000-0000-000000000005'::uuid),
  5, 'admin reads all fixture profiles'
);
select is(
  (select count(*)::int from public.profiles), (select n from owner_profile_count),
  'admin reads every profile, seeded users included (RLS hides none)'
);
select is(public.current_profile_id(), '10000000-0000-0000-0000-000000000001'::uuid, 'admin: current_profile_id is own profile');
select ok(public.has_permission('user.manage'), 'admin: has_permission(user.manage)');
select is(cardinality(public.my_permissions()), 48, 'admin: my_permissions returns 48 codes');
select is(
  (select count(*)::int from public.audit_log
   where id = '20000000-0000-0000-0000-000000000001'::uuid),
  1, 'admin reads fixture audit_log (audit.view)'
);
select lives_ok(
  $$insert into public.profiles (auth_user_id, full_name, email) values ('00000000-0000-0000-0000-000000000006', 'Spare', 'rls-user-6@example.com')$$,
  'admin can insert a profile'
);
select lives_ok(
  $$insert into public.user_roles (user_id, role_id)
    select '10000000-0000-0000-0000-000000000004', id from public.roles where name = 'read-only'$$,
  'admin can insert a user_roles row'
);
select throws_ok(
  $$delete from public.profiles where id = '10000000-0000-0000-0000-000000000004'$$, '42501', null,
  'admin cannot hard-delete profiles (no privilege)'
);
select throws_ok(
  $$update public.permissions set code = 'x' where code = 'user.manage'$$, '42501', null,
  'admin cannot rename a permission'
);
select throws_ok(
  $$delete from public.permissions where code = 'user.manage'$$, '42501', null,
  'admin cannot delete a permission'
);
select throws_ok(
  $$insert into public.roles (name) values ('rogue-admin')$$, '42501', null,
  'admin cannot insert roles'
);
select throws_ok(
  $$delete from public.role_permissions$$, '42501', null,
  'admin cannot change role_permissions'
);
select throws_ok(
  $$update public.audit_log set action = 'tampered'$$, '42501', null,
  'admin cannot update audit_log (no privilege)'
);
select throws_ok(
  $$delete from public.audit_log$$, '42501', null,
  'admin cannot delete audit_log (no privilege)'
);
select throws_ok(
  $$truncate public.audit_log$$, '42501', null,
  'admin cannot truncate audit_log (no privilege)'
);
select throws_ok(
  $$insert into public.audit_log (actor_user_id, action, entity_type)
    values ('10000000-0000-0000-0000-000000000001', 'test.admin', 'profile')$$,
  '42501', null, 'admin cannot append an audit entry directly, even as themselves'
);
select throws_ok(
  $$insert into public.audit_log (actor_user_id, action, entity_type)
    values ('10000000-0000-0000-0000-000000000002', 'test.spoof', 'profile')$$,
  '42501', null, 'admin cannot append an audit entry as someone else'
);
select throws_ok(
  $$insert into public.audit_log (actor_user_id, action, entity_type, created_at)
    values ('10000000-0000-0000-0000-000000000001', 'test.backdate', 'profile', now() - interval '1 year')$$,
  '42501', null, 'admin cannot backdate an audit entry'
);
select throws_ok(
  $$insert into public.audit_log (id, actor_user_id, action, entity_type)
    values (gen_random_uuid(), '10000000-0000-0000-0000-000000000001', 'test.id', 'profile')$$,
  '42501', null, 'admin cannot choose an audit entry id'
);
reset role;

-- ---------------------------------------------------------------------------
-- Treasurer (a2): audit.view, no user.manage
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select ok(public.has_permission('audit.view'), 'treasurer: has_permission(audit.view)');
select ok(not public.has_permission('user.manage'), 'treasurer: lacks user.manage');
select cmp_ok((select count(*)::int from public.audit_log), '>=', 1, 'treasurer reads audit_log');
select is((select count(*)::int from public.profiles), 1, 'treasurer reads only own profile');
select throws_ok(
  $$insert into public.profiles (auth_user_id, full_name, email) values (gen_random_uuid(), 'x', 'x@example.com')$$,
  '42501', null, 'treasurer cannot insert profiles'
);
reset role;

-- ---------------------------------------------------------------------------
-- Operator (a3)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

select is((select count(*)::int from public.profiles), 1, 'operator reads only own profile');
select is((select count(*)::int from public.user_roles), 1, 'operator reads only own user_roles');
select is((select count(*)::int from public.audit_log), 0, 'operator reads no audit_log rows');
select cmp_ok((select count(*)::int from public.roles), '=', 5, 'operator can read roles');
select is((select count(*)::int from public.permissions), 48, 'operator can read permissions');
select set_eq(
  $$select role_id from public.role_permissions$$,
  $$select id from public.roles where name = 'operator'$$,
  'operator reads only role_permissions of own role'
);
select set_eq(
  $$select perm.code from public.role_permissions rp join public.permissions perm on perm.id = rp.permission_id$$,
  $$select unnest(public.my_permissions())$$,
  'operator role_permissions rows match my_permissions()'
);
select throws_ok(
  $$insert into public.user_roles (user_id, role_id)
    select '10000000-0000-0000-0000-000000000003', id from public.roles where name = 'admin'$$,
  '42501', null, 'operator cannot grant themselves a role'
);
select throws_ok(
  $$insert into public.roles (name) values ('rogue')$$,
  '42501', null, 'operator cannot insert roles'
);
select is_empty(
  $$with u as (update public.profiles set full_name = 'hacked' returning 1) select * from u$$,
  'operator updates no profile rows'
);
select throws_ok(
  $$insert into public.audit_log (actor_user_id, action, entity_type)
    values ('10000000-0000-0000-0000-000000000003', 'test.operator', 'profile')$$,
  '42501', null, 'operator cannot append an audit entry directly, even as themselves'
);
select throws_ok(
  $$insert into public.audit_log (actor_user_id, action, entity_type) values (null, 'test.null', 'profile')$$,
  '42501', null, 'audit entry without actor is rejected for authenticated'
);
reset role;

-- ---------------------------------------------------------------------------
-- No-role user (a4) and inactive admin (a5)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.profiles), 1, 'no-role user reads only own profile');
select ok(not public.has_permission('anything'), 'no-role user: has_permission(anything) is false');
select ok(not public.has_permission('user.manage'), 'no-role user: lacks user.manage');
select is(
  public.my_permissions(),
  array['bond.view', 'campaign.view', 'commission.view', 'report.view_financial', 'report.view_operational'],
  'no-role user: my_permissions reflects only the role granted earlier in this test (read-only)'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select ok(not public.has_permission('user.manage'), 'inactive admin: has_permission is false');
select is(public.my_permissions(), array[]::text[], 'inactive admin: my_permissions is empty');
select is((select count(*)::int from public.audit_log), 0, 'inactive admin cannot read audit_log');
select is(public.current_profile_id(), null, 'inactive admin: current_profile_id is null');
select is((select count(*)::int from public.profiles), 1, 'inactive admin still reads own profile (login reports status)');
select is((select count(*)::int from public.user_roles), 0, 'inactive admin reads no user_roles');
select is((select count(*)::int from public.role_permissions), 0, 'inactive admin reads no role_permissions');
select throws_ok(
  $$insert into public.audit_log (actor_user_id, action, entity_type)
    values ('10000000-0000-0000-0000-000000000005', 'test.inactive', 'profile')$$,
  '42501', null, 'inactive admin cannot append audit entries'
);
reset role;

-- authenticated without any JWT subject
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select ok(not public.has_permission('user.manage'), 'no sub claim: has_permission is false');
reset role;

-- ---------------------------------------------------------------------------
-- authenticated cannot probe other users
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$select public.has_permission_for_user('00000000-0000-0000-0000-000000000002', 'audit.view')$$,
  '42501', null, 'authenticated cannot call has_permission_for_user'
);
reset role;

-- ---------------------------------------------------------------------------
-- service_role: bypasses RLS but audit_log stays append-only
-- ---------------------------------------------------------------------------
set local role service_role;
select lives_ok(
  $$insert into public.audit_log (action, entity_type) values ('test.service', 'system')$$,
  'service_role can append to audit_log'
);
select ok(public.has_permission_for_user('00000000-0000-0000-0000-000000000001', 'user.manage'), 'service_role can call has_permission_for_user');
select lives_ok(
  $$insert into public.audit_log (id, action, entity_type, created_at)
    values ('20000000-0000-0000-0000-000000000002', 'test.service.backdate', 'system', '2000-01-01')$$,
  'service_role insert with an explicit created_at is accepted'
);
select throws_ok($$delete from public.role_permissions$$, '42501', null, 'service_role cannot change role_permissions');
select throws_ok($$update public.audit_log set action = 'tampered'$$, '42501', null, 'service_role cannot update audit_log');
select throws_ok($$delete from public.audit_log$$, '42501', null, 'service_role cannot delete audit_log');
select throws_ok($$truncate public.audit_log$$, '42501', null, 'service_role cannot truncate audit_log');
reset role;

-- ---------------------------------------------------------------------------
-- Owner (bypasses privileges and RLS): triggers are the backstop
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.audit_log set action = 'tampered'$$, '23001',
  'audit_log is append-only: UPDATE is not allowed', 'owner cannot update audit_log (trigger)'
);
select throws_ok(
  $$delete from public.audit_log$$, '23001',
  'audit_log is append-only: DELETE is not allowed', 'owner cannot delete audit_log (trigger)'
);
select throws_ok(
  $$truncate public.audit_log$$, '23001',
  'audit_log is append-only: TRUNCATE is not allowed', 'owner cannot truncate audit_log (trigger)'
);
select throws_ok(
  $$update public.audit_log set actor_user_id = null$$, '23001',
  'audit_log is append-only: UPDATE is not allowed',
  'owner cannot null out actor_user_id directly'
);

select is(
  (select created_at from public.audit_log where id = '20000000-0000-0000-0000-000000000002'),
  now(), 'service_role cannot backdate audit_log: created_at is forced to now()'
);
select is(
  (select created_at from public.audit_log where id = '20000000-0000-0000-0000-000000000001'),
  now(), 'owner-inserted fixture got a server-set created_at'
);

-- Profiles referenced by role assignments / audit rows cannot be hard-deleted (ON DELETE RESTRICT)
select throws_ok(
  $$delete from public.profiles where id = '10000000-0000-0000-0000-000000000003'$$,
  '23503', null, 'deleting a profile with audit rows is rejected'
);

-- ---------------------------------------------------------------------------
-- Lockout guard: a1 is the only active user.manage holder (a5 is inactive)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$delete from public.user_roles where user_id = '10000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'last user.manage holder cannot remove own admin role'
);
select throws_ok(
  $$update public.user_roles set role_id = (select id from public.roles where name = 'operator')
    where user_id = '10000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'last user.manage holder cannot swap own admin role'
);
select throws_ok(
  $$update public.profiles set status = 'inactive' where id = '10000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'last user.manage holder cannot deactivate themselves'
);
select lives_ok(
  $$delete from public.user_roles where user_id = '10000000-0000-0000-0000-000000000005'$$,
  'removing a role from an inactive admin is allowed'
);
reset role;

select throws_ok(
  $$delete from public.role_permissions
    where role_id = (select id from public.roles where name = 'admin')
      and permission_id = (select id from public.permissions where code = 'user.manage')$$,
  '23514', null, 'user.manage cannot be removed from the last holders role, even by a migration'
);
select lives_ok(
  $$delete from public.role_permissions
    where role_id = (select id from public.roles where name = 'admin')
      and permission_id = (select id from public.permissions where code = 'audit.view')$$,
  'other permissions can still be removed by a migration'
);

-- With a second holder, the first one may step down
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$insert into public.user_roles (user_id, role_id)
    select '10000000-0000-0000-0000-000000000002', id from public.roles where name = 'admin'$$,
  'admin grants admin to the treasurer'
);
select lives_ok(
  $$update public.profiles set status = 'inactive' where id = '10000000-0000-0000-0000-000000000001'$$,
  'admin can deactivate themselves once another holder exists'
);
reset role;
select ok(public.has_permission_for_user('00000000-0000-0000-0000-000000000002', 'user.manage'), 'treasurer is now the user.manage holder');
select ok(not public.has_permission_for_user('00000000-0000-0000-0000-000000000001', 'user.manage'), 'deactivated admin lost user.manage');

select * from finish();
rollback;
