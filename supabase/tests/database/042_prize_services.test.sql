begin;
set local time zone 'America/Argentina/Buenos_Aires';
select plan(139);
insert into auth.users(id,email)
values('a6420000-0000-0000-0000-000000000001','san81-admin@example.com'),
('a6420000-0000-0000-0000-000000000002','san81-reader@example.com');
insert into public.profiles(id,auth_user_id,full_name,email,status)
select ('b6420000-0000-0000-0000-00000000000'||n)::uuid,
('a6420000-0000-0000-0000-00000000000'||n)::uuid,'SAN81 '||n,'san81-'||n||'@example.com','active'
from generate_series(1,2)n;
insert into public.user_roles(user_id,role_id)
select ('b6420000-0000-0000-0000-00000000000'||n)::uuid,r.id
from (values(1,'admin'),(2,'read-only'))v(n,name) join public.roles r on r.name=v.name;
create temp table ids(k text primary key,id uuid not null);
insert into ids select k,gen_random_uuid() from unnest(array[
  'c','d','scheduled','closed','r','b','b2','n','n2','e','e2','buyer','collector','p','bad','none','reject','replacement'
])k;
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$;
create function pg_temp.actor() returns uuid language sql immutable as $$select 'b6420000-0000-0000-0000-000000000001'::uuid$$;
create function pg_temp.act(n int) returns void language sql as $$
select set_config('request.jwt.claims',format('{"sub":"a6420000-0000-0000-0000-00000000000%s","role":"authenticated"}',n),true)$$;
grant execute on function pg_temp.id(text),pg_temp.actor(),pg_temp.act(int) to authenticated;
grant select,update on ids to authenticated;
insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode,max_number,associated_number_offset)
values(pg_temp.id('c'),'SAN81',100,2,50,'base_number',999,100);
insert into public.buyers(id,type,first_name) values(pg_temp.id('buyer'),'individual','Frozen');
insert into public.collectors(id,display_name) values(pg_temp.id('collector'),'Frozen');
insert into public.bonds(id,campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status)
select pg_temp.id(k),pg_temp.id('c'),'simple','printed',1,100,'available' from unnest(array['b','b2'])k;
insert into public.bond_numbers(id,campaign_id,bond_id,number_value,number_kind)
values(pg_temp.id('n'),pg_temp.id('c'),pg_temp.id('b'),1,'base'),
(pg_temp.id('n2'),pg_temp.id('c'),pg_temp.id('b2'),2,'base');
insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,created_by)
select pg_temp.id(k),pg_temp.id('c'),'final',k,
(now() at time zone 'America/Argentina/Buenos_Aires')::date,now(),pg_temp.actor()
from unnest(array['d','scheduled','closed'])k;
insert into public.draw_rosters(id,draw_id,generated_by,created_by)
values(pg_temp.id('r'),pg_temp.id('d'),pg_temp.actor(),pg_temp.actor());
insert into public.draw_roster_entries(id,draw_roster_id,bond_id,bond_number_id,number_value,
buyer_snapshot,collector_snapshot,eligible,ineligibility_reason,created_by)
select pg_temp.id(e),pg_temp.id('r'),pg_temp.id(b),pg_temp.id(n),num,
jsonb_build_object('id',pg_temp.id('buyer')),jsonb_build_object('id',pg_temp.id('collector')),
eligible,case when eligible then null else 'not_fully_paid' end,pg_temp.actor()
from (values('e','b','n',1,true),('e2','b2','n2',2,false))v(e,b,n,num,eligible);
update public.draws set status='roster_generated' where id in (pg_temp.id('d'),pg_temp.id('closed'));
update public.draw_rosters set status='frozen',frozen_at=now(),frozen_by=pg_temp.actor() where id=pg_temp.id('r');
update public.draws set status='roster_frozen' where id in (pg_temp.id('d'),pg_temp.id('closed'));
update public.draws set status='completed' where id=pg_temp.id('closed');
update public.draws set status='closed' where id=pg_temp.id('closed');
select pg_temp.act(1);
set local role authenticated;
select lives_ok($$update ids set id=public.prize_create(pg_temp.id('d'),' First ',null,1,true,'042-create') where k='p'$$,'create prize');
select lives_ok($$select public.prize_update(pg_temp.id('p'),'Edited','Description',1,true,'042-update')$$,'edit prize');
select is((select name from public.prizes where id=pg_temp.id('p')),'Edited','updated trimmed configuration');
select lives_ok($$select public.draw_load_winning_number(pg_temp.id('p'),1,'Original notes','042-load')$$,'load eligible');
select is((select result_status from public.winning_numbers where prize_id=pg_temp.id('p')),'eligible_winner','eligible classification');
select is((select status from public.prizes where id=pg_temp.id('p')),'pending_validation','eligible awaits resolution');
select throws_ok($$select public.draw_load_winning_number(pg_temp.id('p'),1,null,'042-duplicate')$$,'23505',null,'one loaded result per prize');
select lives_ok($$select public.prize_resolve(pg_temp.id('p'),'award','Award notes','042-resolve')$$,'resolve award');
select is((select status from public.prizes where id=pg_temp.id('p')),'pending_delivery','prize advanced atomically');
select is((select status from public.prize_awards where prize_id=pg_temp.id('p')),'awarded','award synchronized');
select ok((select bond_id=pg_temp.id('b') and buyer_id=pg_temp.id('buyer') and collector_id=pg_temp.id('collector')
  from public.prize_awards where prize_id=pg_temp.id('p')),'uses physical bond and snapshot parties');
