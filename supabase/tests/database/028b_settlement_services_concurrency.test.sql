-- SAN-63 review: settlement_remove_payment and settlement_close lock the settlement first, so a
-- remove racing a close serializes instead of deadlocking (two real dblink sessions, same pattern
-- as 029_payments_settlement_concurrency).
--   1. A closes (not committed); B removes the payment: B waits for the settlement lock and, once
--      A commits, fails because the settlement is no longer open.
--   2. B removes (not committed); A closes: A waits and, once B commits, fails because nothing is
--      pending. Before the fix this order deadlocked (B held the payment, A the settlement).
-- Committed fixtures and their audit rows are removed at the end.
begin;
select plan(8);
set local client_min_messages = warning;

create extension if not exists dblink with schema extensions;
create temporary table race (k text primary key, v text not null);
create function pg_temp.v(p_k text) returns text language sql stable as $$ select v from race where k = p_k $$;
create function pg_temp.connect_all() returns boolean language plpgsql as $$
declare v_conninfo text := format('host=%s port=%s dbname=%s user=postgres password=postgres',
  coalesce(host(inet_server_addr()), '127.0.0.1'), coalesce(inet_server_port(), 5432), current_database());
begin
  perform extensions.dblink_connect('race_setup', v_conninfo);
  perform extensions.dblink_connect('race_a', v_conninfo);
  perform extensions.dblink_connect('race_b', v_conninfo);
  return true;
exception when others then
  raise notice 'dblink unavailable, skipping the race tests: %', sqlerrm;
  return false;
end $$;
create function pg_temp.exec(p_conn text, p_sql text) returns void language plpgsql as $$
begin perform extensions.dblink_exec(p_conn, p_sql); end $$;
create function pg_temp.fetch(p_conn text, p_sql text) returns text language sql as $$
  select t.v from extensions.dblink(p_conn, p_sql) as t (v text) $$;
create function pg_temp.waits_for_lock(p_pid int) returns boolean language plpgsql as $$
begin
  for i in 1..200 loop
    if exists (select 1 from pg_stat_activity where pid = p_pid and wait_event_type = 'Lock') then return true; end if;
    perform pg_sleep(0.05);
  end loop;
  return false;
end $$;
create function pg_temp.async_result(p_conn text) returns text language plpgsql as $$
declare v_status text; v_message text;
begin
  select t.status into v_status from extensions.dblink_get_result(p_conn, false) as t (status text);
  v_message := extensions.dblink_error_message(p_conn);
  perform * from extensions.dblink_get_result(p_conn, false) as t (status text);
  return case when v_message = 'OK' then 'ok'
    else regexp_replace(split_part(v_message, E'\n', 1), '^ERROR:\s+', '') end;
end $$;

insert into race values ('connected', pg_temp.connect_all()::text);
insert into race select k, gen_random_uuid()::text from unnest(array[
  'user', 'profile', 'campaign', 'collector', 'buyer', 'bond', 'sale', 'set1', 'set2', 'pay1', 'pay2'
]) as k;
insert into race values ('claims', format('{"sub":"%s","role":"authenticated"}', pg_temp.v('user')));
select pg_temp.exec('race_setup', format($sql$
  insert into auth.users (id,email) values (%1$L,%1$L || '@race63.example.com');
  insert into public.profiles (id,auth_user_id,full_name,email,status)
    values (%2$L,%1$L,'Settlement race',%1$L || '@race63.example.com','active');
  insert into public.user_roles (user_id,role_id) select %2$L,id from public.roles where name in ('operator','treasurer');
  insert into public.campaigns (id,name,simple_bond_value,installment_count,installment_value,barcode_mode)
    values (%3$L,'[pgtap settlement race] ' || %3$L,100,2,50,'base_number');
  insert into public.collectors (id,display_name) values (%4$L,'Race collector');
  insert into public.buyers (id,type,first_name) values (%5$L,'individual','Race buyer');
  insert into public.bonds (id,campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status)
    values (%6$L,%3$L,'simple','printed',1,100,'available');
  insert into public.sales (id,campaign_id,bond_id,buyer_id,collector_id,payment_mode,total_amount,created_by)
    values (%7$L,%3$L,%6$L,%5$L,%4$L,'installments',100,%2$L);
  insert into public.settlements (id,campaign_id,settlement_number,collector_id,created_by)
    values (%8$L,%3$L,1,%4$L,%2$L),(%9$L,%3$L,2,%4$L,%2$L);
  insert into public.payments (id,campaign_id,sale_id,collector_id,buyer_id,settlement_id,amount,payment_method,status,created_by)
    values (%10$L,%3$L,%7$L,%4$L,%5$L,%8$L,10,'cash','pending_in_settlement',%2$L),
           (%11$L,%3$L,%7$L,%4$L,%5$L,%9$L,10,'cash','pending_in_settlement',%2$L);
  $sql$, pg_temp.v('user'), pg_temp.v('profile'), pg_temp.v('campaign'), pg_temp.v('collector'),
  pg_temp.v('buyer'), pg_temp.v('bond'), pg_temp.v('sale'), pg_temp.v('set1'), pg_temp.v('set2'),
  pg_temp.v('pay1'), pg_temp.v('pay2')))
where pg_temp.v('connected')::boolean;
insert into race select 'pid_a', pg_temp.fetch('race_a', 'select pg_backend_pid()::text') where pg_temp.v('connected')::boolean;
insert into race select 'pid_b', pg_temp.fetch('race_b', 'select pg_backend_pid()::text') where pg_temp.v('connected')::boolean;

