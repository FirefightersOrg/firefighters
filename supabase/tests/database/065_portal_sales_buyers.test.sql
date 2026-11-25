-- SAN-145: collector portal read functions (sales, installments, payments, buyers, due list).
-- Two collectors are isolated; operator (no sale.view_own) and anon are denied; grants and definer settings are checked.
begin;
select plan(31);

insert into auth.users(id, email)
select ('a6610000-0000-0000-0000-00000000000' || n)::uuid, 'san145-' || n || '@example.com' from generate_series(1, 3) n;
insert into public.profiles(id, auth_user_id, full_name, email, status)
select ('b6610000-0000-0000-0000-00000000000' || n)::uuid, ('a6610000-0000-0000-0000-00000000000' || n)::uuid,
  'SAN145 ' || n, 'san145-' || n || '@example.com', 'active' from generate_series(1, 3) n;
insert into public.user_roles(user_id, role_id)
select ('b6610000-0000-0000-0000-00000000000' || v.n)::uuid, r.id
from (values (1, 'collector'), (2, 'collector'), (3, 'operator')) v(n, name)
join public.roles r on r.name = v.name;

create function pg_temp.act(n int) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"a6610000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true) $$;
grant execute on function pg_temp.act(int) to authenticated, anon;

create temp table ids(k text primary key, id uuid not null default gen_random_uuid());
grant select on ids to authenticated, anon;
insert into ids(k) select unnest(array['camp', 'ca', 'cb', 'buyer_a', 'buyer_b', 'buyer_shared', 'buyer_annulled', 'bond_a3', 'sale_a3', 'bond_a', 'bond_a2', 'bond_b',
  'sale_a', 'sale_a2', 'sale_b', 'plan_a', 'plan_a2', 'plan_b', 'i_a1', 'i_a2', 'i_a3', 'i_a21', 'i_b1', 'set_a', 'pay_a', 'pay_a_draft']);
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where ids.k = $1 $$;
grant execute on function pg_temp.id(text) to authenticated, anon;
create function pg_temp.actor() returns uuid language sql immutable as $$ select 'b6610000-0000-0000-0000-000000000003'::uuid $$;

insert into public.campaigns(id, name, simple_bond_value, installment_count, installment_value, barcode_mode)
values (pg_temp.id('camp'), 'SAN145', 300, 3, 100, 'base_number');
insert into public.collectors(id, display_name, user_profile_id, status) values
  (pg_temp.id('ca'), 'SAN145 A', 'b6610000-0000-0000-0000-000000000001', 'active'),
  (pg_temp.id('cb'), 'SAN145 B', 'b6610000-0000-0000-0000-000000000002', 'active');
insert into public.buyers(id, type, first_name, last_name, business_name, document_number, tax_id, phone, address, notes) values
  (pg_temp.id('buyer_a'), 'individual', 'Ana', 'Compradora', null, '30111222', '20301112224', '111', 'Calle A 1', 'secret note'),
  (pg_temp.id('buyer_b'), 'individual', 'Beto', 'Comprador', null, '30333444', null, '222', 'Calle B 2', null),
  (pg_temp.id('buyer_shared'), 'business', null, null, 'Comercio Compartido', null, null, '333', 'Calle C 3', null),
  (pg_temp.id('buyer_annulled'), 'individual', 'Ines', 'Anulada', null, '30555666', null, '444', 'Calle D 4', null);

insert into public.bonds(id, campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status, current_collector_id) values
  (pg_temp.id('bond_a'), pg_temp.id('camp'), 'simple', 'printed', 1, 300, 'available', pg_temp.id('ca')),
  (pg_temp.id('bond_a2'), pg_temp.id('camp'), 'simple', 'printed', 1, 300, 'available', pg_temp.id('ca')),
  (pg_temp.id('bond_b'), pg_temp.id('camp'), 'simple', 'printed', 1, 300, 'available', pg_temp.id('cb')),
  (pg_temp.id('bond_a3'), pg_temp.id('camp'), 'simple', 'printed', 1, 300, 'available', pg_temp.id('ca'));
insert into public.bond_numbers(campaign_id, bond_id, number_value, number_kind) values
  (pg_temp.id('camp'), pg_temp.id('bond_a'), 11, 'base'),
  (pg_temp.id('camp'), pg_temp.id('bond_a2'), 12, 'base'),
  (pg_temp.id('camp'), pg_temp.id('bond_b'), 13, 'base'),
  (pg_temp.id('camp'), pg_temp.id('bond_a3'), 14, 'base');

