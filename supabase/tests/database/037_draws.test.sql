begin;
set local time zone 'America/Argentina/Buenos_Aires';
select plan(190);
insert into auth.users(id,email)
select ('a6370000-0000-0000-0000-00000000000'||n)::uuid,'draw-'||n||'@example.com' from generate_series(1,6)n;
insert into public.profiles(id,auth_user_id,full_name,email,status)
select ('b6370000-0000-0000-0000-00000000000'||n)::uuid,
('a6370000-0000-0000-0000-00000000000'||n)::uuid,'Draw '||n,'draw-'||n||'@example.com','active' from generate_series(1,6)n;
insert into public.user_roles(user_id,role_id)
select ('b6370000-0000-0000-0000-00000000000'||n)::uuid,r.id
from (values (1,'admin'),(2,'operator'),(3,'treasurer'),(4,'read-only'),(5,'collector'))v(n,name)
join public.roles r on r.name=v.name;
create function pg_temp.act_as(n int) returns void language sql as $$
select set_config('request.jwt.claims',format('{"sub":"a6370000-0000-0000-0000-00000000000%s","role":"authenticated"}',n),true)$$;
create temp table ids(k text primary key,id uuid not null);
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$;
grant execute on function pg_temp.id(text),pg_temp.act_as(int) to authenticated,anon,service_role;
grant select on ids to authenticated,anon,service_role;
insert into ids select k,gen_random_uuid() from unnest(array['c','c2','c3','b','b2','n','n2','d','r','r2','e'])k;
insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode)
select pg_temp.id(k),'Draw '||k,100,2,50,'base_number' from unnest(array['c','c2','c3'])k;
insert into public.bonds(id,campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status)
values(pg_temp.id('b'),pg_temp.id('c'),'simple','printed',1,100,'available'),
(pg_temp.id('b2'),pg_temp.id('c2'),'simple','printed',1,100,'available');
insert into public.bond_numbers(id,campaign_id,bond_id,number_value,number_kind)
values(pg_temp.id('n'),pg_temp.id('c'),pg_temp.id('b'),1,'base'),
(pg_temp.id('n2'),pg_temp.id('c2'),pg_temp.id('b2'),2,'base');
insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,required_installment_number,created_by)
values(pg_temp.id('d'),pg_temp.id('c'),'monthly','Monthly',(now() at time zone 'America/Argentina/Buenos_Aires')::date,now(),2,'b6370000-0000-0000-0000-000000000001');
insert into public.draw_rosters(id,draw_id,generated_by,created_by)
select pg_temp.id(k),pg_temp.id('d'),'b6370000-0000-0000-0000-000000000001','b6370000-0000-0000-0000-000000000001' from unnest(array['r','r2'])k;
insert into public.draw_roster_entries(id,draw_roster_id,bond_id,bond_number_id,number_value,buyer_snapshot,collector_snapshot,eligible,created_by)
values(pg_temp.id('e'),pg_temp.id('r'),pg_temp.id('b'),pg_temp.id('n'),1,'{}','{}',true,'b6370000-0000-0000-0000-000000000001');

select fk_ok('public','draws','campaign_id','public','campaigns','id');
select fk_ok('public','draw_rosters','draw_id','public','draws','id');
select fk_ok('public','draw_roster_entries','draw_roster_id','public','draw_rosters','id');
select fk_ok('public','draw_roster_entries','bond_id','public','bonds','id');
select fk_ok('public','draw_roster_entries','bond_number_id','public','bond_numbers','id');
select col_is_unique('public','draw_roster_entries',array['draw_roster_id','bond_number_id']);
select col_is_unique('public','draw_roster_entries',array['draw_roster_id','number_value']);
select has_index('public','draw_roster_entries','draw_roster_entries_draw_roster_id_number_value_key',array['draw_roster_id','number_value']);
select has_index('public',t,i,'FK index '||i) from (values
('draws','draws_campaign_idx'),('draws','draws_created_by_idx'),('draws','draws_annulled_by_idx'),
('draw_rosters','draw_rosters_draw_idx'),('draw_rosters','draw_rosters_generated_by_idx'),
('draw_rosters','draw_rosters_frozen_by_idx'),('draw_rosters','draw_rosters_created_by_idx'),
('draw_roster_entries','draw_roster_entries_bond_idx'),('draw_roster_entries','draw_roster_entries_number_idx'),
('draw_roster_entries','draw_roster_entries_created_by_idx'))v(t,i);

