-- B1: reuse the existing own-sales scope; no new buyer access.
begin;
select plan(22);

insert into auth.users(id, email)
select ('a7810000-0000-0000-0000-00000000000' || n)::uuid, 'b1-' || n || '@example.com' from generate_series(1, 3) n;
insert into public.profiles(id, auth_user_id, full_name, email, status)
select ('b7810000-0000-0000-0000-00000000000' || n)::uuid, ('a7810000-0000-0000-0000-00000000000' || n)::uuid,
  'B1 ' || n, 'b1-' || n || '@example.com', 'active' from generate_series(1, 3) n;
insert into public.user_roles(user_id, role_id)
select ('b7810000-0000-0000-0000-00000000000' || v.n)::uuid, r.id
from (values (1, 'collector'), (2, 'collector'), (3, 'operator')) v(n, name)
join public.roles r on r.name = v.name;

create function pg_temp.act(n int) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"a7810000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true) $$;
grant execute on function pg_temp.act(int) to authenticated, anon;

create temp table ids(k text primary key, id uuid not null default gen_random_uuid());
grant select on ids to authenticated, anon;
insert into ids(k) select unnest(array['c1', 'c2', 'ca', 'cb', 'buyer_a1', 'buyer_a2', 'buyer_b', 'bond_a1', 'bond_a2', 'bond_b',
  'sale_a1', 'sale_a2', 'sale_b', 'plan_a1', 'plan_a2', 'plan_b', 'i_a1', 'i_a2', 'i_b']);
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where ids.k = $1 $$;
grant execute on function pg_temp.id(text) to authenticated, anon;
create function pg_temp.actor() returns uuid language sql immutable as $$ select 'b7810000-0000-0000-0000-000000000003'::uuid $$;

insert into public.campaigns(id, name, simple_bond_value, installment_count, installment_value, barcode_mode) values
  (pg_temp.id('c1'), 'B1 one', 300, 1, 300, 'base_number'),
  (pg_temp.id('c2'), 'B1 two', 300, 1, 300, 'base_number');
insert into public.collectors(id, display_name, user_profile_id, status) values
  (pg_temp.id('ca'), 'B1 A', 'b7810000-0000-0000-0000-000000000001', 'active'),
  (pg_temp.id('cb'), 'B1 B', 'b7810000-0000-0000-0000-000000000002', 'active');
insert into public.buyers(id, type, first_name, last_name, phone, address) values
  (pg_temp.id('buyer_a1'), 'individual', 'Ana', 'Uno', '111', 'Calle 1'),
  (pg_temp.id('buyer_a2'), 'individual', 'Ada', 'Dos', '222', null),
  (pg_temp.id('buyer_b'), 'individual', 'Beto', 'B', '333', 'Calle 3');
insert into public.bonds(id, campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status, current_collector_id) values
  (pg_temp.id('bond_a1'), pg_temp.id('c1'), 'simple', 'printed', 1, 300, 'available', pg_temp.id('ca')),
  (pg_temp.id('bond_a2'), pg_temp.id('c2'), 'simple', 'printed', 1, 300, 'available', pg_temp.id('ca')),
  (pg_temp.id('bond_b'), pg_temp.id('c1'), 'simple', 'printed', 1, 300, 'available', pg_temp.id('cb'));
insert into public.bond_numbers(campaign_id, bond_id, number_value, number_kind) values
  (pg_temp.id('c1'), pg_temp.id('bond_a1'), 21, 'base'),
  (pg_temp.id('c2'), pg_temp.id('bond_a2'), 22, 'base'),
  (pg_temp.id('c1'), pg_temp.id('bond_b'), 23, 'base');
-- A sells in campaign one (buyer_a1) and in campaign two (buyer_a2); B sells in campaign one.
insert into public.sales(id, campaign_id, bond_id, buyer_id, collector_id, sold_at, payment_mode, total_amount, created_by) values
  (pg_temp.id('sale_a1'), pg_temp.id('c1'), pg_temp.id('bond_a1'), pg_temp.id('buyer_a1'), pg_temp.id('ca'), now(), 'installments', 300, pg_temp.actor()),
  (pg_temp.id('sale_a2'), pg_temp.id('c2'), pg_temp.id('bond_a2'), pg_temp.id('buyer_a2'), pg_temp.id('ca'), now(), 'installments', 300, pg_temp.actor()),
  (pg_temp.id('sale_b'), pg_temp.id('c1'), pg_temp.id('bond_b'), pg_temp.id('buyer_b'), pg_temp.id('cb'), now(), 'installments', 300, pg_temp.actor());
insert into public.payment_plans(id, sale_id, installment_count, total_amount) values
  (pg_temp.id('plan_a1'), pg_temp.id('sale_a1'), 1, 300),
  (pg_temp.id('plan_a2'), pg_temp.id('sale_a2'), 1, 300),
  (pg_temp.id('plan_b'), pg_temp.id('sale_b'), 1, 300);
