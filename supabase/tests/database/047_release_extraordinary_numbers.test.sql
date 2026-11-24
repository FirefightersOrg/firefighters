-- Dedicated committed fixture permits real RPC races through two dblink sessions.
begin;
select plan(44);
insert into auth.users(id,email) values
('a6470000-0000-0000-0000-000000000001','san117-admin@example.com'),
('a6470000-0000-0000-0000-000000000002','san117-reader@example.com');
insert into public.profiles(id,auth_user_id,full_name,email,status)
select ('b6470000-0000-0000-0000-00000000000'||n)::uuid,
('a6470000-0000-0000-0000-00000000000'||n)::uuid,'SAN117 '||n,'san117-'||n||'@example.com','active'
from generate_series(1,2)n;
insert into public.user_roles(user_id,role_id)
select ('b6470000-0000-0000-0000-00000000000'||n)::uuid,r.id
from (values(1,'admin'),(2,'read-only'))v(n,name) join public.roles r on r.name=v.name;
create function pg_temp.act_as(n int) returns void language sql as $$
select set_config('request.jwt.claims',format('{"sub":"a6470000-0000-0000-0000-00000000000%s","role":"authenticated"}',n),true)$$;
create function pg_temp.did(n int) returns uuid language sql immutable as $$
select ('d6470000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.act_as(int),pg_temp.did(int) to authenticated;
insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode,starts_at,ends_at)
values('c6470000-0000-0000-0000-000000000001','SAN117',100,1,100,'base_number',now(),now()+interval '1 day');
update public.campaigns set status='active' where id='c6470000-0000-0000-0000-000000000001';
insert into public.collectors(id,display_name) values('e6470000-0000-0000-0000-000000000001','SAN117');
insert into public.buyers(id,type,first_name,document_number)
values('f6470000-0000-0000-0000-000000000001','individual','SAN117','SAN117');
-- Use audited commercial/financial RPCs to build a genuinely paid source bond.
set local role authenticated;
select pg_temp.act_as(1);
create temp table fixture(k text primary key,id uuid);
insert into fixture values('bond',public.bond_create(
p_campaign_id=>'c6470000-0000-0000-0000-000000000001',p_base_numbers=>array[100],p_request_id=>'047-bond'));
select public.bond_deliver('c6470000-0000-0000-0000-000000000001','e6470000-0000-0000-0000-000000000001',
array[(select id from fixture where k='bond')],null,'047-deliver');
insert into fixture values('sale',public.sale_register('c6470000-0000-0000-0000-000000000001',
(select id from fixture where k='bond'),'f6470000-0000-0000-0000-000000000001','full_payment',
(now() at time zone 'America/Argentina/Buenos_Aires')::date,'047-sale'));
insert into fixture values('settlement',public.settlement_open('c6470000-0000-0000-0000-000000000001',
'e6470000-0000-0000-0000-000000000001',null,'047-open'));
select public.settlement_add_payment((select id from fixture where k='settlement'),(select id from fixture where k='sale'),
100,'cash',
(select jsonb_agg(jsonb_build_object('installment_id',i.id,'amount_applied',i.amount))
from public.installments i join public.payment_plans pp on pp.id=i.payment_plan_id
where pp.sale_id=(select id from fixture where k='sale')),
(now() at time zone 'America/Argentina/Buenos_Aires')::date,'047-payment');
select public.settlement_close((select id from fixture where k='settlement'),'047-close');
reset role;
insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,required_installment_number,created_by)
select pg_temp.did(n),'c6470000-0000-0000-0000-000000000001',
case when n=4 then 'monthly' else 'extraordinary_full_payment' end,'SAN117 '||n,
(now() at time zone 'America/Argentina/Buenos_Aires')::date,now(),1,'b6470000-0000-0000-0000-000000000001'
from generate_series(1,4)n;
set local role authenticated;
select pg_temp.act_as(1);
select public.draw_generate_roster(pg_temp.did(1),'047-initial');
reset role;
commit;

