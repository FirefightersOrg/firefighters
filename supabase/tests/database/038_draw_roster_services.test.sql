begin;
set local time zone 'America/Argentina/Buenos_Aires';
select plan(153);
insert into auth.users(id,email)
select ('a6380000-0000-0000-0000-00000000000'||n)::uuid,'roster-'||n||'@example.com' from generate_series(1,2)n;
insert into public.profiles(id,auth_user_id,full_name,email,status)
select ('b6380000-0000-0000-0000-00000000000'||n)::uuid,
('a6380000-0000-0000-0000-00000000000'||n)::uuid,'Roster '||n,'roster-'||n||'@example.com','active' from generate_series(1,2)n;
insert into public.user_roles(user_id,role_id)
select ('b6380000-0000-0000-0000-00000000000'||n)::uuid,r.id
from (values (1,'admin'),(2,'read-only'))v(n,name) join public.roles r on r.name=v.name;
create function pg_temp.act_as(n int) returns void language sql as $$
select set_config('request.jwt.claims',format('{"sub":"a6380000-0000-0000-0000-00000000000%s","role":"authenticated"}',n),true)$$;
create temp table ids(k text primary key,id uuid not null);
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$;
grant execute on function pg_temp.id(text),pg_temp.act_as(int) to authenticated,anon,service_role;
grant select,insert on ids to authenticated;
insert into ids select k,gen_random_uuid() from unnest(array['c','collector','buyer','monthly','final','extra','extra2','consolation','set'])k;
insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode)
values(pg_temp.id('c'),'Roster service',100,2,50,'base_number');
insert into public.collectors(id,display_name) values(pg_temp.id('collector'),'Roster collector');
insert into public.buyers(id,type,first_name,document_number) values(pg_temp.id('buyer'),'individual','Roster buyer','12345');
insert into public.settlements(id,campaign_id,collector_id,settlement_number,created_by)
values(pg_temp.id('set'),pg_temp.id('c'),pg_temp.id('collector'),1,'b6380000-0000-0000-0000-000000000001');
-- 1 fully paid simple; 2 first installment only; 3 pending confirmation;
-- 4 payment after cutoff; 5 unsold; 6 annulled but still reserved; 7 fully paid pata.
create function pg_temp.fixture(n int) returns void language plpgsql as $$
declare b uuid; s uuid; pp uuid; pay uuid; i uuid; units int := case when n=7 then 2 else 1 end;
begin
  insert into public.bonds(campaign_id,kind,origin,commercial_unit_count,total_value)
  values(pg_temp.id('c'),case when n=7 then 'pata' else 'simple' end,'printed',units,100*units) returning id into b;
  insert into ids values('bond'||n,b);
  insert into public.bond_numbers(campaign_id,bond_id,number_value,number_kind)
  select pg_temp.id('c'),b,n*10+j,'base' from generate_series(0,units-1)j;
  insert into public.bond_numbers(campaign_id,bond_id,number_value,number_kind,source_base_number_id)
  select pg_temp.id('c'),b,number_value+4871,'associated',id from public.bond_numbers where bond_id=b and number_kind='base';
  if n=5 then return; end if;
  update public.bonds set commercial_status='delivered_to_collector',current_collector_id=pg_temp.id('collector') where id=b;
  update public.bonds set commercial_status='sold',current_buyer_id=pg_temp.id('buyer') where id=b;
  insert into public.sales(campaign_id,bond_id,buyer_id,collector_id,payment_mode,total_amount,created_by)
  values(pg_temp.id('c'),b,pg_temp.id('buyer'),pg_temp.id('collector'),'installments',100*units,'b6380000-0000-0000-0000-000000000001') returning id into s;
  insert into public.payment_plans(sale_id,installment_count,total_amount) values(s,2,100*units) returning id into pp;
  insert into public.installments(payment_plan_id,installment_number,due_date,amount)
  select pp,j,(now() at time zone 'America/Argentina/Buenos_Aires')::date,50*units from generate_series(1,2)j;
  insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,settlement_id,amount,payment_method,payment_date,status,created_by)
  values(pg_temp.id('c'),s,pg_temp.id('collector'),pg_temp.id('buyer'),pg_temp.id('set'),
    case when n=2 then 50 else 100*units end,'cash',
    (now() at time zone 'America/Argentina/Buenos_Aires')::date-case when n=4 then 0 else 1 end,
    'pending_in_settlement','b6380000-0000-0000-0000-000000000001') returning id into pay;
  insert into public.payment_installments(payment_id,installment_id,amount_applied)
  select pay,id,amount from public.installments where payment_plan_id=pp and (n<>2 or installment_number=1);
  insert into ids values('pay'||n,pay);
  if n<>3 then update public.payments set status='confirmed' where id=pay; end if;
  if n=6 then update public.bonds set commercial_status='annulled',annulled_by='b6380000-0000-0000-0000-000000000001',annul_reason='Test annulment' where id=b; end if;
end $$;
select pg_temp.fixture(n) from generate_series(1,7)n;
-- Annulled-from-available reservations are released history, not participating rows.
with b as (insert into public.bonds(campaign_id,kind,origin,commercial_unit_count,total_value)
  values(pg_temp.id('c'),'simple','printed',1,100) returning id)
insert into ids select 'released',id from b;
insert into public.bond_numbers(campaign_id,bond_id,number_value,number_kind)
values(pg_temp.id('c'),pg_temp.id('released'),80,'base');
update public.bonds set commercial_status='annulled',
  annulled_by='b6380000-0000-0000-0000-000000000001',annul_reason='Mistaken load'
  where id=pg_temp.id('released');
