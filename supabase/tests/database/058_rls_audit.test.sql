-- SAN-91: RLS audit. Every check ENUMERATES the catalog (pg_class / pg_proc), so a table or
-- function added later is audited automatically. The ticket names the roles treasury, operations,
-- collector_coordinator and auditor; the seeded roles are admin, treasurer, operator, collector and
-- read-only (auditor). There is no collector-coordinator role (SAN-139, deferred).
begin;
select plan(19);

-- 1. Tables ------------------------------------------------------------------------------------
create temp view audited_tables as
  select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p');

select ok((select count(*) from audited_tables) >= 30, 'the audit sees every public table');
select is(array(select t.relname::text from audited_tables t join pg_class c on c.oid = t.oid
                where not c.relrowsecurity order by 1), '{}'::text[],
  'every public table has row level security enabled');
select is(array(select distinct table_name::text from information_schema.role_table_grants
                where table_schema = 'public' and grantee = 'anon' order by 1), '{}'::text[],
  'anon has no privilege on any public table');
select is(array(select relname::text from audited_tables t
                where not exists (select 1 from pg_policy p where p.polrelid = t.oid and p.polcmd in ('r', '*'))
                order by 1), '{}'::text[],
  'every public table has a SELECT policy (no table is readable only by bypassing RLS)');
-- Direct writes by authenticated exist only for user administration (profiles, user_roles); every
-- business write goes through audited SECURITY DEFINER RPCs.
select is(array(select distinct table_name::text from information_schema.role_table_grants
                where table_schema = 'public' and grantee = 'authenticated'
                  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE') order by 1),
  array['profiles', 'user_roles'],
  'authenticated writes directly only to profiles and user_roles');
select is(array(select c.relname::text || ':' || p.polcmd::text from pg_policy p join pg_class c on c.oid = p.polrelid
                where c.relname in ('profiles', 'user_roles') and p.polcmd in ('a', 'w', 'd')
                  and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), pg_get_expr(p.polqual, p.polrelid))
                      not like '%has_permission(''user.manage''%' order by 1), '{}'::text[],
  'those direct writes are gated by user.manage');
select is(array(select distinct table_name::text from information_schema.role_table_grants
                where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'TRUNCATE'),
  '{}'::text[], 'authenticated can truncate nothing');
select is(array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind = 'v'
                  and not coalesce('security_invoker=true' = any(c.reloptions), false) order by 1),
  '{}'::text[], 'every public view runs with the caller''s permissions (security_invoker)');

-- 2. SECURITY DEFINER functions ------------------------------------------------------------------
create temp view definers as
  select p.oid, p.proname, p.proconfig, p.proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef;
select ok((select count(*) from definers) > 50, 'the audit sees the SECURITY DEFINER functions');
select is(array(select proname::text from definers
                where not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c = 'search_path=""'
                                  or c = 'search_path=')
                order by 1), '{}'::text[],
  'every SECURITY DEFINER function pins an empty search_path');
select is(array(select proname::text from definers where has_function_privilege('anon', oid, 'execute') order by 1),
  '{}'::text[], 'anon can execute no SECURITY DEFINER function');
select is(array(select proname::text from definers
                where exists (select 1 from aclexplode(coalesce(proacl, acldefault('f', 10))) a
                              where a.grantee = 0 and a.privilege_type = 'EXECUTE') order by 1),
  '{}'::text[], 'no SECURITY DEFINER function is executable by PUBLIC');

-- 3. The five seeded roles: has_permission returns exactly the role's seeded set ------------------
insert into auth.users(id, email)
select ('a6580000-0000-0000-0000-00000000000' || n)::uuid, 'san91-' || n || '@example.com' from generate_series(1, 5) n;
insert into public.profiles(id, auth_user_id, full_name, email, status)
select ('b6580000-0000-0000-0000-00000000000' || n)::uuid, ('a6580000-0000-0000-0000-00000000000' || n)::uuid,
  'SAN91 ' || n, 'san91-' || n || '@example.com', 'active' from generate_series(1, 5) n;
insert into public.user_roles(user_id, role_id)
select ('b6580000-0000-0000-0000-00000000000' || n)::uuid, r.id
from (values (1, 'admin'), (2, 'operator'), (3, 'treasurer'), (4, 'collector'), (5, 'read-only')) v(n, name)
join public.roles r on r.name = v.name;
create function pg_temp.act(n int) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"a6580000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true) $$;
create function pg_temp.granted(role_name text) returns text[] language sql stable as $$
  select array(select p.code from public.role_permissions rp join public.roles r on r.id = rp.role_id
               join public.permissions p on p.id = rp.permission_id where r.name = role_name order by 1) $$;