select lives_ok($$select public.prize_deliver(pg_temp.id('p'),' Received by buyer ','042-deliver')$$,'deliver prize');
select is((select status from public.prizes where id=pg_temp.id('p')),'delivered','prize delivered');
select ok((select status='delivered' and delivered_at is not null and delivered_by=pg_temp.actor()
  and notes='Received by buyer' from public.prize_awards where prize_id=pg_temp.id('p')),'delivery metadata');
select lives_ok($$select public.prize_annul(pg_temp.id('p'),' Wrong winning result ','042-annul')$$,'annul delivered incorrect result');
select is((select status from public.prizes where id=pg_temp.id('p')),'annulled','prize voided');
select ok((select status='annulled' and annul_reason='Wrong winning result'
  and delivered_at is not null and notes='Received by buyer'
  from public.prize_awards where prize_id=pg_temp.id('p')),'award voided, delivery history retained');
select is((select notes from public.winning_numbers where prize_id=pg_temp.id('p')),'Original notes','loaded snapshot never overwritten');
select lives_ok($$update ids set id=public.prize_create(pg_temp.id('d'),'Correct result',null,1,true,'042-replacement') where k='replacement'$$,'replacement may reuse annulled position');
select lives_ok($$select public.draw_load_winning_number(pg_temp.id('replacement'),1,null,'042-correct-load')$$,'load correct result on replacement');
select lives_ok($$select public.prize_resolve(pg_temp.id('replacement'),'award',null,'042-correct-resolve')$$,'replacement award');
select lives_ok($$update ids set id=public.prize_create(pg_temp.id('d'),'Ineligible',null,2,true,'042-bad-create') where k='bad'$$,'create second position');
select lives_ok($$select public.draw_load_winning_number(pg_temp.id('bad'),2,null,'042-bad-load')$$,'load ineligible');
select is((select result_status from public.winning_numbers where prize_id=pg_temp.id('bad')),'not_eligible','ineligible classification');
select is((select status from public.prizes where id=pg_temp.id('bad')),'unawarded','ineligible unawarded');
select is((select e.ineligibility_reason from public.winning_numbers w join public.draw_roster_entries e on e.id=w.matched_roster_entry_id
  where w.prize_id=pg_temp.id('bad')),'not_fully_paid','frozen reason visible');
select lives_ok($$update ids set id=public.prize_create(pg_temp.id('d'),'No match',null,3,true,'042-none-create') where k='none'$$,'create third position');
select lives_ok($$select public.draw_load_winning_number(pg_temp.id('none'),999,null,'042-none-load')$$,'load absent number');
select is((select result_status from public.winning_numbers where prize_id=pg_temp.id('none')),'no_match','no match classification');
select is((select status from public.prizes where id=pg_temp.id('none')),'unawarded','no match unawarded');
select lives_ok($$update ids set id=public.prize_create(pg_temp.id('d'),'Reject',null,4,false,'042-reject-create') where k='reject'$$,'create non-excluding prize');
select lives_ok($$select public.draw_load_winning_number(pg_temp.id('reject'),1,null,'042-reject-load')$$,'load reject fixture');
select lives_ok($$select public.prize_resolve(pg_temp.id('reject'),'unaward','Declined','042-reject')$$,'explicit unaward');
select is((select status from public.prizes where id=pg_temp.id('reject')),'unawarded','explicit unaward terminal');
select is((select count(*) from public.prize_awards where prize_id=pg_temp.id('reject')),0::bigint,'unaward creates no award');
reset role;
select is((select count(*) from public.audit_log where request_id=q),1::bigint,'exactly one audit: '||q)
from unnest(array['042-create','042-update','042-load','042-resolve','042-deliver','042-annul',
'042-replacement','042-correct-load','042-correct-resolve','042-bad-create','042-bad-load',
'042-none-create','042-none-load','042-reject-create','042-reject-load','042-reject'])q;
select ok((select reason='Wrong winning result' and new_value->>'campaign_id'=pg_temp.id('c')::text
  from public.audit_log where request_id='042-annul'),'annul reason and campaign audit');