update public.bond_numbers set released_at=now(),released_by='b6380000-0000-0000-0000-000000000001'
  where bond_id=pg_temp.id('released');
insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,required_installment_number,created_by)
select pg_temp.id(k),pg_temp.id('c'),t,k,(now() at time zone 'America/Argentina/Buenos_Aires')::date,
  ((now() at time zone 'America/Argentina/Buenos_Aires')::date-1)+time '23:59:59' at time zone 'America/Argentina/Buenos_Aires',1,'b6380000-0000-0000-0000-000000000001'
from (values('monthly','monthly'),('final','final'),('extra','extraordinary_full_payment'),('extra2','extraordinary_full_payment'),('consolation','consolation'))v(k,t);
set local role authenticated;
select pg_temp.act_as(2);
select throws_ok($$select public.draw_generate_roster(pg_temp.id('monthly'),'038-denied-generate')$$,'42501',null,'generate permission denial');
select throws_ok($$select public.draw_freeze_roster(pg_temp.id('monthly'),'038-denied-freeze')$$,'42501',null,'freeze permission denial');
reset role;
select is((select count(*)::int from public.audit_log where request_id in ('038-denied-generate','038-denied-freeze')),0,'denials have no audit');
select is((select count(*)::int from public.draw_rosters where draw_id=pg_temp.id('monthly')),0,'denials have no roster');
select is((select status from public.draws where id=pg_temp.id('monthly')),'scheduled','denials preserve draw');
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok($$select public.draw_generate_roster(null,'038-invalid')$$,'22023',null,'null draw validation');
select throws_ok($$select public.draw_freeze_roster(null,'038-invalid-freeze')$$,'22023',null,'freeze null validation');
select throws_ok($$select public.draw_generate_roster(gen_random_uuid(),'038-missing')$$,'P0002',null,'missing draw');
select throws_ok($$select public.draw_freeze_roster(gen_random_uuid(),'038-missing-freeze')$$,'P0002',null,'freeze missing draw');
select throws_ok($$select public.draw_freeze_roster(pg_temp.id('monthly'),'038-too-early')$$,'55000',null,'freeze requires generation');
select throws_ok($$select public.draw_generate_roster(pg_temp.id('consolation'),'038-consolation')$$,'55000','consolation rosters require draw results (Phase 12): not available yet','consolation fails closed without results');
insert into ids values('r-monthly',public.draw_generate_roster(pg_temp.id('monthly'),'038-monthly'));
select results_eq($$select number_value,eligible,ineligibility_reason from public.draw_roster_entries where draw_roster_id=pg_temp.id('r-monthly') and number_value<100 order by number_value$$,
$$select * from (values(10,true,null::text),(20,true,null::text),(30,false,'installments_not_covered'),(40,false,'installments_not_covered'),(50,false,'not_sold'),(60,false,'annulled'),(70,true,null::text),(71,true,null::text))v$$,'monthly exact base rows and reasons');
select is((select count(*)::int from public.draw_roster_entries where draw_roster_id=pg_temp.id('r-monthly')),16,'base plus associated, including ineligible bonds');
select is((select count(*)::int from public.draw_roster_entries where draw_roster_id=pg_temp.id('r-monthly') and bond_id=pg_temp.id('released')),0,'released numbers excluded');
select ok((select bool_and(buyer_snapshot->>'id'=pg_temp.id('buyer')::text and buyer_snapshot->>'document_number'='12345'
  and collector_snapshot->>'id'=pg_temp.id('collector')::text and collector_snapshot->>'display_name'='Roster collector')
  from public.draw_roster_entries where draw_roster_id=pg_temp.id('r-monthly') and eligible),'party identity snapshots');
