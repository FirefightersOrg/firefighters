-- SAN-156: settlement_close is blocked while the collector has unprocessed collector-submitted drafts in the campaign.
begin;
set local timezone = 'America/Argentina/Buenos_Aires';
select plan(26);

insert into auth.users(id, email)
select ('a7500000-0000-0000-0000-00000000000' || n)::uuid, 'san156-' || n || '@example.com' from generate_series(1, 3) n;
insert into public.profiles(id, auth_user_id, full_name, email, status)
select ('b7500000-0000-0000-0000-00000000000' || n)::uuid, ('a7500000-0000-0000-0000-00000000000' || n)::uuid,
  'SAN156 ' || n, 'san156-' || n || '@example.com', 'active' from generate_series(1, 3) n;
insert into public.user_roles(user_id, role_id)
select ('b7500000-0000-0000-0000-00000000000' || v.n)::uuid, r.id
from (values (1, 'collector'), (2, 'collector'), (3, 'admin')) v(n, name)
join public.roles r on r.name = v.name;

create function pg_temp.act(n int) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"a7500000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true) $$;
grant execute on function pg_temp.act(int) to authenticated, anon;
create temp table ids(k text primary key, id uuid not null default gen_random_uuid());
grant select, insert on ids to authenticated, anon;
insert into ids(k) select unnest(array['c1', 'c2', 'ca', 'cb', 'buyer', 'bond_a1', 'bond_b1', 'bond_a2', 'sale_a1', 'sale_b1', 'sale_a2',
  'plan_a1', 'plan_b1', 'plan_a2', 'i_a1', 'i_b1', 'i_a2']);
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where ids.k = $1 $$;
grant execute on function pg_temp.id(text) to authenticated, anon;
create function pg_temp.app(i text, a numeric) returns jsonb language sql stable as $$
  select jsonb_build_array(jsonb_build_object('installment_id', pg_temp.id(i), 'amount_applied', a)) $$;
grant execute on function pg_temp.app(text, numeric) to authenticated, anon;

insert into public.campaigns(id, name, simple_bond_value, installment_count, installment_value, barcode_mode) values
  (pg_temp.id('c1'), 'SAN156 uno', 400, 4, 100, 'base_number'),
  (pg_temp.id('c2'), 'SAN156 dos', 400, 4, 100, 'base_number');
update public.campaigns set status = 'active', starts_at = current_date - 1, ends_at = current_date + 365
  where id in (pg_temp.id('c1'), pg_temp.id('c2'));
insert into public.collectors(id, display_name, user_profile_id, status) values
  (pg_temp.id('ca'), 'A', 'b7500000-0000-0000-0000-000000000001', 'active'),
  (pg_temp.id('cb'), 'B', 'b7500000-0000-0000-0000-000000000002', 'active');
insert into public.buyers(id, type, first_name, last_name) values (pg_temp.id('buyer'), 'individual', 'Ana', 'Compradora');
insert into public.bonds(id, campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status, current_collector_id) values
  (pg_temp.id('bond_a1'), pg_temp.id('c1'), 'simple', 'printed', 1, 400, 'available', pg_temp.id('ca')),
  (pg_temp.id('bond_b1'), pg_temp.id('c1'), 'simple', 'printed', 1, 400, 'available', pg_temp.id('cb')),
  (pg_temp.id('bond_a2'), pg_temp.id('c2'), 'simple', 'printed', 1, 400, 'available', pg_temp.id('ca'));
insert into public.bond_numbers(campaign_id, bond_id, number_value, number_kind) values
  (pg_temp.id('c1'), pg_temp.id('bond_a1'), 31, 'base'), (pg_temp.id('c1'), pg_temp.id('bond_b1'), 32, 'base'),
  (pg_temp.id('c2'), pg_temp.id('bond_a2'), 31, 'base');
