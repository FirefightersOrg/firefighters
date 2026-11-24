begin;
select plan(43);
insert into auth.users(id,email) values
('a6480000-0000-4000-8000-000000000001','san125-admin@example.com'),
('a6480000-0000-4000-8000-000000000002','san125-operator@example.com');
insert into public.profiles(id,auth_user_id,full_name,email,status)
select ('b6480000-0000-4000-8000-00000000000'||n)::uuid,
('a6480000-0000-4000-8000-00000000000'||n)::uuid,'SAN125 '||n,'san125-'||n||'@example.com','active'
from generate_series(1,2)n;
insert into public.user_roles(user_id,role_id)
select ('b6480000-0000-4000-8000-00000000000'||n)::uuid,r.id
from (values(1,'admin'),(2,'operator'))v(n,name) join public.roles r on r.name=v.name;
create temp table ids(k text primary key,id uuid not null) on commit preserve rows;
insert into ids select k,gen_random_uuid() from unnest(array[
  'c','d','r','b','n','e','buyer','collector','p'
])k;
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$;
create function pg_temp.actor() returns uuid language sql immutable as $$select 'b6480000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.act(n int) returns void language sql as $$
select set_config('request.jwt.claims',format('{"sub":"a6480000-0000-4000-8000-00000000000%s","role":"authenticated"}',n),true)$$;
grant execute on function pg_temp.id(text),pg_temp.actor(),pg_temp.act(int) to authenticated;
grant select,update on ids to authenticated;
insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode,max_number,associated_number_offset)
values(pg_temp.id('c'),'SAN125',100,2,50,'base_number',999,100);
insert into public.buyers(id,type,first_name) values(pg_temp.id('buyer'),'individual','SAN125');
insert into public.collectors(id,display_name) values(pg_temp.id('collector'),'SAN125');
insert into public.bonds(id,campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status)
values(pg_temp.id('b'),pg_temp.id('c'),'simple','printed',1,100,'available');
insert into public.bond_numbers(id,campaign_id,bond_id,number_value,number_kind)
values(pg_temp.id('n'),pg_temp.id('c'),pg_temp.id('b'),1,'base');
insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,created_by)
values(pg_temp.id('d'),pg_temp.id('c'),'final','SAN125',
(now() at time zone 'America/Argentina/Buenos_Aires')::date,now(),pg_temp.actor());
insert into public.draw_rosters(id,draw_id,generated_by,created_by)
values(pg_temp.id('r'),pg_temp.id('d'),pg_temp.actor(),pg_temp.actor());
insert into public.draw_roster_entries(id,draw_roster_id,bond_id,bond_number_id,number_value,
buyer_snapshot,collector_snapshot,eligible,created_by)
values(pg_temp.id('e'),pg_temp.id('r'),pg_temp.id('b'),pg_temp.id('n'),1,
jsonb_build_object('id',pg_temp.id('buyer')),jsonb_build_object('id',pg_temp.id('collector')),true,pg_temp.actor());
update public.draws set status='roster_generated' where id=pg_temp.id('d');
update public.draw_rosters set status='frozen',frozen_at=now(),frozen_by=pg_temp.actor() where id=pg_temp.id('r');
update public.draws set status='roster_frozen' where id=pg_temp.id('d');
select pg_temp.act(1);
set local role authenticated;
update ids set id=public.prize_create(pg_temp.id('d'),'SAN125',null,1,true,'048-create') where k='p';
select public.draw_load_winning_number(pg_temp.id('p'),1,null,'048-load');
select public.prize_resolve(pg_temp.id('p'),'award','Resolution notes','048-resolve');
select public.prize_deliver(pg_temp.id('p'),'Original delivery','048-deliver');
reset role;
create temp table before_denial as select to_jsonb(a) as snapshot from public.prize_awards a where prize_id=pg_temp.id('p');
grant select on before_denial to authenticated;
select pg_temp.act(2);
set local role authenticated;
select throws_ok($$select public.prize_reverse_delivery(pg_temp.id('p'),'Mistake','048-denied')$$,'42501',null,'operator cannot reverse delivery');
select is((select to_jsonb(a) from public.prize_awards a where prize_id=pg_temp.id('p')),(select snapshot from before_denial),'denial leaves award unchanged');
select is((select status from public.prizes where id=pg_temp.id('p')),'delivered','denial leaves prize unchanged');
reset role;
select is((select count(*) from public.audit_log where request_id='048-denied'),0::bigint,'denial has no audit');
select is((select count(*) from public.prize_delivery_reversals where prize_id=pg_temp.id('p')),0::bigint,'denial has no history');
select pg_temp.act(1);
set local role authenticated;
select set_config('request.headers','{"x-request-id":"048-direct-denied"}',true);
select throws_ok($$insert into public.prize_delivery_reversals default values$$,'42501',null,'direct history insert denied');
select throws_ok($$update public.prize_delivery_reversals set reason='forged' where prize_id=pg_temp.id('p')$$,'42501',null,'direct history update denied');
select throws_ok($$delete from public.prize_delivery_reversals where prize_id=pg_temp.id('p')$$,'42501',null,'direct history delete denied');
select throws_ok(format('select public.prize_reverse_delivery(%L,%L,''048-invalid'')',pg_temp.id('p'),reason),
  '22023',null,'invalid reversal reason') from unnest(array['',' ',repeat('🧯',1001),null])reason;
