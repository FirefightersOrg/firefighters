begin;
select plan(31);

-- ---------------------------------------------------------------------------
-- Fixtures: b1 acting admin (active), b2 inactive profile, b3..b6 auth users without profile
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
select ('b0000000-0000-0000-0000-00000000000' || n)::uuid, 'Provision-' || n || '@Example.com'
from generate_series(1, 6) as n;

insert into public.profiles (id, auth_user_id, full_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Acting admin', 'provision-1@example.com', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'Inactive', 'provision-2@example.com', 'inactive');

insert into public.user_roles (user_id, role_id)
select 'c0000000-0000-0000-0000-000000000001', r.id from public.roles r where r.name = 'admin';

-- ---------------------------------------------------------------------------
-- Grants: service_role only
-- ---------------------------------------------------------------------------
select ok(
  has_function_privilege('service_role', 'public.admin_provision_profile(uuid, text, text[], uuid, text, text)', 'execute'),
  'service_role can execute admin_provision_profile'
);
select ok(
  not has_function_privilege('authenticated', 'public.admin_provision_profile(uuid, text, text[], uuid, text, text)', 'execute'),
  'authenticated cannot execute admin_provision_profile'
);
select ok(
  not has_function_privilege('anon', 'public.admin_provision_profile(uuid, text, text[], uuid, text, text)', 'execute'),
  'anon cannot execute admin_provision_profile'
);
select ok(
  has_function_privilege('service_role', 'public.admin_grant_roles(uuid, text[], uuid, text, text)', 'execute'),
  'service_role can execute admin_grant_roles'
);
select ok(
  not has_function_privilege('authenticated', 'public.admin_grant_roles(uuid, text[], uuid, text, text)', 'execute'),
  'authenticated cannot execute admin_grant_roles'
);
select ok(
  not has_function_privilege('anon', 'public.admin_grant_roles(uuid, text[], uuid, text, text)', 'execute'),
  'anon cannot execute admin_grant_roles'
);
select ok(
  not has_function_privilege('service_role', 'public.admin_resolve_role_names(text[])', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_resolve_role_names(text[])', 'execute'),
  'admin_resolve_role_names is internal (no API role can execute it)'
);

-- An admin with user.manage still cannot call it through the API role.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$select public.admin_provision_profile('b0000000-0000-0000-0000-000000000003', 'X', array['operator'])$$,
  '42501', null, 'authenticated admin cannot call admin_provision_profile'
);
select throws_ok(
  $$select public.admin_grant_roles('c0000000-0000-0000-0000-000000000001', array['operator'])$$,
  '42501', null, 'authenticated admin cannot call admin_grant_roles'
);
reset role;

-- ---------------------------------------------------------------------------
-- admin_provision_profile (as service_role)
-- ---------------------------------------------------------------------------
set local role service_role;

-- Atomicity: unknown role -> nothing inserted
select throws_ok(
  $$select public.admin_provision_profile('b0000000-0000-0000-0000-000000000003', 'Bad roles', array['operator', 'nope'], 'c0000000-0000-0000-0000-000000000001', 'req-bad')$$,
  '22023', 'unknown role(s): nope', 'unknown role is rejected'
);
select is(
  (select count(*)::int from public.profiles where auth_user_id = 'b0000000-0000-0000-0000-000000000003'),
  0, 'unknown role: no profile inserted'
);
select is(
  (select count(*)::int from public.audit_log where request_id = 'req-bad'),
  0, 'unknown role: no audit row inserted'
);

select throws_ok(
  $$select public.admin_provision_profile('b0000000-0000-0000-0000-000000000003', 'X', array['operator'], 'c0000000-0000-0000-0000-000000000002')$$,
  '22023', null, 'inactive actor is rejected'
);
select throws_ok(
  $$select public.admin_provision_profile('b0000000-0000-0000-0000-000000000003', '  ', array['operator'])$$,
  '22023', null, 'blank full name is rejected'
);
select throws_ok(
  $$select public.admin_provision_profile('b0000000-0000-0000-0000-0000000000ff', 'Ghost', array['operator'])$$,
  'P0002', null, 'missing auth user is rejected'
);

-- Success path
select lives_ok(
  $$select public.admin_provision_profile('b0000000-0000-0000-0000-000000000003', '  New Operator ', array['operator', 'collector', 'operator'], 'c0000000-0000-0000-0000-000000000001', 'req-ok')$$,
  'provisions a profile with roles'
);
select results_eq(
  $$select full_name, email, status from public.profiles where auth_user_id = 'b0000000-0000-0000-0000-000000000003'$$,
  $$values ('New Operator'::text, 'provision-3@example.com'::text, 'active'::text)$$,
  'profile has trimmed name, lowercased auth email and active status'
);
select results_eq(
  $$select r.name from public.user_roles ur join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where p.auth_user_id = 'b0000000-0000-0000-0000-000000000003' order by r.name$$,
  $$values ('collector'::text), ('operator'::text)$$,
  'roles are assigned (deduplicated)'
);
select results_eq(
  $$select a.actor_user_id, a.action, a.entity_type, a.entity_id, a.new_value -> 'roles', a.reason
    from public.audit_log a where a.request_id = 'req-ok'$$,
  $$select 'c0000000-0000-0000-0000-000000000001'::uuid, 'user.create'::text, 'user'::text,
      (select id::text from public.profiles where auth_user_id = 'b0000000-0000-0000-0000-000000000003'),
      '["collector", "operator"]'::jsonb, 'Admin-managed user creation'::text$$,
  'exactly one user.create audit row with actor, entity and roles'
);

-- Duplicate profile for the same auth user
select throws_ok(
  $$select public.admin_provision_profile('b0000000-0000-0000-0000-000000000003', 'Again', array['operator'])$$,
  '23505', null, 'second profile for the same auth user is rejected'
);

-- System actor (null) and no roles
select lives_ok(
  $$select public.admin_provision_profile('b0000000-0000-0000-0000-000000000004', 'No roles', null, null, 'req-system')$$,
  'provisions with null actor and no roles'
);
select results_eq(
  $$select actor_user_id is null, new_value -> 'roles' from public.audit_log where request_id = 'req-system'$$,
  $$values (true, '[]'::jsonb)$$,
  'system provisioning is audited with a null actor'
);

-- ---------------------------------------------------------------------------
-- admin_grant_roles (as service_role)
-- ---------------------------------------------------------------------------
select is(
  public.admin_grant_roles(
    (select id from public.profiles where auth_user_id = 'b0000000-0000-0000-0000-000000000004'),
    array['admin'], null, 'req-grant'),
  array['admin'], 'grants a missing role and returns it'
);
select is(
  (select count(*)::int from public.audit_log where request_id = 'req-grant' and action = 'user.roles.grant'),
  1, 'grant is audited'
);
select is(
  public.admin_grant_roles(
    (select id from public.profiles where auth_user_id = 'b0000000-0000-0000-0000-000000000004'),
    array['admin'], null, 'req-grant-again'),
  array[]::text[], 'granting an already held role is a no-op'
);
select is(
  (select count(*)::int from public.audit_log where request_id = 'req-grant-again'),
  0, 'no-op grant writes no audit row'
);
select throws_ok(
  $$select public.admin_grant_roles((select id from public.profiles where auth_user_id = 'b0000000-0000-0000-0000-000000000004'), array['admin', 'nope'], null, 'req-grant-bad')$$,
  '22023', 'unknown role(s): nope', 'grant with an unknown role is rejected'
);
select is(
  (select count(*)::int from public.audit_log where request_id = 'req-grant-bad'),
  0, 'rejected grant writes no audit row'
);
select throws_ok(
  $$select public.admin_grant_roles('c0000000-0000-0000-0000-0000000000ff', array['admin'])$$,
  'P0002', null, 'grant to a missing profile is rejected'
);
reset role;

-- Atomicity of the audit write: if the audit insert fails, profile and roles roll back too.
-- Simulate with a temporary trigger that rejects user.create audit rows.
create function pg_temp.reject_user_create() returns trigger language plpgsql as $$
begin
  if new.action = 'user.create' then
    raise exception 'audit rejected' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger reject_user_create before insert on public.audit_log
  for each row execute function pg_temp.reject_user_create();

set local role service_role;
select throws_ok(
  $$select public.admin_provision_profile('b0000000-0000-0000-0000-000000000005', 'Audit fails', array['operator'], null, 'req-audit-fail')$$,
  'P0001', 'audit rejected', 'audit failure aborts provisioning'
);
select is(
  (select count(*)::int from public.profiles where auth_user_id = 'b0000000-0000-0000-0000-000000000005'),
  0, 'audit failure: no profile left behind'
);
reset role;
drop trigger reject_user_create on public.audit_log;

select * from finish();
rollback;