insert into public.sales(id, campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by) values
  (pg_temp.id('sale_a1'), pg_temp.id('c1'), pg_temp.id('bond_a1'), pg_temp.id('buyer'), pg_temp.id('ca'), 'installments', 400, 'b7500000-0000-0000-0000-000000000003'),
  (pg_temp.id('sale_b1'), pg_temp.id('c1'), pg_temp.id('bond_b1'), pg_temp.id('buyer'), pg_temp.id('cb'), 'installments', 400, 'b7500000-0000-0000-0000-000000000003'),
  (pg_temp.id('sale_a2'), pg_temp.id('c2'), pg_temp.id('bond_a2'), pg_temp.id('buyer'), pg_temp.id('ca'), 'installments', 400, 'b7500000-0000-0000-0000-000000000003');
insert into public.payment_plans(id, sale_id, installment_count, total_amount) values
  (pg_temp.id('plan_a1'), pg_temp.id('sale_a1'), 4, 400), (pg_temp.id('plan_b1'), pg_temp.id('sale_b1'), 4, 400),
  (pg_temp.id('plan_a2'), pg_temp.id('sale_a2'), 4, 400);
insert into public.installments(id, payment_plan_id, installment_number, due_date, amount) values
  (pg_temp.id('i_a1'), pg_temp.id('plan_a1'), 1, current_date + 5, 400),
  (pg_temp.id('i_b1'), pg_temp.id('plan_b1'), 1, current_date + 5, 400),
  (pg_temp.id('i_a2'), pg_temp.id('plan_a2'), 1, current_date + 5, 400);

-- Collector A submits 3 drafts in campaign 1 (d1 is settled, d2 and d3 wait for review) and one in campaign 2;
-- B submits one in campaign 1.
select pg_temp.act(1);
set local role authenticated;
select lives_ok($$ insert into ids(k, id) values ('d1', public.portal_payment_submit(pg_temp.id('sale_a1'), 100, 'cash', pg_temp.app('i_a1', 100))),
  ('d2', public.portal_payment_submit(pg_temp.id('sale_a1'), 50, 'cash', pg_temp.app('i_a1', 50))),
  ('d3', public.portal_payment_submit(pg_temp.id('sale_a1'), 25, 'cash', pg_temp.app('i_a1', 25))),
  ('dc2', public.portal_payment_submit(pg_temp.id('sale_a2'), 70, 'cash', pg_temp.app('i_a2', 70))) $$, 'A submits drafts in two campaigns');
reset role;
select pg_temp.act(2);
set local role authenticated;
select lives_ok($$ insert into ids(k, id) values ('db', public.portal_payment_submit(pg_temp.id('sale_b1'), 40, 'cash', pg_temp.app('i_b1', 40))) $$, 'B submits a draft in campaign 1');
reset role;

select pg_temp.act(3);
set local role authenticated;
select lives_ok($$ insert into ids(k, id) values ('sa', public.settlement_open(pg_temp.id('c1'), pg_temp.id('ca'))) $$, 'operator opens a settlement for A');
select lives_ok($$ select public.settlement_attach_collector_payment(pg_temp.id('sa'), pg_temp.id('d1')) $$, 'operator includes d1 (so the settlement has a pending payment)');

-- Dashboard function: pending drafts per collector of this campaign, with the open settlement to handle them.
select is((select array_agg(array[collector_name, payment_count::text, total_amount::text, (open_settlement_id = pg_temp.id('sa'))::text] order by collector_name)
  from public.dashboard_submitted_payments(pg_temp.id('c1'))),
  array[array['A', '2', '75.00', 'true'], array['B', '1', '40.00', null]], 'dashboard counts pending drafts per collector (campaign 1 only)');
reset role;
select pg_temp.act(1);
set local role authenticated;
select throws_ok($$ select * from public.dashboard_submitted_payments(pg_temp.id('c1')) $$, '42501', null, 'a collector cannot read the operator dashboard function');
reset role;
select pg_temp.act(3);
set local role authenticated;