select lives_ok($$select public.prize_reverse_delivery(pg_temp.id('p'),' Mistake ','048-reverse')$$,'reverse delivery');
select is((select status from public.prizes where id=pg_temp.id('p')),'pending_delivery','prize pending again');
select ok((select status='awarded' and delivered_at is null and delivered_by is null and notes='Resolution notes'
  from public.prize_awards where prize_id=pg_temp.id('p')),'award restored to pre-delivery state');
select ok((select award_snapshot=(select snapshot from before_denial) and notes='Original delivery'
  and delivered_at is not null and delivered_by=pg_temp.actor() and reason='Mistake' and reversed_by=pg_temp.actor()
  from public.prize_delivery_reversals where prize_id=pg_temp.id('p')),'full original delivery preserved');
select ok((public.prize_certificate_data(pg_temp.id('p'))->>'prize_status')='pending_delivery'
  and (public.prize_certificate_data(pg_temp.id('p'))->>'award_status')='awarded'
  and (public.prize_certificate_data(pg_temp.id('p'))->>'delivered_at') is null,'reversed delivery cannot issue certificate');
select throws_ok($$select public.prize_reverse_delivery(pg_temp.id('p'),'Again','048-again')$$,'55000','prize must be delivered','repeated reversal refused');
select ok((select status='awarded' and delivered_at is null and delivered_by is null and notes='Resolution notes'
  from public.prize_awards where prize_id=pg_temp.id('p')),'repeated refusal preserves award');
select lives_ok($$select public.prize_deliver(pg_temp.id('p'),'Second delivery','048-redeliver')$$,'redelivery works');
select is((select notes from public.prize_delivery_reversals where prize_id=pg_temp.id('p')),'Original delivery','redelivery preserves original notes');
select is(public.prize_certificate_data(pg_temp.id('p'))->>'delivery_notes','Second delivery','new certificate uses new delivery');
reset role;
select ok((select old_value->'award'->>'notes'='Original delivery'
  and new_value->'award'->>'status'='awarded' and new_value->'reversal'->>'reason'='Mistake'
  and reason='Mistake' and actor_user_id=pg_temp.actor()
  from public.audit_log where request_id='048-reverse'),'audit has before/after and actor/reason');
select is((select count(*) from public.audit_log where request_id='048-reverse'),1::bigint,'one reversal audit');
select is((select count(*) from public.audit_log where request_id in ('048-invalid','048-again')),0::bigint,'failed calls never audit');
select is((select count(*) from public.audit_log where request_id='048-direct-denied'),0::bigint,'direct DML denial never audits');
select is((select count(*) from public.prize_delivery_reversals where prize_id=pg_temp.id('p')),1::bigint,'failed calls add no history');
select is((select array_agg(r.name order by r.name) from public.roles r
  join public.role_permissions rp on rp.role_id=r.id join public.permissions p on p.id=rp.permission_id
  where p.code='prize.reverse_delivery'),array['admin']::text[],'permission seeded only to admin');
select ok(not has_table_privilege(r,'public.prize_delivery_reversals','INSERT')
  and not has_table_privilege(r,'public.prize_delivery_reversals','UPDATE')
  and not has_table_privilege(r,'public.prize_delivery_reversals','DELETE'),r||' history DML blocked')
