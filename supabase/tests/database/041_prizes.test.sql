begin;
set local time zone 'America/Argentina/Buenos_Aires';
select plan(299);
insert into auth.users(id,email)
select ('a6410000-0000-0000-0000-00000000000'||n)::uuid,'prizes-'||n||'@example.com' from generate_series(1,6)n;
insert into public.profiles(id,auth_user_id,full_name,email,status)
select ('b6410000-0000-0000-0000-00000000000'||n)::uuid,
('a6410000-0000-0000-0000-00000000000'||n)::uuid,'Prizes '||n,'prizes-'||n||'@example.com','active' from generate_series(1,6)n;
insert into public.user_roles(user_id,role_id)
select ('b6410000-0000-0000-0000-00000000000'||n)::uuid,r.id
from (values (1,'admin'),(2,'operator'),(3,'treasurer'),(4,'read-only'),(5,'collector'))v(n,name)
join public.roles r on r.name=v.name;
create temp table ids(k text primary key,id uuid not null);
insert into ids select k,gen_random_uuid() from unnest(array[
  'c','c2','d','d2','d3','r','r2','r3','b','b2','n','n2','e','e2','e3',
  'buyer','buyer2','collector','collector2','w','w2','w3','a',
  'p','p2','p3','p4','p5','p6','p7','p8','p9','p10'
])k;
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$;
create function pg_temp.actor() returns uuid language sql immutable as $$select 'b6410000-0000-0000-0000-000000000001'::uuid$$;
create function pg_temp.act_as(n int) returns void language sql as $$
select set_config('request.jwt.claims',format('{"sub":"a6410000-0000-0000-0000-00000000000%s","role":"authenticated"}',n),true)$$;
grant execute on function pg_temp.id(text),pg_temp.actor(),pg_temp.act_as(int) to authenticated,anon,service_role;
grant select on ids to authenticated,anon,service_role;
insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode,max_number,associated_number_offset)
select pg_temp.id(k),'Prizes '||k,100,2,50,'base_number',999,100 from unnest(array['c','c2'])k;
insert into public.buyers(id,type,first_name)
select pg_temp.id(k),'individual',k from unnest(array['buyer','buyer2'])k;
insert into public.collectors(id,display_name)
select pg_temp.id(k),k from unnest(array['collector','collector2'])k;
insert into public.bonds(id,campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status)
select pg_temp.id(k),pg_temp.id('c'),'simple','printed',1,100,'available' from unnest(array['b','b2'])k;
insert into public.bond_numbers(id,campaign_id,bond_id,number_value,number_kind)
values(pg_temp.id('n'),pg_temp.id('c'),pg_temp.id('b'),1,'base'),
  (pg_temp.id('n2'),pg_temp.id('c'),pg_temp.id('b2'),2,'base');
insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,created_by)
select pg_temp.id(k),pg_temp.id(case when k='d2' then 'c2' else 'c' end),'final',k,
  (now() at time zone 'America/Argentina/Buenos_Aires')::date,now(),pg_temp.actor() from unnest(array['d','d2','d3'])k;
insert into public.draw_rosters(id,draw_id,generated_by,created_by)
select pg_temp.id(r),pg_temp.id(d),pg_temp.actor(),pg_temp.actor() from (values('r','d'),('r2','d2'),('r3','d3'))v(r,d);
insert into public.draw_roster_entries(id,draw_roster_id,bond_id,bond_number_id,number_value,
  buyer_snapshot,collector_snapshot,eligible,ineligibility_reason,created_by)
select pg_temp.id(e),pg_temp.id(r),pg_temp.id(b),pg_temp.id(n),num,
  jsonb_build_object('id',pg_temp.id('buyer'),'first_name','Frozen buyer'),
  jsonb_build_object('id',pg_temp.id('collector'),'display_name','Frozen collector'),
  eligible,case when eligible then null else 'not_fully_paid' end,pg_temp.actor()
from (values('e','r','b','n',1,true),('e2','r','b2','n2',2,false),
  ('e3','r3','b','n',1,true))v(e,r,b,n,num,eligible);
update public.draws set status='roster_generated' where id in (pg_temp.id('d'),pg_temp.id('d2'));
update public.draw_rosters set status='frozen',frozen_at=now(),frozen_by=pg_temp.actor() where id in (pg_temp.id('r'),pg_temp.id('r2'));
update public.draws set status='roster_frozen' where id in (pg_temp.id('d'),pg_temp.id('d2'));
insert into public.prizes(id,draw_id,name,position,created_by)
select pg_temp.id('p'||case when n=1 then '' else n::text end),pg_temp.id('d'),'Prize '||n,n,pg_temp.actor()
from generate_series(1,10)n;

