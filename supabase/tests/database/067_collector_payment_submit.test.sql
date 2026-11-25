-- SAN-147: the collector registers a collection (draft); the operator includes it in a settlement or rejects it.
begin;
set local timezone = 'America/Argentina/Buenos_Aires';
select plan(51);

insert into auth.users(id, email)
select ('a6700000-0000-0000-0000-00000000000' || n)::uuid, 'san147-' || n || '@example.com' from generate_series(1, 4) n;
insert into public.profiles(id, auth_user_id, full_name, email, status)
select ('b6700000-0000-0000-0000-00000000000' || n)::uuid, ('a6700000-0000-0000-0000-00000000000' || n)::uuid,
  'SAN147 ' || n, 'san147-' || n || '@example.com', 'active' from generate_series(1, 4) n;
insert into public.user_roles(user_id, role_id)
select ('b6700000-0000-0000-0000-00000000000' || v.n)::uuid, r.id
from (values (1, 'collector'), (2, 'collector'), (3, 'admin'), (4, 'collector')) v(n, name)
join public.roles r on r.name = v.name;

create function pg_temp.act(n int) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"a6700000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true) $$;
grant execute on function pg_temp.act(int) to authenticated, anon;
create temp table ids(k text primary key, id uuid not null default gen_random_uuid());
grant select, insert on ids to authenticated, anon;
insert into ids(k) select unnest(array['camp', 'ca', 'cb', 'cc', 'buyer', 'bond_a', 'bond_b', 'sale_a', 'sale_b', 'plan_a', 'plan_b',
  'i_a1', 'i_a2', 'i_b1', 'set_a', 'set_b', 'p1', 'p2', 'p3', 'p_op', 'op_draft']);
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where ids.k = $1 $$;
grant execute on function pg_temp.id(text) to authenticated, anon;
create function pg_temp.app(i text, a numeric) returns jsonb language sql stable as $$
  select jsonb_build_array(jsonb_build_object('installment_id', pg_temp.id(i), 'amount_applied', a)) $$;
grant execute on function pg_temp.app(text, numeric) to authenticated, anon;
create function pg_temp.today() returns date language sql stable as $$ select (now() at time zone 'America/Argentina/Buenos_Aires')::date $$;
grant execute on function pg_temp.today() to authenticated, anon;

insert into public.campaigns(id, name, simple_bond_value, installment_count, installment_value, barcode_mode)
values (pg_temp.id('camp'), 'SAN147', 200, 2, 100, 'base_number');
update public.campaigns set status = 'active', starts_at = current_date - 1, ends_at = current_date + 365 where id = pg_temp.id('camp');
insert into public.collectors(id, display_name, user_profile_id, status) values
  (pg_temp.id('ca'), 'A', 'b6700000-0000-0000-0000-000000000001', 'active'),
  (pg_temp.id('cb'), 'B', 'b6700000-0000-0000-0000-000000000002', 'active'),
  (pg_temp.id('cc'), 'C inactive', 'b6700000-0000-0000-0000-000000000004', 'inactive');
insert into public.buyers(id, type, first_name, last_name) values (pg_temp.id('buyer'), 'individual', 'Ana', 'Compradora');
insert into public.bonds(id, campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status, current_collector_id) values
  (pg_temp.id('bond_a'), pg_temp.id('camp'), 'simple', 'printed', 1, 200, 'available', pg_temp.id('ca')),
  (pg_temp.id('bond_b'), pg_temp.id('camp'), 'simple', 'printed', 1, 200, 'available', pg_temp.id('cb'));
insert into public.bond_numbers(campaign_id, bond_id, number_value, number_kind) values
  (pg_temp.id('camp'), pg_temp.id('bond_a'), 21, 'base'), (pg_temp.id('camp'), pg_temp.id('bond_b'), 22, 'base');
insert into public.sales(id, campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by) values
  (pg_temp.id('sale_a'), pg_temp.id('camp'), pg_temp.id('bond_a'), pg_temp.id('buyer'), pg_temp.id('ca'), 'installments', 200, 'b6700000-0000-0000-0000-000000000003'),
  (pg_temp.id('sale_b'), pg_temp.id('camp'), pg_temp.id('bond_b'), pg_temp.id('buyer'), pg_temp.id('cb'), 'installments', 100, 'b6700000-0000-0000-0000-000000000003');
