-- SAN-148: portal_my_campaign_buyers / portal_my_campaign_due_installments (campaign-scoped portal).
-- The campaign filter narrows the lists; a NULL campaign gives the SAN-145 result; collectors stay isolated;
-- an operator (no sale.view_own) and anon are denied; the old functions delegate and still work.
begin;
select plan(16);

insert into auth.users(id, email)
select ('a6810000-0000-0000-0000-00000000000' || n)::uuid, 'san148-' || n || '@example.com' from generate_series(1, 3) n;
insert into public.profiles(id, auth_user_id, full_name, email, status)
select ('b6810000-0000-0000-0000-00000000000' || n)::uuid, ('a6810000-0000-0000-0000-00000000000' || n)::uuid,
  'SAN148 ' || n, 'san148-' || n || '@example.com', 'active' from generate_series(1, 3) n;
insert into public.user_roles(user_id, role_id)
select ('b6810000-0000-0000-0000-00000000000' || v.n)::uuid, r.id
from (values (1, 'collector'), (2, 'collector'), (3, 'operator')) v(n, name)
join public.roles r on r.name = v.name;

create function pg_temp.act(n int) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"a6810000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true) $$;
grant execute on function pg_temp.act(int) to authenticated, anon;

create temp table ids(k text primary key, id uuid not null default gen_random_uuid());
grant select on ids to authenticated, anon;
insert into ids(k) select unnest(array['c1', 'c2', 'ca', 'cb', 'buyer_a1', 'buyer_a2', 'buyer_b', 'bond_a1', 'bond_a2', 'bond_b',
  'sale_a1', 'sale_a2', 'sale_b', 'plan_a1', 'plan_a2', 'plan_b', 'i_a1', 'i_a2', 'i_b']);
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where ids.k = $1 $$;
grant execute on function pg_temp.id(text) to authenticated, anon;
create function pg_temp.actor() returns uuid language sql immutable as $$ select 'b6810000-0000-0000-0000-000000000003'::uuid $$;

insert into public.campaigns(id, name, simple_bond_value, installment_count, installment_value, barcode_mode) values
  (pg_temp.id('c1'), 'SAN148 one', 300, 1, 300, 'base_number'),
  (pg_temp.id('c2'), 'SAN148 two', 300, 1, 300, 'base_number');
insert into public.collectors(id, display_name, user_profile_id, status) values
  (pg_temp.id('ca'), 'SAN148 A', 'b6810000-0000-0000-0000-000000000001', 'active'),
  (pg_temp.id('cb'), 'SAN148 B', 'b6810000-0000-0000-0000-000000000002', 'active');
insert into public.buyers(id, type, first_name, last_name, phone, address) values
  (pg_temp.id('buyer_a1'), 'individual', 'Ana', 'Uno', '111', 'Calle 1'),
  (pg_temp.id('buyer_a2'), 'individual', 'Ada', 'Dos', '222', 'Calle 2'),
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
  (pg_temp.id('i_a1'), pg_temp.id('plan_a1'), 1, current_date - 5, 300, 'pending'),
  (pg_temp.id('i_a2'), pg_temp.id('plan_a2'), 1, current_date + 2, 300, 'pending'),
  (pg_temp.id('i_b'), pg_temp.id('plan_b'), 1, current_date - 5, 300, 'pending');

-- 1. Collector A ---------------------------------------------------------------------------------------
select pg_temp.act(1);
set local role authenticated;
select is((select array_agg(buyer_id) from public.portal_my_campaign_buyers(pg_temp.id('c1'))), array[pg_temp.id('buyer_a1')], 'buyers of campaign one: only the own buyer of that campaign');
select is((select array_agg(buyer_id) from public.portal_my_campaign_buyers(pg_temp.id('c2'))), array[pg_temp.id('buyer_a2')], 'buyers of campaign two');
select is((select count(*)::int from public.portal_my_campaign_buyers(null)), 2, 'a NULL campaign gives every own buyer');
select is((select balance from public.portal_my_campaign_buyers(pg_temp.id('c1'))), 300::numeric, 'the balance counts only the sales of the campaign');
select is((select total_count from public.portal_my_campaign_buyers(pg_temp.id('c1'), 1, 0)), 1::bigint, 'total_count follows the filter');
select is((select array_agg(installment_id) from public.portal_my_campaign_due_installments(pg_temp.id('c1'))), array[pg_temp.id('i_a1')], 'due list of campaign one');
select is((select count(*)::int from public.portal_my_campaign_due_installments(pg_temp.id('c2'), 1)), 0, 'campaign two has nothing due within one day');
select is((select count(*)::int from public.portal_my_campaign_due_installments(null)), 2, 'a NULL campaign gives every own due installment');
select is((select count(*)::int from public.portal_my_buyers_page()), 2, 'the SAN-145 buyers function still answers (delegates with NULL)');
select is((select count(*)::int from public.portal_my_due_installments(7)), 2, 'the SAN-145 due function still answers (delegates with NULL)');
reset role;

-- A collector cannot register a collection on an annulled own sale (SAN-148: denial of the Phase 16 criteria).
update public.campaigns set status = 'active', starts_at = current_date - 1, ends_at = current_date + 30 where id = pg_temp.id('c1');
update public.sales set status = 'annulled' where id = pg_temp.id('sale_a1');
select pg_temp.act(1);
set local role authenticated;
select throws_ok(format($$select public.portal_payment_submit(%L, 10, 'cash', %L::jsonb, current_date)$$, pg_temp.id('sale_a1'),
  json_build_array(json_build_object('installment_id', pg_temp.id('i_a1'), 'amount_applied', 10))::text),
  '22023', 'sale must be active', 'an annulled own sale cannot receive a collection');
select throws_ok(format($$select public.portal_payment_submit(%L, 10, 'cash', %L::jsonb, current_date)$$, pg_temp.id('sale_b'),
  json_build_array(json_build_object('installment_id', pg_temp.id('i_b'), 'amount_applied', 10))::text),
  'P0002', null, 'the sale of another collector answers not found');
reset role;

-- 2. Collector B ---------------------------------------------------------------------------------------
select pg_temp.act(2);
set local role authenticated;
select is((select array_agg(buyer_id) from public.portal_my_campaign_buyers(pg_temp.id('c1'))), array[pg_temp.id('buyer_b')], 'B sees only its own buyer, never A''s');
reset role;

-- 3. Denied ------------------------------------------------------------------------------------------------
select pg_temp.act(3);
set local role authenticated;
select throws_ok($$select * from public.portal_my_campaign_buyers(null)$$, '42501', null, 'operator is denied (buyers)');
select throws_ok($$select * from public.portal_my_campaign_due_installments(null)$$, '42501', null, 'operator is denied (due list)');
reset role;
set local role anon;
select throws_ok($$select * from public.portal_my_campaign_buyers(null)$$, '42501', null, 'anon cannot execute the campaign buyers function');
reset role;

select * from finish();
rollback;