-- 1. Blocked by a draft of the same collector and campaign ---------------------------------------------------
select throws_ok($$ select public.settlement_close(pg_temp.id('sa'), 'req-156-block') $$, 'FF156',
  'settlement has 2 unprocessed collector payments', 'close is blocked by A''s two drafts in this campaign (typed errcode and count)');
reset role;
select is((select array[status, (select count(*)::text from public.payments where settlement_id = pg_temp.id('sa') and status = 'pending_in_settlement')]
  from public.settlements where id = pg_temp.id('sa')), array['open', '1'], 'nothing changed: still open with its pending payment');
select is((select count(*)::int from public.collector_ledger_entries where settlement_id = pg_temp.id('sa')), 0, 'no ledger entries were written');
select is((select count(*)::int from public.audit_log where action = 'settlement.close' and request_id = 'req-156-block'), 0, 'a blocked close leaves no close audit');
select is((select count(*)::int from public.payments where status = 'draft' and submitted_by_collector), 4, 'drafts untouched (d2, d3, B''s and campaign 2''s)');

-- 2. Including one still blocks; rejecting the last one unblocks. B's and campaign 2's drafts never block -----
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$ select public.settlement_attach_collector_payment(pg_temp.id('sa'), pg_temp.id('d2')) $$, 'operator includes d2');
select throws_ok($$ select public.settlement_close(pg_temp.id('sa')) $$, 'FF156', 'settlement has 1 unprocessed collector payments', 'one draft left still blocks');
select lives_ok($$ select public.settlement_reject_collector_payment(pg_temp.id('d3'), 'Monto no recibido') $$, 'operator rejects d3');
select lives_ok($$ select public.settlement_close(pg_temp.id('sa'), 'req-156-ok') $$,
  'close succeeds once A''s drafts are processed, although B''s and campaign 2''s drafts remain');
reset role;
select is((select status from public.settlements where id = pg_temp.id('sa')), 'closed', 'settlement closed');
select is((select array_agg(status order by id) from public.payments where id in (pg_temp.id('db'), pg_temp.id('dc2'))), array['draft', 'draft'],
  'other collector and other campaign drafts are untouched by the close');
select is((select count(*)::int from public.audit_log where action = 'settlement.close' and request_id = 'req-156-ok'), 1, 'the successful close is audited');

-- 3. Including the last draft unblocks too (second settlement) ------------------------------------------------
select pg_temp.act(1);
set local role authenticated;
select lives_ok($$ insert into ids(k, id) values ('d4', public.portal_payment_submit(pg_temp.id('sale_a1'), 30, 'cash', pg_temp.app('i_a1', 30))),
  ('d5', public.portal_payment_submit(pg_temp.id('sale_a1'), 20, 'cash', pg_temp.app('i_a1', 20))) $$, 'A submits two more drafts');
reset role;
select pg_temp.act(3);
set local role authenticated;
select lives_ok($$ insert into ids(k, id) values ('sa2', public.settlement_open(pg_temp.id('c1'), pg_temp.id('ca'))) $$, 'operator opens a second settlement for A');
select lives_ok($$ select public.settlement_attach_collector_payment(pg_temp.id('sa2'), pg_temp.id('d4')) $$, 'include d4');
select throws_ok($$ select public.settlement_close(pg_temp.id('sa2')) $$, 'FF156', null, 'd5 still blocks');
select lives_ok($$ select public.settlement_attach_collector_payment(pg_temp.id('sa2'), pg_temp.id('d5')) $$, 'include d5');
select lives_ok($$ select public.settlement_close(pg_temp.id('sa2')) $$, 'including the last draft unblocks the close');
reset role;

select is((select proconfig @> array['search_path=""'] and prosecdef from pg_proc where oid = 'public.settlement_close(uuid,text)'::regprocedure), true,
  'settlement_close stays SECURITY DEFINER with an empty search_path');
select is((select has_function_privilege('authenticated', 'public.settlement_close(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.settlement_close(uuid,text)', 'execute')
  and not has_function_privilege('service_role', 'public.settlement_close(uuid,text)', 'execute')), true, 'grants preserved');

select * from finish();
rollback;