-- Templates make each constraint test a real INSERT with independent identity.
create temp table templates(t text primary key, row_data jsonb);
insert into templates values
('prizes',jsonb_build_object('draw_id',pg_temp.id('d'),'name','Prize','position',100,
  'status','pending_validation','excludes_from_consolation',true,
  'created_at',now(),'updated_at',now(),'created_by',pg_temp.actor())),
('winning_numbers',jsonb_build_object('draw_id',pg_temp.id('d'),'prize_id',pg_temp.id('p'),
  'number_value',1,'matched_roster_entry_id',pg_temp.id('e'),'result_status','pending_review',
  'loaded_by',pg_temp.actor(),'loaded_at',now(),'created_at',now(),'updated_at',now(),'created_by',pg_temp.actor())),
('prize_awards',jsonb_build_object('prize_id',pg_temp.id('p'),'winning_number_id',pg_temp.id('w'),
  'bond_id',pg_temp.id('b'),'buyer_id',pg_temp.id('buyer'),'collector_id',pg_temp.id('collector'),
  'status','awarded','awarded_at',now(),'created_at',now(),'updated_at',now(),'created_by',pg_temp.actor()));
create function pg_temp.ins(t text, patch jsonb default '{}') returns void language plpgsql as $$
declare v jsonb;
begin
  select row_data || jsonb_build_object('id',gen_random_uuid()) || patch into v from templates where templates.t=$1;
  execute format('insert into public.%I select (jsonb_populate_record(null::public.%I,$1)).*',t,t) using v;
end $$;

-- Every FK must have an index with its FK column(s) as a leading prefix.
select ok(exists(
  select 1 from pg_index i where i.indrelid=c.conrelid and i.indisvalid
    and (i.indkey::smallint[])[0:cardinality(c.conkey)-1] = c.conkey
    and i.indpred is null
), 'FK indexed: '||c.conname)
from pg_constraint c where c.contype='f'
  and c.conrelid in ('public.prizes'::regclass,'public.winning_numbers'::regclass,'public.prize_awards'::regclass);
select throws_ok(format('select pg_temp.ins(''prizes'',%L)',jsonb_build_object(col,val)),
  '23514',null,'prize CHECK: '||col||'='||val)
from (values ('name',''),('name',' x'),('name',repeat('x',201)),
  ('description',''),('description','x '),('description',repeat('x',1001)),
  ('status','bogus'),('status','delivered'),('annul_reason','unexpected'))v(col,val);
select throws_ok($$select pg_temp.ins('prizes','{"position":0}')$$,'23514',null,'positive position');
select throws_ok($$select pg_temp.ins('prizes','{"position":1}')$$,'23505',null,'unique position per draw');
select lives_ok($$select pg_temp.ins('prizes',jsonb_build_object('name',repeat('🧯',200),'description',repeat('🧯',1000)))$$,'text code-point boundaries');
select lives_ok($$select pg_temp.ins('prizes',jsonb_build_object('draw_id',pg_temp.id('d2'),'position',1))$$,'position reused across draws');
select throws_ok($$select pg_temp.ins('prizes',jsonb_build_object('draw_id',gen_random_uuid()))$$,'23503',null,'prize FK');
select throws_ok($$select pg_temp.ins('prizes',jsonb_build_object('annulled_at',now()))$$,'23514',null,'nonannulled prize forbids annulment time');
select throws_ok($$select pg_temp.ins('prizes',jsonb_build_object('annulled_by',pg_temp.actor()))$$,'23514',null,'nonannulled prize forbids annulment actor');

