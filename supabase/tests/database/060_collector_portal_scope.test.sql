-- SAN-143: collector portal own-scope foundation. Two collectors are isolated on every own-scoped table
-- and function; an unlinked collector login, a linked login without the own-scope permission and an
-- inactive collector are covered; staff roles keep their global reads.
begin;
select plan(50);

-- Users: 1 collector A, 2 collector B (both role collector), 3 collector role but unlinked,
-- 4 collector role linked to an INACTIVE collector, 5 operator, 6 no role but linked to collector E.
insert into auth.users(id, email)
select ('a6600000-0000-0000-0000-00000000000' || n)::uuid, 'san143-' || n || '@example.com' from generate_series(1, 7) n;
insert into public.profiles(id, auth_user_id, full_name, email, status)
select ('b6600000-0000-0000-0000-00000000000' || n)::uuid, ('a6600000-0000-0000-0000-00000000000' || n)::uuid,
  'SAN143 ' || n, 'san143-' || n || '@example.com', 'active' from generate_series(1, 7) n;
insert into public.user_roles(user_id, role_id)
select ('b6600000-0000-0000-0000-00000000000' || v.n)::uuid, r.id
from (values (1, 'collector'), (2, 'collector'), (3, 'collector'), (4, 'collector'), (5, 'operator'), (7, 'admin')) v(n, name)
join public.roles r on r.name = v.name;

create function pg_temp.act(n int) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"a6600000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true) $$;
grant execute on function pg_temp.act(int) to authenticated, anon;

create temp table ids(k text primary key, id uuid not null default gen_random_uuid());
grant select on ids to authenticated, anon;
insert into ids(k) select unnest(array['camp', 'ca', 'cb', 'cinactive', 'ce', 'cfree', 'buyer_a', 'buyer_b',
  'bond_a', 'bond_a2', 'bond_a3', 'bond_b', 'bond_free', 'pata_a', 'member_a', 'note_a', 'note_b',
  'sale_a', 'sale_b', 'set_a', 'set_b', 'pay_a', 'pay_b', 'ledger_a', 'ledger_b', 'adj_a', 'adj_b',
  'assign_a', 'assign_b', 'camp2', 'bond_inactive']);
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where ids.k = $1 $$;
grant execute on function pg_temp.id(text) to authenticated, anon;
create function pg_temp.actor() returns uuid language sql immutable as $$ select 'b6600000-0000-0000-0000-000000000007'::uuid $$;

insert into public.campaigns(id, name, simple_bond_value, installment_count, installment_value, barcode_mode)
values (pg_temp.id('camp'), 'SAN143', 100, 1, 100, 'base_number');
insert into public.campaigns(id, name, simple_bond_value, installment_count, installment_value, barcode_mode)
values (pg_temp.id('camp2'), 'SAN143 inactive', 100, 1, 100, 'base_number');
insert into public.collectors(id, display_name, user_profile_id, status) values
  (pg_temp.id('ca'), 'SAN143 A', 'b6600000-0000-0000-0000-000000000001', 'active'),
  (pg_temp.id('cb'), 'SAN143 B', 'b6600000-0000-0000-0000-000000000002', 'active'),
  (pg_temp.id('cinactive'), 'SAN143 inactive', 'b6600000-0000-0000-0000-000000000004', 'inactive'),
  (pg_temp.id('ce'), 'SAN143 E', 'b6600000-0000-0000-0000-000000000006', 'active'),
  (pg_temp.id('cfree'), 'SAN143 unlinked', null, 'active');
insert into public.buyers(id, type, first_name, last_name, document_number, phone) values
  (pg_temp.id('buyer_a'), 'individual', 'Ana', 'Compradora', '30111222', '111'),
  (pg_temp.id('buyer_b'), 'individual', 'Beto', 'Comprador', '30333444', '222');

-- Bonds: A holds bond_a (simple), bond_a2, bond_a3 (pata) with a member; B holds bond_b; one unassigned.
insert into public.bonds(id, campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status, current_collector_id)
values
  (pg_temp.id('bond_a'), pg_temp.id('camp'), 'simple', 'printed', 1, 100, 'available', pg_temp.id('ca')),
  (pg_temp.id('bond_a2'), pg_temp.id('camp'), 'simple', 'printed', 1, 100, 'available', pg_temp.id('ca')),
  (pg_temp.id('bond_b'), pg_temp.id('camp'), 'simple', 'printed', 1, 100, 'available', pg_temp.id('cb')),
  (pg_temp.id('bond_free'), pg_temp.id('camp'), 'simple', 'printed', 1, 100, 'available', null);