create temp table effective(role_name text primary key, codes text[]);
grant all on effective to authenticated;
grant execute on function pg_temp.act(int) to authenticated;
do $$
declare v record;
begin
  for v in select * from (values (1, 'admin'), (2, 'operator'), (3, 'treasurer'), (4, 'collector'), (5, 'read-only')) x(n, name) loop
    perform pg_temp.act(v.n);
    execute 'set local role authenticated';
    insert into effective
      select v.name, array(select code from public.permissions where public.has_permission(code) order by 1);
    execute 'reset role';
  end loop;
end $$;
select is((select codes from effective where role_name = 'admin'), pg_temp.granted('admin'), 'admin: effective = seeded permissions');
select is((select codes from effective where role_name = 'operator'), pg_temp.granted('operator'), 'operator (operations): effective = seeded permissions');
select is((select codes from effective where role_name = 'treasurer'), pg_temp.granted('treasurer'), 'treasurer (treasury): effective = seeded permissions');
select is((select codes from effective where role_name = 'collector'), pg_temp.granted('collector'), 'collector: effective = seeded permissions');
select is((select codes from effective where role_name = 'read-only'), pg_temp.granted('read-only'), 'read-only (auditor): effective = seeded permissions');
select is((select cardinality(codes) from effective where role_name = 'admin'),
  (select count(*)::int from public.permissions), 'admin holds every permission');

-- 4. A protected financial row is visible only to roles with its view permission ------------------
insert into public.campaigns(id, name, simple_bond_value, installment_count, installment_value, barcode_mode)
values ('c6580000-0000-0000-0000-000000000001', 'SAN91', 100, 1, 100, 'base_number');
insert into public.collectors(id, display_name) values ('c6580000-0000-0000-0000-000000000002', 'SAN91 collector');
insert into public.buyers(id, type, first_name) values ('c6580000-0000-0000-0000-000000000003', 'individual', 'SAN91');
insert into public.bonds(id, campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
values ('c6580000-0000-0000-0000-000000000004', 'c6580000-0000-0000-0000-000000000001', 'simple', 'printed', 1, 100, 'available');
insert into public.sales(id, campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by)
values ('c6580000-0000-0000-0000-000000000005', 'c6580000-0000-0000-0000-000000000001', 'c6580000-0000-0000-0000-000000000004',
  'c6580000-0000-0000-0000-000000000003', 'c6580000-0000-0000-0000-000000000002', 'full_payment', 100,
  'b6580000-0000-0000-0000-000000000001');
insert into public.settlements(id, campaign_id, settlement_number, collector_id, created_by)
values ('c6580000-0000-0000-0000-000000000006', 'c6580000-0000-0000-0000-000000000001', 1,
  'c6580000-0000-0000-0000-000000000002', 'b6580000-0000-0000-0000-000000000001');
insert into public.payments(id, campaign_id, sale_id, collector_id, buyer_id, settlement_id, amount, payment_method, status, created_by)
values ('c6580000-0000-0000-0000-000000000007', 'c6580000-0000-0000-0000-000000000001', 'c6580000-0000-0000-0000-000000000005',
  'c6580000-0000-0000-0000-000000000002', 'c6580000-0000-0000-0000-000000000003', 'c6580000-0000-0000-0000-000000000006',
  100, 'cash', 'pending_in_settlement', 'b6580000-0000-0000-0000-000000000001');
create temp table visible(role_name text primary key, payments int, settlements int);
grant all on visible to authenticated;
do $$
declare v record;
begin
  for v in select * from (values (1, 'admin'), (2, 'operator'), (3, 'treasurer'), (4, 'collector'), (5, 'read-only')) x(n, name) loop
    perform pg_temp.act(v.n);
    execute 'set local role authenticated';
    insert into visible select v.name,
      (select count(*)::int from public.payments where id = 'c6580000-0000-0000-0000-000000000007'),
      (select count(*)::int from public.settlements where id = 'c6580000-0000-0000-0000-000000000006');
    execute 'reset role';
  end loop;
end $$;
select is(array(select role_name || ':' || payments || '/' || settlements from visible order by 1),
  array(select r.name || ':' ||
    (case when pg_temp.granted(r.name) && array['payment.view', 'payment.create', 'payment.annul'] then 1 else 0 end) || '/' ||
    (case when pg_temp.granted(r.name) && array['settlement.view', 'settlement.create', 'settlement.update_open',
                                                'settlement.close', 'settlement.correct'] then 1 else 0 end)
    from public.roles r where r.name in ('admin', 'operator', 'treasurer', 'collector', 'read-only') order by 1),
  'payments and settlements are visible exactly to the roles holding a matching permission');

select * from finish();
rollback;