select throws_ok(format('select pg_temp.ins(''winning_numbers'',%L)',patch),'23514',null,label)
from (values
  ('{"number_value":-1}'::jsonb,'nonnegative value'),
  ('{"number_value":1000,"matched_roster_entry_id":null,"result_status":"no_match"}','campaign maximum'),
  ('{"result_status":"bogus"}','result enum'),
  ('{"result_status":"no_match"}','no_match requires null'),
  ('{"matched_roster_entry_id":null}','null requires no_match'),
  ('{"result_status":"not_eligible"}','eligible cannot become not eligible'),
  (jsonb_build_object('number_value',2,'matched_roster_entry_id',pg_temp.id('e2'),'result_status','eligible_winner'),'ineligible cannot win'),
  (jsonb_build_object('matched_roster_entry_id',pg_temp.id('e3')),'entry of another nonfrozen draw'),
  (jsonb_build_object('draw_id',pg_temp.id('d2')),'prize from another campaign/draw'),
  ('{"number_value":3}','entry must match value')
)v(patch,label);
select throws_ok(format('select pg_temp.ins(''winning_numbers'',%L)',jsonb_build_object('notes',v)),
  '23514',null,'winning notes validity') from unnest(array['',' x',repeat('x',1001)])v;
select throws_ok($$select pg_temp.ins('winning_numbers',jsonb_build_object('draw_id',pg_temp.id('d3')))$$,
  '55000',null,'nonfrozen draw refuses loading');
update public.draws set status='roster_generated' where id=pg_temp.id('d3');
update public.draws set status='roster_frozen' where id=pg_temp.id('d3');
select throws_ok($$select pg_temp.ins('winning_numbers',jsonb_build_object('draw_id',pg_temp.id('d3'),'prize_id',null))$$,
  '55000',null,'draw status alone is not a frozen roster');
update public.draw_rosters set status='frozen',frozen_at=now(),frozen_by=pg_temp.actor() where id=pg_temp.id('r3');
select throws_ok($$select pg_temp.ins('winning_numbers',jsonb_build_object('matched_roster_entry_id',pg_temp.id('e3')))$$,
  '23514',null,'entry from a different frozen draw rejected');
select lives_ok($$select pg_temp.ins('winning_numbers',jsonb_build_object('id',pg_temp.id('w'),'notes',repeat('🧯',1000)))$$,'load pending review at notes boundary');
select throws_ok($$select pg_temp.ins('winning_numbers')$$,'23505',null,'one result per prize');
select throws_ok($$update public.winning_numbers set number_value=2 where id=pg_temp.id('w')$$,'23001',null,'loaded identity immutable during review');
select throws_ok($$update public.winning_numbers set result_status='not_eligible' where id=pg_temp.id('w')$$,'23514',null,'review cannot override frozen eligibility');
select lives_ok($$update public.winning_numbers set result_status='eligible_winner' where id=pg_temp.id('w')$$,'review resolves to eligible');
select throws_ok($$update public.winning_numbers set notes='changed' where id=pg_temp.id('w')$$,'55000',null,'resolved winner immutable');
select lives_ok($$select pg_temp.ins('winning_numbers',jsonb_build_object('id',pg_temp.id('w2'),
  'prize_id',pg_temp.id('p2'),'number_value',2,'matched_roster_entry_id',pg_temp.id('e2'),'result_status','pending_review'))$$,'ineligible entry can await review');
select lives_ok($$update public.winning_numbers set result_status='not_eligible' where id=pg_temp.id('w2')$$,'review resolves to ineligible');
select lives_ok($$select pg_temp.ins('winning_numbers',jsonb_build_object('id',pg_temp.id('w3'),
  'prize_id',pg_temp.id('p3'),'number_value',999,'matched_roster_entry_id',null,'result_status','no_match'))$$,'no match at campaign max');
select throws_ok($$update public.campaigns set max_number=998 where id=pg_temp.id('c')$$,'23514',null,'campaign cannot lower below historical winner');
select throws_ok($$select pg_temp.ins('winning_numbers',jsonb_build_object('prize_id',pg_temp.id('p4'),
  'number_value',1,'matched_roster_entry_id',null,'result_status','no_match'))$$,'23514',null,'cannot hide existing match as no_match');
select lives_ok($$select pg_temp.ins('winning_numbers',jsonb_build_object('prize_id',pg_temp.id('p4'),'result_status','eligible_winner'))$$,'same number may win different prizes');
select lives_ok($$select pg_temp.ins('winning_numbers',jsonb_build_object('prize_id',pg_temp.id('p5'),
  'number_value',0,'matched_roster_entry_id',null,'result_status','no_match'))$$,'zero boundary');
select lives_ok($$select pg_temp.ins('winning_numbers',jsonb_build_object('prize_id',pg_temp.id('p6')))$$,'pending review for award denial');
select throws_ok($$select pg_temp.ins('prize_awards',jsonb_build_object('prize_id',pg_temp.id('p6'),
  'winning_number_id',(select id from public.winning_numbers where prize_id=pg_temp.id('p6'))))$$,
  '23514',null,'pending review cannot award');