insert into ids values('r-final',public.draw_generate_roster(pg_temp.id('final'),'038-final'));
select results_eq($$select number_value,eligible,ineligibility_reason from public.draw_roster_entries where draw_roster_id=pg_temp.id('r-final') and number_value<100 order by number_value$$,
$$select * from (values(10,true,null::text),(20,false,'not_fully_paid'),(30,false,'not_fully_paid'),(40,false,'not_fully_paid'),(50,false,'not_sold'),(60,false,'annulled'),(70,true,null::text),(71,true,null::text))v$$,'final exact rows and reasons');
insert into ids values('r-extra',public.draw_generate_roster(pg_temp.id('extra'),'038-extra'));
select results_eq($$select number_value,eligible,ineligibility_reason from public.draw_roster_entries where draw_roster_id=pg_temp.id('r-extra') and number_value<100 order by number_value$$,
$$select * from (values(0,true,null::text),(1,true,null::text),(2,true,null::text),(10,true,null::text),(20,false,'not_fully_paid'),(30,false,'not_fully_paid'),(40,false,'not_fully_paid'),(50,false,'not_sold'),(60,false,'annulled'),(70,true,null::text),(71,true,null::text))v$$,'extraordinary exact rows, reasons and lowest-free ordering');
select results_eq($$select n.number_value,b.number_value from public.bond_numbers n join public.bond_numbers b on b.id=n.source_base_number_id where n.campaign_id=pg_temp.id('c') and n.number_kind='extraordinary' order by n.number_value$$,
$$select * from (values(0,10),(1,70),(2,71))v$$,'simple one and pata per-base extra persisted and linked');
insert into ids values('r-extra-new',public.draw_generate_roster(pg_temp.id('extra'),'038-regenerate'));
select is((select status from public.draw_rosters where id=pg_temp.id('r-extra')),'superseded','regeneration supersedes history');
select is((select count(*)::int from public.draw_roster_entries where draw_roster_id=pg_temp.id('r-extra')),19,'original entries preserved');
select is((select count(*)::int from public.bond_numbers where campaign_id=pg_temp.id('c') and number_kind='extraordinary'),3,'no extra leak on regeneration');
select results_eq($$select bond_number_id,eligible,ineligibility_reason from public.draw_roster_entries where draw_roster_id=pg_temp.id('r-extra-new') order by bond_number_id$$,
$$select bond_number_id,eligible,ineligibility_reason from public.draw_roster_entries where draw_roster_id=pg_temp.id('r-extra') order by bond_number_id$$,'regenerated contents stable');
insert into ids values('r-extra2',public.draw_generate_roster(pg_temp.id('extra2'),'038-extra2'));
select is((select count(*)::int from public.bond_numbers where campaign_id=pg_temp.id('c') and number_kind='extraordinary'),3,'later extraordinary draws share extras');
select lives_ok($$select public.draw_freeze_roster(pg_temp.id('monthly'),'038-freeze')$$,'freeze current roster');
select is((select status from public.draws where id=pg_temp.id('monthly')),'roster_frozen','draw frozen');
select ok((select status='frozen' and frozen_at is not null and frozen_by='b6380000-0000-0000-0000-000000000001'::uuid from public.draw_rosters where id=pg_temp.id('r-monthly')),'freeze metadata');
select throws_ok($$select public.draw_generate_roster(pg_temp.id('monthly'),'038-after-freeze')$$,'55000',null,'generation after freeze refused');
create temp table freeze_before as select to_jsonb(r) as row from public.draw_rosters r where r.draw_id=pg_temp.id('monthly') and r.status='frozen';
select lives_ok($$select public.draw_freeze_roster(pg_temp.id('monthly'),'038-freeze-twice')$$,'repeated freeze is an idempotent no-op');
select is((select to_jsonb(r) from public.draw_rosters r where r.draw_id=pg_temp.id('monthly') and r.status='frozen'),(select row from freeze_before),'repeated freeze leaves the frozen roster identical');
reset role;
create temp table frozen_before as select * from public.draw_roster_entries where draw_roster_id=pg_temp.id('r-monthly');
update public.payments set status='confirmed' where id=pg_temp.id('pay3');
select results_eq($$select * from public.draw_roster_entries where draw_roster_id=pg_temp.id('r-monthly') order by id$$,$$select * from frozen_before order by id$$,'late confirmation leaves FULL frozen rows identical');
select throws_ok($$update public.draw_rosters set frozen_at=now()+interval '1 second' where id=pg_temp.id('r-monthly')$$,'55000',null,'frozen roster immutable');
select throws_ok($$update public.draw_roster_entries set eligible=true,ineligibility_reason=null where draw_roster_id=pg_temp.id('r-monthly')$$,'55000',null,'frozen entries immutable even privileged');
select throws_ok($$insert into public.draw_roster_entries(draw_roster_id,bond_id,bond_number_id,number_value,buyer_snapshot,collector_snapshot,eligible,created_by)
select pg_temp.id('r-monthly'),bond_id,id,number_value,'{}','{}',true,'b6380000-0000-0000-0000-000000000001' from public.bond_numbers where bond_id=pg_temp.id('bond1') limit 1$$,'55000',null,'no admission to frozen roster');
select is((select count(*)::int from public.audit_log where request_id in ('038-after-freeze','038-freeze-twice','038-consolation','038-invalid','038-missing','038-too-early')),0,'failed operations write no audit');
select results_eq($$select request_id,action,count(*)::int from public.audit_log where request_id in ('038-monthly','038-final','038-extra','038-regenerate','038-extra2','038-freeze') group by request_id,action order by request_id$$,
$$select * from (values('038-extra','draw.generate_roster',1),('038-extra2','draw.generate_roster',1),('038-final','draw.generate_roster',1),('038-freeze','draw.freeze_roster',1),('038-monthly','draw.generate_roster',1),('038-regenerate','draw.generate_roster',1))v$$,'one audit per successful invocation');
select is((select count(*)::int from public.draw_rosters where draw_id=pg_temp.id('monthly')),1,'failed regeneration adds no roster');
select is((select status from public.draws where id=pg_temp.id('consolation')),'scheduled','unsupported consolation unchanged');
-- Direct DML remains blocked for ALL external roles, not merely by RLS.
select ok(not has_table_privilege(r,'public.'||t,priv),r||' cannot '||priv||' '||t)
from unnest(array['anon','authenticated','service_role'])r
cross join unnest(array['draws','draw_rosters','draw_roster_entries'])t
cross join unnest(array['insert','update','delete'])priv;
select ok(not has_function_privilege(r,'public.draw_generate_roster(uuid,text)','execute')
  and not has_function_privilege(r,'public.draw_freeze_roster(uuid,text)','execute'),r||' cannot invoke roster RPCs')