-- Every invalid value is tested as a real write, not by grepping the guard.
select throws_ok(format('update public.draws set %s where id=pg_temp.id(''d'')',assignment),'23514',null,label)
from (values
('draw_type=''bogus''','draw type'),('status=''bogus''','draw status'),
('name=''''','blank name'),('name='' x''','untrimmed name'),('name=repeat(''x'',201)','long name'),
('required_installment_number=null','monthly installment required'),('required_installment_number=0','positive installment'),
('required_installment_number=3','campaign installment bound'),
('eligibility_rule=''[]''','object eligibility'),('annul_reason=''unexpected''','no spurious annulment'),
('status=''annulled''','annulment needs metadata'),
('status=''annulled'',annulled_at=now(),annulled_by=''b6370000-0000-0000-0000-000000000001'',annul_reason='' ''','annul reason nonblank'),
('status=''annulled'',annulled_at=now(),annulled_by=''b6370000-0000-0000-0000-000000000001'',annul_reason=repeat(''x'',1001)','annul reason length'),
('status=''annulled'',annulled_at=now(),annulled_by=''b6370000-0000-0000-0000-000000000001'',annul_reason='' x''','annul reason trimmed'),
('status=''completed''','no skipping states')
)v(assignment,label);
select lives_ok($$update public.draws set name=repeat('🧯',200) where id=pg_temp.id('d')$$,'200 code point boundary');
select throws_ok($$insert into public.draws(campaign_id,draw_type,name,draw_date,payment_cutoff_at,created_by,status)
values(pg_temp.id('c'),'final','Final',date '2026-01-01',now(),'b6370000-0000-0000-0000-000000000001','closed')$$,'23514',null,'draw starts scheduled');
select lives_ok(format($$insert into public.draws(campaign_id,draw_type,name,draw_date,payment_cutoff_at,created_by)
values(pg_temp.id('c'),%L,%L,date '2026-01-01',now(),'b6370000-0000-0000-0000-000000000001')$$,t,t),'nonmonthly nullable installment '||t)
from unnest(array['extraordinary_full_payment','final','consolation'])t;
select throws_ok($$update public.draws set campaign_id=pg_temp.id('c2') where id=pg_temp.id('d')$$,'23001',null,'draw campaign immutable');
select throws_ok($$update public.campaigns set installment_count=1,installment_value=100 where id=pg_temp.id('c')$$,'23514',null,'campaign cannot invalidate existing draw');
select lives_ok($$update public.campaigns set installment_count=1,installment_value=100 where id=pg_temp.id('c3')$$,'campaign without draw can reduce count');
select throws_ok($$update public.draw_rosters set draw_id=gen_random_uuid() where id=pg_temp.id('r')$$,'23001',null,'roster ancestry immutable');
select throws_ok($$update public.draw_rosters set status='bad' where id=pg_temp.id('r')$$,'23514',null,'roster status');
select throws_ok($$update public.draw_rosters set frozen_at=now() where id=pg_temp.id('r')$$,'23514',null,'generated has no freeze metadata');
select throws_ok($$update public.draw_rosters set status='frozen' where id=pg_temp.id('r')$$,'23514',null,'frozen requires actor and time');
select throws_ok($$insert into public.draw_rosters(draw_id,status,generated_by,created_by)
values(pg_temp.id('d'),'superseded','b6370000-0000-0000-0000-000000000001','b6370000-0000-0000-0000-000000000001')$$,'23514',null,'roster starts generated');