insert into public.payment_plans(id, sale_id, installment_count, total_amount) values
  (pg_temp.id('plan_a'), pg_temp.id('sale_a'), 2, 200), (pg_temp.id('plan_b'), pg_temp.id('sale_b'), 1, 100);
insert into public.installments(id, payment_plan_id, installment_number, due_date, amount) values
  (pg_temp.id('i_a1'), pg_temp.id('plan_a'), 1, current_date + 5, 100),
  (pg_temp.id('i_a2'), pg_temp.id('plan_a'), 2, current_date + 35, 100),
  (pg_temp.id('i_b1'), pg_temp.id('plan_b'), 1, current_date + 5, 100);

-- 1. Grants and definer settings ------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('portal_payment_submit', 'settlement_attach_collector_payment', 'settlement_reject_collector_payment',
                    'portal_my_sale_submissions', 'portal_my_sale_reserved')
  and p.prosecdef and p.proconfig @> array['search_path=""']), 5, 'five SECURITY DEFINER functions with an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('portal_payment_submit', 'settlement_attach_collector_payment', 'settlement_reject_collector_payment',
                    'portal_my_sale_submissions', 'portal_my_sale_reserved')
  and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
  and not has_function_privilege('service_role', p.oid, 'execute')), 5, 'executable by authenticated only');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('payments_collector_submission_guard', 'payments_guard_update')
  and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('service_role', p.oid, 'execute'))), 0, 'trigger functions are not executable by API roles');

-- 2. Collector A submits ----------------------------------------------------------------------------------
select pg_temp.act(1);
set local role authenticated;
select lives_ok($$ insert into ids(k, id) values ('s1', public.portal_payment_submit(pg_temp.id('sale_a'), 60, 'cash', pg_temp.app('i_a1', 60), null, 'req-147-1')) $$, 'A submits 60 in cash');
reset role;
select is((select array[status, submitted_by_collector::text, (settlement_id is null)::text, collector_id::text, payment_date::text]
  from public.payments where id = (select id from ids where k = 's1')),
  array['draft', 'true', 'true', pg_temp.id('ca')::text, pg_temp.today()::text], 'draft, no settlement, own collector, default date is Buenos Aires today');
select is((select array[(select status from public.installments where id = pg_temp.id('i_a1')),
  (select count(*)::text from public.collector_ledger_entries), (select financial_status_snapshot from public.bonds where id = pg_temp.id('bond_a'))]),
  array['pending', '0', (select financial_status_snapshot from public.bonds where id = pg_temp.id('bond_a'))],
  'a draft changes no installment, ledger entry or financial snapshot');
select is((select count(*)::int from public.audit_log where action = 'payment.collector_submit' and request_id = 'req-147-1'
  and actor_user_id = 'b6700000-0000-0000-0000-000000000001'), 1, 'submission is audited with actor and request id');

select pg_temp.act(1);
set local role authenticated;
select is(public.portal_payment_submit(pg_temp.id('sale_a'), 60, 'cash', pg_temp.app('i_a1', 60), null, 'req-147-1'),
  (select id from ids where k = 's1'), 'the same request id is idempotent (double click)');
select throws_ok($$ select public.portal_payment_submit(pg_temp.id('sale_a'), 10, 'cash', pg_temp.app('i_a1', 10), pg_temp.today() + 1) $$,
  '22023', 'payment date cannot be in the future', 'a future date (Buenos Aires today) is rejected');
select lives_ok($$ select public.portal_payment_submit(pg_temp.id('sale_a'), 10, 'cash', pg_temp.app('i_a1', 10), pg_temp.today()) $$,
  'today is accepted');
select throws_ok($$ select public.portal_payment_submit(pg_temp.id('sale_a'), 40, 'transfer', pg_temp.app('i_a1', 40)) $$,
  '23514', 'payment applications exceed installment amount', 'other drafts reserve the installment balance (60 + 10 + 40 > 100)');
select lives_ok($$ select public.portal_payment_submit(pg_temp.id('sale_a'), 30, 'transfer', pg_temp.app('i_a1', 30)) $$,
  'the exact remaining balance is accepted');