select throws_ok(format('select pg_temp.ins(''prize_awards'',%L)',patch),'23514',null,label)
from (values
  ('{"status":"bogus"}'::jsonb,'award enum'),
  ('{"status":"delivered"}','award starts awarded'),
  (jsonb_build_object('prize_id',pg_temp.id('p2')),'award prize must match winner'),
  (jsonb_build_object('prize_id',pg_temp.id('p2'),'winning_number_id',pg_temp.id('w2')),'ineligible result cannot award'),
  (jsonb_build_object('prize_id',pg_temp.id('p3'),'winning_number_id',pg_temp.id('w3')),'no match cannot award'),
  (jsonb_build_object('bond_id',pg_temp.id('b2')),'bond must match physical roster owner'),
  (jsonb_build_object('buyer_id',pg_temp.id('buyer2')),'buyer must match snapshot'),
  (jsonb_build_object('collector_id',pg_temp.id('collector2')),'collector must match snapshot'),
  ('{"annul_reason":"unexpected"}','no spurious annulment'),
  (jsonb_build_object('annulled_at',now()),'no spurious award annulment time'),
  (jsonb_build_object('annulled_by',pg_temp.actor()),'no spurious award annulment actor'),
  (jsonb_build_object('delivered_at',now()),'no spurious delivery timestamp'),
  (jsonb_build_object('delivered_by',pg_temp.actor()),'no spurious delivery actor')
)v(patch,label);
select throws_ok(format('select pg_temp.ins(''prize_awards'',%L)',jsonb_build_object('notes',v)),
  '23514',null,'award notes validity') from unnest(array['',' x',repeat('x',1001)])v;
select lives_ok($$select pg_temp.ins('prize_awards',jsonb_build_object('id',pg_temp.id('a'),'notes',repeat('🧯',1000)))$$,'award happy path');
select throws_ok($$select pg_temp.ins('prize_awards')$$,'23505',null,'one active award per prize');
select throws_ok($$update public.prize_awards set bond_id=pg_temp.id('b2') where id=pg_temp.id('a')$$,'23001',null,'award identity immutable');
select throws_ok(format('update public.prize_awards set %s where id=pg_temp.id(''a'')',assignment),
  '23514',null,label)
from (values
  ('status=''delivered''','delivery needs time and actor'),
  ('status=''delivered'',delivered_at=now()','delivery needs actor'),
  ('status=''delivered'',delivered_by=pg_temp.actor()','delivery needs time'),
  ('status=''delivered'',delivered_at=now(),delivered_by=pg_temp.actor(),notes=null','delivery observations required'),
  ('status=''annulled''','annulment needs metadata'),
  ('status=''annulled'',annulled_by=pg_temp.actor(),annul_reason=''Reason''','award annulment needs time'),
  ('status=''annulled'',annulled_at=now(),annul_reason=''Reason''','award annulment needs actor'),
  ('status=''annulled'',annulled_at=now(),annulled_by=pg_temp.actor()','award annulment needs reason'),
  ('status=''annulled'',annulled_at=now(),annulled_by=pg_temp.actor(),annul_reason=''''','nonblank award annulment'),
  ('status=''annulled'',annulled_at=now(),annulled_by=pg_temp.actor(),annul_reason='' x''','trimmed award annulment'),
  ('status=''annulled'',annulled_at=now(),annulled_by=pg_temp.actor(),annul_reason=repeat(''x'',1001)','award annulment length')
)v(assignment,label);
select lives_ok($$update public.prize_awards set status='annulled',annulled_at=now(),
  annulled_by=pg_temp.actor(),annul_reason=repeat('🧯',1000) where id=pg_temp.id('a')$$,'annul at reason boundary');
select throws_ok($$update public.prize_awards set annul_reason='overwrite' where id=pg_temp.id('a')$$,'55000',null,'original annulment immutable');
select lives_ok($$select pg_temp.ins('prize_awards')$$,'replacement award preserves annulled history');
select lives_ok($$update public.prize_awards set status='delivered',delivered_at=now(),delivered_by=pg_temp.actor(),notes='Received'
  where prize_id=pg_temp.id('p') and status='awarded'$$,'delivery happy path');
select throws_ok($$update public.prize_awards set status='awarded' where prize_id=pg_temp.id('p') and status='delivered'$$,'55000',null,'delivered award terminal');