from unnest(array['anon','service_role'])r;
select ok(not has_function_privilege('authenticated','public.draw_payment_before_cutoff(text,date,timestamptz)','execute'),'cutoff helper is internal');
-- Capacity failure rolls back a regeneration (including supersession and allocations).
-- Reserve the remaining values with fixture-only extraordinary rows (legacy nullable source).
insert into public.bond_numbers(campaign_id,bond_id,number_value,number_kind)
select pg_temp.id('c'),pg_temp.id('bond5'),v,'extraordinary'
from generate_series(0,9999)v where not exists (
  select 1 from public.bond_numbers where campaign_id=pg_temp.id('c') and number_value=v);
set local role authenticated;
select throws_ok($$select public.draw_generate_roster(pg_temp.id('extra'),'038-exhaustion')$$,'55000','not enough free campaign numbers','exhaustion refused atomically after newly eligible bond');
reset role;
select is((select status from public.draw_rosters where id=pg_temp.id('r-extra-new')),'generated','capacity failure preserves current roster');
select is((select count(*)::int from public.draw_rosters where draw_id=pg_temp.id('extra')),2,'capacity failure creates no roster');
select is((select count(*)::int from public.audit_log where request_id='038-exhaustion'),0,'capacity failure has no audit');
select is((select count(*)::int from public.bond_numbers where bond_id=pg_temp.id('bond3') and number_kind='extraordinary'),0,'capacity failure leaves no partial extra');
set local role authenticated;
select lives_ok($$select public.payment_annul(pg_temp.id('pay1'),'Correction after freeze','038-late-correction')$$,'audited payment correction after freeze');
reset role;
select is((select status from public.payments where id=pg_temp.id('pay1')),'annulled','payment actually corrected');
select results_eq($$select * from public.draw_roster_entries where draw_roster_id=pg_temp.id('r-monthly') order by id$$,$$select * from frozen_before order by id$$,'payment correction leaves FULL frozen rows identical');

-- Real RPCs in two independently committed sessions: draw serialization and
-- campaign-wide extraordinary allocation serialization, not structural assertions.
create extension if not exists dblink with schema extensions;
create function pg_temp.remote_exec(c text,q text) returns void language plpgsql as $$
begin perform extensions.dblink_exec(c,q); end $$;
create function pg_temp.remote_text(c text,q text) returns text language sql as $$
select t.v from extensions.dblink(c,q) as t(v text)$$;
create function pg_temp.wait_lock(p int) returns boolean language plpgsql as $$
begin
  for i in 1..200 loop
    if exists(select 1 from pg_stat_activity where pid=p and wait_event_type='Lock') then return true; end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end $$;
create function pg_temp.result(c text) returns text language plpgsql as $$
declare v text; msg text;
begin
  select t.v into v from extensions.dblink_get_result(c,false) as t(v text);
  msg := extensions.dblink_error_message(c);
  perform * from extensions.dblink_get_result(c,false) as t(v text);
  return case when msg='OK' then v else regexp_replace(split_part(msg,E'\n',1),'^ERROR:\s+','') end;
end $$;
select extensions.dblink_connect(c,format('host=%s port=%s dbname=%s user=postgres password=postgres',
  coalesce(host(inet_server_addr()),'127.0.0.1'),inet_server_port(),current_database()))
from unnest(array['roster_a','roster_b'])c;
select pg_temp.remote_exec('roster_a',$q$
  insert into auth.users(id,email) values('a6381000-0000-0000-0000-000000000001','roster-race@example.com');
  insert into public.profiles(id,auth_user_id,full_name,email,status)
  values('b6381000-0000-0000-0000-000000000001','a6381000-0000-0000-0000-000000000001','Roster race','roster-race@example.com','active');
  insert into public.user_roles(user_id,role_id) select 'b6381000-0000-0000-0000-000000000001',id from public.roles where name='admin';
  insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode)
  values('c6381000-0000-0000-0000-000000000001','Roster race',100,2,50,'base_number');
  insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,created_by)
  select ('d6381000-0000-0000-0000-00000000000'||n)::uuid,'c6381000-0000-0000-0000-000000000001',
    'extraordinary_full_payment','Race '||n,date '2026-01-01',now(),'b6381000-0000-0000-0000-000000000001'
    from generate_series(1,2)n;
$q$);
select pg_temp.remote_exec(c,$q$set request.jwt.claims='{"sub":"a6381000-0000-0000-0000-000000000001","role":"authenticated"}';set role authenticated$q$)
from unnest(array['roster_a','roster_b'])c;
create function pg_temp.rpc_races() returns setof text language plpgsql as $$
declare
  pid_b int := pg_temp.remote_text('roster_b','select pg_backend_pid()::text')::int;
  gen1 text := $q$select public.draw_generate_roster('d6381000-0000-0000-0000-000000000001','038-race-generate')::text$q$;
  freeze1 text := $q$select public.draw_freeze_roster('d6381000-0000-0000-0000-000000000001','038-race-freeze')::text$q$;
  rid text;
