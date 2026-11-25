-- SAN-154: portal_my_ledger returns the operator's reason only for manual adjustments. Annulment reasons, other
-- entry types, the creator and other collectors' entries stay hidden; the own scope is still enforced.
begin;
select plan(13);

insert into auth.users(id, email)
select ('a7300000-0000-0000-0000-00000000000' || n)::uuid, 'san154-' || n || '@example.com' from generate_series(1, 3) n;
insert into public.profiles(id, auth_user_id, full_name, email, status)
select ('b7300000-0000-0000-0000-00000000000' || n)::uuid, ('a7300000-0000-0000-0000-00000000000' || n)::uuid,
  'SAN154 ' || n, 'san154-' || n || '@example.com', 'active' from generate_series(1, 3) n;
insert into public.user_roles(user_id, role_id)
select ('b7300000-0000-0000-0000-00000000000' || v.n)::uuid, r.id
from (values (1, 'collector'), (2, 'collector'), (3, 'operator')) v(n, name)
join public.roles r on r.name = v.name;

create function pg_temp.act(n int) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"a7300000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true) $$;
grant execute on function pg_temp.act(int) to authenticated, anon;
create temp table ids(k text primary key, id uuid not null default gen_random_uuid());
grant select on ids to authenticated, anon;
insert into ids(k) select unnest(array['camp', 'ca', 'cb']);
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where ids.k = $1 $$;
grant execute on function pg_temp.id(text) to authenticated, anon;
create function pg_temp.actor() returns uuid language sql immutable as $$ select 'b7300000-0000-0000-0000-000000000003'::uuid $$;

insert into public.campaigns(id, name, simple_bond_value, installment_count, installment_value, barcode_mode)
values (pg_temp.id('camp'), 'SAN154', 100, 1, 100, 'base_number');
insert into public.collectors(id, display_name, user_profile_id, status) values
  (pg_temp.id('ca'), 'SAN154 A', 'b7300000-0000-0000-0000-000000000001', 'active'),
  (pg_temp.id('cb'), 'SAN154 B', 'b7300000-0000-0000-0000-000000000002', 'active');

insert into public.collector_ledger_entries(campaign_id, collector_id, entry_type, direction, amount, occurred_at, created_by, reason) values
  (pg_temp.id('camp'), pg_temp.id('ca'), 'commission_generated', 'collector_credit', 100, '2026-11-01T10:00:00Z', pg_temp.actor(), null),
  (pg_temp.id('camp'), pg_temp.id('ca'), 'adjustment_in_favor_of_collector', 'collector_credit', 10, '2026-11-02T10:00:00Z', pg_temp.actor(), 'Bonus por cobranza'),
  (pg_temp.id('camp'), pg_temp.id('ca'), 'adjustment_in_favor_of_firefighters', 'collector_debit', 5, '2026-11-03T10:00:00Z', pg_temp.actor(), 'Descuento por faltante'),
  (pg_temp.id('camp'), pg_temp.id('ca'), 'adjustment_in_favor_of_collector', 'collector_credit', 7, '2026-11-04T10:00:00Z', pg_temp.actor(), 'Error de carga'),
  (pg_temp.id('camp'), pg_temp.id('cb'), 'adjustment_in_favor_of_collector', 'collector_credit', 3, '2026-11-02T10:00:00Z', pg_temp.actor(), 'Motivo ajeno');
update public.collector_ledger_entries set status = 'annulled', annulled_by = pg_temp.actor(), annulled_at = '2026-11-04T11:00:00Z',
  annul_reason = 'Motivo interno de anulacion' where amount = 7 and collector_id = pg_temp.id('ca');
-- a non-adjustment entry that carries a reason (e.g. a correction) must not expose it
insert into public.collector_ledger_entries(campaign_id, collector_id, entry_type, direction, amount, occurred_at, created_by, reason) values
  (pg_temp.id('camp'), pg_temp.id('ca'), 'annulment', 'collector_debit', 1, '2026-11-05T10:00:00Z', pg_temp.actor(), 'Nota interna de correccion');

select pg_temp.act(1);
set local role authenticated;
select is((select adjustment_reason from public.portal_my_ledger(pg_temp.id('camp')) where amount = 10), 'Bonus por cobranza', 'reason returned for an adjustment in favor of the collector');
select is((select adjustment_reason from public.portal_my_ledger(pg_temp.id('camp')) where amount = 5), 'Descuento por faltante', 'reason returned for an adjustment in favor of the firefighters');
select is((select adjustment_reason from public.portal_my_ledger(pg_temp.id('camp')) where amount = 7), 'Error de carga', 'an annulled adjustment keeps its original reason, never the annul reason');
select is((select count(*)::int from public.portal_my_ledger(pg_temp.id('camp')) where adjustment_reason ~* 'anulacion|interna'), 0, 'no annul reason or internal note is returned');
select is((select adjustment_reason from public.portal_my_ledger(pg_temp.id('camp')) where entry_type = 'commission_generated'), null, 'no reason for a commission');
select is((select adjustment_reason from public.portal_my_ledger(pg_temp.id('camp')) where entry_type = 'annulment'), null, 'no reason for an annulment entry even if it has one');
select is((select count(*)::int from public.portal_my_ledger(pg_temp.id('camp')) where adjustment_reason is not null), 3, 'exactly the three adjustments carry a reason');
select is((select count(*)::int from public.portal_my_ledger(pg_temp.id('camp')) where adjustment_reason = 'Motivo ajeno'), 0, 'another collector''s reason is not visible');
select is((select balance from public.portal_my_ledger_summary(pg_temp.id('camp'))), 104.00, 'balances are unchanged');

select pg_temp.act(2);
select is((select array_agg(adjustment_reason) from public.portal_my_ledger(pg_temp.id('camp'))), array['Motivo ajeno'], 'B sees only its own entry and reason');
select pg_temp.act(3);
select throws_ok(format('select * from public.portal_my_ledger(%L)', pg_temp.id('camp')), '42501', null, 'a caller without the own-scope permission is refused');

reset role;
select is(has_function_privilege('anon', 'public.portal_my_ledger(uuid,integer,integer)', 'execute')
       or has_function_privilege('service_role', 'public.portal_my_ledger(uuid,integer,integer)', 'execute'), false, 'anon and service_role cannot execute');
select is((select count(*)::int from pg_proc p where p.proname = 'portal_my_ledger' and p.prosecdef
           and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute')
           and pg_get_function_result(p.oid) !~* '(annul_reason|created_by|notes)'), 1, 'security definer, empty search_path, authenticated only, no internal columns');

select * from finish();
rollback;