select ok((select new_value ?& array['correction_type','affected_entity','related_entity','reason','user','date',
  'previous_value','new_value','generated_compensatory_movements']
  and old_value->'awards'->0->>'status'='delivered'
  and new_value->'new_value'->'awards'->0->>'status'='annulled'
  from public.audit_log where request_id='042-annul'),'correction has all nine fields and both award snapshots');
select is((select count(*) from public.audit_log where request_id in ('042-annul','042-correct-load')),2::bigint,'both correction events preserved');

-- Each RPC denies before validation/state and leaves ALL fixture rows unchanged.
create temp table before_denial as select jsonb_build_object(
  'prizes',(select jsonb_agg(to_jsonb(p) order by p.id) from public.prizes p where draw_id=pg_temp.id('d')),
  'winners',(select jsonb_agg(to_jsonb(w) order by w.id) from public.winning_numbers w where draw_id=pg_temp.id('d')),
  'awards',(select jsonb_agg(to_jsonb(a) order by a.id) from public.prize_awards a join public.prizes p on p.id=a.prize_id where p.draw_id=pg_temp.id('d'))) as snapshot;
create function pg_temp.snapshot() returns jsonb language sql security definer set search_path='' as $$
select jsonb_build_object(
  'prizes',(select jsonb_agg(to_jsonb(p) order by p.id) from public.prizes p where draw_id=pg_temp.id('d')),
  'winners',(select jsonb_agg(to_jsonb(w) order by w.id) from public.winning_numbers w where draw_id=pg_temp.id('d')),
  'awards',(select jsonb_agg(to_jsonb(a) order by a.id) from public.prize_awards a join public.prizes p on p.id=a.prize_id where p.draw_id=pg_temp.id('d')))
$$;
create function pg_temp.audits(q text) returns bigint language sql security definer set search_path='' as $$
select count(*) from public.audit_log where request_id=q $$;
grant execute on function pg_temp.snapshot(),pg_temp.audits(text) to authenticated;
grant select on before_denial to authenticated;
create temp table calls(op text,q text);
insert into calls values
('create',$$select public.prize_create(pg_temp.id('d'),'Denied',null,9,true,'042-denied-create')$$),
('update',$$select public.prize_update(pg_temp.id('replacement'),'Denied',null,1,true,'042-denied-update')$$),
('load',$$select public.draw_load_winning_number(pg_temp.id('replacement'),1,null,'042-denied-load')$$),
('resolve',$$select public.prize_resolve(pg_temp.id('replacement'),'award',null,'042-denied-resolve')$$),
('deliver',$$select public.prize_deliver(pg_temp.id('replacement'),'Denied','042-denied-deliver')$$),
('annul',$$select public.prize_annul(pg_temp.id('replacement'),'Denied','042-denied-annul')$$);
grant select on calls to authenticated;
select pg_temp.act(2);
set local role authenticated;
select throws_ok(q,'42501',null,op||' permission SQLSTATE') from calls;
select is(pg_temp.audits('042-denied-'||op),0::bigint,op||' denial has no audit') from calls;
select is(pg_temp.snapshot(),(select snapshot from before_denial),op||' denial preserves state') from calls;
select set_config('request.headers','{"x-request-id":"042-denied-direct"}',true);
select throws_ok('update public.'||t||' set updated_at=now() where '||
  case when t='prizes' then 'id' else 'prize_id' end||'='||quote_literal(pg_temp.id('replacement')),
  '42501',null,'direct DML denied: '||t)