insert into public.bonds(id, campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status, current_collector_id)
values (pg_temp.id('bond_inactive'), pg_temp.id('camp2'), 'simple', 'printed', 1, 100, 'available', pg_temp.id('cinactive'));
insert into public.bond_numbers(campaign_id, bond_id, number_value, number_kind) values
  (pg_temp.id('camp'), pg_temp.id('bond_a'), 1, 'base'),
  (pg_temp.id('camp'), pg_temp.id('bond_a2'), 2, 'base'),
  (pg_temp.id('camp'), pg_temp.id('bond_b'), 3, 'base'),
  (pg_temp.id('camp'), pg_temp.id('bond_free'), 4, 'base');
insert into public.bonds(id, campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status, current_collector_id)
values (pg_temp.id('pata_a'), pg_temp.id('camp'), 'pata', 'manual_grouping', 2, 200, 'available', pg_temp.id('ca'));
insert into public.bonds(id, campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
values (pg_temp.id('member_a'), pg_temp.id('camp'), 'simple', 'printed', 1, 100, 'available');
insert into public.bond_groups(pata_bond_id, member_bond_id, grouped_by)
values (pg_temp.id('pata_a'), pg_temp.id('member_a'), pg_temp.actor());
-- The pata of B, so the group visibility has a foreign counterpart.
insert into public.bonds(id, campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status, current_collector_id)
values (pg_temp.id('bond_a3'), pg_temp.id('camp'), 'pata', 'manual_grouping', 2, 200, 'available', pg_temp.id('cb'));
insert into public.bond_groups(pata_bond_id, member_bond_id, grouped_by)
select pg_temp.id('bond_a3'), b.id, pg_temp.actor()
from (select pg_temp.id('bond_free') as id) b;

insert into public.delivery_notes(id, campaign_id, note_number, collector_id, created_by) values
  (pg_temp.id('note_a'), pg_temp.id('camp'), 1, pg_temp.id('ca'), pg_temp.actor()),
  (pg_temp.id('note_b'), pg_temp.id('camp'), 2, pg_temp.id('cb'), pg_temp.actor());
insert into public.bond_assignments(id, campaign_id, bond_id, assignment_type, status, created_by, collector_id, delivery_note_id) values
  (pg_temp.id('assign_a'), pg_temp.id('camp'), pg_temp.id('bond_a'), 'delivery', 'active', pg_temp.actor(), pg_temp.id('ca'), pg_temp.id('note_a')),
  (pg_temp.id('assign_b'), pg_temp.id('camp'), pg_temp.id('bond_b'), 'delivery', 'active', pg_temp.actor(), pg_temp.id('cb'), pg_temp.id('note_b'));
insert into public.sales(id, campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by) values
  (pg_temp.id('sale_a'), pg_temp.id('camp'), pg_temp.id('bond_a'), pg_temp.id('buyer_a'), pg_temp.id('ca'), 'full_payment', 100, pg_temp.actor()),
  (pg_temp.id('sale_b'), pg_temp.id('camp'), pg_temp.id('bond_b'), pg_temp.id('buyer_b'), pg_temp.id('cb'), 'full_payment', 100, pg_temp.actor());
insert into public.settlements(id, campaign_id, settlement_number, collector_id, created_by) values
  (pg_temp.id('set_a'), pg_temp.id('camp'), 1, pg_temp.id('ca'), pg_temp.actor()),
  (pg_temp.id('set_b'), pg_temp.id('camp'), 2, pg_temp.id('cb'), pg_temp.actor());
insert into public.payments(id, campaign_id, sale_id, collector_id, buyer_id, settlement_id, amount, payment_method, status, created_by) values
  (pg_temp.id('pay_a'), pg_temp.id('camp'), pg_temp.id('sale_a'), pg_temp.id('ca'), pg_temp.id('buyer_a'), pg_temp.id('set_a'), 100, 'cash', 'pending_in_settlement', pg_temp.actor()),
  (pg_temp.id('pay_b'), pg_temp.id('camp'), pg_temp.id('sale_b'), pg_temp.id('cb'), pg_temp.id('buyer_b'), pg_temp.id('set_b'), 100, 'cash', 'pending_in_settlement', pg_temp.actor());
-- cash_settled is a reference entry since SAN-107 (#130): it never affects the balance.
insert into public.collector_ledger_entries(id, campaign_id, collector_id, entry_type, direction, amount, created_by, affects_balance) values
  (pg_temp.id('ledger_a'), pg_temp.id('camp'), pg_temp.id('ca'), 'cash_settled', 'collector_credit', 10, pg_temp.actor(), false),
  (pg_temp.id('ledger_b'), pg_temp.id('camp'), pg_temp.id('cb'), 'cash_settled', 'collector_credit', 20, pg_temp.actor(), false);
insert into public.commission_adjustments(id, campaign_id, collector_id, amount, direction, reason, created_by) values
  (pg_temp.id('adj_a'), pg_temp.id('camp'), pg_temp.id('ca'), 5, 'in_favor_of_collector', 'A adjustment', pg_temp.actor()),
  (pg_temp.id('adj_b'), pg_temp.id('camp'), pg_temp.id('cb'), 6, 'in_favor_of_collector', 'B adjustment', pg_temp.actor());

-- Counts of what the current user sees, one row per table, restricted to this test's campaign/fixtures.
create function pg_temp.seen() returns text language sql stable as $$
  select concat_ws(' ',
    'bonds=' || (select count(*) from public.bonds where campaign_id = pg_temp.id('camp')),
    'numbers=' || (select count(*) from public.bond_numbers where campaign_id = pg_temp.id('camp')),
    'groups=' || (select count(*) from public.bond_groups where pata_bond_id in (pg_temp.id('pata_a'), pg_temp.id('bond_a3'))),
    'notes=' || (select count(*) from public.delivery_notes where campaign_id = pg_temp.id('camp')),
    'assign=' || (select count(*) from public.bond_assignments where campaign_id = pg_temp.id('camp')),
    'sales=' || (select count(*) from public.sales where campaign_id = pg_temp.id('camp')),
    'pay=' || (select count(*) from public.payments where campaign_id = pg_temp.id('camp')),
    'sets=' || (select count(*) from public.settlements where campaign_id = pg_temp.id('camp')),
    'ledger=' || (select count(*) from public.collector_ledger_entries where campaign_id = pg_temp.id('camp')),
    'adj=' || (select count(*) from public.commission_adjustments where campaign_id = pg_temp.id('camp')),
    'buyers=' || (select count(*) from public.buyers where id in (pg_temp.id('buyer_a'), pg_temp.id('buyer_b'))))
$$;
grant execute on function pg_temp.seen() to authenticated, anon;

-- 1. Catalog and grants --------------------------------------------------------------------------------
select is((select array_agg(code order by code) from public.permissions where code like '%\_own'),
  array['bond.view_own', 'collector.ledger.view_own', 'payment.create_own', 'sale.view_own'], 'the four own-scope permissions exist');
select is((select array_agg(p.code order by p.code) from public.role_permissions rp join public.roles r on r.id = rp.role_id
           join public.permissions p on p.id = rp.permission_id where r.name = 'collector'),
  array['bond.view_own', 'campaign.view', 'collector.ledger.view_own', 'payment.create_own', 'sale.view_own'], 'collector holds campaign.view and the own-scope codes');
select is((select count(*)::int from public.role_permissions rp join public.roles r on r.id = rp.role_id
           join public.permissions p on p.id = rp.permission_id where p.code like '%\_own' and r.name not in ('admin', 'collector')), 0,
  'no staff role other than admin holds an own-scope code');
select ok(not exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id
                      join public.permissions p on p.id = rp.permission_id
                      where r.name = 'collector' and p.code in ('bond.view', 'sale.view', 'payment.view', 'settlement.view', 'buyer.view', 'collector.ledger.view', 'commission.view')),
  'collector holds no global view permission');

-- 2. Collector A sees only A ---------------------------------------------------------------------------
select pg_temp.act(1);
set local role authenticated;
select is(pg_temp.seen(), 'bonds=3 numbers=2 groups=1 notes=1 assign=1 sales=1 pay=1 sets=1 ledger=1 adj=1 buyers=0',
  'collector A sees only its own rows (bonds incl. pata, numbers, group via pata, delivery, sale, payment, settlement, ledger, adjustment) and no buyers');
select is((select array_agg(id order by id) from public.bonds where campaign_id = pg_temp.id('camp')),
  (select array_agg(id order by id) from ids where k in ('bond_a', 'bond_a2', 'pata_a')) , 'collector A sees exactly its bonds');
select is((select count(*)::int from public.bonds where id in (pg_temp.id('bond_b'), pg_temp.id('bond_free'), pg_temp.id('bond_a3'))), 0,
  'collector A does not see the bond of B, the unassigned one or the pata of B');
select is((select count(*)::int from public.payments where id = pg_temp.id('pay_b')), 0, 'collector A does not see the payment of B');
select is((select count(*)::int from public.collector_ledger_entries where id = pg_temp.id('ledger_b')), 0, 'collector A does not see the ledger of B');
select is((select count(*)::int from public.collectors where id in (pg_temp.id('ca'), pg_temp.id('cb'))), 1, 'collector A reads only its own collector row');
select is((select display_name from public.portal_my_collector()), 'SAN143 A', 'portal_my_collector resolves collector A from the session');
select is((select count(*)::int from public.portal_my_collector()), 1, 'portal_my_collector returns one row');
select is((select array_agg(display_name) from public.portal_my_buyers(pg_temp.id('camp'))), array['Ana Compradora'], 'portal_my_buyers returns only the buyers of A''s sales');
select is((select count(*)::int from public.portal_my_buyers(pg_temp.id('camp')) where buyer_id = pg_temp.id('buyer_b')), 0, 'portal_my_buyers hides the buyer of B');
select is((select address is null and phone = '111' from public.portal_my_buyers(pg_temp.id('camp'))), true, 'portal_my_buyers returns phone/address columns only (no document, tax id or notes)');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'portal_my_buyers' and pg_get_function_result(p.oid) ~* '(document|tax_id|notes)'),
  'the buyer function does not expose identity documents, tax ids or notes');