select throws_ok(format('update public.draw_roster_entries set %s where id=pg_temp.id(''e'')',assignment),'23514',null,label)
from (values
('buyer_snapshot=''[]''','buyer object'),('collector_snapshot=''null''','collector object'),
('eligible=false','ineligible requires reason'),('ineligibility_reason=''bad''','eligible forbids reason'),
('eligible=false,ineligibility_reason=''''','nonblank reason'),
('eligible=false,ineligibility_reason='' x''','trimmed reason'),
('eligible=false,ineligibility_reason=repeat(''x'',1001)','reason length'),
('number_value=-1','nonnegative number'),('number_value=2','number value matches source'),
('bond_id=pg_temp.id(''b2'')','bond mismatch'),
('bond_id=pg_temp.id(''b2''),bond_number_id=pg_temp.id(''n2''),number_value=2','cross campaign mismatch')
)v(assignment,label);
select lives_ok($$update public.draw_roster_entries set eligible=false,ineligibility_reason=repeat('🧯',1000) where id=pg_temp.id('e')$$,'reason boundary');
select lives_ok($$update public.draw_roster_entries set eligible=true,ineligibility_reason=null where id=pg_temp.id('e')$$,'enable clears reason');
select throws_ok($$update public.draw_roster_entries set draw_roster_id=pg_temp.id('r2') where id=pg_temp.id('e')$$,'23001',null,'entry cannot move');
select throws_ok($$insert into public.draw_roster_entries(draw_roster_id,bond_id,bond_number_id,number_value,buyer_snapshot,collector_snapshot,eligible,created_by)
values(pg_temp.id('r2'),pg_temp.id('b2'),pg_temp.id('n2'),2,'{}','{}',true,'b6370000-0000-0000-0000-000000000001')$$,'23514',null,'insert cross campaign');
select throws_ok($$insert into public.draw_roster_entries(draw_roster_id,bond_id,bond_number_id,number_value,buyer_snapshot,collector_snapshot,eligible,created_by)
values(pg_temp.id('r'),pg_temp.id('b'),pg_temp.id('n'),1,'{}','{}',true,'b6370000-0000-0000-0000-000000000001')$$,'23505',null,'duplicate entry');

-- Exact seed-role RLS, including roleless authenticated.
create function pg_temp.rls_tests() returns setof text language plpgsql as $$
declare n integer; t text; expected integer;
begin
  for n in 1..6 loop
    perform pg_temp.act_as(n);
    expected := case when n <= 3 then 1 else 0 end;
    foreach t in array array['draws','draw_rosters','draw_roster_entries'] loop
      return next is((case t
        when 'draws' then (select count(*)::int from public.draws where id=pg_temp.id('d'))
        when 'draw_rosters' then (select count(*)::int from public.draw_rosters where id=pg_temp.id('r'))
        else (select count(*)::int from public.draw_roster_entries where id=pg_temp.id('e')) end),
        expected,'RLS '||t||' role '||n);
    end loop;
  end loop;
end $$;
grant execute on function pg_temp.rls_tests() to authenticated;
set local role authenticated;
select * from pg_temp.rls_tests();
select set_config('request.jwt.claims','{"sub":"a6370000-0000-0000-0000-000000000005","role":"authenticated"}',true);
select set_config('request.headers','{"x-request-id":"san75-denied"}',true);
select throws_ok($$update public.draws set name='Denied' where id=pg_temp.id('d')$$,'42501',null,'collector DML denied');
reset role;
select is((select name from public.draws where id=pg_temp.id('d')),repeat('🧯',200),'denial leaves row unchanged');
select is((select count(*)::int from public.audit_log where request_id='san75-denied'),0,'denial writes no audit');

select ok(not has_table_privilege(r,'public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE'),'no DML '||r||' '||t)
from unnest(array['anon','authenticated','service_role'])r cross join unnest(array['draws','draw_rosters','draw_roster_entries'])t;
select ok(not has_table_privilege('anon','public.'||t,'SELECT') and not has_table_privilege('service_role','public.'||t,'SELECT'),'no anon/service SELECT '||t)
from unnest(array['draws','draw_rosters','draw_roster_entries'])t;
select ok(has_function_privilege('authenticated','public.draw_can_read()','execute'),'explicit RLS helper execute');
select ok(not has_function_privilege('authenticated','public.'||f||'()','execute'),'internal no execute '||f)
from unnest(array['draws_forbid_delete','draws_guard_write','draw_rosters_guard_write','draw_roster_entries_guard_write','campaigns_guard_draw_installments'])f;
select is((select count(*)::int from pg_policies where schemaname='public' and tablename in ('draws','draw_rosters','draw_roster_entries') and cmd <> 'SELECT'),0,'no write policies');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.draws'::regclass,'public.draw_rosters'::regclass,'public.draw_roster_entries'::regclass)),'RLS enabled');