begin
  perform pg_temp.remote_exec('roster_a','begin');
  rid := pg_temp.remote_text('roster_a',gen1);
  perform extensions.dblink_send_query('roster_b',freeze1);
  return next ok(pg_temp.wait_lock(pid_b),'RPC race: freeze waits for generation draw lock');
  perform pg_temp.remote_exec('roster_a','commit');
  perform pg_temp.result('roster_b');
  return next is(pg_temp.remote_text('roster_a',format('select status from public.draw_rosters where id=%L',rid)),'frozen','RPC race: freeze sees committed generated roster');
  perform pg_temp.remote_exec('roster_a','begin');
  perform pg_temp.remote_text('roster_a',$q$select public.draw_generate_roster('d6381000-0000-0000-0000-000000000002','038-race-generate2')::text$q$);
  -- This request waits on the draw, then rechecks the committed frozen state.
  perform pg_temp.remote_text('roster_a',$q$select public.draw_freeze_roster('d6381000-0000-0000-0000-000000000002','038-race-freeze2')::text$q$);
  perform extensions.dblink_send_query('roster_b',$q$select public.draw_generate_roster('d6381000-0000-0000-0000-000000000002','038-race-denied')::text$q$);
  return next ok(pg_temp.wait_lock(pid_b),'RPC race: generation waits on uncommitted freeze');
  perform pg_temp.remote_exec('roster_a','commit');
  return next is(pg_temp.result('roster_b'),'draw roster cannot be generated in this state','RPC race: generation refused after freeze');
  -- Same campaign, DIFFERENT draws: advisory allocation lock is also exercised.
  -- New scheduled draws, committed independently, avoid any draw-row conflict.
  perform pg_temp.remote_exec('roster_b',$q$reset role;
    do $fixture$
    declare b uuid; s uuid; pp uuid; i uuid; pay uuid; st uuid;
    begin
      insert into public.collectors(id,display_name) values('e6381000-0000-0000-0000-000000000001','Race collector');
      insert into public.buyers(id,type,first_name) values('f6381000-0000-0000-0000-000000000001','individual','Race buyer');
      insert into public.bonds(campaign_id,kind,origin,commercial_unit_count,total_value)
      values('c6381000-0000-0000-0000-000000000001','simple','printed',1,100) returning id into b;
      insert into public.bond_numbers(campaign_id,bond_id,number_value,number_kind)
      values('c6381000-0000-0000-0000-000000000001',b,10,'base');
      update public.bonds set commercial_status='delivered_to_collector',current_collector_id='e6381000-0000-0000-0000-000000000001' where id=b;
      update public.bonds set commercial_status='sold',current_buyer_id='f6381000-0000-0000-0000-000000000001' where id=b;
      insert into public.sales(campaign_id,bond_id,buyer_id,collector_id,payment_mode,total_amount,created_by)
      values('c6381000-0000-0000-0000-000000000001',b,'f6381000-0000-0000-0000-000000000001','e6381000-0000-0000-0000-000000000001','full_payment',100,'b6381000-0000-0000-0000-000000000001') returning id into s;
      insert into public.payment_plans(sale_id,installment_count,total_amount) values(s,1,100) returning id into pp;
      insert into public.installments(payment_plan_id,installment_number,due_date,amount) values(pp,1,date '2026-01-01',100) returning id into i;
      insert into public.settlements(campaign_id,collector_id,settlement_number,created_by)
      values('c6381000-0000-0000-0000-000000000001','e6381000-0000-0000-0000-000000000001',1,'b6381000-0000-0000-0000-000000000001') returning id into st;
      insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,settlement_id,amount,payment_method,payment_date,status,created_by)
      values('c6381000-0000-0000-0000-000000000001',s,'e6381000-0000-0000-0000-000000000001','f6381000-0000-0000-0000-000000000001',st,100,'cash',date '2026-01-01','pending_in_settlement','b6381000-0000-0000-0000-000000000001') returning id into pay;
      insert into public.payment_installments values(pay,i,100);
      update public.payments set status='confirmed' where id=pay;
    end $fixture$;
    set role authenticated$q$);
  perform pg_temp.remote_exec('roster_b',$q$reset role;insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,created_by)
    select ('d6381000-0000-0000-0000-00000000000'||n)::uuid,'c6381000-0000-0000-0000-000000000001','extraordinary_full_payment','Allocation race',date '2026-01-01',now(),'b6381000-0000-0000-0000-000000000001' from generate_series(3,4)n;set role authenticated$q$);
  perform pg_temp.remote_exec('roster_a','begin');
  perform pg_temp.remote_text('roster_a',$q$select public.draw_generate_roster('d6381000-0000-0000-0000-000000000003','038-race-allocation-a')::text$q$);
  perform extensions.dblink_send_query('roster_b',$q$select public.draw_generate_roster('d6381000-0000-0000-0000-000000000004','038-race-allocation-b')::text$q$);
  return next ok(pg_temp.wait_lock(pid_b),'RPC race: different draw waits for campaign allocation lock');
  perform pg_temp.remote_exec('roster_a','commit');
  return next ok(pg_temp.result('roster_b') ~ '^[0-9a-f-]{36}$','RPC race: allocation resumes after lock release');
  return next is(pg_temp.remote_text('roster_a',$q$select count(*)::text from public.bond_numbers where campaign_id='c6381000-0000-0000-0000-000000000001' and number_kind='extraordinary'$q$),'1','RPC race: concurrent extraordinary draws persist only one shared extra');
  return next is(pg_temp.remote_text('roster_a',$q$select count(distinct e.bond_number_id)::text||'/'||count(*)::text from public.draw_roster_entries e join public.draw_rosters r on r.id=e.draw_roster_id where r.draw_id in ('d6381000-0000-0000-0000-000000000003','d6381000-0000-0000-0000-000000000004')$q$),'2/4','RPC race: both rosters contain identical base and extra reservations');
  return next is(pg_temp.remote_text('roster_a',$q$select count(*)::text from public.draw_rosters where draw_id='d6381000-0000-0000-0000-000000000002'$q$),'1','RPC race: refused regeneration creates no roster');
  return next is(pg_temp.remote_text('roster_a',$q$reset role;select count(*)::text from public.audit_log where request_id='038-race-denied'$q$),'0','RPC race: refused regeneration creates no audit');