select throws_ok($$ select public.portal_payment_submit(pg_temp.id('sale_a'), 0, 'cash', pg_temp.app('i_a2', 1)) $$, '22023', null, 'zero amount');
select throws_ok($$ select public.portal_payment_submit(pg_temp.id('sale_a'), 10, 'check', pg_temp.app('i_a2', 10)) $$, '22023', null, 'method outside cash/transfer');
select throws_ok($$ select public.portal_payment_submit(pg_temp.id('sale_a'), 10, 'cash', pg_temp.app('i_a2', 9)) $$, '22023',
  'payment applications must equal the payment amount', 'applications must add up to the amount');
select throws_ok($$ select public.portal_payment_submit(pg_temp.id('sale_a'), 10, 'cash', pg_temp.app('i_b1', 10)) $$, '23514', null,
  'an installment of another sale is rejected');
select throws_ok($$ select public.portal_payment_submit(pg_temp.id('sale_b'), 10, 'cash', pg_temp.app('i_b1', 10)) $$, 'P0002', null,
  'A cannot submit for the sale of B');
select is((select count(*)::int from public.portal_my_sale_submissions(pg_temp.id('sale_a'))), 3, 'A sees the three drafts it submitted');
select is((select submitted_amount from public.portal_my_sale_reserved(pg_temp.id('sale_a')) where installment_id = pg_temp.id('i_a1')),
  100::numeric, 'reserved balance per installment');
-- direct writes are closed
select throws_ok($$ update public.payments set status = 'confirmed' $$, '42501', null, 'a collector cannot update payments directly');
select throws_ok($$ select public.settlement_attach_collector_payment(pg_temp.id('set_a'), (select id from ids where k = 's1')) $$,
  '42501', null, 'a collector cannot include a payment in a settlement');
select throws_ok($$ select public.settlement_reject_collector_payment((select id from ids where k = 's1'), 'no') $$,
  '42501', null, 'a collector cannot reject or annul');
reset role;

-- 3. Collector B, admin without collector, inactive collector, anon ----------------------------------------
select pg_temp.act(2);
set local role authenticated;
select throws_ok($$ select public.portal_payment_submit(pg_temp.id('sale_a'), 10, 'cash', pg_temp.app('i_a1', 10)) $$, 'P0002', null,
  'B cannot submit for the sale of A');
select is((select count(*)::int from public.portal_my_sale_submissions(pg_temp.id('sale_a'))), 0, 'B sees no submissions of A');
reset role;
select pg_temp.act(3);
set local role authenticated;
select throws_ok($$ select public.portal_payment_submit(pg_temp.id('sale_a'), 10, 'cash', pg_temp.app('i_a1', 10)) $$, '42501', null,
  'a profile without a collector cannot submit (collector is never taken from input)');
reset role;
select pg_temp.act(4);
set local role authenticated;
select throws_ok($$ select public.portal_payment_submit(pg_temp.id('sale_a'), 10, 'cash', pg_temp.app('i_a1', 10)) $$, '42501', null,
  'an inactive collector cannot submit');
reset role;
set local role anon;
select throws_ok($$ select public.portal_payment_submit(pg_temp.id('sale_a'), 10, 'cash', pg_temp.app('i_a1', 10)) $$, '42501', null, 'anon is denied');
reset role;

-- 4. Operator: include, reject, close -------------------------------------------------------------------------
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$ insert into ids(k, id) values ('sa', public.settlement_open(pg_temp.id('camp'), pg_temp.id('ca'))) $$, 'operator opens a settlement for A');
select lives_ok($$ insert into ids(k, id) values ('sb', public.settlement_open(pg_temp.id('camp'), pg_temp.id('cb'))) $$, 'operator opens a settlement for B');
select is((select total_amount from public.settlement_totals((select id from ids where k = 'sa'))), 0::numeric, 'drafts do not count in the settlement totals');
select throws_ok($$ select public.settlement_attach_collector_payment((select id from ids where k = 'sb'), (select id from ids where k = 's1')) $$,
  '22023', null, 'a draft cannot enter the settlement of another collector');
select throws_ok($$ select public.settlement_reject_collector_payment((select id from ids where k = 's1'), '  ') $$, '22023', null, 'rejection needs a reason');
select lives_ok($$ select public.settlement_attach_collector_payment((select id from ids where k = 'sa'), (select id from ids where k = 's1'), 'req-att') $$,
  'operator includes the 60 draft');
