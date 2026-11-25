-- SAN-87: financial and draw report functions (grants, access rule, aggregates, filters).
begin;
set local time zone 'America/Argentina/Buenos_Aires';
select plan(50);

insert into auth.users(id, email)
select ('a6470000-0000-0000-0000-00000000000' || n)::uuid, 'frep-' || n || '@example.com' from generate_series(1, 6) n;
insert into public.profiles(id, auth_user_id, full_name, email, status)
select ('b6470000-0000-0000-0000-00000000000' || n)::uuid, ('a6470000-0000-0000-0000-00000000000' || n)::uuid,
  'FRep ' || n, 'frep-' || n || '@example.com', 'active' from generate_series(1, 6) n;
-- 6 has no role at all.
insert into public.user_roles(user_id, role_id)
select ('b6470000-0000-0000-0000-00000000000' || v.n)::uuid, r.id
from (values (1, 'admin'), (2, 'operator'), (3, 'read-only'), (4, 'treasurer'), (5, 'collector')) v(n, name)
join public.roles r on r.name = v.name;

create function pg_temp.act_as(n int) returns void language sql as $$
select set_config('request.jwt.claims', format('{"sub":"a6470000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true) $$;
create temp table ids(k text primary key, id uuid not null);
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where k = $1 $$;
grant execute on function pg_temp.id(text), pg_temp.act_as(int) to authenticated, anon;
grant select on ids to authenticated, anon;
insert into ids select k, gen_random_uuid() from unnest(array['c', 'other', 'od', 'ca', 'cb', 'buyer', 'set1', 'set2', 'set3', 'b2', 'b3',
  'bn1', 'bn2', 'bn3', 'd1', 'd2', 'r1', 'e1', 'e2', 'e3', 'p1', 'p2', 'p3', 'w1', 'a1']) k;

create function pg_temp.actor() returns uuid language sql immutable as $$ select 'b6470000-0000-0000-0000-000000000001'::uuid $$;
grant execute on function pg_temp.actor() to authenticated, anon;

insert into public.campaigns(id, name, simple_bond_value, installment_count, installment_value, barcode_mode, max_number, associated_number_offset)
values (pg_temp.id('c'), 'FReports', 100, 2, 50, 'base_number', 999, 100),
       (pg_temp.id('other'), 'Other freports', 100, 2, 50, 'base_number', 999, 100);
insert into public.collectors(id, display_name) values (pg_temp.id('ca'), 'Ana'), (pg_temp.id('cb'), 'Beto');
insert into public.buyers(id, type, first_name, last_name) values (pg_temp.id('buyer'), 'individual', 'Eva', 'Paz');

insert into public.bonds(id, campaign_id, kind, origin, commercial_unit_count, total_value)
select pg_temp.id(b), pg_temp.id('c'), 'simple', 'printed', 1, 100 from unnest(array['b2', 'b3']) b;
update public.bonds set commercial_status = 'delivered_to_collector', current_collector_id = pg_temp.id('ca')
where id in (pg_temp.id('b2'), pg_temp.id('b3'));
update public.bonds set commercial_status = 'sold', current_buyer_id = pg_temp.id('buyer')
where id in (pg_temp.id('b2'), pg_temp.id('b3'));
insert into public.bond_numbers(id, campaign_id, bond_id, number_value, number_kind)
values (pg_temp.id('bn1'), pg_temp.id('c'), pg_temp.id('b2'), 1, 'base'),
       (pg_temp.id('bn2'), pg_temp.id('c'), pg_temp.id('b3'), 2, 'base');

create temp table sale_ids(bond text primary key, sale uuid not null);
grant select on sale_ids to authenticated;
insert into public.sales(campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, sold_at, created_by)
select pg_temp.id('c'), pg_temp.id(b), pg_temp.id('buyer'), pg_temp.id('ca'), 'installments', 100, '2020-03-05 12:00-03', pg_temp.actor()
from unnest(array['b2', 'b3']) b;
insert into sale_ids select case when s.bond_id = pg_temp.id('b2') then 'b2' else 'b3' end, s.id from public.sales s;

-- Settlements: Ana has an open one (1) and a closed one (2); Beto has an open one (3).
insert into public.settlements(id, campaign_id, collector_id, settlement_number, created_by, total_cash, total_transfer, total_amount, commission_amount, net_to_firefighters, opened_at)
values (pg_temp.id('set1'), pg_temp.id('c'), pg_temp.id('ca'), 1, pg_temp.actor(), 100, 40, 140, 14, 126, '2020-03-12 12:00-03'),
       (pg_temp.id('set3'), pg_temp.id('c'), pg_temp.id('cb'), 3, pg_temp.actor(), 50, 0, 50, 5, 45, '2020-04-02 12:00-03');
insert into public.settlements(id, campaign_id, collector_id, settlement_number, created_by, total_cash, total_transfer, total_amount, commission_amount, commission_paid_amount, net_to_firefighters, opened_at)
values (pg_temp.id('set2'), pg_temp.id('c'), pg_temp.id('ca'), 2, pg_temp.actor(), 30, 0, 30, 3, 3, 27, '2020-03-30 12:00-03');
update public.settlements set status = 'closed', closed_at = '2020-03-31 12:00-03', closed_by = pg_temp.actor() where id = pg_temp.id('set2');

-- Payments: cash 100 and transfer 40 on March 2020, cash 10 in April, a draft of 30 (not counted).
insert into public.payments(campaign_id, sale_id, collector_id, buyer_id, settlement_id, amount, payment_method, payment_date, status, created_by)
values (pg_temp.id('c'), (select sale from sale_ids where bond = 'b3'), pg_temp.id('ca'), pg_temp.id('buyer'), pg_temp.id('set1'), 100, 'cash', '2020-03-12', 'pending_in_settlement', pg_temp.actor()),
       (pg_temp.id('c'), (select sale from sale_ids where bond = 'b2'), pg_temp.id('ca'), pg_temp.id('buyer'), pg_temp.id('set1'), 40, 'transfer', '2020-03-15', 'pending_in_settlement', pg_temp.actor()),
       (pg_temp.id('c'), (select sale from sale_ids where bond = 'b2'), pg_temp.id('cb'), pg_temp.id('buyer'), pg_temp.id('set3'), 10, 'cash', '2020-04-01', 'pending_in_settlement', pg_temp.actor()),
       (pg_temp.id('c'), (select sale from sale_ids where bond = 'b2'), pg_temp.id('ca'), pg_temp.id('buyer'), null, 30, 'cash', '2020-03-16', 'draft', pg_temp.actor());

-- Ledger of Ana: +20 (Mar 12), -5 (Mar 20), an annulled +7 (Mar 21, no effect). Balance 15.
insert into public.collector_ledger_entries(campaign_id, collector_id, settlement_id, entry_type, direction, amount, occurred_at, created_by)
values (pg_temp.id('c'), pg_temp.id('ca'), pg_temp.id('set1'), 'commission_generated', 'collector_credit', 20, '2020-03-12 10:00-03', pg_temp.actor()),
       (pg_temp.id('c'), pg_temp.id('ca'), null, 'cash_settled', 'collector_debit', 5, '2020-03-20 10:00-03', pg_temp.actor()),
       (pg_temp.id('c'), pg_temp.id('ca'), null, 'adjustment_in_favor_of_collector', 'collector_credit', 7, '2020-03-21 10:00-03', pg_temp.actor());
update public.collector_ledger_entries set status = 'annulled', annulled_by = pg_temp.actor(), annulled_at = now(), annul_reason = 'mistake'
where entry_type = 'adjustment_in_favor_of_collector' and collector_id = pg_temp.id('ca');

-- Draws: d1 has a frozen roster (1 eligible, 1 ineligible); d2 has none; od belongs to another campaign.
insert into public.draws(id, campaign_id, draw_type, name, draw_date, payment_cutoff_at, required_installment_number, created_by)
values (pg_temp.id('d1'), pg_temp.id('c'), 'final', 'Final draw', '2020-05-01', now(), null, pg_temp.actor()),
       (pg_temp.id('d2'), pg_temp.id('c'), 'monthly', 'Monthly draw', '2020-06-01', now(), 1, pg_temp.actor()),
       (pg_temp.id('od'), pg_temp.id('other'), 'monthly', 'Other draw', '2020-06-01', now(), 1, pg_temp.actor());
insert into public.draw_rosters(id, draw_id, generated_by, created_by) values (pg_temp.id('r1'), pg_temp.id('d1'), pg_temp.actor(), pg_temp.actor());
insert into public.draw_roster_entries(id, draw_roster_id, bond_id, bond_number_id, number_value, buyer_snapshot, collector_snapshot, eligible, ineligibility_reason, created_by)
values (pg_temp.id('e1'), pg_temp.id('r1'), pg_temp.id('b2'), pg_temp.id('bn1'), 1, jsonb_build_object('id', pg_temp.id('buyer'), 'first_name', 'Eva', 'last_name', 'Paz'), jsonb_build_object('id', pg_temp.id('ca'), 'display_name', 'Ana'), true, null, pg_temp.actor()),
       (pg_temp.id('e2'), pg_temp.id('r1'), pg_temp.id('b3'), pg_temp.id('bn2'), 2, '{"business_name":"Taller SRL"}', '{"display_name":"Beto"}', false, 'not_fully_paid', pg_temp.actor());
update public.draws set status = 'roster_generated' where id = pg_temp.id('d1');
update public.draw_rosters set status = 'frozen', frozen_at = now(), frozen_by = pg_temp.actor() where id = pg_temp.id('r1');
update public.draws set status = 'roster_frozen' where id = pg_temp.id('d1');

-- Prizes of d1: p1 awarded to number 1 (with its award), p2 unawarded, p3 annulled.
insert into public.prizes(id, draw_id, name, position, created_by)
values (pg_temp.id('p1'), pg_temp.id('d1'), 'First prize', 1, pg_temp.actor()),
       (pg_temp.id('p2'), pg_temp.id('d1'), 'Second prize', 2, pg_temp.actor()),
       (pg_temp.id('p3'), pg_temp.id('d1'), 'Third prize', 3, pg_temp.actor());
insert into public.winning_numbers(id, draw_id, prize_id, number_value, matched_roster_entry_id, result_status, loaded_by, created_by)
values (pg_temp.id('w1'), pg_temp.id('d1'), pg_temp.id('p1'), 1, pg_temp.id('e1'), 'eligible_winner', pg_temp.actor(), pg_temp.actor());
insert into public.prize_awards(id, prize_id, winning_number_id, bond_id, buyer_id, collector_id, created_by)
values (pg_temp.id('a1'), pg_temp.id('p1'), pg_temp.id('w1'), pg_temp.id('b2'), pg_temp.id('buyer'), pg_temp.id('ca'), pg_temp.actor());
update public.prizes set status = 'awarded' where id = pg_temp.id('p1');
update public.prizes set status = 'unawarded' where id = pg_temp.id('p2');
update public.prizes set status = 'awarded' where id = pg_temp.id('p3');
update public.prizes set status = 'annulled', annulled_at = now(), annulled_by = pg_temp.actor(), annul_reason = 'loaded by mistake' where id = pg_temp.id('p3');

-- Grants
select is((select count(*)::int from public.role_permissions rp
  join public.permissions p on p.id = rp.permission_id join public.roles r on r.id = rp.role_id
  where p.code = 'report.export' and r.name in ('admin', 'operator', 'treasurer', 'read-only')), 4,
  'admin, operator, treasurer and read-only hold report.export');
select is((select count(*)::int from public.role_permissions rp
  join public.permissions p on p.id = rp.permission_id join public.roles r on r.id = rp.role_id
  where p.code in ('report.export', 'report.view_financial') and r.name in ('collector')), 0, 'collector holds neither');
select is((select count(*)::int from public.role_permissions rp
  join public.permissions p on p.id = rp.permission_id join public.roles r on r.id = rp.role_id
  where p.code = 'report.view_financial' and r.name = 'operator'), 0, 'operator lacks report.view_financial');

-- Access rule, same for the seven functions
select pg_temp.act_as(1);
set local role authenticated;
select lives_ok($$select * from public.report_payments_by_date(pg_temp.id('c'))$$, 'admin reads payments by date');
select pg_temp.act_as(3);
select lives_ok($$select * from public.report_settlements_by_collector(pg_temp.id('c'))$$, 'read-only reads settlements (no settlement.view needed)');
select lives_ok($$select * from public.report_collector_accounts(pg_temp.id('c'))$$, 'read-only reads collector accounts (no collector.ledger.view needed)');
select pg_temp.act_as(4);
select lives_ok($$select * from public.report_collector_ledger(pg_temp.id('c'), pg_temp.id('ca'))$$, 'treasurer reads the account detail');
select lives_ok($$select * from public.report_draw_rosters(pg_temp.id('c'))$$, 'treasurer reads draw rosters');
select lives_ok($$select * from public.report_draw_roster_entries(pg_temp.id('c'), pg_temp.id('d1'))$$, 'treasurer reads roster entries');
select lives_ok($$select * from public.report_prizes(pg_temp.id('c'))$$, 'treasurer reads prizes');
select pg_temp.act_as(2);
select throws_ok($$select * from public.report_payments_by_date(pg_temp.id('c'))$$, '42501', 'permission denied', 'operator (operational only) is denied');
select throws_ok($$select * from public.report_prizes(pg_temp.id('c'))$$, '42501', 'permission denied', 'operator is denied the prizes');
select pg_temp.act_as(5);
select throws_ok($$select * from public.report_collector_accounts(pg_temp.id('c'))$$, '42501', 'permission denied', 'collector role is denied');
select pg_temp.act_as(6);
select throws_ok($$select * from public.report_draw_rosters(pg_temp.id('c'))$$, '42501', 'permission denied', 'user without roles is denied');
select pg_temp.act_as(1);
select throws_ok($$select * from public.report_payments_by_date('00000000-0000-0000-0000-00000000dead')$$, 'P0002', null, 'unknown campaign is no_data_found');
select throws_ok($$select * from public.report_collector_ledger(pg_temp.id('c'), null)$$, '22023', 'collector is required', 'the account detail needs a collector');
select throws_ok($$select * from public.report_draw_roster_entries(pg_temp.id('c'), null)$$, '22023', 'draw is required', 'the roster entries need a draw');
select throws_ok($$select * from public.report_draw_roster_entries(pg_temp.id('c'), pg_temp.id('od'))$$, 'P0002', null, 'a draw of another campaign is no_data_found');
reset role;
set local role anon;
select throws_ok($$select * from public.report_payments_by_date('00000000-0000-0000-0000-00000000dead')$$, '42501', null, 'anon cannot execute the reports');
reset role;
set local role authenticated;
select throws_ok($$select public.report_require_financial(pg_temp.id('c'))$$, '42501', null, 'the guard is not callable directly');

-- Payments by date
select pg_temp.act_as(1);
select results_eq($$select payment_date::text, payment_method, payment_count::int, total from public.report_payments_by_date(pg_temp.id('c'))$$,
  $$values ('2020-03-12'::text, 'cash'::text, 1, '100.00'::text), ('2020-03-15', 'transfer', 1, '40.00'), ('2020-04-01', 'cash', 1, '10.00')$$,
  'payments by date and method exclude the draft');
select results_eq($$select payment_method, total from public.report_payments_by_date(pg_temp.id('c'), null, 'transfer')$$,
  $$values ('transfer'::text, '40.00'::text)$$, 'payments filter by method');
select results_eq($$select total from public.report_payments_by_date(pg_temp.id('c'), pg_temp.id('cb'))$$,
  $$values ('10.00'::text)$$, 'payments filter by collector');
select results_eq($$select payment_date::text from public.report_payments_by_date(pg_temp.id('c'), null, null, '2020-03-13', '2020-03-31')$$,
  $$values ('2020-03-15'::text)$$, 'payments filter by date range (inclusive)');
select is((select count(*)::int from public.report_payments_by_date(pg_temp.id('other'))), 0, 'payments are scoped to the campaign');

-- Settlements by collector
select results_eq($$select collector_name, status, settlement_count::int, total_amount, commission_amount, net_to_firefighters from public.report_settlements_by_collector(pg_temp.id('c'))$$,
  $$values ('Ana'::text, 'closed'::text, 1, '30.00'::text, '3.00'::text, '27.00'::text), ('Ana', 'open', 1, '140.00', '14.00', '126.00'), ('Beto', 'open', 1, '50.00', '5.00', '45.00')$$,
  'settlements group by collector and status');
select results_eq($$select collector_name, status from public.report_settlements_by_collector(pg_temp.id('c'), null, 'closed')$$,
  $$values ('Ana'::text, 'closed'::text)$$, 'settlements filter by status');
select results_eq($$select collector_name from public.report_settlements_by_collector(pg_temp.id('c'), null, null, '2020-04-01', '2020-04-30')$$,
  $$values ('Beto'::text)$$, 'settlements filter by opening date');
select is((select count(*)::int from public.report_settlements_by_collector(pg_temp.id('c'), pg_temp.id('cb'))), 1, 'settlements filter by collector');

-- Collector accounts and ledger
select results_eq($$select collector_name, entry_count::int, credit_total, debit_total, balance, last_entry_on::text from public.report_collector_accounts(pg_temp.id('c'))$$,
  $$values ('Ana'::text, 2, '20.00'::text, '5.00'::text, '15.00'::text, '2020-03-20'::text)$$,
  'collector accounts ignore annulled entries and skip collectors without entries');
select is((select count(*)::int from public.report_collector_accounts(pg_temp.id('c'), pg_temp.id('cb'))), 0, 'collector accounts filter by collector');
select results_eq($$select occurred_on::text, occurred_time, entry_type, amount, status, settlement_number, running_balance from public.report_collector_ledger(pg_temp.id('c'), pg_temp.id('ca'))$$,
  $$values ('2020-03-12'::text, '10:00'::text, 'commission_generated'::text, '20.00'::text, 'recorded'::text, 1, '20.00'::text),
           ('2020-03-20', '10:00', 'cash_settled', '5.00', 'recorded', null, '15.00'),
           ('2020-03-21', '10:00', 'adjustment_in_favor_of_collector', '7.00', 'annulled', null, '15.00')$$,
  'account detail lists the entries with the running balance (annulled kept, no effect)');
select results_eq($$select running_balance from public.report_collector_ledger(pg_temp.id('c'), pg_temp.id('ca'), '2020-03-20', '2020-03-20')$$,
  $$values ('15.00'::text)$$, 'account detail by date keeps the running balance of the whole account');
select is((select count(*)::int from public.report_collector_ledger(pg_temp.id('c'), pg_temp.id('ca'), null, null, 2, 0)), 2, 'account detail honours the page size');
select results_eq($$select entry_type from public.report_collector_ledger(pg_temp.id('c'), pg_temp.id('ca'), null, null, 2, 2)$$,
  $$values ('adjustment_in_favor_of_collector'::text)$$, 'account detail honours the offset');
select is((select count(*)::int from public.report_collector_ledger(pg_temp.id('other'), pg_temp.id('ca'))), 0, 'account detail is scoped to the campaign');

-- Draw rosters
select results_eq($$select draw_name, roster_status, eligible_count::int, ineligible_count::int from public.report_draw_rosters(pg_temp.id('c'))$$,
  $$values ('Final draw'::text, 'frozen'::text, 1, 1), ('Monthly draw', null, 0, 0)$$,
  'draw rosters count the frozen roster, drawn in date order');
select results_eq($$select number_value, eligible, ineligibility_reason, buyer_name, collector_name from public.report_draw_roster_entries(pg_temp.id('c'), pg_temp.id('d1'))$$,
  $$values (1, true, null, 'Eva Paz'::text, 'Ana'::text), (2, false, 'not_fully_paid'::text, 'Taller SRL', 'Beto')$$,
  'roster entries list eligible and ineligible numbers with snapshot names');
select results_eq($$select number_value from public.report_draw_roster_entries(pg_temp.id('c'), pg_temp.id('d1'), false)$$,
  $$values (2)$$, 'roster entries filter ineligible numbers');
select results_eq($$select number_value from public.report_draw_roster_entries(pg_temp.id('c'), pg_temp.id('d1'), true, 1, 0)$$,
  $$values (1)$$, 'roster entries filter eligible numbers and page');
select is((select count(*)::int from public.report_draw_roster_entries(pg_temp.id('c'), pg_temp.id('d2'))), 0, 'a draw without a frozen roster has no entries');

-- Prizes
select results_eq($$select prize_name, prize_status, winning_number, result_status, buyer_name, collector_name, award_status from public.report_prizes(pg_temp.id('c'))$$,
  $$values ('First prize'::text, 'awarded'::text, 1, 'eligible_winner'::text, 'Eva Paz'::text, 'Ana'::text, 'awarded'::text),
           ('Second prize', 'unawarded', null, null, null, null, null),
           ('Third prize', 'annulled', null, null, null, null, null)$$,
  'prizes list winners, unawarded and annulled prizes');
select results_eq($$select prize_name from public.report_prizes(pg_temp.id('c'), pg_temp.id('d1'), 'unawarded')$$,
  $$values ('Second prize'::text)$$, 'prizes filter by status and draw');
select is((select count(*)::int from public.report_prizes(pg_temp.id('c'), pg_temp.id('d2'))), 0, 'prizes filter by draw');
reset role;
update public.buyers set first_name = 'Renombrada' where id = pg_temp.id('buyer');
set local role authenticated;
select results_eq($$select buyer_name from public.report_prizes(pg_temp.id('c'), pg_temp.id('d1'), 'awarded')$$,
  $$values ('Eva Paz'::text)$$, 'prizes show the frozen roster snapshot name, as the certificates do, after the buyer is renamed');
select is((select count(*)::int from public.report_prizes(pg_temp.id('other'))), 0, 'prizes are scoped to the campaign');

-- Read only and hardening
select is((select count(*)::int from public.audit_log where entity_type in ('report', 'reports')), 0, 'reports write no audit rows');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'report\_%' and p.prosecdef and p.provolatile = 's'), 14, 'all report functions are stable security definer');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'report\_%' and p.proconfig::text like '%search_path=%'), 14, 'the report functions pin search_path');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'report\_%' and p.proname <> 'report_require_financial' and p.proname <> 'report_require_operational'
    and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
    and not has_function_privilege('service_role', p.oid, 'execute')), 12, 'report functions: authenticated only (SAN-87 and SAN-142 functions also revoke service_role)');

select * from finish();
rollback;
