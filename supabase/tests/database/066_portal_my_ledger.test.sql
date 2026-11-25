-- SAN-146: portal_my_ledger_summary / portal_my_ledger. Two collectors are isolated, annulled entries are listed
-- but not counted, pages are stable and newest first, balances match the treasury view, no internal notes leak,
-- and callers without collector.ledger.view_own are refused.
begin;
select plan(26);

-- Users: 1 collector A, 2 collector B, 3 collector role but unlinked, 4 operator (no own-scope permission), 5 admin (actor).
insert into auth.users(id, email)
select ('a6620000-0000-0000-0000-00000000000' || n)::uuid, 'san146-' || n || '@example.com' from generate_series(1, 5) n;
insert into public.profiles(id, auth_user_id, full_name, email, status)
select ('b6620000-0000-0000-0000-00000000000' || n)::uuid, ('a6620000-0000-0000-0000-00000000000' || n)::uuid,
  'SAN146 ' || n, 'san146-' || n || '@example.com', 'active' from generate_series(1, 5) n;
insert into public.user_roles(user_id, role_id)
select ('b6620000-0000-0000-0000-00000000000' || v.n)::uuid, r.id
from (values (1, 'collector'), (2, 'collector'), (3, 'collector'), (4, 'operator'), (5, 'admin')) v(n, name)
join public.roles r on r.name = v.name;

create function pg_temp.act(n int) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"a6620000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true) $$;
grant execute on function pg_temp.act(int) to authenticated, anon;

create temp table ids(k text primary key, id uuid not null default gen_random_uuid());
grant select on ids to authenticated, anon;
insert into ids(k) select unnest(array['camp', 'ca', 'cb', 'set_a', 'set_b']);
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where ids.k = $1 $$;
grant execute on function pg_temp.id(text) to authenticated, anon;
create function pg_temp.actor() returns uuid language sql immutable as $$ select 'b6620000-0000-0000-0000-000000000005'::uuid $$;

insert into public.campaigns(id, name, simple_bond_value, installment_count, installment_value, barcode_mode)
values (pg_temp.id('camp'), 'SAN146', 100, 1, 100, 'base_number');
insert into public.collectors(id, display_name, user_profile_id, status) values
  (pg_temp.id('ca'), 'SAN146 A', 'b6620000-0000-0000-0000-000000000001', 'active'),
  (pg_temp.id('cb'), 'SAN146 B', 'b6620000-0000-0000-0000-000000000002', 'active');
insert into public.settlements(id, campaign_id, settlement_number, collector_id, created_by) values
  (pg_temp.id('set_a'), pg_temp.id('camp'), 1, pg_temp.id('ca'), pg_temp.actor()),
  (pg_temp.id('set_b'), pg_temp.id('camp'), 2, pg_temp.id('cb'), pg_temp.actor());

-- A: +100 commission, -30 adjustment (internal reason), +500 annulled adjustment, -20 settled. Balance 50.
insert into public.collector_ledger_entries(campaign_id, collector_id, settlement_id, entry_type, direction, amount, occurred_at, created_by, reason) values
  (pg_temp.id('camp'), pg_temp.id('ca'), pg_temp.id('set_a'), 'commission_generated', 'collector_credit', 100, '2026-11-01T10:00:00Z', pg_temp.actor(), null),
  (pg_temp.id('camp'), pg_temp.id('ca'), null, 'adjustment_in_favor_of_firefighters', 'collector_debit', 30, '2026-11-02T10:00:00Z', pg_temp.actor(), 'internal treasury note'),
  (pg_temp.id('camp'), pg_temp.id('cb'), pg_temp.id('set_b'), 'commission_generated', 'collector_credit', 999, '2026-11-01T11:00:00Z', pg_temp.actor(), null);
insert into public.collector_ledger_entries(campaign_id, collector_id, entry_type, direction, amount, occurred_at, created_by, reason) values
  (pg_temp.id('camp'), pg_temp.id('ca'), 'adjustment_in_favor_of_collector', 'collector_credit', 500, '2026-11-03T10:00:00Z', pg_temp.actor(), 'wrong');
update public.collector_ledger_entries set status = 'annulled', annulled_by = pg_temp.actor(), annulled_at = '2026-11-03T11:00:00Z',
  annul_reason = 'internal annul note' where amount = 500 and collector_id = pg_temp.id('ca');
insert into public.collector_ledger_entries(campaign_id, collector_id, entry_type, direction, amount, occurred_at, created_by) values
  (pg_temp.id('camp'), pg_temp.id('ca'), 'commission_settled', 'collector_debit', 20, '2026-11-04T10:00:00Z', pg_temp.actor());