select is(public.is_own_collector(pg_temp.id('ca')), true, 'is_own_collector: own collector');
select is(public.is_own_collector(pg_temp.id('cb')), false, 'is_own_collector: someone else''s collector');
select is(public.is_own_collector(null), false, 'is_own_collector: null');
reset role;

-- 3. Collector B sees only B ---------------------------------------------------------------------------
select pg_temp.act(2);
set local role authenticated;
select is(pg_temp.seen(), 'bonds=2 numbers=1 groups=1 notes=1 assign=1 sales=1 pay=1 sets=1 ledger=1 adj=1 buyers=0',
  'collector B sees only its own rows');
select is((select array_agg(id order by id) from public.bonds where campaign_id = pg_temp.id('camp')),
  (select array_agg(id order by id) from ids where k in ('bond_b', 'bond_a3')), 'collector B sees exactly its bonds');
select is((select array_agg(display_name) from public.portal_my_buyers(pg_temp.id('camp'))), array['Beto Comprador'], 'portal_my_buyers for B returns only B''s buyer');
reset role;

-- 4. Unlinked collector login, inactive collector, linked login without permissions --------------------
select pg_temp.act(3);
set local role authenticated;
select is(pg_temp.seen(), 'bonds=0 numbers=0 groups=0 notes=0 assign=0 sales=0 pay=0 sets=0 ledger=0 adj=0 buyers=0', 'an unlinked collector login sees nothing');
select is((select count(*)::int from public.portal_my_collector()), 0, 'an unlinked login resolves no collector');
select is((select count(*)::int from public.portal_my_buyers(pg_temp.id('camp'))), 0, 'an unlinked login gets no buyers');
select is(public.is_own_collector(pg_temp.id('cfree')), false, 'an unlinked login owns no collector');
reset role;

