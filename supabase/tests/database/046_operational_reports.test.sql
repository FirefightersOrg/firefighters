-- SAN-86: operational report functions (grants, access rule, aggregates, filters).
begin;
set local time zone 'America/Argentina/Buenos_Aires';
select plan(34);

insert into auth.users(id, email)
select ('a6460000-0000-0000-0000-00000000000' || n)::uuid, 'rep-' || n || '@example.com' from generate_series(1, 6) n;
insert into public.profiles(id, auth_user_id, full_name, email, status)
select ('b6460000-0000-0000-0000-00000000000' || n)::uuid, ('a6460000-0000-0000-0000-00000000000' || n)::uuid,
  'Rep ' || n, 'rep-' || n || '@example.com', 'active' from generate_series(1, 6) n;
-- 6 has no role at all.
insert into public.user_roles(user_id, role_id)
select ('b6460000-0000-0000-0000-00000000000' || v.n)::uuid, r.id
from (values (1, 'admin'), (2, 'operator'), (3, 'read-only'), (4, 'treasurer'), (5, 'collector')) v(n, name)
join public.roles r on r.name = v.name;

create function pg_temp.act_as(n int) returns void language sql as $$
select set_config('request.jwt.claims', format('{"sub":"a6460000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true) $$;
create temp table ids(k text primary key, id uuid not null);
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where k = $1 $$;
grant execute on function pg_temp.id(text), pg_temp.act_as(int) to authenticated, anon;
grant select on ids to authenticated, anon;
insert into ids select k, gen_random_uuid() from unnest(array['c', 'other', 'ca', 'cb', 'buyer', 'set', 'b1', 'b2', 'b3', 'b4', 'b5']) k;

insert into public.campaigns(id, name, simple_bond_value, installment_count, installment_value, barcode_mode)
values (pg_temp.id('c'), 'Reports', 100, 2, 50, 'base_number'), (pg_temp.id('other'), 'Other reports', 100, 2, 50, 'base_number');
insert into public.collectors(id, display_name) values (pg_temp.id('ca'), 'Ana'), (pg_temp.id('cb'), 'Beto');
insert into public.buyers(id, type, first_name) values (pg_temp.id('buyer'), 'individual', 'Eva');
insert into public.settlements(id, campaign_id, collector_id, settlement_number, created_by)
values (pg_temp.id('set'), pg_temp.id('c'), pg_temp.id('ca'), 1, 'b6460000-0000-0000-0000-000000000001');

-- b1 delivered to Ana; b2 and b3 sold by Ana; b4 delivered to Beto; b5 available.
insert into public.bonds(id, campaign_id, kind, origin, commercial_unit_count, total_value)
select pg_temp.id('b' || n), pg_temp.id('c'), 'simple', 'printed', 1, 100 from generate_series(1, 5) n;
update public.bonds set commercial_status = 'delivered_to_collector', current_collector_id = pg_temp.id('ca')
where id in (pg_temp.id('b1'), pg_temp.id('b2'), pg_temp.id('b3'));
update public.bonds set commercial_status = 'delivered_to_collector', current_collector_id = pg_temp.id('cb') where id = pg_temp.id('b4');
update public.bonds set commercial_status = 'sold', current_buyer_id = pg_temp.id('buyer')
where id in (pg_temp.id('b2'), pg_temp.id('b3'));

create temp table sale_ids(bond text primary key, sale uuid not null, plan uuid not null);
grant select on sale_ids to authenticated;
insert into public.sales(campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, sold_at, created_by)
select pg_temp.id('c'), pg_temp.id(b), pg_temp.id('buyer'), pg_temp.id('ca'), 'installments', 100, d::timestamptz,
  'b6460000-0000-0000-0000-000000000001'
from (values ('b2', '2020-03-05 12:00-03'), ('b3', '2020-03-20 12:00-03')) v(b, d);
insert into public.payment_plans(sale_id, installment_count, total_amount)
select s.id, case when b.id = pg_temp.id('b2') then 2 else 1 end, 100
from public.sales s join public.bonds b on b.id = s.bond_id;
insert into sale_ids select case when s.bond_id = pg_temp.id('b2') then 'b2' else 'b3' end, s.id, pp.id
from public.sales s join public.payment_plans pp on pp.sale_id = s.id;
-- b2: 50 due 2020-03-10 (overdue), 50 due 2099-03-10 (pending); b3: 100 due 2020-03-20, paid.
insert into public.installments(payment_plan_id, installment_number, due_date, amount)
values ((select plan from sale_ids where bond = 'b2'), 1, '2020-03-10', 50),
       ((select plan from sale_ids where bond = 'b2'), 2, '2099-03-10', 50),
       ((select plan from sale_ids where bond = 'b3'), 1, '2020-03-20', 100);
update public.installments set status = 'paid' where payment_plan_id = (select plan from sale_ids where bond = 'b3');
-- Payments in March 2020: cash 100 and transfer 40 count; a draft of 30 does not.
insert into public.payments(campaign_id, sale_id, collector_id, buyer_id, settlement_id, amount, payment_method, payment_date, status, created_by)
values (pg_temp.id('c'), (select sale from sale_ids where bond = 'b3'), pg_temp.id('ca'), pg_temp.id('buyer'), pg_temp.id('set'), 100, 'cash', '2020-03-12', 'pending_in_settlement', 'b6460000-0000-0000-0000-000000000001'),
       (pg_temp.id('c'), (select sale from sale_ids where bond = 'b2'), pg_temp.id('ca'), pg_temp.id('buyer'), pg_temp.id('set'), 40, 'transfer', '2020-03-15', 'pending_in_settlement', 'b6460000-0000-0000-0000-000000000001'),
       (pg_temp.id('c'), (select sale from sale_ids where bond = 'b2'), pg_temp.id('ca'), pg_temp.id('buyer'), null, 30, 'cash', '2020-03-16', 'draft', 'b6460000-0000-0000-0000-000000000001');

-- Grants
select is((select count(*)::int from public.role_permissions rp
  join public.permissions p on p.id = rp.permission_id join public.roles r on r.id = rp.role_id
  where p.code = 'report.view_operational' and r.name in ('admin', 'operator', 'treasurer', 'read-only')), 4,
  'admin, operator, treasurer and read-only hold report.view_operational');
select is((select count(*)::int from public.role_permissions rp
  join public.permissions p on p.id = rp.permission_id join public.roles r on r.id = rp.role_id
  where p.code = 'report.view_operational' and r.name = 'collector'), 0, 'collector lacks report.view_operational');

-- Access rule, same for the four functions
select pg_temp.act_as(2);
set local role authenticated;
select lives_ok($$select * from public.report_bonds_by_status(pg_temp.id('c'))$$, 'operator reads bonds by status');
select pg_temp.act_as(3);
select lives_ok($$select * from public.report_bonds_by_collector(pg_temp.id('c'))$$, 'read-only reads bonds by collector (no sale.view needed)');
select pg_temp.act_as(4);
select lives_ok($$select * from public.report_installments(pg_temp.id('c'))$$, 'treasurer reads installments');
select lives_ok($$select * from public.report_collector_monthly(pg_temp.id('c'), '2020-03-01')$$, 'treasurer reads the monthly summary');
select pg_temp.act_as(5);
select throws_ok($$select * from public.report_bonds_by_status(pg_temp.id('c'))$$, '42501', 'permission denied', 'collector role is denied');
select throws_ok($$select * from public.report_collector_monthly(pg_temp.id('c'), '2020-03-01')$$, '42501', 'permission denied', 'collector role is denied (monthly)');
select pg_temp.act_as(6);
select throws_ok($$select * from public.report_installments(pg_temp.id('c'))$$, '42501', 'permission denied', 'user without roles is denied');
select pg_temp.act_as(1);
select throws_ok($$select * from public.report_bonds_by_status('00000000-0000-0000-0000-00000000dead')$$, 'P0002', null, 'unknown campaign is no_data_found');
select throws_ok($$select * from public.report_collector_monthly(pg_temp.id('c'), null)$$, '22023', 'month is required', 'monthly summary needs a month');
reset role;
set local role anon;
select throws_ok($$select * from public.report_bonds_by_status('00000000-0000-0000-0000-00000000dead')$$, '42501', null, 'anon cannot execute the reports');
reset role;
set local role authenticated;
select throws_ok($$select public.report_require_operational(pg_temp.id('c'))$$, '42501', null, 'the guard is not callable directly');

-- Bonds by status
select pg_temp.act_as(1);
select results_eq($$select commercial_status, financial_status, bond_count::int, total_value from public.report_bonds_by_status(pg_temp.id('c'))$$,
  $$values ('available'::text, 'no_payments'::text, 1, '100.00'::text), ('delivered_to_collector', 'no_payments', 2, '200.00'), ('sold', 'no_payments', 2, '200.00')$$,
  'bonds by status groups both statuses');
select results_eq($$select commercial_status, bond_count::int from public.report_bonds_by_status(pg_temp.id('c'), pg_temp.id('ca'))$$,
  $$values ('delivered_to_collector'::text, 1), ('sold', 2)$$, 'bonds by status filters by collector');
select is((select count(*)::int from public.report_bonds_by_status(pg_temp.id('c'), null, 'pata')), 0, 'bonds by status filters by kind');
select results_eq($$select bond_count::int from public.report_bonds_by_status(pg_temp.id('c'), null, null, 'sold', 'no_payments')$$,
  $$values (2)$$, 'bonds by status filters by commercial and financial status');
select is((select count(*)::int from public.report_bonds_by_status(pg_temp.id('other'))), 0, 'another campaign has no rows from this one');

-- Bonds by collector
select results_eq($$select collector_name, bond_count::int, delivered_count::int, sold_count::int, total_value, sold_value from public.report_bonds_by_collector(pg_temp.id('c'))$$,
  $$values ('Ana'::text, 3, 1, 2, '300.00'::text, '200.00'::text), ('Beto', 1, 1, 0, '100.00', '0.00'), (null, 1, 0, 0, '100.00', '0.00')$$,
  'bonds by collector counts per collector, unassigned last');
select results_eq($$select collector_name from public.report_bonds_by_collector(pg_temp.id('c'), pg_temp.id('cb'))$$,
  $$values ('Beto'::text)$$, 'bonds by collector filters by collector');

-- Installments
select results_eq($$select bucket, installment_count::int, amount from public.report_installments(pg_temp.id('c'))$$,
  $$values ('overdue'::text, 1, '50.00'::text), ('paid', 1, '100.00'), ('pending', 1, '50.00')$$,
  'installments split into paid, overdue and pending (past pending counts as overdue)');
select results_eq($$select bucket from public.report_installments(pg_temp.id('c'), null, null, '2020-03-01', '2020-03-31')$$,
  $$values ('overdue'::text), ('paid')$$, 'installments filter by due date range');
select is((select count(*)::int from public.report_installments(pg_temp.id('c'), pg_temp.id('cb'))), 0, 'installments filter by collector');
select is((select count(*)::int from public.report_installments(pg_temp.id('c'), null, 'pata')), 0, 'installments filter by bond kind');

-- Monthly summary
select results_eq($$select collector_name, assigned_bonds::int, sold_bonds::int, sold_value, pending_installments::int, overdue_installments::int, overdue_amount from public.report_collector_monthly(pg_temp.id('c'), '2020-03-17')$$,
  $$values ('Ana'::text, 1, 2, '200.00'::text, 0, 1, '50.00'::text), ('Beto', 1, 0, '0.00', 0, 0, '0.00')$$,
  'monthly summary: assigned, sold and overdue for March 2020 (any date of the month)');
select results_eq($$select payments_count::int, payments_total, payments_cash, payments_transfer from public.report_collector_monthly(pg_temp.id('c'), '2020-03-01', pg_temp.id('ca'))$$,
  $$values (2, '140.00'::text, '100.00'::text, '40.00'::text)$$, 'monthly summary: payments exclude drafts and split cash/transfer');
select results_eq($$select pending_installments::int, pending_amount from public.report_collector_monthly(pg_temp.id('c'), '2099-03-01', pg_temp.id('ca'))$$,
  $$values (1, '50.00'::text)$$, 'monthly summary: pending installments of a future month');
select is((select count(*)::int from public.report_collector_monthly(pg_temp.id('c'), '2019-01-01') where sold_bonds > 0 or payments_count > 0), 0, 'monthly summary: an empty month has no activity');
select is((select count(*)::int from public.report_collector_monthly(pg_temp.id('c'), '2020-03-01', pg_temp.id('cb'))), 1, 'monthly summary filters by collector');
select results_eq($$select count(*)::int from public.report_collector_monthly(pg_temp.id('other'), '2020-03-01')$$, $$values (0)$$, 'monthly summary is scoped to the campaign');

-- Read only: no function writes
select is((select count(*)::int from public.audit_log where entity_type in ('report', 'reports')), 0, 'reports write no audit rows');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'report\_%' and p.prosecdef and p.provolatile = 's'), 5, 'the five report functions are stable security definer');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'report\_%' and p.proconfig::text like '%search_path=%'), 5, 'the report functions pin search_path');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'report\_%' and has_function_privilege('service_role', p.oid, 'execute')), 0,
  'service_role cannot execute any report function or helper');

select * from finish();
rollback;