begin;
create temp table original_extra as select * from public.bond_numbers
where campaign_id='c6470000-0000-0000-0000-000000000001' and number_kind='extraordinary';
create temp table original_entries as select e.* from public.draw_roster_entries e
join public.draw_rosters r on r.id=e.draw_roster_id where r.draw_id=pg_temp.did(1);
set local role authenticated;
select pg_temp.act_as(2);
select throws_ok($$select public.draw_annul(pg_temp.did(1),'Denied','047-denied')$$,'42501',null,'annul requires permission');
reset role;
select is((select count(*)::int from public.audit_log where request_id='047-denied'),0,'denial has no audit');
select is((select status from public.draws where id=pg_temp.did(1)),'roster_generated','denial preserves draw');
select results_eq($$select * from public.bond_numbers where id in (select id from original_extra) order by id$$,
$$select * from original_extra order by id$$,'denial preserves reservations');
-- A failing audit insert must roll back both the status change and every release.
create function pg_temp.fail_audit() returns trigger language plpgsql as $$
begin
  if new.request_id='047-audit-fail' then raise exception 'fixture audit failure' using errcode='23514'; end if;
  return new;
end$$;
grant execute on function pg_temp.fail_audit() to authenticated;
create trigger san117_fail_audit before insert on public.audit_log
for each row execute function pg_temp.fail_audit();
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok($$select public.draw_annul(pg_temp.did(1),'Rollback','047-audit-fail')$$,'23514','fixture audit failure','audit failure aborts annulment');
reset role;
drop trigger san117_fail_audit on public.audit_log;
select is((select status from public.draws where id=pg_temp.did(1)),'roster_generated','failed audit rolls back draw');
select results_eq($$select * from public.bond_numbers where id in (select id from original_extra) order by id$$,
$$select * from original_extra order by id$$,'failed audit rolls back release');
select is((select count(*)::int from public.audit_log where request_id='047-audit-fail'),0,'failed audit leaves no event');
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok($$select public.draw_annul(pg_temp.did(1),' ','047-invalid')$$,'22023',null,'blank reason refused');
select throws_ok($$select public.draw_annul(null,'Reason','047-null')$$,'22023',null,'null id refused');
select throws_ok($$select public.draw_annul(gen_random_uuid(),'Reason','047-missing')$$,'P0002',null,'missing draw');
select lives_ok($$select public.draw_annul(pg_temp.did(1),'  Cancel extra  ','047-release')$$,'generated extraordinary draw annulled');
reset role;
select ok((select bool_and(released_at is not null and released_by='b6470000-0000-0000-0000-000000000001'::uuid)
from public.bond_numbers where id in (select id from original_extra)),'extras released with actor');
select is((select count(*)::int from public.bond_numbers where campaign_id='c6470000-0000-0000-0000-000000000001'
and number_kind<>'extraordinary' and released_at is not null),0,'ordinary reservations untouched');
select is((select count(*)::int from public.audit_log where request_id='047-release'),1,'one transactional audit');
select ok((select old_value->>'status'='roster_generated' and new_value->>'status'='annulled' and reason='Cancel extra'
and new_value->'released_number_ids'=(select jsonb_agg(id order by id) from original_extra)
from public.audit_log where request_id='047-release'),'audit includes exact released ids and before/after');
select results_eq($$select e.* from public.draw_roster_entries e join public.draw_rosters r on r.id=e.draw_roster_id
where r.draw_id=pg_temp.did(1) order by e.id$$,$$select * from original_entries order by id$$,'annulled roster entries retained verbatim');
set local role authenticated;
select throws_ok($$select public.draw_annul(pg_temp.did(1),'Again','047-again')$$,'55000',null,'repeat annulment refused');
select lives_ok($$select public.draw_generate_roster(pg_temp.did(2),'047-reassign')$$,'later draw reallocates');
reset role;
select is((select count(*)::int from public.bond_numbers n join original_extra o on o.number_value=n.number_value
and o.source_base_number_id=n.source_base_number_id where n.released_at is null and n.id<>o.id),1,'same value/source gets a new historical row');
select results_eq($$select e.* from public.draw_roster_entries e join public.draw_rosters r on r.id=e.draw_roster_id
where r.draw_id=pg_temp.did(1) order by e.id$$,$$select * from original_entries order by id$$,'reallocation never rewrites history');
select is((select count(*)::int from public.audit_log where request_id in ('047-invalid','047-null','047-missing','047-again')),0,'failed calls have no audit');
select ok((select status='annulled' and annul_reason='Cancel extra' from public.draws where id=pg_temp.did(1)),'original reason retained');
rollback;