from unnest(array['prizes','winning_numbers','prize_awards'])t;
select is(pg_temp.snapshot(),(select snapshot from before_denial),'direct DML denial preserves full state');
select is(pg_temp.audits('042-denied-direct'),0::bigint,'direct DML denial has no audit');
reset role;
select pg_temp.act(1);
set local role authenticated;
select throws_ok($$select public.prize_create(pg_temp.id('closed'),'x',null,1,true,'042-state-create')$$,'55000',null,'create closed draw');
select throws_ok($$select public.prize_update(pg_temp.id('replacement'),'x',null,1,true,'042-state-update')$$,'55000',null,'update resolved');
select throws_ok($$select public.draw_load_winning_number(pg_temp.id('replacement'),1,null,'042-state-load')$$,'55000',null,'load resolved');
select throws_ok($$select public.prize_resolve(pg_temp.id('replacement'),'award',null,'042-state-resolve')$$,'55000',null,'resolve twice');
select throws_ok($$select public.prize_deliver(pg_temp.id('bad'),'x','042-state-deliver')$$,'55000',null,'deliver unawarded');
select throws_ok($$select public.prize_annul(pg_temp.id('p'),'x','042-state-annul')$$,'55000',null,'annul twice');
select throws_ok($$select public.prize_create(pg_temp.id('d'),' ',null,9,true,'042-invalid-create')$$,'22023',null,'create validates name');
-- Validation needs a pending prize, not a terminal state.
select public.prize_create(pg_temp.id('d'),'Validation',null,9,true,'042-validation-fixture') as validation_id \gset
update ids set id=:'validation_id' where k='scheduled';
select throws_ok($$select public.prize_update(pg_temp.id('scheduled'),'x',null,0,true,'042-invalid-update')$$,'22023',null,'update validates position');
select throws_ok($$select public.draw_load_winning_number(pg_temp.id('scheduled'),1000,null,'042-invalid-load')$$,'22023',null,'load validates campaign range');
select throws_ok($$select public.prize_resolve(pg_temp.id('scheduled'),'override',null,'042-invalid-resolve')$$,'22023',null,'resolve validates decision');
select throws_ok($$select public.prize_deliver(pg_temp.id('replacement'),' ','042-invalid-deliver')$$,'22023',null,'deliver requires notes');
select throws_ok($$select public.prize_annul(pg_temp.id('replacement'),repeat('x',1001),'042-invalid-annul')$$,'22023',null,'annul limits reason');
select throws_ok($$select public.prize_create(pg_temp.id('d'),'Duplicate',null,1,true,'042-duplicate-position')$$,'23505',null,'active position uniqueness');
select throws_ok($$select public.prize_annul(gen_random_uuid(),'x','042-missing')$$,'P0002',null,'missing prize');
reset role;
select is((select count(*) from public.audit_log where request_id like '042-state-%' or request_id like '042-invalid-%'
  or request_id in ('042-missing','042-duplicate','042-duplicate-position')),0::bigint,'failed calls never audit');
select is((select count(*) from public.prize_awards where prize_id=pg_temp.id('replacement')),1::bigint,'repeated resolve leaves one award');
select ok(not has_table_privilege(r,t,'INSERT') and not has_table_privilege(r,t,'UPDATE')
  and not has_table_privilege(r,t,'DELETE'),r||' direct DML blocked '||t)
from unnest(array['anon','authenticated','service_role'])r
cross join unnest(array['public.prizes','public.winning_numbers','public.prize_awards'])t;
select ok(has_function_privilege('authenticated',f,'EXECUTE'),'authenticated explicit RPC EXECUTE '||f)
from unnest(array['public.prize_create(uuid,text,text,integer,boolean,text)',
  'public.prize_update(uuid,text,text,integer,boolean,text)',
  'public.draw_load_winning_number(uuid,integer,text,text)','public.prize_resolve(uuid,text,text,text)',
  'public.prize_deliver(uuid,text,text)','public.prize_annul(uuid,text,text)'])f;
select ok(not has_function_privilege(r,f,'EXECUTE'),r||' has no RPC EXECUTE '||f)
from unnest(array['anon','service_role'])r cross join
unnest(array['public.prize_create(uuid,text,text,integer,boolean,text)',
  'public.prize_update(uuid,text,text,integer,boolean,text)',
  'public.draw_load_winning_number(uuid,integer,text,text)','public.prize_resolve(uuid,text,text,text)',
  'public.prize_deliver(uuid,text,text)','public.prize_annul(uuid,text,text)'])f;
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
  where p.oid=f::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'no PUBLIC RPC EXECUTE '||f)