-- Exercise the revoked privileges, not only their catalog representation. Every
-- denial verifies both the exact SQLSTATE and the unchanged row/no audit effect.
create function pg_temp.dml_denials() returns setof text language plpgsql as $$
declare r text; t text; k text; before_row jsonb; after_row jsonb; req text;
begin
  foreach r in array array['anon','authenticated','service_role'] loop
    foreach t in array array['draws','draw_rosters','draw_roster_entries'] loop
      k := case t when 'draws' then 'd' when 'draw_rosters' then 'r' else 'e' end;
      req := 'san75-denial-'||r||'-'||t;
      execute format('select to_jsonb(x) from public.%I x where id=$1',t) into before_row using pg_temp.id(k);
      perform set_config('request.headers',json_build_object('x-request-id',req)::text,true);
      execute format('set local role %I',r);
      return next throws_ok(format('insert into public.%I default values',t),'42501',null,r||' insert denied '||t);
      return next throws_ok(format('update public.%I set id=id where id=pg_temp.id(%L)',t,k),'42501',null,r||' update denied '||t);
      return next throws_ok(format('delete from public.%I where id=pg_temp.id(%L)',t,k),'42501',null,r||' delete denied '||t);
      return next throws_ok(format('truncate public.%I',t),'42501',null,r||' truncate denied '||t);
      reset role;
      execute format('select to_jsonb(x) from public.%I x where id=$1',t) into after_row using pg_temp.id(k);
      return next is(after_row,before_row,r||' denials preserve '||t);
      return next is((select count(*)::int from public.audit_log where request_id=req),0,r||' denials have no audit '||t);
    end loop;
  end loop;
end $$;
select * from pg_temp.dml_denials();

select lives_ok($$update public.draw_rosters set status='frozen',frozen_at=now(),frozen_by='b6370000-0000-0000-0000-000000000001' where id=pg_temp.id('r')$$,'freeze generated');
select throws_ok($$update public.draw_rosters set status='frozen',frozen_at=now(),frozen_by='b6370000-0000-0000-0000-000000000001' where id=pg_temp.id('r2')$$,'23505',null,'only one frozen roster');
select throws_ok($$update public.draw_rosters set status='superseded',frozen_at=null,frozen_by=null where id=pg_temp.id('r')$$,'55000',null,'frozen never superseded');
select throws_ok($$update public.draw_rosters set generated_at=now() where id=pg_temp.id('r')$$,'55000',null,'frozen immutable even no-op');
select throws_ok($$update public.draw_roster_entries set buyer_snapshot='{"changed":true}' where id=pg_temp.id('e')$$,'55000',null,'frozen entries immutable');
select throws_ok($$insert into public.draw_roster_entries(draw_roster_id,bond_id,bond_number_id,number_value,buyer_snapshot,collector_snapshot,eligible,created_by)
values(pg_temp.id('r'),pg_temp.id('b'),pg_temp.id('n'),1,'{}','{}',true,'b6370000-0000-0000-0000-000000000001')$$,'55000',null,'no insert into frozen');
select lives_ok($$update public.draw_rosters set status='superseded' where id=pg_temp.id('r2')$$,'regeneration preserves superseded');
select throws_ok($$update public.draw_rosters set status='generated' where id=pg_temp.id('r2')$$,'55000',null,'superseded terminal');
select lives_ok($$update public.draws set status='roster_generated' where id=pg_temp.id('d')$$,'scheduled -> generated');
select throws_ok($$update public.draws set name='Changed' where id=pg_temp.id('d')$$,'55000',null,'generated rules frozen');
select lives_ok($$update public.draws set status='roster_frozen' where id=pg_temp.id('d')$$,'generated -> frozen');
select lives_ok($$update public.draws set status='completed' where id=pg_temp.id('d')$$,'frozen -> completed');
select lives_ok($$update public.draws set status='closed' where id=pg_temp.id('d')$$,'completed -> closed');
select throws_ok($$update public.draws set name='Changed' where id=pg_temp.id('d')$$,'55000',null,'closed immutable');
select lives_ok($$update public.draws set status='annulled',annulled_at=now(),annulled_by='b6370000-0000-0000-0000-000000000001',annul_reason='Mistake'
where campaign_id=pg_temp.id('c') and draw_type='final'$$,'scheduled -> annulled');
select throws_ok($$update public.draws set annul_reason='Overwrite' where campaign_id=pg_temp.id('c') and draw_type='final'$$,'55000',null,'annul reason immutable');
select throws_ok(format('delete from public.%I where id=pg_temp.id(%L)',t,k),'23001',null,'never delete '||t)
from (values ('draws','d'),('draw_rosters','r'),('draw_roster_entries','e'))v(t,k);
select throws_ok('truncate public.draw_roster_entries,public.draw_rosters,public.draws,public.prizes,public.winning_numbers,public.prize_awards','23001',null,'never truncate');
-- Real two-session races. Setup is committed and explicitly removed below.
create extension if not exists dblink with schema extensions;
select extensions.dblink_connect(c,format('host=%s port=%s dbname=%s user=postgres password=postgres',
  coalesce(host(inet_server_addr()),'127.0.0.1'),coalesce(inet_server_port(),5432),current_database()))