-- A sells bond_a to buyer_a and bond_a2 to the shared buyer; B sells bond_b to the shared buyer too.
insert into public.sales(id, campaign_id, bond_id, buyer_id, collector_id, sold_at, payment_mode, total_amount, created_by) values
  (pg_temp.id('sale_a'), pg_temp.id('camp'), pg_temp.id('bond_a'), pg_temp.id('buyer_a'), pg_temp.id('ca'), now() - interval '2 days', 'installments', 300, pg_temp.actor()),
  (pg_temp.id('sale_a2'), pg_temp.id('camp'), pg_temp.id('bond_a2'), pg_temp.id('buyer_shared'), pg_temp.id('ca'), now() - interval '1 day', 'full_payment', 100, pg_temp.actor()),
  (pg_temp.id('sale_b'), pg_temp.id('camp'), pg_temp.id('bond_b'), pg_temp.id('buyer_b'), pg_temp.id('cb'), now(), 'full_payment', 100, pg_temp.actor());
-- A third own sale, to a buyer whose ONLY own sale ends up annulled.
insert into public.sales(id, campaign_id, bond_id, buyer_id, collector_id, sold_at, payment_mode, total_amount, created_by)
values (pg_temp.id('sale_a3'), pg_temp.id('camp'), pg_temp.id('bond_a3'), pg_temp.id('buyer_annulled'), pg_temp.id('ca'), now() - interval '3 days', 'full_payment', 100, pg_temp.actor());
update public.sales set status = 'annulled' where id = pg_temp.id('sale_a3');
insert into public.payment_plans(id, sale_id, installment_count, total_amount) values
  (pg_temp.id('plan_a'), pg_temp.id('sale_a'), 3, 300),
  (pg_temp.id('plan_a2'), pg_temp.id('sale_a2'), 1, 100),
  (pg_temp.id('plan_b'), pg_temp.id('sale_b'), 1, 100);
-- Installment 1 paid, 2 due in the past (overdue, with 40 pending in a settlement), 3 due far ahead.
insert into public.installments(id, payment_plan_id, installment_number, due_date, amount, status) values
  (pg_temp.id('i_a1'), pg_temp.id('plan_a'), 1, current_date - 40, 100, 'pending'),
  (pg_temp.id('i_a2'), pg_temp.id('plan_a'), 2, current_date - 10, 100, 'pending'),
  (pg_temp.id('i_a3'), pg_temp.id('plan_a'), 3, current_date + 60, 100, 'pending'),
  (pg_temp.id('i_a21'), pg_temp.id('plan_a2'), 1, current_date + 3, 100, 'pending'),
  (pg_temp.id('i_b1'), pg_temp.id('plan_b'), 1, current_date - 5, 100, 'pending');
update public.installments set status = 'paid' where id = pg_temp.id('i_a1');
insert into public.settlements(id, campaign_id, settlement_number, collector_id, created_by)
values (pg_temp.id('set_a'), pg_temp.id('camp'), 1, pg_temp.id('ca'), pg_temp.actor());
insert into public.payments(id, campaign_id, sale_id, collector_id, buyer_id, settlement_id, amount, payment_method, status, created_by) values
  (pg_temp.id('pay_a'), pg_temp.id('camp'), pg_temp.id('sale_a'), pg_temp.id('ca'), pg_temp.id('buyer_a'), pg_temp.id('set_a'), 40, 'cash', 'pending_in_settlement', pg_temp.actor());
insert into public.payment_installments(payment_id, installment_id, amount_applied) values (pg_temp.id('pay_a'), pg_temp.id('i_a2'), 40);

-- 1. Collector A ---------------------------------------------------------------------------------------
select pg_temp.act(1);
set local role authenticated;
select is((select count(*)::int from public.portal_my_sales()), 3, 'A lists its three sales (the annulled one included)');
select is((select array_agg(sale_id order by sold_at desc) from public.portal_my_sales()), array[pg_temp.id('sale_a2'), pg_temp.id('sale_a'), pg_temp.id('sale_a3')], 'newest sale first');
select is((select total_count from public.portal_my_sales(null, 1, 0)), 3::bigint, 'total_count ignores the page size');
select is((select sale_id from public.portal_my_sales(null, 1, 1)), pg_temp.id('sale_a'), 'offset gives the second page');
select is((select array[paid_amount, pending_amount, balance] from public.portal_my_sales() where sale_id = pg_temp.id('sale_a')),
  array[0::numeric, 40, 160], 'sale totals: pending in settlement counted apart, balance excludes paid and pending');