select is((select total_amount from public.settlement_totals((select id from ids where k = 'sa'))), 60::numeric, 'only the included payment counts');
select throws_ok($$ select public.settlement_attach_collector_payment((select id from ids where k = 'sa'), (select id from ids where k = 's1')) $$,
  '55000', null, 'an already included payment cannot be included again');
reset role;
insert into ids(k, id) select 'd10', id from public.payments where amount = 10 and submitted_by_collector;
insert into ids(k, id) select 'd30', id from public.payments where amount = 30 and submitted_by_collector;
insert into public.payments(id, campaign_id, sale_id, collector_id, buyer_id, amount, payment_method, status, created_by)
values (pg_temp.id('p_op'), pg_temp.id('camp'), pg_temp.id('sale_a'), pg_temp.id('ca'), pg_temp.id('buyer'), 5, 'cash', 'draft', 'b6700000-0000-0000-0000-000000000003');

select pg_temp.act(3);
set local role authenticated;
select lives_ok($$ select public.settlement_reject_collector_payment((select id from ids where k = 'd10'), ' Monto no recibido ', 'req-rej') $$, 'operator rejects a draft with a reason');
select throws_ok($$ select public.settlement_attach_collector_payment((select id from ids where k = 'sa'), (select id from ids where k = 'd10')) $$,
  '55000', null, 'a rejected payment cannot be included');
select throws_ok($$ select public.settlement_reject_collector_payment(pg_temp.id('p_op'), 'no') $$, '55000', null, 'only collector submissions can be rejected here');
select throws_ok($$ select public.settlement_attach_collector_payment((select id from ids where k = 'sa'), pg_temp.id('p_op')) $$, '55000', null, 'only collector submissions can be included here');
reset role;
select is((select array[status, annulment_reason] from public.payments where id = (select id from ids where k = 'd10')),
  array['annulled', 'Monto no recibido'], 'rejected draft is annulled with its reason');
select is((select count(*)::int from public.audit_log where (action, request_id) in (('payment.collector_attach', 'req-att'), ('payment.collector_reject', 'req-rej'))
  and actor_user_id = 'b6700000-0000-0000-0000-000000000003'), 2, 'include and reject are audited with actor and request id');

select pg_temp.act(1);
set local role authenticated;
select is((select rejection_reason from public.portal_my_sale_submissions(pg_temp.id('sale_a')) where payment_id = (select id from ids where k = 'd10')),
  'Monto no recibido', 'the collector sees the rejection reason');
select is((select submitted_amount from public.portal_my_sale_reserved(pg_temp.id('sale_a')) where installment_id = pg_temp.id('i_a1')),
  30::numeric, 'a rejected or included draft stops reserving as a draft');
reset role;

-- Guards (as the table owner: triggers still fire).
select throws_ok($$ update public.payments set status = 'confirmed' where id = (select id from ids where k = 'd30') $$, '23514', null, 'draft cannot jump to confirmed');
select throws_ok($$ update public.payments set submitted_by_collector = false where id = (select id from ids where k = 'd30') $$, '23001', null, 'origin flag is immutable');
select throws_ok($$ insert into public.payments(campaign_id, sale_id, collector_id, buyer_id, amount, payment_method, status, created_by, submitted_by_collector)
  values (pg_temp.id('camp'), pg_temp.id('sale_a'), pg_temp.id('ca'), pg_temp.id('buyer'), 1, 'cash', 'confirmed', 'b6700000-0000-0000-0000-000000000003', true) $$,
  '23514', null, 'a collector submission cannot start confirmed');

-- Close: only included payments are confirmed.
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$ select public.settlement_attach_collector_payment((select id from ids where k = 'sa'), (select id from ids where k = 'd30')) $$, 'include the 30 draft');
select lives_ok($$ select public.settlement_close((select id from ids where k = 'sa')) $$, 'operator closes the settlement');
reset role;
select is((select array_agg(status order by amount) from public.payments where submitted_by_collector), array['annulled', 'confirmed', 'confirmed'],
  'close confirmed exactly the included payments');
select is((select status from public.payments where id = pg_temp.id('p_op')), 'draft', 'payments outside the settlement stay untouched');
select is((select (select sum(amount_applied) from public.payment_installments pi join public.payments p on p.id = pi.payment_id
  where pi.installment_id = pg_temp.id('i_a1') and p.status = 'confirmed')), 90::numeric, 'confirmed coverage of the installment');

select * from finish();
rollback;