-- Exact state graph: every directed edge is tried on an independent fixture.
create function pg_temp.prize_transitions() returns setof text language plpgsql as $$
declare f text; t text; v uuid; expected boolean; q text;
begin
  foreach f in array array['pending_validation','awarded','pending_delivery','delivered','unawarded','annulled'] loop
    foreach t in array array['pending_validation','awarded','pending_delivery','delivered','unawarded','annulled'] loop
      v := gen_random_uuid();
      insert into public.prizes(id,draw_id,name,position,created_by)
      values(v,pg_temp.id('d'),'Transition',1000+(select count(*) from public.prizes where draw_id=pg_temp.id('d')),pg_temp.actor());
      if f in ('awarded','pending_delivery','delivered','annulled') then update public.prizes set status='awarded' where id=v; end if;
      if f in ('pending_delivery','delivered') then update public.prizes set status='pending_delivery' where id=v; end if;
      if f='delivered' then update public.prizes set status='delivered' where id=v; end if;
      if f='unawarded' then update public.prizes set status='unawarded' where id=v; end if;
      if f='annulled' then update public.prizes set status='annulled',annulled_at=now(),annulled_by=pg_temp.actor(),annul_reason='Fixture' where id=v; end if;
      q := format('update public.prizes set status=%L%s where id=%L',t,
        case when t='annulled' then ',annulled_at=now(),annulled_by=pg_temp.actor(),annul_reason=''Reason''' else '' end,v);
      expected := (f='pending_validation' and t in ('awarded','unawarded','pending_validation'))
        or (f='awarded' and t in ('awarded','pending_delivery','annulled'))
        or (f='pending_delivery' and t in ('pending_delivery','delivered'));
      if expected then return next lives_ok(q,'prize transition '||f||' -> '||t);
      else return next throws_ok(q,case when f in ('delivered','unawarded','annulled') then '55000' else '23514' end,null,'prize transition '||f||' -> '||t); end if;
    end loop;
  end loop;
end $$;
select * from pg_temp.prize_transitions();
select throws_ok($$update public.prizes set draw_id=pg_temp.id('d2') where id=pg_temp.id('p')$$,'23001',null,'prize ancestry immutable');
select lives_ok($$update public.prizes set status='awarded' where id=pg_temp.id('p')$$,'award prize');
select throws_ok($$update public.prizes set excludes_from_consolation=false where id=pg_temp.id('p')$$,'55000',null,'exclusion frozen once resolved');
select throws_ok(format('update public.prizes set status=''annulled'',%s where id=pg_temp.id(''p'')',assignment),
  '23514',null,'prize annulment CHECK: '||label)
from (values
  ('annul_reason=''Reason''','time and actor required'),
  ('annulled_at=now(),annul_reason=''Reason''','actor required'),
  ('annulled_by=pg_temp.actor(),annul_reason=''Reason''','time required'),
  ('annulled_at=now(),annulled_by=pg_temp.actor()','reason required'),
  ('annulled_at=now(),annulled_by=pg_temp.actor(),annul_reason=''''','nonblank'),
  ('annulled_at=now(),annulled_by=pg_temp.actor(),annul_reason='' x''','trimmed'),
  ('annulled_at=now(),annulled_by=pg_temp.actor(),annul_reason=repeat(''x'',1001)','length')
)v(assignment,label);
select lives_ok($$update public.prizes set status='annulled',annulled_at=now(),
  annulled_by=pg_temp.actor(),annul_reason=repeat('🧯',1000) where id=pg_temp.id('p')$$,'prize annulment boundary');

-- Owner cannot delete/truncate history, either.
select throws_ok(format('delete from public.%I where id=%L',t,pg_temp.id(k)),'23001',null,'delete forbidden: '||t)
from (values('prizes','p'),('winning_numbers','w'),('prize_awards','a'))v(t,k);
select throws_ok(format('truncate public.%I cascade',t),'23001',null,'truncate forbidden: '||t)
from unnest(array['prizes','winning_numbers','prize_awards'])t;
select ok(not has_table_privilege(r,t,p),r||' has no '||p||' on '||t)
from unnest(array['anon','authenticated','service_role'])r
cross join unnest(array['prizes','winning_numbers','prize_awards'])t
cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE'])p;
select ok(not has_function_privilege(r,f,'EXECUTE'),r||' cannot execute internal helper '||f)
from unnest(array['anon','authenticated','service_role'])r
cross join unnest(array['public.prizes_guard_write()','public.winning_numbers_guard_write()',
  'public.prize_awards_guard_write()','public.campaigns_guard_winning_numbers()'])f;
