-- SAN-62: settlement admission and status changes serialize in real sessions.
begin;
select plan(11);
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
  'user', 'profile', 'campaign', 'collector', 'buyer', 'bond', 'sale', 'close_set', 'annul_set', 'insert_set'
]) as k;
select pg_temp.exec('race_setup', format($sql$
  insert into auth.users (id,email) values (%1$L,%1$L || '@race.example.com');
  insert into public.profiles (id,auth_user_id,full_name,email,status)
    values (%2$L,%1$L,'Payment race',%1$L || '@race.example.com','active');
  insert into public.campaigns (id,name,simple_bond_value,installment_count,installment_value,barcode_mode)
    values (%3$L,'[pgtap payment race] ' || %3$L,100,2,50,'base_number');
  insert into public.collectors (id,display_name,user_profile_id) values (%4$L,'Race collector',%2$L);
  insert into public.buyers (id,type,first_name) values (%5$L,'individual','Race buyer');
  insert into public.bonds (id,campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status)
    values (%6$L,%3$L,'simple','printed',1,100,'available');
  insert into public.sales (id,campaign_id,bond_id,buyer_id,collector_id,payment_mode,total_amount,created_by)
    values (%7$L,%3$L,%6$L,%5$L,%4$L,'installments',100,%2$L);
  insert into public.settlements (id,campaign_id,settlement_number,collector_id,created_by)
    values (%8$L,%3$L,1,%4$L,%2$L),(%9$L,%3$L,2,%4$L,%2$L),(%10$L,%3$L,3,%4$L,%2$L);
  $sql$, pg_temp.v('user'), pg_temp.v('profile'), pg_temp.v('campaign'), pg_temp.v('collector'),
  pg_temp.v('buyer'), pg_temp.v('bond'), pg_temp.v('sale'), pg_temp.v('close_set'),
  pg_temp.v('annul_set'), pg_temp.v('insert_set')))
where pg_temp.v('connected')::boolean;
insert into race select 'pid_a', pg_temp.fetch('race_a', 'select pg_backend_pid()::text')
where pg_temp.v('connected')::boolean;
insert into race select 'pid_b', pg_temp.fetch('race_b', 'select pg_backend_pid()::text')
where pg_temp.v('connected')::boolean;

create function pg_temp.race_tests() returns setof text language plpgsql as $$
declare
  v_payment text := 'insert into public.payments (campaign_id,sale_id,collector_id,buyer_id,settlement_id,amount,payment_method,status,created_by) values (%1$L,%2$L,%3$L,%4$L,%5$L,1,''cash'',''pending_in_settlement'',%6$L)';
