begin;
select plan(10);

-- auth/profile fixtures: ...01 admin (all permissions), ...02 operator.
insert into auth.users (id, email)
select ('a2500000-0000-0000-0000-00000000000' || n)::uuid, 'audit-direct-' || n || '@example.com'
from generate_series(1, 2) as n;

insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b2500000-0000-0000-0000-00000000000' || n)::uuid,
  ('a2500000-0000-0000-0000-00000000000' || n)::uuid,
  'Audit direct user ' || n, 'audit-direct-' || n || '@example.com', 'active'
from generate_series(1, 2) as n;

insert into public.user_roles (user_id, role_id)
select v.profile_id::uuid, r.id
from (values
  ('b2500000-0000-0000-0000-000000000001', 'admin'),
  ('b2500000-0000-0000-0000-000000000002', 'operator')
) as v (profile_id, role_name)
join public.roles r on r.name = v.role_name;

-- Catalog checks.
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'audit_log' and cmd = 'INSERT'),
  0, 'audit_log has no INSERT policy'
);
select ok(not has_table_privilege('authenticated', 'public.audit_log', 'insert'), 'authenticated has no table INSERT on audit_log');
select ok(not has_table_privilege('anon', 'public.audit_log', 'insert'), 'anon has no INSERT on audit_log');
select ok(
  not has_any_column_privilege('authenticated', 'public.audit_log', 'insert'),
  'authenticated has no column-level INSERT on audit_log'
);

-- Direct inserts are rejected, even as the caller's own active profile.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a2500000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$insert into public.audit_log (actor_user_id, action, entity_type)
    values ('b2500000-0000-0000-0000-000000000001', 'forged.action', 'profile')$$,
  '42501', null, 'admin cannot insert into audit_log directly (own actor)'
);
select throws_ok(
  $$insert into public.audit_log (action, entity_type) values ('forged.system', 'system')$$,
  '42501', null, 'admin cannot insert into audit_log directly (no actor)'
);

-- Audited RPCs (SECURITY DEFINER, running as owner) still write their rows.
select public.campaign_create('Audit direct 2027', 60000, 10, 4, 9999, 4871, 'reject', 'base_number', null, null, 'req-san94-1');
reset role;

select is(
  (select count(*)::int from public.audit_log where request_id = 'req-san94-1' and action = 'campaign.create'),
  1, 'campaign_create still writes its audit row'
);
select is(
  (select a.actor_user_id from public.audit_log a where a.request_id = 'req-san94-1'),
  'b2500000-0000-0000-0000-000000000001'::uuid, 'the RPC audit row carries the caller as actor'
);

-- A denied audited RPC leaves neither change nor audit row.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a2500000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select public.campaign_create('Denied', 60000, 10, 4, 9999, 4871, 'reject', 'base_number', null, null, 'req-san94-denied')$$,
  null, null, 'operator is denied by the audited RPC'
);
reset role;
select is(
  (select count(*)::int from public.audit_log where request_id = 'req-san94-denied')
  + (select count(*)::int from public.campaigns where name = 'Denied'),
  0, 'a denied RPC leaves no audit row and no change'
);

select * from finish();
rollback;