select is((select overdue_count from public.portal_my_sales() where sale_id = pg_temp.id('sale_a')), 1, 'one overdue installment');
select is((select bond_numbers from public.portal_my_sales() where sale_id = pg_temp.id('sale_a')), array[11], 'bond numbers');
select is((select count(*)::int from public.portal_my_sale(pg_temp.id('sale_a'))), 1, 'A reads its sale');
select is((select buyer_address from public.portal_my_sale(pg_temp.id('sale_a'))), 'Calle A 1', 'buyer address is returned');
select is((select count(*)::int from public.portal_my_sale(pg_temp.id('sale_b'))), 0, 'A cannot read the sale of B');
select is((select status from public.portal_my_sale_installments(pg_temp.id('sale_a')) where installment_number = 2), 'overdue', 'past-due pending installment shows as overdue');
select is((select count(*)::int from public.portal_my_sale_installments(pg_temp.id('sale_b'))), 0, 'no installments of the sale of B');
select is((select status from public.portal_my_sale_payments(pg_temp.id('sale_a'))), 'pending_in_settlement', 'pending payment is flagged');
select is((select count(*)::int from public.portal_my_sale_payments(pg_temp.id('sale_b'))), 0, 'no payments of the sale of B');
select is((select count(*)::int from public.portal_my_buyers_page()), 2, 'A has two buyers');
select is((select count(*)::int from public.portal_my_buyer(pg_temp.id('buyer_b'))), 0, 'buyer of B is invisible to A');
select is((select count(*)::int from public.portal_my_buyer(pg_temp.id('buyer_shared'))), 1, 'a shared buyer is visible through the own sale');
select is((select count(*)::int from public.portal_my_buyer(pg_temp.id('buyer_annulled'))), 0, 'a buyer whose own sale is annulled is not reachable by id (same as the list)');
select is((select count(*)::int from public.portal_my_buyers_page() where buyer_id = pg_temp.id('buyer_annulled')), 0, 'and is not in the list either');
select is((select count(*)::int from public.portal_my_buyers_page(20, 100)) + (select count(*)::int from public.portal_my_sales(null, 20, 100)), 0, 'a page past the end is empty (no unfiltered installments scan)');
select is((select count(*)::int from public.portal_my_buyer_sales(pg_temp.id('buyer_shared'))), 1, 'only the own sale of a shared buyer');
select is((select array_agg(installment_number order by due_date) from public.portal_my_due_installments(7)), array[2, 1], 'due list: overdue then due within 7 days');
select is((select count(*)::int from public.portal_my_due_installments(7) where status = 'overdue' and balance = 60), 1, 'due balance deducts the pending payment');
select is((select count(*)::int from public.buyers), 0, 'buyers table stays closed');
reset role;

-- 2. Collector B ---------------------------------------------------------------------------------------
select pg_temp.act(2);
set local role authenticated;
select is((select array_agg(sale_id) from public.portal_my_sales()), array[pg_temp.id('sale_b')], 'B sees only its sale');
select is((select count(*)::int from public.portal_my_sale(pg_temp.id('sale_a'))), 0, 'B cannot read the sale of A');
reset role;

-- 3. Denied ------------------------------------------------------------------------------------------------
select pg_temp.act(3);
set local role authenticated;
select throws_ok($$select * from public.portal_my_sales()$$, '42501', null, 'operator (no sale.view_own) is denied');
reset role;
set local role anon;
select throws_ok($$select * from public.portal_my_sales()$$, '42501', null, 'anon cannot execute the portal sales function');
reset role;

-- 4. Grants and definer settings ---------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('portal_my_sales', 'portal_my_sale', 'portal_my_sale_installments',
             'portal_my_sale_payments', 'portal_my_buyers_page', 'portal_my_buyer', 'portal_my_buyer_sales',
             'portal_my_due_installments', 'portal_own_installments', 'portal_require_sale_view_own')
             and p.prosecdef and p.proconfig @> array['search_path=""']), 10, 'all ten functions are SECURITY DEFINER with an empty search_path');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('portal_my_collector', 'portal_my_sales', 'portal_my_sale', 'portal_my_sale_installments',
               'portal_my_sale_payments', 'portal_my_buyers_page', 'portal_my_buyer', 'portal_my_buyer_sales', 'portal_my_due_installments',
               'portal_my_buyers')
             and has_function_privilege('authenticated', p.oid, 'execute')
             and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 12,
  'the twelve portal_my functions are granted to authenticated only (portal_my_collector from SAN-143 and the two SAN-146 ledger reads included)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('portal_own_installments', 'portal_require_sale_view_own')
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
                  or has_function_privilege('service_role', p.oid, 'execute'))), 0, 'internal helpers are not executable by API roles');

select * from finish();
rollback;