begin
  if not pg_temp.v('connected')::boolean then return; end if;
  -- Closing first: payment admission waits for the status update, then refuses the closed settlement.
  perform pg_temp.exec('race_a', 'begin');
  perform pg_temp.exec('race_a', format('update public.settlements set status = ''closed'', closed_at = now(), closed_by = %L where id = %L', pg_temp.v('profile'), pg_temp.v('close_set')));
  perform extensions.dblink_send_query('race_b', format(v_payment, pg_temp.v('campaign'), pg_temp.v('sale'), pg_temp.v('collector'), pg_temp.v('buyer'), pg_temp.v('close_set'), pg_temp.v('profile')));
  return next ok(pg_temp.waits_for_lock(pg_temp.v('pid_b')::int), 'race 1: admission waits for an uncommitted close');
  perform pg_temp.exec('race_a', 'commit');
  return next is(pg_temp.async_result('race_b'), 'a payment can only enter an open settlement of its collector', 'race 1: admission fails after close commits');
  return next is(pg_temp.fetch('race_setup', format('select status from public.settlements where id = %L', pg_temp.v('close_set'))), 'closed', 'race 1: settlement is closed');
  -- Annulment has the same serialization boundary.
  perform pg_temp.exec('race_a', 'begin');
  perform pg_temp.exec('race_a', format('update public.settlements set status = ''annulled'' where id = %L', pg_temp.v('annul_set')));
  perform extensions.dblink_send_query('race_b', format(v_payment, pg_temp.v('campaign'), pg_temp.v('sale'), pg_temp.v('collector'), pg_temp.v('buyer'), pg_temp.v('annul_set'), pg_temp.v('profile')));
  return next ok(pg_temp.waits_for_lock(pg_temp.v('pid_b')::int), 'race 2: admission waits for an uncommitted annulment');
  perform pg_temp.exec('race_a', 'commit');
  return next is(pg_temp.async_result('race_b'), 'a payment can only enter an open settlement of its collector', 'race 2: admission fails after annulment commits');
  return next is(pg_temp.fetch('race_setup', format('select status from public.settlements where id = %L', pg_temp.v('annul_set'))), 'annulled', 'race 2: settlement is annulled');
  -- Admission first: the close waits for the FOR SHARE lock, then succeeds once payment commits.
  perform pg_temp.exec('race_b', 'begin');
  perform pg_temp.exec('race_b', format(v_payment, pg_temp.v('campaign'), pg_temp.v('sale'), pg_temp.v('collector'), pg_temp.v('buyer'), pg_temp.v('insert_set'), pg_temp.v('profile')));
  perform extensions.dblink_send_query('race_a', format('update public.settlements set status = ''closed'', closed_at = now(), closed_by = %L where id = %L', pg_temp.v('profile'), pg_temp.v('insert_set')));
  return next ok(pg_temp.waits_for_lock(pg_temp.v('pid_a')::int), 'race 3: close waits for an uncommitted payment admission');
  perform pg_temp.exec('race_b', 'commit');
  return next is(pg_temp.async_result('race_a'), 'ok', 'race 3: close succeeds after payment admission commits');
  return next is(pg_temp.fetch('race_setup', format('select s.status || ''/'' || count(p.id)::text from public.settlements s left join public.payments p on p.settlement_id = s.id where s.id = %L group by s.status', pg_temp.v('insert_set'))), 'closed/1', 'race 3: committed payment remains in the closed settlement');
end $$;

select * from pg_temp.race_tests();
select skip('dblink cannot connect to this server', 9) where not pg_temp.v('connected')::boolean;
select lives_ok(format($t$select pg_temp.exec('race_setup', %L)$t$, format($sql$
  begin;
  alter table public.payments disable trigger payments_forbid_delete;
  alter table public.settlements disable trigger settlements_forbid_delete;
  alter table public.sales disable trigger sales_forbid_delete;
  alter table public.bonds disable trigger bonds_forbid_delete;
  alter table public.campaigns disable trigger campaigns_forbid_delete;
  alter table public.collectors disable trigger collectors_forbid_delete;
  alter table public.buyers disable trigger buyers_forbid_delete;
  delete from public.payments where campaign_id = %1$L;
  delete from public.settlements where campaign_id = %1$L;
  delete from public.sales where campaign_id = %1$L;
  delete from public.bonds where campaign_id = %1$L;
  delete from public.collectors where id = %2$L;
  delete from public.buyers where id = %3$L;
  delete from public.campaigns where id = %1$L;
  delete from public.profiles where id = %4$L;
  delete from auth.users where id = %5$L;
  alter table public.payments enable trigger payments_forbid_delete;
  alter table public.settlements enable trigger settlements_forbid_delete;
  alter table public.sales enable trigger sales_forbid_delete;
  alter table public.bonds enable trigger bonds_forbid_delete;
  alter table public.campaigns enable trigger campaigns_forbid_delete;
  alter table public.collectors enable trigger collectors_forbid_delete;
  alter table public.buyers enable trigger buyers_forbid_delete;
  commit;
  $sql$, pg_temp.v('campaign'), pg_temp.v('collector'), pg_temp.v('buyer'), pg_temp.v('profile'), pg_temp.v('user'))),
  'cleanup: the committed race fixtures are removed') where pg_temp.v('connected')::boolean;
select skip('dblink cannot connect to this server', 1) where not pg_temp.v('connected')::boolean;
select is(pg_temp.fetch('race_setup', format('select count(*)::text from public.campaigns where id = %L', pg_temp.v('campaign'))), '0',
  'cleanup: nothing is left behind') where pg_temp.v('connected')::boolean;
select skip('dblink cannot connect to this server', 1) where not pg_temp.v('connected')::boolean;
select extensions.dblink_disconnect(c) from unnest(extensions.dblink_get_connections()) as c where pg_temp.v('connected')::boolean;
select * from finish();
rollback;