from unnest(array['public.prize_create(uuid,text,text,integer,boolean,text)',
  'public.prize_update(uuid,text,text,integer,boolean,text)',
  'public.draw_load_winning_number(uuid,integer,text,text)','public.prize_resolve(uuid,text,text,text)',
  'public.prize_deliver(uuid,text,text)','public.prize_annul(uuid,text,text)'])f;

-- Consolation snapshot uses authoritative active awards; not merely loaded results.
-- Sell the physical winner after freeze: frozen identity is still authoritative.
select pg_temp.act(1);
update public.campaigns set starts_at=now()-interval '1 day',ends_at=now()+interval '1 year' where id=pg_temp.id('c');
select public.campaign_transition(pg_temp.id('c'),'active',p_request_id=>'042-activate');
select public.bond_deliver(pg_temp.id('c'),pg_temp.id('collector'),array[pg_temp.id('b')],null,'042-deliver-bond');
select public.sale_register(pg_temp.id('c'),pg_temp.id('b'),pg_temp.id('buyer'),'installments',
  (now() at time zone 'America/Argentina/Buenos_Aires')::date,'042-sale');
select public.draw_create(pg_temp.id('c'),'consolation','Consolation',
  (now() at time zone 'America/Argentina/Buenos_Aires')::date + 1,now(),1,'{}','042-consolation-create') as consolation \gset
select lives_ok(format('select public.draw_generate_roster(%L,''042-consolation'')',:'consolation'),'consolation generates');
select is((select count(*) from public.draw_roster_entries e join public.draw_rosters r on r.id=e.draw_roster_id
  where r.draw_id=:'consolation' and e.ineligibility_reason='not_sold'),1::bigint,'unsold reason precedence preserved');
select is((select e.ineligibility_reason from public.draw_roster_entries e join public.draw_rosters r on r.id=e.draw_roster_id
  where r.draw_id=:'consolation' and e.bond_id=pg_temp.id('b')),'already_won','active previous award excludes winner');
select public.prize_annul(pg_temp.id('replacement'),'Corrected exclusion','042-annul-replacement');
select public.draw_generate_roster(:'consolation','042-consolation-regenerate') as regenerated \gset
select is((select ineligibility_reason from public.draw_roster_entries where draw_roster_id=:'regenerated'
  and bond_id=pg_temp.id('b')),'installments_not_covered','annulled awards no longer exclude');

-- Two REAL sessions invoke the public RPCs. Committed fixture setup is removed
-- explicitly; all racing writes are request-scoped.
create extension if not exists dblink with schema extensions;
select extensions.dblink_connect(c,format('host=%s port=%s dbname=%s user=postgres password=postgres',
  coalesce(host(inet_server_addr()),'127.0.0.1'),inet_server_port(),current_database()))
from unnest(array['san81_a','san81_b'])c;
select extensions.dblink_exec('san81_a',$q$
insert into auth.users(id,email) values('a6421000-0000-0000-0000-000000000001','san81-race@example.com');
insert into public.profiles(id,auth_user_id,full_name,email,status)
values('b6421000-0000-0000-0000-000000000001','a6421000-0000-0000-0000-000000000001','Race','san81-race@example.com','active');
insert into public.user_roles(user_id,role_id) select 'b6421000-0000-0000-0000-000000000001',id from public.roles where name='admin';
insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode,max_number,associated_number_offset)
values('c6421000-0000-0000-0000-000000000001','SAN81 race',100,2,50,'base_number',999,100);
insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,created_by)
values('d6421000-0000-0000-0000-000000000001','c6421000-0000-0000-0000-000000000001',
'final','Race',(now() at time zone 'America/Argentina/Buenos_Aires')::date,now(),'b6421000-0000-0000-0000-000000000001');
insert into public.draw_rosters(draw_id,generated_by,created_by)
values('d6421000-0000-0000-0000-000000000001','b6421000-0000-0000-0000-000000000001','b6421000-0000-0000-0000-000000000001');
update public.draws set status='roster_generated' where id='d6421000-0000-0000-0000-000000000001';
update public.draw_rosters set status='frozen',frozen_at=now(),frozen_by='b6421000-0000-0000-0000-000000000001'
where draw_id='d6421000-0000-0000-0000-000000000001';
update public.draws set status='roster_frozen' where id='d6421000-0000-0000-0000-000000000001';
insert into public.prizes(id,draw_id,name,position,created_by)
values('e6421000-0000-0000-0000-000000000001','d6421000-0000-0000-0000-000000000001','Race',1,'b6421000-0000-0000-0000-000000000001');
$q$);
create function pg_temp.remote(c text,q text) returns text language sql as $$
select v from extensions.dblink(c,q) as t(v text) $$;
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
  return case when msg='OK' then 'ok' else regexp_replace(split_part(msg,E'\n',1),'^ERROR:\s+','') end;
