-- SAN-91: RLS audit. Every check ENUMERATES the catalog (pg_class / pg_proc), so a table or
-- function added later is audited automatically. The ticket names the roles treasury, operations,
-- collector_coordinator and auditor; the seeded roles are admin, treasurer, operator, collector and
-- read-only (auditor). There is no collector-coordinator role (SAN-139, deferred).
begin;
select plan(28);

-- 1. Tables ------------------------------------------------------------------------------------
create temp view audited_tables as
  select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p');

select ok((select count(*) from audited_tables) >= 30, 'the audit sees every public table');
select is(array(select t.relname::text from audited_tables t join pg_class c on c.oid = t.oid
                where not c.relrowsecurity order by 1), '{}'::text[],
  'every public table has row level security enabled');
select is(array(select distinct table_name::text from information_schema.role_table_grants
                where table_schema = 'public' and grantee = 'anon' order by 1), '{}'::text[],
  'anon has no privilege on any public table');
select is(array(select relname::text from audited_tables t
                where not exists (select 1 from pg_policy p where p.polrelid = t.oid and p.polcmd in ('r', '*'))
                order by 1), '{}'::text[],
  'every public table has a SELECT policy (no table is readable only by bypassing RLS)');
-- A policy whose USING / WITH CHECK is the literal `true` exposes the whole table to every role. The only
-- legitimate ones are the read-only permission catalog (roles, permissions), readable by design.
select is(array(select p.tablename::text || '.' || p.policyname::text from pg_policies p
                where p.schemaname = 'public' and (p.qual = 'true' or p.with_check = 'true')
                  and p.tablename not in ('roles', 'permissions') order by 1),
  '{}'::text[], 'no policy outside the roles/permissions catalog is trivially true');
-- Direct writes by authenticated exist only for user administration (profiles, user_roles); every
-- business write goes through audited SECURITY DEFINER RPCs.
select is(array(select distinct table_name::text from information_schema.role_table_grants
                where table_schema = 'public' and grantee = 'authenticated'
                  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE') order by 1),
  array['profiles', 'user_roles'],
  'authenticated writes directly only to profiles and user_roles');
select is(array(select c.relname::text || ':' || p.polcmd::text from pg_policy p join pg_class c on c.oid = p.polrelid
                where c.relname in ('profiles', 'user_roles') and p.polcmd in ('a', 'w', 'd')
                  and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), pg_get_expr(p.polqual, p.polrelid))
                      not like '%has_permission(''user.manage''%' order by 1), '{}'::text[],
  'those direct writes are gated by user.manage');
select is(array(select distinct table_name::text from information_schema.role_table_grants
                where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'TRUNCATE'),
  '{}'::text[], 'authenticated can truncate nothing');
select is(array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind = 'v'
                  and not coalesce('security_invoker=true' = any(c.reloptions), false) order by 1),
  '{}'::text[], 'every public view runs with the caller''s permissions (security_invoker)');

-- 2. SECURITY DEFINER functions ------------------------------------------------------------------
create temp view definers as
  select p.oid, p.proname, p.proconfig, p.proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef;
select ok((select count(*) from definers) > 50, 'the audit sees the SECURITY DEFINER functions');
select is(array(select proname::text from definers
                where not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c = 'search_path=""'
                                  or c = 'search_path=')
                order by 1), '{}'::text[],
  'every SECURITY DEFINER function pins an empty search_path');
select is(array(select proname::text from definers where has_function_privilege('anon', oid, 'execute') order by 1),
  '{}'::text[], 'anon can execute no SECURITY DEFINER function');
select is(array(select proname::text from definers
                where exists (select 1 from aclexplode(coalesce(proacl, acldefault('f', 10))) a
                              where a.grantee = 0 and a.privilege_type = 'EXECUTE') order by 1),
  '{}'::text[], 'no SECURITY DEFINER function is executable by PUBLIC');