begin;
set local role authenticated;
select pg_temp.act_as(1);
select public.draw_generate_roster(pg_temp.did(2),'047-shared');
select public.draw_generate_roster(pg_temp.did(2),'047-superseded');
select public.draw_freeze_roster(pg_temp.did(2),'047-freeze');
reset role;
create temp table frozen_entries as select e.* from public.draw_roster_entries e
join public.draw_rosters r on r.id=e.draw_roster_id where r.draw_id=pg_temp.did(2);
set local role authenticated;
select lives_ok($$select public.draw_annul(pg_temp.did(1),'Shared','047-keep')$$,'annul succeeds when another roster shares extra');
select throws_ok($$select public.draw_annul(pg_temp.did(2),'Frozen','047-frozen')$$,'55000',null,'frozen extraordinary cannot be annulled');
select throws_ok($$select public.draw_generate_roster(pg_temp.did(2),'047-frozen-generate')$$,'55000',null,'frozen roster cannot regenerate');
select public.draw_generate_roster(pg_temp.did(4),'047-monthly');
select throws_ok($$select public.draw_annul(pg_temp.did(4),'Monthly','047-monthly-annul')$$,'55000',null,'generated ordinary draws cannot annul');
reset role;
select is((select count(*)::int from public.bond_numbers where campaign_id='c6470000-0000-0000-0000-000000000001'
and number_kind='extraordinary' and released_at is null),1,'other non-annulled roster retains reservation');
select is((select new_value->'released_number_ids' from public.audit_log where request_id='047-keep'),'[]'::jsonb,'kept reservations absent from released ids');
select results_eq($$select e.* from public.draw_roster_entries e join public.draw_rosters r on r.id=e.draw_roster_id
where r.draw_id=pg_temp.did(2) order by e.id$$,$$select * from frozen_entries order by id$$,'all frozen and superseded entry rows unchanged');
select is((select count(*)::int from public.audit_log where request_id in ('047-frozen','047-frozen-generate','047-monthly-annul')),0,'state refusals unaudited');
select is((select status from public.draws where id=pg_temp.did(2)),'roster_frozen','frozen status unchanged');
select ok(not has_table_privilege(r,'public.draws','UPDATE'),r||' cannot annul draws directly')
from unnest(array['anon','authenticated','service_role'])r;
rollback;

-- Annul holds the same seed-77 lock used by generation on a different draw.
create extension if not exists dblink with schema extensions;
select extensions.dblink_connect(c,format('host=%s port=%s dbname=%s user=postgres password=postgres',
  coalesce(host(inet_server_addr()),'127.0.0.1'),inet_server_port(),current_database()))