select ok(has_function_privilege('authenticated','public.prize_can_read()','EXECUTE'),'RLS helper explicit grant');
select ok(not has_function_privilege(r,'public.prize_can_read()','EXECUTE'),r||' no RLS helper execute')
from unnest(array['anon','service_role'])r;
select is((select count(*) from pg_policies where schemaname='public'
  and tablename in ('prizes','winning_numbers','prize_awards') and cmd<>'SELECT'),0::bigint,'no write RLS policies');

-- Test-only owner readers let denied roles prove state/audit are unchanged
-- without granting those roles protected table access.
create function pg_temp.fixture_row(t text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
  execute format('select to_jsonb(r) from public.%I r where id=$1',t) into v
    using pg_temp.id(case t when 'prizes' then 'p' when 'winning_numbers' then 'w' else 'a' end);
  return v;
end $$;
create function pg_temp.fixture_audits() returns bigint language sql security definer set search_path='' as $$
select count(*) from public.audit_log where actor_user_id in
  (select ('b6410000-0000-0000-0000-00000000000'||n)::uuid from generate_series(1,6)n)
$$;
grant execute on function pg_temp.fixture_row(text),pg_temp.fixture_audits() to authenticated,anon,service_role;
create function pg_temp.rls_tests() returns setof text language plpgsql as $$
<<rls>>
declare n int; t text; q text;
begin
  for n in 1..6 loop
    perform pg_temp.act_as(n);
    foreach t in array array['prizes','winning_numbers','prize_awards'] loop
      q := format('select count(*)::int from public.%I where id=%L',t,
        pg_temp.id(case t when 'prizes' then 'p' when 'winning_numbers' then 'w' else 'a' end));
      return next results_eq(q,format('values (%s)',case when n<=3 then 1 else 0 end),'seed role RLS '||n||'/'||t);
      return next throws_ok(format('update public.%I set updated_at=now() where id=%L',t,
        pg_temp.id(case t when 'prizes' then 'p' when 'winning_numbers' then 'w' else 'a' end)),
        '42501',null,'role denied DML '||n||'/'||t);
      return next is(pg_temp.fixture_row(t),(select row_data from before_denials where before_denials.t=rls.t),
        'denial leaves state unchanged '||n||'/'||t);
      return next is(pg_temp.fixture_audits(),0::bigint,'denial writes no fixture audit '||n||'/'||t);
    end loop;
  end loop;
end $$;
grant execute on function pg_temp.rls_tests() to authenticated;
create temp table before_denials as
select 'prizes'::text t,to_jsonb(p) row_data from public.prizes p where id=pg_temp.id('p')
union all select 'winning_numbers',to_jsonb(w) from public.winning_numbers w where id=pg_temp.id('w')
union all select 'prize_awards',to_jsonb(a) from public.prize_awards a where id=pg_temp.id('a');
grant select on before_denials to authenticated,anon,service_role;
set local role authenticated;
select * from pg_temp.rls_tests();
reset role;
select results_eq($$select to_jsonb(p) from public.prizes p where id=pg_temp.id('p')$$,
  $$select row_data from before_denials where t='prizes'$$,'denials leave prize unchanged');
select results_eq($$select to_jsonb(w) from public.winning_numbers w where id=pg_temp.id('w')$$,
  $$select row_data from before_denials where t='winning_numbers'$$,'denials leave winner unchanged');
select results_eq($$select to_jsonb(a) from public.prize_awards a where id=pg_temp.id('a')$$,
  $$select row_data from before_denials where t='prize_awards'$$,'denials leave award unchanged');
set local role anon;
select throws_ok($$update public.prizes set name='Forbidden' where id=pg_temp.id('p')$$,'42501',null,'anon direct write denied');
select is(pg_temp.fixture_row('prizes'),(select row_data from before_denials where t='prizes'),'anon denial leaves state unchanged');
select is(pg_temp.fixture_audits(),0::bigint,'anon denial writes no fixture audit');
reset role;
set local role service_role;
select throws_ok($$update public.prizes set name='Forbidden' where id=pg_temp.id('p')$$,'42501',null,'service role direct write denied');
select is(pg_temp.fixture_row('prizes'),(select row_data from before_denials where t='prizes'),'service role denial leaves state unchanged');
select is(pg_temp.fixture_audits(),0::bigint,'service role denial writes no fixture audit');
reset role;
select is((select count(*) from public.audit_log where actor_user_id in
  (select ('b6410000-0000-0000-0000-00000000000'||n)::uuid from generate_series(1,6)n)),0::bigint,'denied DML writes no audit for fixture actors');
-- Real two-session admission/closure and campaign-bound races.
create extension if not exists dblink with schema extensions;
select extensions.dblink_connect(c,format('host=%s port=%s dbname=%s user=postgres password=postgres',
  coalesce(host(inet_server_addr()),'127.0.0.1'),inet_server_port(),current_database()))
from unnest(array['prize_a','prize_b'])c;
create function pg_temp.remote_exec(c text,q text) returns void language plpgsql as $$
begin perform extensions.dblink_exec(c,q); end $$;
create function pg_temp.remote_text(c text,q text) returns text language sql as $$
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
select pg_temp.remote_exec('prize_a',$q$
  insert into auth.users(id,email) values('a6411000-0000-0000-0000-000000000001','prize-race@example.com');
  insert into public.profiles(id,auth_user_id,full_name,email,status)
  values('b6411000-0000-0000-0000-000000000001','a6411000-0000-0000-0000-000000000001','Prize race','prize-race@example.com','active');
  insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode,max_number,associated_number_offset)
  values('c6411000-0000-0000-0000-000000000001','Prize race',100,2,50,'base_number',999,100);
  insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,created_by)
  select ('d6411000-0000-0000-0000-00000000000'||n)::uuid,'c6411000-0000-0000-0000-000000000001',
    'final','Race '||n,(now() at time zone 'America/Argentina/Buenos_Aires')::date,now(),'b6411000-0000-0000-0000-000000000001'
    from generate_series(1,4)n;
  insert into public.draw_rosters(draw_id,generated_by,created_by)
  select id,'b6411000-0000-0000-0000-000000000001','b6411000-0000-0000-0000-000000000001'
  from public.draws where campaign_id='c6411000-0000-0000-0000-000000000001';
  update public.draws set status='roster_generated' where campaign_id='c6411000-0000-0000-0000-000000000001';
  update public.draw_rosters set status='frozen',frozen_at=now(),frozen_by='b6411000-0000-0000-0000-000000000001'
  where draw_id in (select id from public.draws where campaign_id='c6411000-0000-0000-0000-000000000001');
  update public.draws set status='roster_frozen' where campaign_id='c6411000-0000-0000-0000-000000000001';
  update public.draws set status='completed' where campaign_id='c6411000-0000-0000-0000-000000000001';
  insert into public.prizes(id,draw_id,name,position,created_by)
  select ('e6411000-0000-0000-0000-00000000000'||n)::uuid,
    ('d6411000-0000-0000-0000-00000000000'||n)::uuid,'Race',1,'b6411000-0000-0000-0000-000000000001'
    from generate_series(1,4)n;