-- Collector portal functions (#129 and later, SAN-92 review): listed by name so new `portal_*` functions are
-- audited automatically. None is open to anon or PUBLIC; the client-facing ones are granted to authenticated.
create temp view portal_functions as
  select p.oid, p.proname, p.proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.proname like 'portal\_%' or p.proname like '%is\_own\_collector');
select ok((select count(*) from portal_functions) >= 7, 'the audit sees the collector portal functions');
select is(array(select proname::text from portal_functions
                where has_function_privilege('anon', oid, 'execute')
                   or exists (select 1 from aclexplode(coalesce(proacl, acldefault('f', 10))) a
                              where a.grantee = 0 and a.privilege_type = 'EXECUTE')
                order by 1),
  '{}'::text[], 'no collector portal function is executable by anon or PUBLIC');
select ok(has_function_privilege('authenticated', 'public.is_own_collector(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.portal_my_collector()', 'execute')
  and has_function_privilege('authenticated', (select oid from pg_proc where proname = 'portal_my_buyers' limit 1), 'execute'),
  'the client-facing portal functions (is_own_collector, portal_my_collector, portal_my_buyers) are granted to authenticated');

-- 3. The five seeded roles: has_permission returns exactly the set documented in docs/permissions.md ------------------
insert into auth.users(id, email)
select ('a6580000-0000-0000-0000-00000000000' || n)::uuid, 'san91-' || n || '@example.com' from generate_series(1, 5) n;
insert into public.profiles(id, auth_user_id, full_name, email, status)
select ('b6580000-0000-0000-0000-00000000000' || n)::uuid, ('a6580000-0000-0000-0000-00000000000' || n)::uuid,
  'SAN91 ' || n, 'san91-' || n || '@example.com', 'active' from generate_series(1, 5) n;