end $$;
select * from pg_temp.rpc_races();
select pg_temp.remote_exec('roster_a',$q$
  begin;
  set local session_replication_role=replica;
  delete from public.audit_log where request_id like '038-race-%';
  delete from public.draw_roster_entries where draw_roster_id in (select r.id from public.draw_rosters r join public.draws d on d.id=r.draw_id where d.campaign_id='c6381000-0000-0000-0000-000000000001');
  delete from public.draw_rosters where draw_id in (select id from public.draws where campaign_id='c6381000-0000-0000-0000-000000000001');
  delete from public.draws where campaign_id='c6381000-0000-0000-0000-000000000001';
  delete from public.payment_installments where payment_id in (select id from public.payments where campaign_id='c6381000-0000-0000-0000-000000000001');
  delete from public.payments where campaign_id='c6381000-0000-0000-0000-000000000001';
  delete from public.settlements where campaign_id='c6381000-0000-0000-0000-000000000001';
  delete from public.installments where payment_plan_id in (select pp.id from public.payment_plans pp join public.sales s on s.id=pp.sale_id where s.campaign_id='c6381000-0000-0000-0000-000000000001');
  delete from public.payment_plans where sale_id in (select id from public.sales where campaign_id='c6381000-0000-0000-0000-000000000001');
  delete from public.sales where campaign_id='c6381000-0000-0000-0000-000000000001';
  delete from public.bond_numbers where campaign_id='c6381000-0000-0000-0000-000000000001';
  delete from public.bonds where campaign_id='c6381000-0000-0000-0000-000000000001';
  delete from public.collectors where id='e6381000-0000-0000-0000-000000000001';
  delete from public.buyers where id='f6381000-0000-0000-0000-000000000001';
  delete from public.campaigns where id='c6381000-0000-0000-0000-000000000001';
  delete from public.user_roles where user_id='b6381000-0000-0000-0000-000000000001';
  delete from public.profiles where id='b6381000-0000-0000-0000-000000000001';
  delete from auth.users where id='a6381000-0000-0000-0000-000000000001';
  commit;
$q$);
select extensions.dblink_disconnect(c) from unnest(array['roster_a','roster_b'])c;
-- Draw configuration RPCs consumed by SAN-78.
create function pg_temp.new_draw(t text,n text,required int,rule jsonb,req text) returns uuid language sql as $$
select public.draw_create(pg_temp.id('c'),t,n,
  (now() at time zone 'America/Argentina/Buenos_Aires')::date,now(),required,rule,req)$$;
create function pg_temp.edit_draw(d uuid,n text,required int,rule jsonb,req text) returns void language sql as $$
select public.draw_update(d,n,
  (now() at time zone 'America/Argentina/Buenos_Aires')::date,now(),required,rule,req)$$;