insert into public.installments(id, payment_plan_id, installment_number, due_date, amount, status) values
  (pg_temp.id('i_a1'), pg_temp.id('plan_a1'), 1, (now() at time zone 'America/Argentina/Buenos_Aires')::date - 5, 300, 'pending'),
  (pg_temp.id('i_a2'), pg_temp.id('plan_a2'), 1, (now() at time zone 'America/Argentina/Buenos_Aires')::date + 2, 300, 'pending'),
  (pg_temp.id('i_b'), pg_temp.id('plan_b'), 1, (now() at time zone 'America/Argentina/Buenos_Aires')::date - 5, 300, 'pending');


select function_privs_are('public', 'portal_my_campaign_due_installments', array['uuid','integer','integer','integer'], 'authenticated', array['EXECUTE'], 'authenticated retains execute');
select function_privs_are('public', 'portal_my_campaign_due_installments', array['uuid','integer','integer','integer'], 'anon', array[]::text[], 'anon has no privileges');
select function_privs_are('public', 'portal_my_campaign_due_installments', array['uuid','integer','integer','integer'], 'service_role', array[]::text[], 'service_role has no privileges');
select is((select count(*)::int from pg_proc p, lateral aclexplode(p.proacl) a
  where p.oid = 'public.portal_my_campaign_due_installments(uuid,integer,integer,integer)'::regprocedure
    and a.grantee = 0), 0, 'PUBLIC has no privileges');
select is((select p.proargnames[array_length(p.proargnames, 1)]
  from pg_proc p where p.oid = 'public.portal_my_campaign_due_installments(uuid,integer,integer,integer)'::regprocedure),
  'buyer_address', 'buyer_address is appended after the existing output columns');

select function_privs_are('public', 'portal_my_due_installments', array['integer','integer','integer'], 'authenticated', array['EXECUTE'], 'legacy RPC keeps authenticated execute');
select function_privs_are('public', 'portal_my_due_installments', array['integer','integer','integer'], 'anon', array[]::text[], 'legacy RPC keeps anon denied');
select function_privs_are('public', 'portal_my_due_installments', array['integer','integer','integer'], 'service_role', array[]::text[], 'legacy RPC keeps service_role denied');
select is((select count(*)::int from pg_proc p, lateral aclexplode(p.proacl) a
  where p.oid = 'public.portal_my_due_installments(integer,integer,integer)'::regprocedure and a.grantee = 0),
  0, 'legacy RPC keeps PUBLIC denied');

select pg_temp.act(1);
set local role authenticated;
select is((select buyer_address from public.portal_my_campaign_due_installments(pg_temp.id('c1'))),
  'Calle 1', 'own installment returns the buyer address');
select is((select count(*)::int from public.portal_my_campaign_due_installments(pg_temp.id('c2'))),
  1, 'the buyer without an address is still returned');
select is((select buyer_address from public.portal_my_campaign_due_installments(pg_temp.id('c2'))),
  null::text, 'a missing address remains NULL');
select is((select array_agg(installment_id order by due_date, installment_id) from public.portal_my_campaign_due_installments(null)),
  array[pg_temp.id('i_a1'), pg_temp.id('i_a2')], 'campaign NULL retains only the own installments and ordering');
select is((select count(*)::int from public.portal_my_campaign_due_installments(pg_temp.id('c2'), 1)),
  0, 'due-day filter remains unchanged');
select is((select installment_id from public.portal_my_campaign_due_installments(null, 7, 1, 1)),
  pg_temp.id('i_a2'), 'pagination remains unchanged');
select is((select total_count from public.portal_my_campaign_due_installments(null, 7, 1, 1)),
  2::bigint, 'total_count retains the full own scope');
select is((select count(*)::int from public.portal_my_due_installments(7)),
  2, 'legacy RPC still executes and returns the own installments');
select is((select array_agg(k order by k) from jsonb_object_keys(
  (select to_jsonb(d) from public.portal_my_due_installments(7, 1, 0) d)) k),
  array['amount','balance','bond_numbers','buyer_id','buyer_name','buyer_phone','campaign_id','campaign_name',
        'due_date','installment_id','installment_number','number_digits','pending_amount','sale_id','status','total_count'],
  'legacy RPC still returns exactly its original 16 columns');
reset role;

select pg_temp.act(2);
set local role authenticated;
select is((select array_agg(installment_id) from public.portal_my_campaign_due_installments(null)),
  array[pg_temp.id('i_b')], 'another collector sees exactly its own rows');
select is((select count(*)::int from public.portal_my_campaign_due_installments(pg_temp.id('c2'))),
  0, 'another collector cannot read the first collector rows');
reset role;
select pg_temp.act(3);
set local role authenticated;
select throws_ok($$select * from public.portal_my_campaign_due_installments(null)$$, '42501', null, 'operator remains denied');
reset role;
set local role anon;
select throws_ok($$select * from public.portal_my_campaign_due_installments(null)$$, '42501', null, 'anon remains denied');
reset role;

select * from finish();
rollback;