select pg_temp.act(4);
set local role authenticated;
select is(pg_temp.seen(), 'bonds=0 numbers=0 groups=0 notes=0 assign=0 sales=0 pay=0 sets=0 ledger=0 adj=0 buyers=0',
  'an inactive collector with no data of its own sees nothing');
select is((select status from public.portal_my_collector()), 'inactive', 'an inactive collector still resolves (the portal can say it is inactive)');
reset role;

-- The inactive collector keeps read access to its own history (the helper never looked at status).
select pg_temp.act(4);
set local role authenticated;
select is((select count(*)::int from public.bonds where id = pg_temp.id('bond_inactive')), 1, 'an inactive collector keeps reading the bonds it holds');
reset role;

select pg_temp.act(6);
set local role authenticated;
select is(pg_temp.seen(), 'bonds=0 numbers=0 groups=0 notes=0 assign=0 sales=0 pay=0 sets=0 ledger=0 adj=0 buyers=0',
  'a profile linked to a collector but without the own-scope permissions sees nothing');
select throws_ok($$select * from public.portal_my_buyers(pg_temp.id('camp'))$$, '42501', null, 'portal_my_buyers requires sale.view_own');
-- Definer functions skip RLS: the wrappers must carry the permission (profile 6 is linked to collector E, no role).
select is(public.collector_ledger_is_own_collector(pg_temp.id('ce')), false, 'linked without permission: collector_ledger_is_own_collector is false');
select is(public.sale_is_own_collector(pg_temp.id('ce')), false, 'linked without permission: sale_is_own_collector is false');
select is(public.delivery_is_own_collector(pg_temp.id('ce')), false, 'linked without permission: delivery_is_own_collector is false');
select is(public.payment_settlement_is_own_collector(pg_temp.id('ce')), false, 'linked without permission: payment_settlement_is_own_collector is false');
select is(public.delivery_can_read(pg_temp.id('ce')), false, 'linked without permission: delivery_can_read is false');
reset role;
-- Same on collector A's own data: an operator-like profile (no *_own) is refused by the RPCs.
update public.collectors set user_profile_id = 'b6600000-0000-0000-0000-000000000005' where id = pg_temp.id('cfree');
select pg_temp.act(5);
set local role authenticated;
select throws_ok($$select public.collector_ledger_balance(pg_temp.id('camp'), pg_temp.id('cfree'))$$, '42501', null, 'RPC collector_ledger_balance refuses a linked profile without collector.ledger.view_own');
select throws_ok($$select * from public.collector_ledger_entries_with_balance(pg_temp.id('camp'), pg_temp.id('cfree'))$$, '42501', null, 'RPC entries_with_balance refuses a linked profile without collector.ledger.view_own');
reset role;
select pg_temp.act(1);
set local role authenticated;
select lives_ok($$select public.collector_ledger_balance(pg_temp.id('camp'), pg_temp.id('ca'))$$, 'collector A (with the permission) still reads its own balance');
reset role;