grant execute on function pg_temp.new_draw(text,text,int,jsonb,text),pg_temp.edit_draw(uuid,text,int,jsonb,text) to authenticated;
set local role authenticated;
select pg_temp.act_as(2);
select throws_ok($$select pg_temp.new_draw('monthly','Denied',1,'{}','038-denied-create')$$,'42501',null,'create denied');
select throws_ok($$select pg_temp.edit_draw(pg_temp.id('consolation'),'Denied',1,'{}','038-denied-update')$$,'42501',null,'update denied');
select throws_ok($$select public.draw_annul(pg_temp.id('consolation'),'Denied','038-denied-annul')$$,'42501',null,'annul denied');
reset role;
select is((select count(*)::int from public.audit_log where request_id in ('038-denied-create','038-denied-update','038-denied-annul')),0,'configuration denials have no audit');
select is((select count(*)::int from public.draws where campaign_id=pg_temp.id('c')),5,'denied creation writes no draw');
select ok((select status='scheduled' and name='consolation' and annulled_at is null from public.draws where id=pg_temp.id('consolation')),'denied edits and annulment preserve row');
set local role authenticated;
select pg_temp.act_as(1);
insert into ids values('created',pg_temp.new_draw('monthly','  Created  ',2,'{}','038-create'));
select ok((select name='Created' and status='scheduled' and required_installment_number=2 and created_by='b6380000-0000-0000-0000-000000000001'::uuid from public.draws where id=pg_temp.id('created')),'create trims name and sets creator');
select lives_ok($$select pg_temp.edit_draw(pg_temp.id('created'),repeat('🧯',200),1,'{"custom":true}','038-update')$$,'update accepts 200 Unicode code points');
select ok((select name=repeat('🧯',200) and required_installment_number=1 and eligibility_rule='{"custom":true}' and draw_type='monthly' from public.draws where id=pg_temp.id('created')),'update changes rules but not draw type');
select throws_ok($$select pg_temp.new_draw('bogus','Bad',1,'{}','038-bad-type')$$,'22023',null,'create rejects draw type');
select throws_ok($$select pg_temp.new_draw('monthly',' ',1,'{}','038-bad-name')$$,'22023',null,'create requires name');
select throws_ok($$select pg_temp.new_draw('monthly',repeat('🧯',201),1,'{}','038-long-name')$$,'22023',null,'create Unicode name limit');
select throws_ok($$select pg_temp.new_draw('monthly','Bad',null,'{}','038-no-installment')$$,'22023',null,'monthly requires installment');
select throws_ok($$select pg_temp.new_draw('monthly','Bad',3,'{}','038-high-installment')$$,'23514',null,'create respects campaign installment count');
select throws_ok($$select pg_temp.new_draw('final','Bad',null,'[]','038-bad-rule')$$,'22023',null,'create requires object rule');
select throws_ok($$select public.draw_create(pg_temp.id('c'),'final','Bad',null,now(),null,'{}','038-bad-date')$$,'22023',null,'create requires date');
select throws_ok($$select public.draw_create(gen_random_uuid(),'final','Missing',date '2026-01-01',now(),null,'{}','038-no-campaign')$$,'P0002',null,'create campaign not found');
select throws_ok($$select pg_temp.edit_draw(pg_temp.id('created'),'Bad',null,'{}','038-bad-update')$$,'22023',null,'update validates monthly installment');
select throws_ok($$select pg_temp.edit_draw(pg_temp.id('created'),'Bad',3,'{}','038-high-update')$$,'23514',null,'update respects campaign installment count');
select throws_ok($$select pg_temp.edit_draw(gen_random_uuid(),'Missing',1,'{}','038-no-draw')$$,'P0002',null,'update not found');
select throws_ok($$select pg_temp.edit_draw(pg_temp.id('monthly'),'Frozen',1,'{}','038-frozen-update')$$,'55000',null,'update refused after generation/freeze');
select throws_ok($$select public.draw_annul(pg_temp.id('monthly'),'Frozen','038-frozen-annul')$$,'55000',null,'annul frozen draw refused and frozen roster preserved');
select throws_ok($$select public.draw_annul(pg_temp.id('created'),' ','038-empty-annul')$$,'22023',null,'annul requires reason');
select throws_ok($$select public.draw_annul(pg_temp.id('created'),repeat('🧯',1001),'038-long-annul')$$,'22023',null,'annul reason Unicode limit');
select throws_ok($$select public.draw_annul(gen_random_uuid(),'Missing','038-no-annul')$$,'P0002',null,'annul not found');
select lives_ok($$select public.draw_annul(pg_temp.id('created'),'  Cancellation  ','038-annul')$$,'scheduled annulment');
select ok((select status='annulled' and annulled_at is not null and annulled_by='b6380000-0000-0000-0000-000000000001'::uuid and annul_reason='Cancellation' from public.draws where id=pg_temp.id('created')),'annulment separate metadata');
select throws_ok($$select public.draw_annul(pg_temp.id('created'),'Overwrite','038-second-annul')$$,'55000',null,'annulment immutable');
reset role;
select results_eq($$select action,count(*)::int from public.audit_log where request_id in ('038-create','038-update','038-annul') group by action order by action$$,
$$select * from (values('draw.annul',1),('draw.create',1),('draw.update',1))v$$,'configuration RPCs audit exactly once');
select ok((select reason='Cancellation' and old_value->>'status'='scheduled' and new_value->>'status'='annulled' from public.audit_log where request_id='038-annul'),'annul audit preserves before/after and reason');
select is((select count(*)::int from public.audit_log where request_id in ('038-bad-type','038-bad-name','038-long-name','038-no-installment','038-high-installment','038-bad-rule','038-bad-date','038-no-campaign','038-bad-update','038-high-update','038-no-draw','038-frozen-update','038-frozen-annul','038-empty-annul','038-long-annul','038-no-annul','038-second-annul')),0,'all invalid configurations roll back audit');
select is((select name from public.draws where id=pg_temp.id('created')),repeat('🧯',200),'failed updates preserve name');
select is((select status from public.draw_rosters where id=pg_temp.id('r-monthly')),'frozen','configuration actions preserve frozen roster');
insert into ids values('closing-campaign',gen_random_uuid());
insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode,starts_at,ends_at)
values(pg_temp.id('closing-campaign'),'Closing roster campaign',100,2,50,'base_number',now(),now()+interval '1 day');
update public.campaigns set status='active' where id=pg_temp.id('closing-campaign');
update public.campaigns set status='closing' where id=pg_temp.id('closing-campaign');
set local role authenticated;
select throws_ok($$select public.draw_create(pg_temp.id('closing-campaign'),'final','Closed',date '2026-01-01',now(),null,'{}','038-create-closing')$$,'55000',null,'create refused for closing campaign');
reset role;
select is((select count(*)::int from public.draws where campaign_id=pg_temp.id('closing-campaign')),0,'closing campaign refusal creates no draw');
select is((select count(*)::int from public.audit_log where request_id='038-create-closing'),0,'closing campaign refusal creates no audit');
select results_eq($$select * from public.draw_roster_entries where draw_roster_id=pg_temp.id('r-monthly') order by id$$,$$select * from frozen_before order by id$$,'configuration refusals preserve FULL frozen rows');
select ok(not has_function_privilege(r,f,'execute'),r||' cannot execute '||f)
from unnest(array['anon','service_role'])r cross join unnest(array[
  'public.draw_create(uuid,text,text,date,timestamptz,integer,jsonb,text)',
  'public.draw_update(uuid,text,date,timestamptz,integer,jsonb,text)',
  'public.draw_annul(uuid,text,text)'])f;
-- Review #79: unrelated uniqueness errors retain their original SQLSTATE/message.
do $$begin
  execute format('create unique index review_roster_unique on public.draw_rosters(draw_id) where draw_id = %L',pg_temp.id('final'));