-- 1. Collector A ----------------------------------------------------------------------------------------
select pg_temp.act(1);
set local role authenticated;
select is((select balance from public.portal_my_ledger_summary(pg_temp.id('camp'))), 50.00, 'A: balance excludes the annulled entry');
select is((select commission_generated from public.portal_my_ledger_summary(pg_temp.id('camp'))), 100.00, 'A: commissions generated');
select is((select commission_adjusted from public.portal_my_ledger_summary(pg_temp.id('camp'))), -30.00, 'A: commissions adjusted (annulled adjustment not counted)');
select is((select commission_settled from public.portal_my_ledger_summary(pg_temp.id('camp'))), 20.00, 'A: commissions settled');
select is((select entry_count from public.portal_my_ledger_summary(pg_temp.id('camp'))), 4::bigint, 'A: four entries counted, annulled included');
select is((select array_agg(entry_type order by occurred_at desc) from public.portal_my_ledger(pg_temp.id('camp'))),
  array['commission_settled', 'adjustment_in_favor_of_collector', 'adjustment_in_favor_of_firefighters', 'commission_generated'],
  'A: entries come newest first and the annulled one is listed');
select is((select max(total_count) from public.portal_my_ledger(pg_temp.id('camp'))), 4::bigint, 'A: total_count is the full size');
select is((select array_agg(entry_type order by occurred_at desc) from public.portal_my_ledger(pg_temp.id('camp'), 2, 2)),
  array['adjustment_in_favor_of_firefighters', 'commission_generated'], 'A: the second page holds the two oldest entries');
select is((select array_agg(entry_type order by occurred_at desc) from public.portal_my_ledger(pg_temp.id('camp'), 2, 0)),
  array['commission_settled', 'adjustment_in_favor_of_collector'], 'A: the first page holds the two newest entries');
select is((select running_balance from public.portal_my_ledger(pg_temp.id('camp')) order by occurred_at desc limit 1), 50.00, 'A: the newest running balance is the balance');
select is((select running_balance from public.portal_my_ledger(pg_temp.id('camp')) where status = 'annulled'), 70.00, 'A: an annulled entry adds 0 to the running balance');
select is((select array_agg(running_balance order by occurred_at) from public.portal_my_ledger(pg_temp.id('camp'))),
  (select array_agg(running_balance order by occurred_at) from public.collector_ledger_entries_with_balance(pg_temp.id('camp'), pg_temp.id('ca'))),
  'A: running balances match the treasury view');
select is((select bool_and(affects_balance) from public.portal_my_ledger(pg_temp.id('camp'))), true, 'A: every entry affects the balance (no reference entries)');
select is((select settlement_number from public.portal_my_ledger(pg_temp.id('camp')) where entry_type = 'commission_generated'), 1, 'A: the own settlement number is returned');
select is((select count(*)::int from pg_proc p where p.proname = 'portal_my_ledger'
   and pg_get_function_result(p.oid) ~* '(reason|notes|created_by|collector_id)'), 0, 'no internal notes or collector id in the result');
select throws_ok(format('select * from public.portal_my_ledger(%L)', gen_random_uuid()), 'P0002', null, 'an unknown campaign is not found');
select throws_ok(format('select * from public.portal_my_ledger(%L, 0, 0)', pg_temp.id('camp')), '22023', null, 'a page of 0 entries is refused');
select throws_ok(format('select * from public.portal_my_ledger(%L, 25, -1)', pg_temp.id('camp')), '22023', null, 'a negative offset is refused');

-- 2. Collector B only sees B -------------------------------------------------------------------------------
select pg_temp.act(2);
select is((select balance from public.portal_my_ledger_summary(pg_temp.id('camp'))), 999.00, 'B: its own balance');
select is((select count(*)::int from public.portal_my_ledger(pg_temp.id('camp'))), 1, 'B: one entry, none of A');
select is((select settlement_number from public.portal_my_ledger(pg_temp.id('camp'))), 2, 'B: its own settlement number');

-- 3. Unlinked collector login and operator ----------------------------------------------------------------
select pg_temp.act(3);
select is((select count(*)::int from public.portal_my_ledger(pg_temp.id('camp'))) + (select count(*)::int from public.portal_my_ledger_summary(pg_temp.id('camp'))), 0, 'an unlinked login gets nothing');
select pg_temp.act(4);
select throws_ok(format('select * from public.portal_my_ledger(%L)', pg_temp.id('camp')), '42501', null, 'the operator has no own-scope permission (ledger)');
select throws_ok(format('select * from public.portal_my_ledger_summary(%L)', pg_temp.id('camp')), '42501', null, 'the operator has no own-scope permission (summary)');

-- 4. Grants -------------------------------------------------------------------------------------------------
reset role;
select is(has_function_privilege('anon', 'public.portal_my_ledger(uuid,integer,integer)', 'execute')
       or has_function_privilege('service_role', 'public.portal_my_ledger(uuid,integer,integer)', 'execute')
       or has_function_privilege('anon', 'public.portal_my_ledger_summary(uuid)', 'execute')
       or has_function_privilege('service_role', 'public.portal_my_ledger_summary(uuid)', 'execute'), false, 'anon and service_role cannot execute');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('portal_my_ledger', 'portal_my_ledger_summary')
             and p.prosecdef and p.proconfig @> array['search_path=""']), 2, 'both are SECURITY DEFINER with an empty search_path');

select * from finish();
rollback;