$q$);
create function pg_temp.races() returns setof text language plpgsql as $$
declare
  a int := pg_temp.remote_text('prize_a','select pg_backend_pid()::text')::int;
  b int := pg_temp.remote_text('prize_b','select pg_backend_pid()::text')::int;
  admission text := $q$insert into public.winning_numbers(draw_id,prize_id,number_value,result_status,loaded_by,created_by)
    values(%L,%L,999,'no_match','b6411000-0000-0000-0000-000000000001','b6411000-0000-0000-0000-000000000001')$q$;
  close_draw text := $q$update public.draws set status='closed' where id=%L$q$;
  shrink text := $q$update public.campaigns set max_number=998 where id='c6411000-0000-0000-0000-000000000001'$q$;
begin
  perform pg_temp.remote_exec('prize_a','begin');
  perform pg_temp.remote_exec('prize_a',shrink);
  perform extensions.dblink_send_query('prize_b',format(admission,'d6411000-0000-0000-0000-000000000003','e6411000-0000-0000-0000-000000000003'));
  return next ok(pg_temp.wait_lock(b),'winner admission waits for maximum reduction');
  perform pg_temp.remote_exec('prize_a','commit');
  return next is(pg_temp.result('prize_b'),'winning number exceeds campaign maximum','admission rechecks committed maximum');
  return next is(pg_temp.remote_text('prize_a',$q$select count(*)::text from public.winning_numbers where draw_id='d6411000-0000-0000-0000-000000000003'$q$),'0','bound rejection leaves no winning number');
  perform pg_temp.remote_exec('prize_a',$q$update public.campaigns set max_number=999 where id='c6411000-0000-0000-0000-000000000001'$q$);
  perform pg_temp.remote_exec('prize_a','begin');
  perform pg_temp.remote_exec('prize_a',format(close_draw,'d6411000-0000-0000-0000-000000000001'));
  perform extensions.dblink_send_query('prize_b',format(admission,'d6411000-0000-0000-0000-000000000001','e6411000-0000-0000-0000-000000000001'));
  return next ok(pg_temp.wait_lock(b),'winner admission waits for draw closure');
  perform pg_temp.remote_exec('prize_a','commit');
  return next is(pg_temp.result('prize_b'),'winning numbers require a frozen draw','winner rechecks committed closure');
  return next is(pg_temp.remote_text('prize_a',$q$select count(*)::text from public.winning_numbers where draw_id='d6411000-0000-0000-0000-000000000001'$q$),'0','closed draw has no late winner');
  perform pg_temp.remote_exec('prize_b','begin');
  perform pg_temp.remote_exec('prize_b',format(admission,'d6411000-0000-0000-0000-000000000002','e6411000-0000-0000-0000-000000000002'));
  perform extensions.dblink_send_query('prize_a',format(close_draw,'d6411000-0000-0000-0000-000000000002'));
  return next ok(pg_temp.wait_lock(a),'closure waits for admitted winner');
  perform pg_temp.remote_exec('prize_b','commit');
  return next is(pg_temp.result('prize_a'),'ok','closure proceeds after winner commits');
  return next is(pg_temp.remote_text('prize_b',$q$select count(*)::text from public.winning_numbers where draw_id='d6411000-0000-0000-0000-000000000002'$q$),'1','winner preserved after closure');
  -- The previously admitted 999 also prevents reductions. Use rollback so both
  -- sides can exercise waiting without changing historical rows.
  perform pg_temp.remote_exec('prize_a','begin');
  perform pg_temp.remote_exec('prize_a',$q$update public.campaigns set name='Locked race' where id='c6411000-0000-0000-0000-000000000001'$q$);
  perform extensions.dblink_send_query('prize_b',format(admission,'d6411000-0000-0000-0000-000000000003','e6411000-0000-0000-0000-000000000003'));
  return next ok(pg_temp.wait_lock(b),'winner admission waits for campaign non-key write');
  perform pg_temp.remote_exec('prize_a','rollback');
  return next is(pg_temp.result('prize_b'),'ok','winner admission proceeds on stable campaign bound');
  perform pg_temp.remote_exec('prize_b','begin');
  perform pg_temp.remote_exec('prize_b',format(admission,'d6411000-0000-0000-0000-000000000004','e6411000-0000-0000-0000-000000000004'));
  perform extensions.dblink_send_query('prize_a',shrink);
  return next ok(pg_temp.wait_lock(a),'maximum reduction waits for admission');
  perform pg_temp.remote_exec('prize_b','commit');
  return next is(pg_temp.result('prize_a'),'campaign maximum cannot invalidate winning numbers','maximum reduction refuses historical results');
end $$;
select * from pg_temp.races();
select pg_temp.remote_exec('prize_a',$q$
  begin;
  set local session_replication_role=replica;
  delete from public.winning_numbers where draw_id in (select id from public.draws where campaign_id='c6411000-0000-0000-0000-000000000001');
  delete from public.prizes where draw_id in (select id from public.draws where campaign_id='c6411000-0000-0000-0000-000000000001');
  delete from public.draw_rosters where draw_id in (select id from public.draws where campaign_id='c6411000-0000-0000-0000-000000000001');
  delete from public.draws where campaign_id='c6411000-0000-0000-0000-000000000001';
  delete from public.campaigns where id='c6411000-0000-0000-0000-000000000001';
  delete from public.profiles where id='b6411000-0000-0000-0000-000000000001';
  delete from auth.users where id='a6411000-0000-0000-0000-000000000001';
  commit;
$q$);
select is(pg_temp.remote_text('prize_a',$q$select count(*)::text from public.campaigns where id='c6411000-0000-0000-0000-000000000001'$q$),'0','race fixtures removed');
select extensions.dblink_disconnect(c) from unnest(array['prize_a','prize_b'])c;
select * from finish();
rollback;