from unnest(array['draw_a','draw_b'])c;
create function pg_temp.remote_exec(c text,q text) returns void language plpgsql as $$
begin perform extensions.dblink_exec(c,q); end $$;
create function pg_temp.remote_text(c text,q text) returns text language sql as $$
select v from extensions.dblink(c,q) as t(v text) $$;
create function pg_temp.wait_lock(pid integer) returns boolean language plpgsql as $$
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
select pg_temp.remote_exec('draw_a',$q$
  insert into auth.users(id,email) values('a6371000-0000-0000-0000-000000000001','draw-race@example.com');
  insert into public.profiles(id,auth_user_id,full_name,email,status)
  values('b6371000-0000-0000-0000-000000000001','a6371000-0000-0000-0000-000000000001','Draw race','draw-race@example.com','active');
  insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode)
  values('c6371000-0000-0000-0000-000000000001','Draw race',100,2,50,'base_number'),
    ('c6371000-0000-0000-0000-000000000002','Draw count race',100,2,50,'base_number');
  insert into public.bonds(id,campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status)
  values('d6371000-0000-0000-0000-000000000001','c6371000-0000-0000-0000-000000000001','simple','printed',1,100,'available');
  insert into public.bond_numbers(id,campaign_id,bond_id,number_value,number_kind)
  values('e6371000-0000-0000-0000-000000000001','c6371000-0000-0000-0000-000000000001','d6371000-0000-0000-0000-000000000001',1,'base');
  insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,created_by)
  select ('f6371000-0000-0000-0000-00000000000'||n)::uuid,'c6371000-0000-0000-0000-000000000001','final','Race '||n,date '2026-01-01',now(),'b6371000-0000-0000-0000-000000000001' from generate_series(1,2)n;
  insert into public.draw_rosters(id,draw_id,generated_by,created_by)
  select ('f6372000-0000-0000-0000-00000000000'||n)::uuid,('f6371000-0000-0000-0000-00000000000'||n)::uuid,'b6371000-0000-0000-0000-000000000001','b6371000-0000-0000-0000-000000000001' from generate_series(1,2)n;
$q$);
create function pg_temp.draw_races() returns setof text language plpgsql as $$
declare
  a integer := pg_temp.remote_text('draw_a','select pg_backend_pid()::text')::int;
  b integer := pg_temp.remote_text('draw_b','select pg_backend_pid()::text')::int;
  admission text := $q$insert into public.draw_roster_entries(draw_roster_id,bond_id,bond_number_id,number_value,buyer_snapshot,collector_snapshot,eligible,created_by)
    values(%L,'d6371000-0000-0000-0000-000000000001','e6371000-0000-0000-0000-000000000001',1,'{}','{}',true,'b6371000-0000-0000-0000-000000000001')$q$;
  v_freeze text := $q$update public.draw_rosters set status='frozen',frozen_at=now(),frozen_by='b6371000-0000-0000-0000-000000000001' where id=%L$q$;
  monthly text := $q$insert into public.draws(campaign_id,draw_type,name,draw_date,payment_cutoff_at,required_installment_number,created_by)
    values('c6371000-0000-0000-0000-000000000002','monthly','Count race',date '2026-01-01',now(),2,'b6371000-0000-0000-0000-000000000001')$q$;
  shrink text := $q$update public.campaigns set installment_count=1,installment_value=100 where id='c6371000-0000-0000-0000-000000000002'$q$;
