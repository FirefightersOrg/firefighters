-- SAN-85: campaign dashboard functions (next draw, bonds at risk): access rule and aggregates.
begin;
set local time zone 'America/Argentina/Buenos_Aires';
select plan(34);

insert into auth.users(id, email)
select ('a6560000-0000-0000-0000-00000000000' || n)::uuid, 'dash-' || n || '@example.com' from generate_series(1, 6) n;
insert into public.profiles(id, auth_user_id, full_name, email, status)
select ('b6560000-0000-0000-0000-00000000000' || n)::uuid, ('a6560000-0000-0000-0000-00000000000' || n)::uuid,
  'Dash ' || n, 'dash-' || n || '@example.com', 'active' from generate_series(1, 6) n;
-- 6 has no role at all.
insert into public.user_roles(user_id, role_id)
select ('b6560000-0000-0000-0000-00000000000' || v.n)::uuid, r.id
from (values (1, 'admin'), (2, 'operator'), (3, 'read-only'), (4, 'treasurer'), (5, 'collector')) v(n, name)
join public.roles r on r.name = v.name;

create function pg_temp.act_as(n int) returns void language sql as $$
select set_config('request.jwt.claims', format('{"sub":"a6560000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true) $$;
create temp table ids(k text primary key, id uuid not null);
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where k = $1 $$;
grant execute on function pg_temp.id(text), pg_temp.act_as(int) to authenticated, anon;
grant select on ids to authenticated, anon;
insert into ids select k, gen_random_uuid() from unnest(array['c', 'other', 'ca', 'cb', 'buyer', 'set',
  'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'dm1', 'dm2', 'dfinal', 'dold', 'dcons', 'dcons0', 'dother']) k;

create function pg_temp.actor() returns uuid language sql immutable as $$ select 'b6560000-0000-0000-0000-000000000001'::uuid $$;
grant execute on function pg_temp.actor() to authenticated, anon;
create function pg_temp.today() returns date language sql stable as $$ select (now() at time zone 'America/Argentina/Buenos_Aires')::date $$;
grant execute on function pg_temp.today() to authenticated, anon;

insert into public.campaigns(id, name, simple_bond_value, installment_count, installment_value, barcode_mode, max_number, associated_number_offset)
values (pg_temp.id('c'), 'Dashboard', 100, 2, 50, 'base_number', 999, 100),
       (pg_temp.id('other'), 'Other dashboard', 100, 2, 50, 'base_number', 999, 100);
insert into public.collectors(id, display_name) values (pg_temp.id('ca'), 'Ana'), (pg_temp.id('cb'), 'Beto');
insert into public.buyers(id, type, first_name, last_name) values (pg_temp.id('buyer'), 'individual', 'Eva', 'Paz');
insert into public.settlements(id, campaign_id, collector_id, settlement_number, created_by)
values (pg_temp.id('set'), pg_temp.id('c'), pg_temp.id('ca'), 1, pg_temp.actor());

-- Six bonds with base number n. Installments are 50 + 50, due in the past.
--   b1 sold, both installments paid on time      -> never at risk
--   b2 sold, installment 1 paid on time          -> at risk for the final (and N = 2)
--   b3 sold, nothing paid                        -> at risk (2 missing)
--   b4 sold, installment 1 paid AFTER the cutoff -> at risk (late payment does not count)
--   b5 available, never sold                     -> never at risk
--   b6 sold, installment 1 paid but not confirmed -> at risk
create function pg_temp.fixture(n int) returns void language plpgsql as $$
declare b uuid := pg_temp.id('b' || n); s uuid; pp uuid; pay uuid;
begin
  insert into public.bonds(id, campaign_id, kind, origin, commercial_unit_count, total_value)
  values (b, pg_temp.id('c'), 'simple', 'printed', 1, 100);
  insert into public.bond_numbers(campaign_id, bond_id, number_value, number_kind) values (pg_temp.id('c'), b, n, 'base');
  if n = 5 then return; end if;
  update public.bonds set commercial_status = 'delivered_to_collector', current_collector_id = pg_temp.id('ca') where id = b;
  update public.bonds set commercial_status = 'sold', current_buyer_id = pg_temp.id('buyer') where id = b;
  insert into public.sales(campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by)
  values (pg_temp.id('c'), b, pg_temp.id('buyer'), pg_temp.id('ca'), 'installments', 100, pg_temp.actor()) returning id into s;
  insert into public.payment_plans(sale_id, installment_count, total_amount) values (s, 2, 100) returning id into pp;
  insert into public.installments(payment_plan_id, installment_number, due_date, amount)
  select pp, j, pg_temp.today() - 30, 50 from generate_series(1, 2) j;
  if n = 3 then return; end if;
  insert into public.payments(campaign_id, sale_id, collector_id, buyer_id, settlement_id, amount, payment_method, payment_date, status, created_by)
  values (pg_temp.id('c'), s, pg_temp.id('ca'), pg_temp.id('buyer'), pg_temp.id('set'),
    case when n = 1 then 100 else 50 end, 'cash',
    pg_temp.today() - case when n = 4 then 1 else 3 end, 'pending_in_settlement', pg_temp.actor()) returning id into pay;
  insert into public.payment_installments(payment_id, installment_id, amount_applied)
  select pay, id, amount from public.installments where payment_plan_id = pp and (n = 1 or installment_number = 1);
  if n <> 6 then update public.payments set status = 'confirmed' where id = pay; end if;
end $$;
select pg_temp.fixture(n) from generate_series(1, 6) n;

-- Cutoff of every draw: the end of the day two days ago (so late = paid yesterday).
insert into public.draws(id, campaign_id, draw_type, name, draw_date, payment_cutoff_at, required_installment_number, created_by)
select pg_temp.id(d.k), pg_temp.id('c'), d.t, d.k, pg_temp.today() + d.plus,
  ((pg_temp.today() - 2) + time '23:59:59') at time zone 'America/Argentina/Buenos_Aires', d.req, pg_temp.actor()
from (values ('dm1', 'monthly', 20, 1), ('dm2', 'monthly', 30, 2), ('dfinal', 'final', 40, null::int),
  ('dold', 'monthly', -5, 1), ('dcons', 'consolation', 50, 1), ('dcons0', 'consolation', 60, null::int)) d(k, t, plus, req);
insert into public.draws(id, campaign_id, draw_type, name, draw_date, payment_cutoff_at, required_installment_number, created_by)
values (pg_temp.id('dother'), pg_temp.id('other'), 'monthly', 'dother', pg_temp.today() + 5, now(), 1, pg_temp.actor());

-- Privileges
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('report_next_draw', 'report_at_risk_bonds', 'dashboard_at_risk_bonds_internal')
    and p.prosecdef and p.proconfig = array['search_path=""']), 3, 'the three functions are security definer with an empty search_path');
select ok(has_function_privilege('authenticated', 'public.report_next_draw(uuid)', 'execute'), 'authenticated may execute report_next_draw');
select ok(not has_function_privilege('service_role', 'public.report_at_risk_bonds(uuid, uuid, integer, integer)', 'execute'), 'service_role may not execute report_at_risk_bonds');
select ok(not has_function_privilege('authenticated', 'public.dashboard_at_risk_bonds_internal(uuid)', 'execute'), 'the internal helper is not executable by authenticated');

-- Access rule
select pg_temp.act_as(1);
set local role authenticated;
select lives_ok($$select * from public.report_next_draw(pg_temp.id('c'))$$, 'admin reads the next draw');
select pg_temp.act_as(2);
select lives_ok($$select * from public.report_next_draw(pg_temp.id('c'))$$, 'operator reads the next draw');
select pg_temp.act_as(3);
select lives_ok($$select * from public.report_at_risk_bonds(pg_temp.id('c'), pg_temp.id('dm1'))$$, 'read-only reads the at-risk bonds');
select pg_temp.act_as(4);
select lives_ok($$select * from public.report_at_risk_bonds(pg_temp.id('c'), pg_temp.id('dm1'))$$, 'treasurer reads the at-risk bonds');
select pg_temp.act_as(5);
select throws_ok($$select * from public.report_next_draw(pg_temp.id('c'))$$, '42501', 'permission denied', 'collector role is denied the next draw');
select throws_ok($$select * from public.report_at_risk_bonds(pg_temp.id('c'), pg_temp.id('dm1'))$$, '42501', 'permission denied', 'collector role is denied the at-risk bonds');
select pg_temp.act_as(6);
select throws_ok($$select * from public.report_next_draw(pg_temp.id('c'))$$, '42501', 'permission denied', 'user without roles is denied');
select pg_temp.act_as(1);
select throws_ok($$select * from public.report_next_draw('00000000-0000-0000-0000-00000000dead')$$, 'P0002', null, 'unknown campaign is no_data_found');
select throws_ok($$select * from public.report_at_risk_bonds(pg_temp.id('c'), null)$$, '22023', 'draw is required', 'a draw is required');
select throws_ok($$select * from public.report_at_risk_bonds(pg_temp.id('c'), pg_temp.id('dother'))$$, 'P0002', null, 'a draw of another campaign is no_data_found');
select throws_ok($$select * from public.dashboard_at_risk_bonds_internal(pg_temp.id('dm1'))$$, '42501', null, 'the internal helper is not callable');

-- Next draw: the earliest draw from today on (dold is in the past), with its at-risk count.
select is((select draw_id from public.report_next_draw(pg_temp.id('c'))), pg_temp.id('dm1'), 'the next draw is the earliest upcoming one');
select is((select at_risk_count from public.report_next_draw(pg_temp.id('c'))), 3::bigint, 'monthly N = 1: b3, b4 (late payment) and b6 (unconfirmed) are at risk');
select is((select required_installment_number from public.report_next_draw(pg_temp.id('c'))), 1, 'it returns the required installment');
select is((select count(*)::int from public.report_next_draw(pg_temp.id('other'))), 1, 'another campaign has its own next draw');
reset role;
update public.draws set status = 'annulled', annulled_at = now(), annulled_by = pg_temp.actor(), annul_reason = 'test' where id = pg_temp.id('dm1');
set local role authenticated;
select is((select draw_id from public.report_next_draw(pg_temp.id('c'))), pg_temp.id('dm2'), 'an annulled draw is skipped');

-- At-risk bonds
select is((select array_agg(base_number order by base_number) from public.report_at_risk_bonds(pg_temp.id('c'), pg_temp.id('dm2'))),
  array[2, 3, 4, 6], 'monthly N = 2: b2 (installment 2 unpaid), b3, b4 and b6');
select is((select array_agg(base_number order by base_number) from public.report_at_risk_bonds(pg_temp.id('c'), pg_temp.id('dfinal'))),
  array[2, 3, 4, 6], 'final: every installment is required');
select is((select base_number from public.report_at_risk_bonds(pg_temp.id('c'), pg_temp.id('dfinal')) limit 1), 3,
  'most installments missing first (b3 misses two)');
select is((select missing_installments from public.report_at_risk_bonds(pg_temp.id('c'), pg_temp.id('dfinal')) where base_number = 2), 1::bigint,
  'b2 misses one installment');
select is((select required_installments from public.report_at_risk_bonds(pg_temp.id('c'), pg_temp.id('dm2')) limit 1), 2, 'it returns the required installments');
select is((select required_installments from public.report_at_risk_bonds(pg_temp.id('c'), pg_temp.id('dfinal')) limit 1), null, 'a final draw requires every installment (null)');
select is((select collector_name from public.report_at_risk_bonds(pg_temp.id('c'), pg_temp.id('dm2')) where base_number = 3), 'Ana', 'it returns the collector');
select is((select array_agg(base_number order by base_number) from public.report_at_risk_bonds(pg_temp.id('c'), pg_temp.id('dcons'))),
  array[3, 4, 6], 'consolation uses its required installment');
select is((select count(*)::int from public.report_at_risk_bonds(pg_temp.id('c'), pg_temp.id('dcons0'))), 0, 'a consolation draw without a required installment lists nothing');
select is((select count(*)::int from public.report_at_risk_bonds(pg_temp.id('c'), pg_temp.id('dfinal'), 2, 0)), 2, 'p_limit pages the list');
select is((select max(total_count) from public.report_at_risk_bonds(pg_temp.id('c'), pg_temp.id('dfinal'), 2, 0)), 4::bigint, 'total_count is the full count');

select * from finish();
rollback;