-- 5. Staff roles are unchanged ---------------------------------------------------------------------------
select pg_temp.act(5);
set local role authenticated;
select is(pg_temp.seen(), 'bonds=7 numbers=4 groups=2 notes=2 assign=2 sales=2 pay=2 sets=2 ledger=0 adj=0 buyers=2',
  'operator: global bond/sale/payment/settlement/buyer reads, no ledger or commissions (as before)');
select throws_ok($$select * from public.portal_my_buyers(pg_temp.id('camp'))$$, '42501', null, 'operator cannot use the portal buyer function');
reset role;
select pg_temp.act(7);
set local role authenticated;
select is(pg_temp.seen(), 'bonds=7 numbers=4 groups=2 notes=2 assign=2 sales=2 pay=2 sets=2 ledger=2 adj=2 buyers=2', 'admin reads everything');
reset role;

-- 6. Grants and the single helper --------------------------------------------------------------------------
select is(has_function_privilege('anon', 'public.is_own_collector(uuid)', 'execute'), false, 'anon cannot execute is_own_collector');
select is(has_function_privilege('service_role', 'public.is_own_collector(uuid)', 'execute'), false, 'service_role cannot execute is_own_collector');
select is(has_function_privilege('authenticated', 'public.is_own_collector(uuid)', 'execute'), true, 'authenticated executes is_own_collector');
select is(has_function_privilege('anon', 'public.portal_my_collector()', 'execute') or has_function_privilege('anon', 'public.portal_my_buyers(uuid)', 'execute'), false, 'anon cannot execute the portal functions');
select is(has_function_privilege('service_role', 'public.portal_my_collector()', 'execute') or has_function_privilege('service_role', 'public.portal_my_buyers(uuid)', 'execute'), false, 'service_role cannot execute the portal functions');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('is_own_collector', 'portal_my_collector', 'portal_my_buyers')
             and p.prosecdef and p.proconfig @> array['search_path=""'] ), 3, 'the three new functions are SECURITY DEFINER with an empty search_path');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('delivery_is_own_collector', 'sale_is_own_collector',
             'payment_settlement_is_own_collector', 'collector_ledger_is_own_collector') and p.prosrc ~ 'is_own_collector\(p_collector_id\)'), 4,
  'the four per-domain helpers only delegate to is_own_collector');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'buyers' and qual ~ 'own'), 0, 'buyers_select has no own-scope clause');

select * from finish();
rollback;