from unnest(array['release_a','release_b'])c;
select extensions.dblink_exec('release_a',$q$begin; set local role authenticated;
set local request.jwt.claims='{"sub":"a6470000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$begin perform public.draw_annul('d6470000-0000-0000-0000-000000000001','Race release','047-race-annul'); end$$;$q$);
select extensions.dblink_exec('release_b',$q$begin; set local role authenticated;
set local request.jwt.claims='{"sub":"a6470000-0000-0000-0000-000000000001","role":"authenticated"}';$q$);
select extensions.dblink_send_query('release_b',$$select public.draw_generate_roster('d6470000-0000-0000-0000-000000000003','047-race-generate')$$);
do $$begin
for n in 1..100 loop
  exit when exists(select 1 from pg_stat_activity where query like '%047-race-generate%'
  and pid<>pg_backend_pid() and wait_event='advisory');
  perform pg_sleep(0.02);
end loop;
end$$;
select ok(exists(select 1 from pg_stat_activity where query like '%047-race-generate%'
and pid<>pg_backend_pid() and wait_event='advisory'),'generation really waits for annulment advisory lock');
select extensions.dblink_exec('release_a','commit');
select ok(id is not null,'waiting generation succeeds after release') from extensions.dblink_get_result('release_b') as t(id uuid);
select * from extensions.dblink_get_result('release_b') as t(id uuid);
select extensions.dblink_exec('release_b','commit');
select is((select count(*)::int from public.bond_numbers where campaign_id='c6470000-0000-0000-0000-000000000001'
and number_kind='extraordinary' and released_at is null),1,'racing generation has one active extra');
select is((select count(*)::int from public.bond_numbers where campaign_id='c6470000-0000-0000-0000-000000000001'
and number_kind='extraordinary' and released_at is not null),1,'race preserves released historical row');
select is((select count(*)::int from public.audit_log where request_id in ('047-race-annul','047-race-generate')),2,'both race operations audited');
-- Reverse order: generation publishes another reference before waiting annulment rechecks.
select extensions.dblink_exec('release_a',$q$begin; set local role authenticated;
set local request.jwt.claims='{"sub":"a6470000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$begin perform public.draw_generate_roster('d6470000-0000-0000-0000-000000000002','047-race-reuse'); end$$;$q$);
select extensions.dblink_exec('release_b',$q$begin; set local role authenticated;
set local request.jwt.claims='{"sub":"a6470000-0000-0000-0000-000000000001","role":"authenticated"}';$q$);
select extensions.dblink_send_query('release_b',$q$select public.draw_annul('d6470000-0000-0000-0000-000000000003','Keep newly shared','047-race-keep')::text$q$);
do $$begin
for n in 1..100 loop
  exit when exists(select 1 from pg_stat_activity where query like '%047-race-keep%'
  and pid<>pg_backend_pid() and wait_event='advisory');
  perform pg_sleep(0.02);
end loop;
end$$;
select ok(exists(select 1 from pg_stat_activity where query like '%047-race-keep%'
and pid<>pg_backend_pid() and wait_event='advisory'),'annulment really waits for another draw generation');
select extensions.dblink_exec('release_a','commit');
select * from extensions.dblink_get_result('release_b') as t(result text);
select * from extensions.dblink_get_result('release_b') as t(result text);
select extensions.dblink_exec('release_b','commit');
select is((select status from public.draws where id=pg_temp.did(3)),'annulled','waiting annulment succeeds');
select is((select new_value->'released_number_ids' from public.audit_log where request_id='047-race-keep'),
'[]'::jsonb,'waiting annulment sees committed new reference and releases nothing');
select is((select count(*)::int from public.bond_numbers where campaign_id='c6470000-0000-0000-0000-000000000001'
and number_kind='extraordinary' and released_at is null),1,'newly referenced extra remains reserved');
select extensions.dblink_disconnect('release_a');
select extensions.dblink_disconnect('release_b');

-- Cleanup only this fixture, bypassing immutable-history guards as in 038.
begin;
set local session_replication_role=replica;
delete from public.audit_log where actor_user_id in ('b6470000-0000-0000-0000-000000000001','b6470000-0000-0000-0000-000000000002');
delete from public.draw_roster_entries where draw_roster_id in (select id from public.draw_rosters
where draw_id in (select id from public.draws where campaign_id='c6470000-0000-0000-0000-000000000001'));
delete from public.draw_rosters where draw_id in (select id from public.draws where campaign_id='c6470000-0000-0000-0000-000000000001');
delete from public.draws where campaign_id='c6470000-0000-0000-0000-000000000001';
delete from public.collector_ledger_entries where campaign_id='c6470000-0000-0000-0000-000000000001';
delete from public.payment_installments where payment_id in (select id from public.payments where campaign_id='c6470000-0000-0000-0000-000000000001');
delete from public.payments where campaign_id='c6470000-0000-0000-0000-000000000001';
delete from public.installments where payment_plan_id in (select p.id from public.payment_plans p join public.sales s on s.id=p.sale_id where s.campaign_id='c6470000-0000-0000-0000-000000000001');
delete from public.payment_plans where sale_id in (select id from public.sales where campaign_id='c6470000-0000-0000-0000-000000000001');
delete from public.settlements where campaign_id='c6470000-0000-0000-0000-000000000001';
delete from public.sales where campaign_id='c6470000-0000-0000-0000-000000000001';
delete from public.bond_assignments where campaign_id='c6470000-0000-0000-0000-000000000001';
delete from public.delivery_note_items where delivery_note_id in (select id from public.delivery_notes where campaign_id='c6470000-0000-0000-0000-000000000001');
delete from public.delivery_notes where campaign_id='c6470000-0000-0000-0000-000000000001';
delete from public.bond_numbers where campaign_id='c6470000-0000-0000-0000-000000000001';
delete from public.bonds where campaign_id='c6470000-0000-0000-0000-000000000001';
delete from public.campaigns where id='c6470000-0000-0000-0000-000000000001';
delete from public.collectors where id='e6470000-0000-0000-0000-000000000001';
delete from public.buyers where id='f6470000-0000-0000-0000-000000000001';
delete from public.user_roles where user_id in ('b6470000-0000-0000-0000-000000000001','b6470000-0000-0000-0000-000000000002');
delete from public.profiles where id in ('b6470000-0000-0000-0000-000000000001','b6470000-0000-0000-0000-000000000002');
delete from auth.users where id in ('a6470000-0000-0000-0000-000000000001','a6470000-0000-0000-0000-000000000002');
commit;
select * from finish();
