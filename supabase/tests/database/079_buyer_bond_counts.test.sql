-- SAN-169: buyer_bond_counts equals the per-buyer read it replaces, and keeps bond.view RLS.
begin;
select plan(8);

insert into auth.users(id, email) values
  ('a7900000-0000-0000-0000-000000000001', 'san169-1@example.com'),
  ('a7900000-0000-0000-0000-000000000002', 'san169-2@example.com');
insert into public.profiles(id, auth_user_id, full_name, email, status) values
  ('b7900000-0000-0000-0000-000000000001', 'a7900000-0000-0000-0000-000000000001', 'SAN169 op', 'san169-1@example.com', 'active'),
  ('b7900000-0000-0000-0000-000000000002', 'a7900000-0000-0000-0000-000000000002', 'SAN169 none', 'san169-2@example.com', 'active');
insert into public.user_roles(user_id, role_id)
select 'b7900000-0000-0000-0000-000000000001'::uuid, r.id from public.roles r where r.name = 'operator';

create temp table ids(k text primary key, id uuid not null default gen_random_uuid());
grant select on ids to authenticated;
insert into ids(k) select unnest(array['c1', 'c2', 'b1', 'b2', 'b3', 'k1', 'k2', 'k3', 'k4']);
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where ids.k = $1 $$;
grant execute on function pg_temp.id(text) to authenticated;

insert into public.campaigns(id, name, simple_bond_value, installment_count, installment_value, barcode_mode) values
  (pg_temp.id('c1'), 'SAN169 one', 100, 1, 100, 'base_number'),
  (pg_temp.id('c2'), 'SAN169 two', 100, 1, 100, 'base_number');
insert into public.buyers(id, first_name, last_name, type) values
  (pg_temp.id('b1'), 'Uno', 'Uno', 'individual'),
  (pg_temp.id('b2'), 'Dos', 'Dos', 'individual'),
  (pg_temp.id('b3'), 'Tres', 'Tres', 'individual');
-- b1: 2 bonds in c1 and 1 in c2; b2: 1 in c1; b3: none
insert into public.bonds(id, campaign_id, kind, origin, commercial_status, commercial_unit_count, total_value)
select pg_temp.id(v.k), pg_temp.id(v.c), 'simple', 'printed', 'available', 1, 100
from (values ('k1', 'c1'), ('k2', 'c1'), ('k3', 'c2'), ('k4', 'c1')) v(k, c);
-- the owner is set afterwards: new bonds must start available
update public.bonds b set current_buyer_id = pg_temp.id(v.b)
from (values ('k1', 'b1'), ('k2', 'b1'), ('k3', 'b1'), ('k4', 'b2')) v(k, b)
where b.id = pg_temp.id(v.k);

select set_config('request.jwt.claims', '{"sub":"a7900000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select bond_count from public.buyer_bond_counts(pg_temp.id('c1'), array[pg_temp.id('b1'), pg_temp.id('b2'), pg_temp.id('b3')]) where buyer_id = pg_temp.id('b1')), 2, 'counts the buyer''s bonds of the campaign only');
select is((select bond_count from public.buyer_bond_counts(pg_temp.id('c1'), array[pg_temp.id('b1'), pg_temp.id('b2')]) where buyer_id = pg_temp.id('b2')), 1, 'counts another buyer');
select is((select count(*)::int from public.buyer_bond_counts(pg_temp.id('c1'), array[pg_temp.id('b3')])), 0, 'a buyer without bonds has no row');
select is((select bond_count from public.buyer_bond_counts(pg_temp.id('c2'), array[pg_temp.id('b1')])), 1, 'the other campaign counts apart');
select is(
  (select jsonb_object_agg(buyer_id, bond_count) from public.buyer_bond_counts(pg_temp.id('c1'), array[pg_temp.id('b1'), pg_temp.id('b2'), pg_temp.id('b3')])),
  (select jsonb_object_agg(x.id, x.n) from (select bi.id, (select count(*) from public.bonds b where b.current_buyer_id = bi.id and b.campaign_id = pg_temp.id('c1')) n from (select pg_temp.id(k) id from unnest(array['b1', 'b2']) k) bi) x),
  'equals the per-buyer count');

select set_config('request.jwt.claims', '{"sub":"a7900000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.buyer_bond_counts(pg_temp.id('c1'), array[pg_temp.id('b1')])), 0, 'without bond.view the RLS returns nothing');

reset role;
select is(has_function_privilege('anon', 'public.buyer_bond_counts(uuid,uuid[])', 'execute')
       or has_function_privilege('service_role', 'public.buyer_bond_counts(uuid,uuid[])', 'execute'), false, 'anon and service_role cannot execute');
select is((select count(*)::int from pg_proc p where p.proname = 'buyer_bond_counts' and not p.prosecdef
           and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute')), 1, 'security invoker, empty search_path, authenticated only');

select * from finish();
rollback;