begin
  perform pg_temp.remote_exec('draw_a','begin');
  perform pg_temp.remote_exec('draw_a',format(v_freeze,'f6372000-0000-0000-0000-000000000001'));
  perform extensions.dblink_send_query('draw_b',format(admission,'f6372000-0000-0000-0000-000000000001'));
  return next ok(pg_temp.wait_lock(b),'race: insert waits for freeze');
  perform pg_temp.remote_exec('draw_a','commit');
  return next is(pg_temp.result('draw_b'),'entries require a generated roster','race: insert rejected after freeze commits');
  return next is(pg_temp.remote_text('draw_a',$q$select count(*)::text from public.draw_roster_entries where draw_roster_id='f6372000-0000-0000-0000-000000000001'$q$),'0','race: no late entry');
  perform pg_temp.remote_exec('draw_b','begin');
  perform pg_temp.remote_exec('draw_b',format(admission,'f6372000-0000-0000-0000-000000000002'));
  perform extensions.dblink_send_query('draw_a',format(v_freeze,'f6372000-0000-0000-0000-000000000002'));
  return next ok(pg_temp.wait_lock(a),'race: freeze waits for admission');
  perform pg_temp.remote_exec('draw_b','commit');
  return next is(pg_temp.result('draw_a'),'ok','race: freeze succeeds after admission');
  return next is(pg_temp.remote_text('draw_b',$q$select r.status||'/'||count(e.id)::text from public.draw_rosters r left join public.draw_roster_entries e on e.draw_roster_id=r.id where r.id='f6372000-0000-0000-0000-000000000002' group by r.status$q$),'frozen/1','race: committed entry frozen');
  perform pg_temp.remote_exec('draw_a','begin');
  perform pg_temp.remote_exec('draw_a',shrink);
  perform extensions.dblink_send_query('draw_b',monthly);
  return next ok(pg_temp.wait_lock(b),'race: monthly admission waits for count reduction');
  perform pg_temp.remote_exec('draw_a','commit');
  return next is(pg_temp.result('draw_b'),'required installment exceeds campaign count','race: monthly admission revalidates committed count');
  return next is(pg_temp.remote_text('draw_a',$q$select count(*)::text from public.draws where campaign_id='c6371000-0000-0000-0000-000000000002' and draw_type='monthly'$q$),'0','race: no invalid monthly draw');
  perform pg_temp.remote_exec('draw_a',$q$update public.campaigns set installment_count=2,installment_value=50 where id='c6371000-0000-0000-0000-000000000002'$q$);
  perform pg_temp.remote_exec('draw_b','begin');
  perform pg_temp.remote_exec('draw_b',monthly);
  perform extensions.dblink_send_query('draw_a',shrink);
  return next ok(pg_temp.wait_lock(a),'race: count reduction waits for monthly admission');
  perform pg_temp.remote_exec('draw_b','commit');
  return next is(pg_temp.result('draw_a'),'campaign count cannot invalidate a draw installment','race: count reduction revalidates admitted draw');
  return next is(pg_temp.remote_text('draw_b',$q$select installment_count::text from public.campaigns where id='c6371000-0000-0000-0000-000000000002'$q$),'2','race: admitted draw keeps valid count');
end $$;
select * from pg_temp.draw_races();
select pg_temp.remote_exec('draw_a',$q$
  begin;
  -- Privileged, fixture-only cleanup; avoid ALTER TABLE's AccessExclusive locks
  -- against the still-open local test transaction. Only our exact ids are removed.
  set local session_replication_role = replica;
  delete from public.draw_roster_entries where draw_roster_id in ('f6372000-0000-0000-0000-000000000001','f6372000-0000-0000-0000-000000000002');
  delete from public.draw_rosters where draw_id in ('f6371000-0000-0000-0000-000000000001','f6371000-0000-0000-0000-000000000002');
  delete from public.draws where campaign_id in ('c6371000-0000-0000-0000-000000000001','c6371000-0000-0000-0000-000000000002');
  delete from public.bond_numbers where campaign_id='c6371000-0000-0000-0000-000000000001';
  delete from public.bonds where campaign_id='c6371000-0000-0000-0000-000000000001';
  delete from public.campaigns where id in ('c6371000-0000-0000-0000-000000000001','c6371000-0000-0000-0000-000000000002');
  delete from public.profiles where id='b6371000-0000-0000-0000-000000000001';
  delete from auth.users where id='a6371000-0000-0000-0000-000000000001';
  commit;
$q$);
select is(pg_temp.remote_text('draw_a',$q$select count(*)::text from public.campaigns where id in ('c6371000-0000-0000-0000-000000000001','c6371000-0000-0000-0000-000000000002')$q$),'0','race fixtures removed');
select extensions.dblink_disconnect(c) from unnest(array['draw_a','draw_b'])c;
select * from finish();
rollback;