end $$;
select pg_temp.remote('san81_a','select pg_backend_pid()::text') as apid \gset
select pg_temp.remote('san81_b','select pg_backend_pid()::text') as bpid \gset
select extensions.dblink_exec(c,$q$set request.jwt.claims='{"sub":"a6421000-0000-0000-0000-000000000001","role":"authenticated"}';set role authenticated$q$)
from unnest(array['san81_a','san81_b'])c;
select extensions.dblink_exec('san81_a','begin');
select pg_temp.remote('san81_a',$q$select public.draw_load_winning_number('e6421000-0000-0000-0000-000000000001',999,null,'042-race-first')::text$q$);
select extensions.dblink_send_query('san81_b',$q$select public.draw_load_winning_number('e6421000-0000-0000-0000-000000000001',998,null,'042-race-second')::text$q$);
select ok(pg_temp.wait_lock(:'bpid'::int),'second load waits for first draw lock');
select extensions.dblink_exec('san81_a','commit');
select is(pg_temp.result('san81_b'),'winning numbers require a pending prize and frozen draw','second loader rechecks committed status');
select is(pg_temp.remote('san81_a',$q$select count(*)::text from public.winning_numbers where prize_id='e6421000-0000-0000-0000-000000000001'$q$),'1','no duplicate result');
select is(pg_temp.remote('san81_a',$q$select count(*)::text from public.audit_log where request_id='042-race-second'$q$),'0','losing loader no audit');
select extensions.dblink_exec('san81_a','begin');
select pg_temp.remote('san81_a',$q$select public.prize_create('d6421000-0000-0000-0000-000000000001','Hold draw',null,2,true,'042-race-create')::text$q$);
select extensions.dblink_exec('san81_b','reset role');
select extensions.dblink_send_query('san81_b',$q$update public.draws set status='completed' where id='d6421000-0000-0000-0000-000000000001' returning status$q$);
select ok(pg_temp.wait_lock(:'bpid'::int),'draw lifecycle waits for prize RPC');
select extensions.dblink_exec('san81_a','rollback');
select is(pg_temp.result('san81_b'),'ok','lifecycle proceeds after RPC releases parents');
select extensions.dblink_exec('san81_b','begin');
select extensions.dblink_exec('san81_b',$q$update public.draws set status='closed' where id='d6421000-0000-0000-0000-000000000001'$q$);
select extensions.dblink_send_query('san81_a',$q$select public.prize_create('d6421000-0000-0000-0000-000000000001','Late',null,2,true,'042-race-late')::text$q$);
select ok(pg_temp.wait_lock(:'apid'::int),'prize RPC waits for closure');
select extensions.dblink_exec('san81_b','commit');
select is(pg_temp.result('san81_a'),'draw is closed or annulled','RPC rechecks closed draw');
select is(pg_temp.remote('san81_b',$q$select count(*)::text from public.audit_log where request_id in ('042-race-late','042-race-create')$q$),'0','closure refusal and rollback preserve audit');
select extensions.dblink_exec('san81_b',$q$
begin;
set local session_replication_role=replica;
delete from public.audit_log where request_id='042-race-first';
delete from public.winning_numbers where draw_id='d6421000-0000-0000-0000-000000000001';
delete from public.prizes where draw_id='d6421000-0000-0000-0000-000000000001';
delete from public.draw_rosters where draw_id='d6421000-0000-0000-0000-000000000001';
delete from public.draws where id='d6421000-0000-0000-0000-000000000001';
delete from public.campaigns where id='c6421000-0000-0000-0000-000000000001';
delete from public.user_roles where user_id='b6421000-0000-0000-0000-000000000001';
delete from public.profiles where id='b6421000-0000-0000-0000-000000000001';
delete from auth.users where id='a6421000-0000-0000-0000-000000000001';
commit;
$q$);
select extensions.dblink_disconnect(c) from unnest(array['san81_a','san81_b'])c;
select * from finish();
rollback;