insert into public.user_roles(user_id, role_id)
select ('b6580000-0000-0000-0000-00000000000' || n)::uuid, r.id
from (values (1, 'admin'), (2, 'operator'), (3, 'treasurer'), (4, 'collector'), (5, 'read-only')) v(n, name)
join public.roles r on r.name = v.name;
create function pg_temp.act(n int) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"a6580000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true) $$;
-- Expected role -> permission matrix, written by hand from docs/permissions.md ("Initial suggested
-- matrix" plus the SAN-93 "Action implies view" additions). admin is the full documented catalog; the
-- other roles hold exactly what the docs grant (collector: campaign.view plus the own-scope codes of SAN-143;
-- nothing else). It is NOT derived from the seed, so a seed that drifts from the docs fails here.
create temp table expected_matrix(role_name text primary key, codes text[]);
insert into expected_matrix values
('admin', array[
  'campaign.view','campaign.create','campaign.update','campaign.update_rules','campaign.close',
  'bond.view','bond.create','bond.import','bond.scan','bond.assign','bond.return','bond.mark_lost','bond.annul','bond.view_own',
  'buyer.view','buyer.manage','collector.view','collector.manage','collector.ledger.view','collector.ledger.adjust','collector.ledger.view_own',
  'sale.view','sale.create','sale.correct','sale.mark_uncollectible','sale.revert_uncollectible','sale.view_own','payment.view','payment.create','payment.annul','payment.create_own',
  'settlement.view','settlement.create','settlement.update_open','settlement.close','settlement.correct',
  'commission.view','commission.rule_manage','commission.adjust','commission.settle',
  'draw.view','draw.create','draw.update','draw.annul','draw.complete','draw.generate_roster','draw.freeze_roster',
  'draw.load_winner','prize.resolve','prize.deliver','prize.annul','prize.reverse_delivery',
  'report.view_operational','report.view_financial','report.export','audit.view','user.manage']),
('operator', array[
  'campaign.view','bond.view','bond.create','bond.import','bond.scan','bond.assign','bond.return',
  'buyer.view','buyer.manage','collector.view','sale.view','sale.create','payment.view','payment.create',
  'settlement.view','settlement.create','settlement.update_open','draw.view','draw.load_winner',
  'report.view_operational','report.export']),
('treasurer', array[
  'campaign.view','bond.view','sale.view','sale.mark_uncollectible','collector.ledger.view','payment.view','payment.create','payment.annul',
  'settlement.view','settlement.create','settlement.close','settlement.correct',
  'commission.view','commission.adjust','draw.view','draw.freeze_roster','draw.load_winner',
  'report.view_operational','report.view_financial','report.export','audit.view']),
('collector', array['campaign.view','bond.view_own','sale.view_own','collector.ledger.view_own','payment.create_own']),
('read-only', array['campaign.view','bond.view','commission.view','report.view_operational',
  'report.view_financial','report.export']);
update expected_matrix set codes = (select array_agg(c order by c) from unnest(codes) c);
create function pg_temp.granted(role_name text) returns text[] language sql stable as $$
  select codes from expected_matrix where expected_matrix.role_name = granted.role_name $$;
create temp table effective(role_name text primary key, codes text[]);
grant all on effective to authenticated;
grant execute on function pg_temp.act(int) to authenticated;
do $$
declare v record;
begin
  for v in select * from (values (1, 'admin'), (2, 'operator'), (3, 'treasurer'), (4, 'collector'), (5, 'read-only')) x(n, name) loop
    perform pg_temp.act(v.n);
    execute 'set local role authenticated';
    insert into effective
      select v.name, array(select code from public.permissions where public.has_permission(code) order by 1);
    execute 'reset role';
  end loop;
end $$;
select is((select codes from effective where role_name = 'admin'), pg_temp.granted('admin'), 'admin: effective = documented permissions');
select is((select codes from effective where role_name = 'operator'), pg_temp.granted('operator'), 'operator (operations): effective = documented permissions');
select is((select codes from effective where role_name = 'treasurer'), pg_temp.granted('treasurer'), 'treasurer (treasury): effective = documented permissions');
select is((select codes from effective where role_name = 'collector'), pg_temp.granted('collector'), 'collector: effective = documented permissions');
select is((select codes from effective where role_name = 'read-only'), pg_temp.granted('read-only'), 'read-only (auditor): effective = documented permissions');
select is((select cardinality(codes) from effective where role_name = 'admin'),
  (select count(*)::int from public.permissions), 'admin holds every permission');
select is(array(select code::text from public.permissions where code <> all (select unnest(codes) from expected_matrix where role_name = 'admin') order by 1),
  '{}'::text[], 'every seeded permission is in the documented catalog');

-- 4. A protected financial row is visible only to roles with its view permission ------------------
insert into public.campaigns(id, name, simple_bond_value, installment_count, installment_value, barcode_mode)
values ('c6580000-0000-0000-0000-000000000001', 'SAN91', 100, 1, 100, 'base_number');
insert into public.collectors(id, display_name) values ('c6580000-0000-0000-0000-000000000002', 'SAN91 collector');
insert into public.buyers(id, type, first_name) values ('c6580000-0000-0000-0000-000000000003', 'individual', 'SAN91');
insert into public.bonds(id, campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
values ('c6580000-0000-0000-0000-000000000004', 'c6580000-0000-0000-0000-000000000001', 'simple', 'printed', 1, 100, 'available');
insert into public.sales(id, campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by)
values ('c6580000-0000-0000-0000-000000000005', 'c6580000-0000-0000-0000-000000000001', 'c6580000-0000-0000-0000-000000000004',
  'c6580000-0000-0000-0000-000000000003', 'c6580000-0000-0000-0000-000000000002', 'full_payment', 100,
  'b6580000-0000-0000-0000-000000000001');
insert into public.settlements(id, campaign_id, settlement_number, collector_id, created_by)
values ('c6580000-0000-0000-0000-000000000006', 'c6580000-0000-0000-0000-000000000001', 1,
  'c6580000-0000-0000-0000-000000000002', 'b6580000-0000-0000-0000-000000000001');
insert into public.payments(id, campaign_id, sale_id, collector_id, buyer_id, settlement_id, amount, payment_method, status, created_by)
values ('c6580000-0000-0000-0000-000000000007', 'c6580000-0000-0000-0000-000000000001', 'c6580000-0000-0000-0000-000000000005',
  'c6580000-0000-0000-0000-000000000002', 'c6580000-0000-0000-0000-000000000003', 'c6580000-0000-0000-0000-000000000006',
  100, 'cash', 'pending_in_settlement', 'b6580000-0000-0000-0000-000000000001');
create temp table visible(role_name text primary key, payments int, settlements int);
grant all on visible to authenticated;
do $$
declare v record;
begin
  for v in select * from (values (1, 'admin'), (2, 'operator'), (3, 'treasurer'), (4, 'collector'), (5, 'read-only')) x(n, name) loop
    perform pg_temp.act(v.n);
    execute 'set local role authenticated';
    insert into visible select v.name,
      (select count(*)::int from public.payments where id = 'c6580000-0000-0000-0000-000000000007'),
      (select count(*)::int from public.settlements where id = 'c6580000-0000-0000-0000-000000000006');
    execute 'reset role';
  end loop;
end $$;
select is(array(select role_name || ':' || payments || '/' || settlements from visible order by 1),
  array(select r.name || ':' ||
    (case when pg_temp.granted(r.name) && array['payment.view', 'payment.create', 'payment.annul'] then 1 else 0 end) || '/' ||
    (case when pg_temp.granted(r.name) && array['settlement.view', 'settlement.create', 'settlement.update_open',
                                                'settlement.close', 'settlement.correct'] then 1 else 0 end)
    from public.roles r where r.name in ('admin', 'operator', 'treasurer', 'collector', 'read-only') order by 1),
  'payments and settlements are visible exactly to the roles holding a matching permission');

-- 5. Beyond payments/settlements: one fixture row in every sensitive table, and a role WITHOUT the read
-- permission (collector; read-only where it lacks it) plus anon must see 0 rows, while admin sees them.
-- A `USING (true)` policy would fail the collector/anon checks; admin > 0 keeps them from passing vacuously.
insert into public.delivery_notes(id, campaign_id, note_number, collector_id, created_by)
values ('c6580000-0000-0000-0000-000000000008', 'c6580000-0000-0000-0000-000000000001', 1,
  'c6580000-0000-0000-0000-000000000002', 'b6580000-0000-0000-0000-000000000001');
insert into public.bond_assignments(id, campaign_id, bond_id, assignment_type, status, created_by, collector_id, delivery_note_id)
values ('c6580000-0000-0000-0000-000000000009', 'c6580000-0000-0000-0000-000000000001', 'c6580000-0000-0000-0000-000000000004',
  'delivery', 'active', 'b6580000-0000-0000-0000-000000000001', 'c6580000-0000-0000-0000-000000000002',
  'c6580000-0000-0000-0000-000000000008');
insert into public.collector_ledger_entries(id, campaign_id, collector_id, entry_type, direction, amount, created_by)
values ('c6580000-0000-0000-0000-000000000010', 'c6580000-0000-0000-0000-000000000001', 'c6580000-0000-0000-0000-000000000002',
  'adjustment_in_favor_of_collector', 'collector_credit', 10, 'b6580000-0000-0000-0000-000000000001');
insert into public.audit_log(action, entity_type) values ('san91.probe', 'san91');
insert into public.commission_rules(id, campaign_id, rule_type, valid_from, percentage)
values ('c6580000-0000-0000-0000-000000000011', 'c6580000-0000-0000-0000-000000000001', 'cash_full_payment', current_date, 10);
insert into public.draws(id, campaign_id, draw_type, name, draw_date, payment_cutoff_at, required_installment_number, created_by)
values ('c6580000-0000-0000-0000-000000000012', 'c6580000-0000-0000-0000-000000000001', 'monthly', 'SAN91 draw',
  current_date, now(), 1, 'b6580000-0000-0000-0000-000000000001');
insert into public.draw_rosters(id, draw_id, generated_by, created_by)
values ('c6580000-0000-0000-0000-000000000013', 'c6580000-0000-0000-0000-000000000012',
  'b6580000-0000-0000-0000-000000000001', 'b6580000-0000-0000-0000-000000000001');
insert into public.prizes(id, draw_id, name, position, created_by)
values ('c6580000-0000-0000-0000-000000000014', 'c6580000-0000-0000-0000-000000000012', 'SAN91 prize', 1,
  'b6580000-0000-0000-0000-000000000001');
update public.draw_rosters set status = 'frozen', frozen_at = now(), frozen_by = 'b6580000-0000-0000-0000-000000000001'
  where id = 'c6580000-0000-0000-0000-000000000013';
update public.draws set status = 'roster_generated' where id = 'c6580000-0000-0000-0000-000000000012';
update public.draws set status = 'roster_frozen' where id = 'c6580000-0000-0000-0000-000000000012';
insert into public.winning_numbers(id, draw_id, prize_id, number_value, result_status, loaded_by, created_by)
values ('c6580000-0000-0000-0000-000000000015', 'c6580000-0000-0000-0000-000000000012', 'c6580000-0000-0000-0000-000000000014',
  1, 'no_match', 'b6580000-0000-0000-0000-000000000001', 'b6580000-0000-0000-0000-000000000001');
insert into public.import_sessions(id, campaign_id, source_type, created_by)
values ('c6580000-0000-0000-0000-000000000016', 'c6580000-0000-0000-0000-000000000001', 'barcode_scan',
  'b6580000-0000-0000-0000-000000000001');

-- (table, does read-only see it?) read-only holds bond.view and commission.view. sale_can_read() also
-- accepts bond.view by design (a bond's commercial state is derived from its sale), so sales is visible.
create temp table probe_tables(tbl text primary key, readonly_sees boolean);
insert into probe_tables values
  ('bonds', true), ('bond_assignments', true), ('delivery_notes', true), ('commission_rules', true),
  ('sales', true), ('buyers', false), ('collectors', false), ('payments', false), ('settlements', false),
  ('collector_ledger_entries', false), ('audit_log', false), ('draws', false), ('draw_rosters', false),
  ('prizes', false), ('winning_numbers', false), ('import_sessions', false);
create temp table probe(who text, tbl text, n int, primary key (who, tbl));
grant all on probe to authenticated, anon;
grant select on probe_tables to authenticated, anon;
do $$
declare v record; t record; c int;
begin
  for v in select * from (values (1, 'admin'), (4, 'collector'), (5, 'read-only'), (0, 'anon')) x(n, name) loop
    for t in select tbl from probe_tables loop
      if v.n > 0 then
        perform pg_temp.act(v.n);
        execute 'set local role authenticated';
      else
        execute 'set local role anon';
      end if;
      begin
        execute format('select count(*)::int from public.%I', t.tbl) into c;
      exception when insufficient_privilege then c := 0;  -- anon has no grant at all: nothing readable
      end;
      insert into probe values (v.name, t.tbl, c);
      execute 'reset role';
    end loop;
  end loop;
end $$;
select is(array(select tbl::text from probe where who = 'admin' and n = 0 order by 1), '{}'::text[],
  'admin reads a fixture row in every sensitive table (the zero-row checks below are not vacuous)');
select is(array(select tbl::text from probe where who = 'collector' and n <> 0 order by 1), '{}'::text[],
  'collector (no read permission) sees 0 rows in bonds, sales, buyers, collectors, ledger, audit_log, prizes, draws, imports and the rest');
select is(array(select tbl::text from probe where who = 'anon' and n <> 0 order by 1), '{}'::text[],
  'anon sees 0 rows in every sensitive table');
select is(array(select p.tbl::text || ':' || (p.n > 0) from probe p join probe_tables t using (tbl)
                where p.who = 'read-only' and (p.n > 0) <> t.readonly_sees order by 1), '{}'::text[],
  'read-only sees exactly bonds, delivery notes, assignments and commission rules and sales (via bond.view), commission rules and nothing else');

select * from finish();
rollback;