end $$;
set local role authenticated;
select throws_ok($$select public.draw_generate_roster(pg_temp.id('final'),'038-review-unique')$$,
  '23505','duplicate key value violates unique constraint "review_roster_unique"',
  'non-allocation unique violation is not masked');
reset role;
drop index public.review_roster_unique;
select is((select status from public.draw_rosters where id=pg_temp.id('r-final')),'generated','unique failure rolls back supersession');
select is((select count(*)::int from public.draw_rosters where draw_id=pg_temp.id('final')),1,'unique failure leaves no new roster');
select is((select count(*)::int from public.audit_log where request_id='038-review-unique'),0,'unique failure leaves no audit');

set local role authenticated;
select throws_ok($$select pg_temp.new_draw('consolation','Missing',null,'{}','038-review-consolation-create')$$,
  '22023','consolation draw requires a positive required installment in required_installment_number or eligibility_rule','consolation create requires installment');
select throws_ok($$select pg_temp.edit_draw(pg_temp.id('consolation'),'Missing',null,'{}','038-review-consolation-update')$$,
  '22023','consolation draw requires a positive required installment in required_installment_number or eligibility_rule','consolation update requires installment');
select throws_ok($$select pg_temp.new_draw('consolation','Invalid',null,'{"requiredInstallmentNumber":0}','038-review-consolation-invalid')$$,
  '22023',null,'consolation rule must contain positive integer');
select ok((select name='consolation' and required_installment_number=1 and eligibility_rule='{}' and status='scheduled'
  from public.draws where id=pg_temp.id('consolation')),'invalid consolation update preserves configuration');
select lives_ok($$select pg_temp.new_draw('consolation','Column',1,'{}','038-review-consolation-column')$$,'consolation accepts column installment');
select lives_ok($$select pg_temp.new_draw('consolation','Camel',null,'{"requiredInstallmentNumber":1}','038-review-consolation-camel')$$,'consolation accepts camelCase rule');
select lives_ok($$select pg_temp.edit_draw(pg_temp.id('consolation'),'Snake',null,'{"required_installment_number":1}','038-review-consolation-snake')$$,'consolation update accepts snake_case rule');
reset role;
select is((select count(*)::int from public.audit_log where request_id in ('038-review-consolation-create','038-review-consolation-update','038-review-consolation-invalid')),0,'invalid consolation writes no audit');
select is((select count(*)::int from public.draws where campaign_id=pg_temp.id('c') and name in ('Missing','Invalid')),0,'invalid consolation creates no draw');
select is(public.draw_consolation_required(null,'{}'),null::int,'legacy missing rule resolves to missing_required_installment branch');

-- Existing generated snapshots may be frozen after campaign closure, but not regenerated.
insert into ids values('review-edit',gen_random_uuid()),('review-freeze',gen_random_uuid());
insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,created_by)
select pg_temp.id(k),pg_temp.id('closing-campaign'),'extraordinary_full_payment',k,date '2026-01-01',now(),
  'b6380000-0000-0000-0000-000000000001' from unnest(array['review-edit','review-freeze'])k;
-- Privileged fixture: a pre-closure generated empty snapshot, no invented commercial data.
insert into public.draw_rosters(draw_id,generated_by,created_by)
values(pg_temp.id('review-freeze'),'b6380000-0000-0000-0000-000000000001','b6380000-0000-0000-0000-000000000001');
update public.draws set status='roster_generated' where id=pg_temp.id('review-freeze');
set local role authenticated;
select throws_ok($$select public.draw_generate_roster(pg_temp.id('review-edit'),'038-review-closing-generate')$$,'55000','draws require a draft or active campaign','closing campaign cannot allocate extras');
select throws_ok($$select pg_temp.edit_draw(pg_temp.id('review-edit'),'Changed',null,'{}','038-review-closing-update')$$,'55000','draws require a draft or active campaign','closing campaign cannot edit');
reset role;
update public.campaigns set status='closed' where id=pg_temp.id('closing-campaign');
set local role authenticated;
select throws_ok($$select public.draw_generate_roster(pg_temp.id('review-freeze'),'038-review-closed-generate')$$,'55000','draws require a draft or active campaign','closed campaign cannot regenerate');
select throws_ok($$select pg_temp.edit_draw(pg_temp.id('review-edit'),'Changed',null,'{}','038-review-closed-update')$$,'55000','draws require a draft or active campaign','closed campaign cannot edit');
select lives_ok($$select public.draw_freeze_roster(pg_temp.id('review-freeze'),'038-review-closed-freeze')$$,'closed campaign can freeze existing snapshot');
reset role;
select is((select name from public.draws where id=pg_temp.id('review-edit')),'review-edit','campaign refusals preserve configuration');
select is((select count(*)::int from public.bond_numbers where campaign_id=pg_temp.id('closing-campaign')),0,'campaign refusals allocate no numbers');
select is((select count(*)::int from public.draw_rosters where draw_id in (pg_temp.id('review-edit'),pg_temp.id('review-freeze'))),1,'campaign refusals add no roster');
select is((select count(*)::int from public.audit_log where request_id in ('038-review-closing-generate','038-review-closing-update','038-review-closed-generate','038-review-closed-update')),0,'campaign refusals write no audit');
select is((select status from public.draws where id=pg_temp.id('review-freeze')),'roster_frozen','closed campaign freeze transitions draw');
select is((select count(*)::int from public.audit_log where request_id='038-review-closed-freeze' and action='draw.freeze_roster'),1,'closed campaign freeze audited exactly once');
select * from finish();
rollback;