from unnest(array['anon','authenticated','service_role'])r;
select ok(has_function_privilege('authenticated','public.prize_reverse_delivery(uuid,text,text)','EXECUTE'),'RPC grant');
select ok(not has_function_privilege(r,'public.prize_reverse_delivery(uuid,text,text)','EXECUTE'),r||' no RPC grant')
from unnest(array['anon','service_role'])r;
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
  where p.oid='public.prize_reverse_delivery(uuid,text,text)'::regprocedure and a.grantee=0),'no PUBLIC execute');
select throws_ok($$update public.prize_delivery_reversals set reason='changed' where prize_id=pg_temp.id('p')$$,
  '23001',null,'history immutable even to owner');

-- The fixture is committed solely for two genuine sessions racing the public
-- RPC. Cleanup below is scoped to these ids, never global application data.
create extension if not exists dblink with schema extensions;
select extensions.dblink_connect(c,format('host=%s port=%s dbname=%s user=postgres password=postgres',
  coalesce(host(inet_server_addr()),'127.0.0.1'),inet_server_port(),current_database()))
from unnest(array['san125_a','san125_b'])c;
create function pg_temp.wait_lock(pid int) returns boolean language plpgsql as $$
begin
  for i in 1..200 loop
    if exists(select 1 from pg_stat_activity where pg_stat_activity.pid=$1 and wait_event_type='Lock') then return true; end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end $$;
create function pg_temp.result(c text) returns text language plpgsql as $$
declare msg text;
begin
  perform * from extensions.dblink_get_result(c,false) as t(v text);
  msg := extensions.dblink_error_message(c);
  perform * from extensions.dblink_get_result(c,false) as t(v text);
  return msg;
end $$;
commit;
select extensions.dblink_exec(c,$q$set request.jwt.claims='{"sub":"a6480000-0000-4000-8000-000000000001","role":"authenticated"}';set role authenticated$q$)
from unnest(array['san125_a','san125_b'])c;
select pid as bpid from extensions.dblink('san125_b','select pg_backend_pid()') as t(pid int) \gset
select extensions.dblink_exec('san125_a','begin');
select * from extensions.dblink('san125_a',format('select public.prize_reverse_delivery(%L,''Race first'',''048-race-first'')::text',pg_temp.id('p'))) as t(v text);
select extensions.dblink_send_query('san125_b',format('select public.prize_reverse_delivery(%L,''Race second'',''048-race-second'')::text',pg_temp.id('p')));
select ok(pg_temp.wait_lock(:'bpid'::int),'second reversal waits on SAN-81 locks');
select extensions.dblink_exec('san125_a','commit');
select matches(pg_temp.result('san125_b'),'prize must be delivered','loser rechecks committed state');
select is((select count(*) from public.audit_log where request_id='048-race-first'),1::bigint,'winning reversal audited once');
select is((select count(*) from public.audit_log where request_id='048-race-second'),0::bigint,'loser has no audit');
select is((select count(*) from public.prize_delivery_reversals where prize_id=pg_temp.id('p')),2::bigint,'one history per successful reversal');
select is((select status from public.prizes where id=pg_temp.id('p')),'pending_delivery','race leaves prize pending');
select is((select status from public.prize_awards where prize_id=pg_temp.id('p')),'awarded','race leaves award ready');
select extensions.dblink_disconnect(c) from unnest(array['san125_a','san125_b'])c;
begin;
set local session_replication_role=replica;
delete from public.audit_log where request_id like '048-%';
delete from public.prize_delivery_reversals where prize_id=pg_temp.id('p');
delete from public.prize_awards where prize_id=pg_temp.id('p');
delete from public.winning_numbers where prize_id=pg_temp.id('p');
delete from public.prizes where id=pg_temp.id('p');
delete from public.draw_roster_entries where draw_roster_id=pg_temp.id('r');
delete from public.draw_rosters where id=pg_temp.id('r');
delete from public.draws where id=pg_temp.id('d');
delete from public.bond_numbers where campaign_id=pg_temp.id('c');
delete from public.bonds where campaign_id=pg_temp.id('c');
delete from public.campaigns where id=pg_temp.id('c');
delete from public.buyers where id=pg_temp.id('buyer');
delete from public.collectors where id=pg_temp.id('collector');
delete from public.user_roles where user_id in ('b6480000-0000-4000-8000-000000000001','b6480000-0000-4000-8000-000000000002');
delete from public.profiles where id in ('b6480000-0000-4000-8000-000000000001','b6480000-0000-4000-8000-000000000002');
delete from auth.users where id in ('a6480000-0000-4000-8000-000000000001','a6480000-0000-4000-8000-000000000002');
commit;
select * from finish();