create function pg_temp.race_tests() returns setof text language plpgsql as $$
declare v_auth text := format('select set_config(%L, %L, false)', 'request.jwt.claims', pg_temp.v('claims'));
begin
  if not pg_temp.v('connected')::boolean then return next skip('dblink cannot connect to this server', 6); return; end if;
  perform pg_temp.fetch('race_a', v_auth);
  perform pg_temp.fetch('race_b', v_auth);
  -- 1. Close first: the remove waits on the settlement, then sees it closed.
  perform pg_temp.exec('race_a', 'begin');
  perform pg_temp.fetch('race_a', format('select public.settlement_close(%L, %L)::text', pg_temp.v('set1'), 'race63-close-1'));
  perform extensions.dblink_send_query('race_b', format('select public.settlement_remove_payment(%L, %L, %L)::text',
    pg_temp.v('pay1'), 'Race', 'race63-remove-1'));
  return next ok(pg_temp.waits_for_lock(pg_temp.v('pid_b')::int), 'race 1: remove waits for an uncommitted close');
  perform pg_temp.exec('race_a', 'commit');
  return next is(pg_temp.async_result('race_b'), 'only a pending payment in an open settlement can be removed',
    'race 1: remove fails once the close commits');
  return next is(pg_temp.fetch('race_setup', format('select status from public.payments where id = %L', pg_temp.v('pay1'))),
    'confirmed', 'race 1: the payment stays confirmed');
  -- 2. Remove first: the close waits on the settlement (no deadlock), then finds nothing pending.
  perform pg_temp.exec('race_b', 'begin');
  perform pg_temp.fetch('race_b', format('select public.settlement_remove_payment(%L, %L, %L)::text',
    pg_temp.v('pay2'), 'Race', 'race63-remove-2'));
  perform extensions.dblink_send_query('race_a', format('select public.settlement_close(%L, %L)::text',
    pg_temp.v('set2'), 'race63-close-2'));
  return next ok(pg_temp.waits_for_lock(pg_temp.v('pid_a')::int), 'race 2: close waits for an uncommitted remove');
  perform pg_temp.exec('race_b', 'commit');
  return next is(pg_temp.async_result('race_a'), 'settlement has no pending payments',
    'race 2: close fails cleanly (no deadlock) once the remove commits');
  return next is(pg_temp.fetch('race_setup', format('select status from public.settlements where id = %L', pg_temp.v('set2'))),
    'open', 'race 2: the settlement stays open');
end $$;

select * from pg_temp.race_tests();
select skip('dblink cannot connect to this server', 1) where not pg_temp.v('connected')::boolean;
select lives_ok(format($t$select pg_temp.exec('race_setup', %L)$t$, format($sql$
  begin;
  alter table public.audit_log disable trigger audit_log_forbid_update_delete;
  alter table public.payments disable trigger payments_forbid_delete;
  alter table public.settlements disable trigger settlements_forbid_delete;
  alter table public.sales disable trigger sales_forbid_delete;
  alter table public.bonds disable trigger bonds_forbid_delete;
  alter table public.campaigns disable trigger campaigns_forbid_delete;
  alter table public.collectors disable trigger collectors_forbid_delete;
  alter table public.buyers disable trigger buyers_forbid_delete;
  alter table public.collector_ledger_entries disable trigger collector_ledger_entries_forbid_delete;
  delete from public.audit_log where request_id like 'race63-%%';
  delete from public.collector_ledger_entries where campaign_id = %1$L;
  delete from public.payments where campaign_id = %1$L;
  delete from public.settlements where campaign_id = %1$L;
  delete from public.sales where campaign_id = %1$L;
  delete from public.bonds where campaign_id = %1$L;
  delete from public.collectors where id = %2$L;
  delete from public.buyers where id = %3$L;
  delete from public.campaigns where id = %1$L;
  delete from public.user_roles where user_id = %4$L;
  delete from public.profiles where id = %4$L;
  delete from auth.users where id = %5$L;
  alter table public.audit_log enable trigger audit_log_forbid_update_delete;
  alter table public.payments enable trigger payments_forbid_delete;
  alter table public.settlements enable trigger settlements_forbid_delete;
  alter table public.sales enable trigger sales_forbid_delete;
  alter table public.bonds enable trigger bonds_forbid_delete;
  alter table public.campaigns enable trigger campaigns_forbid_delete;
  alter table public.collectors enable trigger collectors_forbid_delete;
  alter table public.buyers enable trigger buyers_forbid_delete;
  alter table public.collector_ledger_entries enable trigger collector_ledger_entries_forbid_delete;
  commit;
  $sql$, pg_temp.v('campaign'), pg_temp.v('collector'), pg_temp.v('buyer'), pg_temp.v('profile'), pg_temp.v('user'))),
  'cleanup: the committed race fixtures and audit rows are removed') where pg_temp.v('connected')::boolean;
select skip('dblink cannot connect to this server', 1) where not pg_temp.v('connected')::boolean;
select is(pg_temp.fetch('race_setup', format('select count(*)::text from public.audit_log where request_id like %L', 'race63-%')), '0',
  'cleanup: no audit rows are left behind') where pg_temp.v('connected')::boolean;
select extensions.dblink_disconnect(c) from unnest(extensions.dblink_get_connections()) as c where pg_temp.v('connected')::boolean;
select * from finish();
rollback;
