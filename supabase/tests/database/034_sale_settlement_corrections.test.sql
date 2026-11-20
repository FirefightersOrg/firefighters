begin;
set local time zone 'America/Argentina/Buenos_Aires';
select plan(103);
insert into auth.users(id,email) values
 ('a6720000-0000-0000-0000-000000000001','admin672@example.com'),
 ('a6720000-0000-0000-0000-000000000002','denied672@example.com');
insert into public.profiles(id,auth_user_id,full_name,email,status) values
 ('b6720000-0000-0000-0000-000000000001','a6720000-0000-0000-0000-000000000001','Admin','admin672@example.com','active'),
 ('b6720000-0000-0000-0000-000000000002','a6720000-0000-0000-0000-000000000002','Denied','denied672@example.com','active');
insert into public.user_roles(user_id,role_id)
 select 'b6720000-0000-0000-0000-000000000001',id from public.roles where name='admin';
select set_config('request.jwt.claims','{"sub":"a6720000-0000-0000-0000-000000000001","role":"authenticated"}',true);
create temp table ids(k text primary key,id uuid);
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$;
grant execute on function pg_temp.id(text) to authenticated;
grant select,insert on ids to authenticated;
create temp table snapshots(k text primary key,value jsonb);
with x as (insert into public.campaigns(name,simple_bond_value,installment_count,installment_value,barcode_mode,starts_at,ends_at)
 values('SAN72',100,1,100,'base_number',current_date-10,current_date+100) returning id) insert into ids select 'campaign',id from x;
update public.campaigns set status='active' where id=pg_temp.id('campaign');
with x as (insert into public.collectors(display_name) values('SAN72 wrong') returning id) insert into ids select 'wrong',id from x;
with x as (insert into public.collectors(display_name) values('SAN72 right') returning id) insert into ids select 'right',id from x;
with x as (insert into public.collectors(display_name,status) values('SAN72 inactive','inactive') returning id) insert into ids select 'inactive',id from x;
with x as (insert into public.buyers(type,first_name,document_number) values('individual','Original','111') returning id) insert into ids select 'buyer',id from x;
with x as (insert into public.buyers(type,first_name,document_number) values('individual','Correct','222') returning id) insert into ids select 'new_buyer',id from x;
insert into public.commission_rules(campaign_id,rule_type,percentage,valid_from)
 values(pg_temp.id('campaign'),'cash_full_payment',10,current_date-10);
insert into public.commission_rules(campaign_id,rule_type,percentage,valid_from,applies_to_collector_id)
 values(pg_temp.id('campaign'),'cash_full_payment',20,current_date-10,pg_temp.id('right'));
do $$
declare k text; b uuid; s uuid;
begin
 foreach k in array array['cash','transfer','open','delegate','unsold'] loop
  insert into public.bonds(campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status)
   values(pg_temp.id('campaign'),'simple','printed',1,100,'available') returning id into b;
  perform public.bond_deliver(pg_temp.id('campaign'),pg_temp.id('wrong'),array[b]);
  insert into ids values(k||'_bond',b);
  if k<>'unsold' then
   s:=public.sale_register(pg_temp.id('campaign'),b,pg_temp.id('buyer'),'full_payment');
   insert into ids values(k||'_sale',s);
   insert into ids select k||'_installment',i.id from public.installments i
    join public.payment_plans pp on pp.id=i.payment_plan_id where pp.sale_id=s;
  end if;
 end loop;
end $$;
insert into ids values('closed',public.settlement_open(pg_temp.id('campaign'),pg_temp.id('wrong')));
do $$
declare k text; p uuid;
begin
 foreach k in array array['cash','transfer'] loop
  p:=public.settlement_add_payment(pg_temp.id('closed'),pg_temp.id(k||'_sale'),100,
   case when k='cash' then 'cash' else 'transfer' end,
   jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id(k||'_installment'),'amount_applied',100)));
  insert into ids values(k||'_payment',p);
 end loop;
end $$;
select public.settlement_close(pg_temp.id('closed'));
insert into ids values('open',public.settlement_open(pg_temp.id('campaign'),pg_temp.id('wrong')));
insert into ids values('open_payment',public.settlement_add_payment(pg_temp.id('open'),pg_temp.id('open_sale'),100,'cash',
 jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('open_installment'),'amount_applied',100))));
insert into snapshots select 'closed',to_jsonb(s) from public.settlements s where id=pg_temp.id('closed');
create function pg_temp.state() returns jsonb language sql stable as $$
 select jsonb_build_object(
 'sales',(select jsonb_agg(to_jsonb(s) order by id) from public.sales s where campaign_id=pg_temp.id('campaign')),
 'bonds',(select jsonb_agg(to_jsonb(b) order by id) from public.bonds b where campaign_id=pg_temp.id('campaign')),
 'settlements',(select jsonb_agg(to_jsonb(s) order by id) from public.settlements s where campaign_id=pg_temp.id('campaign')),
 'ledger',(select jsonb_agg(to_jsonb(e) order by id) from public.collector_ledger_entries e where campaign_id=pg_temp.id('campaign')),
 'custody',(select jsonb_agg(to_jsonb(a) order by id) from public.bond_assignments a where campaign_id=pg_temp.id('campaign')))
$$;
insert into snapshots values('before',pg_temp.state());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a6720000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.sale_correct_buyer(pg_temp.id('cash_sale'),pg_temp.id('new_buyer'),'denied','72-denied-buyer')$$,'42501',null,'buyer denial');
select throws_ok($$select public.sale_correct_collector(pg_temp.id('cash_sale'),pg_temp.id('right'),'denied','72-denied-collector')$$,'42501',null,'collector denial');
select throws_ok($$select public.bond_correct_collector(pg_temp.id('unsold_bond'),pg_temp.id('right'),'denied','72-denied-bond')$$,'42501',null,'unsold denial');
select throws_ok($$select public.bond_correct_collector(pg_temp.id('delegate_bond'),pg_temp.id('right'),'denied','72-denied-sold')$$,'42501',null,'sold denial');
select throws_ok($$select public.settlement_correct(pg_temp.id('closed'),'denied','{"commission_delta":1,"cash_retained_delta":0}','72-denied-set')$$,'42501',null,'settlement denial');
reset role;
select is(pg_temp.state(),(select value from snapshots where k='before'),'all denials leave state unchanged');
select is((select count(*)::int from public.audit_log where request_id like '72-denied-%'),0,'denials leave no scoped audit');
select is((select count(*)::int from public.settlement_corrections where settlement_id=pg_temp.id('closed')),0,'denials leave no adjustment');
select set_config('request.jwt.claims','{"sub":"a6720000-0000-0000-0000-000000000001","role":"authenticated"}',true);

select throws_ok($$select public.sale_correct_buyer(pg_temp.id('cash_sale'),pg_temp.id('new_buyer'),' ')$$,'22023',null,'blank reason');
select throws_ok($$select public.sale_correct_buyer(pg_temp.id('cash_sale'),pg_temp.id('new_buyer'),repeat('😀',1001))$$,'22023',null,'Unicode maximum');
select throws_ok($$select public.sale_correct_buyer(pg_temp.id('cash_sale'),pg_temp.id('buyer'),'same')$$,'22023',null,'same buyer');
select throws_ok($$select public.sale_correct_buyer(pg_temp.id('cash_sale'),'00000000-0000-0000-0000-000000000000','missing')$$,'P0002',null,'missing buyer');
select throws_ok($$select public.sale_correct_collector(pg_temp.id('cash_sale'),pg_temp.id('inactive'),'inactive')$$,'55000',null,'inactive sale target');
select throws_ok($$select public.bond_correct_collector(pg_temp.id('unsold_bond'),pg_temp.id('inactive'),'inactive')$$,'55000',null,'inactive bond target');
select throws_ok($$select public.sale_correct_collector(pg_temp.id('cash_sale'),pg_temp.id('wrong'),'same')$$,'22023',null,'same collector');
select throws_ok($$select public.sale_correct_collector(pg_temp.id('open_sale'),pg_temp.id('right'),'open','72-open')$$,'55000','remove payments from open settlements before correcting the collector','open payments require removal');
select throws_ok($$select public.sale_correct_buyer('00000000-0000-0000-0000-000000000000',pg_temp.id('buyer'),'missing')$$,'P0002',null,'missing sale');
select throws_ok($$select public.settlement_correct(pg_temp.id('closed'),'none')$$,'22023',null,'explicit adjustment required');
select throws_ok($$select public.settlement_correct(pg_temp.id('closed'),'zero','{"commission_delta":0,"cash_retained_delta":0}')$$,'22023',null,'zero-only rejected');
select throws_ok($$select public.settlement_correct(pg_temp.id('closed'),'scale','{"commission_delta":1.001,"cash_retained_delta":0}')$$,'22023',null,'fractional cents');
select throws_ok($$select public.settlement_correct(pg_temp.id('closed'),'nan','{"commission_delta":"NaN","cash_retained_delta":0}')$$,'22023',null,'NaN rejected');
select throws_ok($$select public.settlement_correct(pg_temp.id('closed'),'large','{"commission_delta":10000000000,"cash_retained_delta":0}')$$,'22023',null,'overflow rejected');
select throws_ok($$select public.settlement_correct(pg_temp.id('closed'),'negative','{"commission_delta":-21,"cash_retained_delta":0}')$$,'22023',null,'resulting negative commission');
select throws_ok($$select public.settlement_correct(pg_temp.id('open'),'open','{"commission_delta":1,"cash_retained_delta":0}')$$,'55000',null,'open cannot correct');
select throws_ok($$update public.sales set buyer_id=pg_temp.id('new_buyer') where id=pg_temp.id('cash_sale')$$,'23001',null,'unflagged privileged sale correction rejected');
select throws_ok($$update public.bonds set current_buyer_id=pg_temp.id('new_buyer') where id=pg_temp.id('cash_bond')$$,'23001',null,'unflagged privileged sold bond correction rejected');
select throws_ok($$update public.settlements set status='corrected' where id=pg_temp.id('closed')$$,'23001',null,'unflagged privileged settlement correction rejected');
select is(pg_temp.state(),(select value from snapshots where k='before'),'validation writes nothing');
select is((select count(*)::int from public.audit_log where request_id='72-open'),0,'open refusal has no audit');

set local role authenticated;
select lives_ok($$select public.sale_correct_buyer(pg_temp.id('cash_sale'),pg_temp.id('new_buyer'),'  wrong buyer  ','72-buyer')$$,'buyer happy path');
reset role;
select is((select buyer_id from public.sales where id=pg_temp.id('cash_sale')),pg_temp.id('new_buyer'),'sale buyer changed');
select is((select current_buyer_id from public.bonds where id=pg_temp.id('cash_bond')),pg_temp.id('new_buyer'),'bond buyer changed');
select is((select buyer_id from public.payments where id=pg_temp.id('cash_payment')),pg_temp.id('buyer'),'payment buyer remains historical');
select is((select old_value->'buyer'->>'document_number' from public.audit_log where request_id='72-buyer'),'111','old buyer document snapshot');
select is((select new_value->'new_value'->'buyer'->>'document_number' from public.audit_log where request_id='72-buyer'),'222','new buyer document snapshot');
select is((select old_value->'buyer'->>'first_name' from public.audit_log where request_id='72-buyer'),'Original','old buyer name snapshot');
select is((select new_value->'new_value'->'buyer'->>'first_name' from public.audit_log where request_id='72-buyer'),'Correct','new buyer name snapshot');
set local role authenticated;
select lives_ok($$select public.sale_correct_collector(pg_temp.id('cash_sale'),pg_temp.id('right'),'cash collector','72-cash')$$,'cash collector happy path');
select lives_ok($$select public.sale_correct_collector(pg_temp.id('transfer_sale'),pg_temp.id('right'),'transfer collector','72-transfer')$$,'transfer collector happy path');
reset role;
select results_eq($$select collector_id,direction,amount from public.collector_ledger_entries where corrects_sale_id=pg_temp.id('cash_sale') order by collector_id,direction$$,
 $$select * from (values (pg_temp.id('wrong'),'collector_credit'::text,10::numeric),(pg_temp.id('wrong'),'collector_debit',10),(pg_temp.id('right'),'collector_credit',20),(pg_temp.id('right'),'collector_debit',20)) x order by 1,2$$,'cash exact four rows both collectors');
select results_eq($$select collector_id,direction,amount from public.collector_ledger_entries where corrects_sale_id=pg_temp.id('transfer_sale') order by collector_id,direction$$,
 $$select * from (values (pg_temp.id('wrong'),'collector_debit'::text,10::numeric),(pg_temp.id('right'),'collector_credit',20)) x order by 1,2$$,'transfer exact two rows');
select is(public.collector_ledger_balance(pg_temp.id('campaign'),pg_temp.id('wrong')),0::numeric,'wrong balance zero');
select is(public.collector_ledger_balance(pg_temp.id('campaign'),pg_temp.id('right')),20::numeric,'right balance transfer commission only');
select is((select to_jsonb(s) from public.settlements s where id=pg_temp.id('closed')),(select value from snapshots where k='closed'),'sale corrections preserve FULL closed settlement');
select ok((select bool_and(collector_id=pg_temp.id('wrong')) from public.payments where id in (pg_temp.id('cash_payment'),pg_temp.id('transfer_payment'))),'payment collectors remain historical');
select is((select count(*)::int from public.bond_assignments where bond_id=pg_temp.id('cash_bond')),2,'custody history retained');
select is((select collector_id from public.bond_assignments where bond_id=pg_temp.id('cash_bond') and status='active'),pg_temp.id('right'),'active custody corrected');
select throws_ok($$select public.payment_annul(pg_temp.id('cash_payment'),'later')$$,'55000',null,'later payment correction fails safely after collector move');
set local role authenticated;
select lives_ok($$select public.bond_correct_collector(pg_temp.id('unsold_bond'),pg_temp.id('right'),'unsold','72-unsold')$$,'unsold reassignment');
select lives_ok($$select public.bond_correct_collector(pg_temp.id('delegate_bond'),pg_temp.id('right'),'sold','72-delegate')$$,'sold delegates');
reset role;
select is((select collector_id from public.sales where id=pg_temp.id('delegate_sale')),pg_temp.id('right'),'delegation updates sale');
select is((select current_collector_id from public.bonds where id=pg_temp.id('unsold_bond')),pg_temp.id('right'),'unsold updates bond');
select is((select count(*)::int from public.bond_assignments where bond_id=pg_temp.id('unsold_bond')),2,'unsold retains original custody');
select is((select reason from public.delivery_notes where id=(select delivery_note_id from public.bond_assignments where bond_id=pg_temp.id('unsold_bond') and status='active')),'reassignment','unsold issues reassignment note');
set local role authenticated;
select lives_ok($$select public.settlement_correct(pg_temp.id('closed'),'  commission difference  ','{"commission_delta":5,"cash_retained_delta":-2}','72-settlement')$$,'settlement correction happy path');
reset role;
select is((select status from public.settlements where id=pg_temp.id('closed')),'corrected','closed becomes corrected');
select is((select to_jsonb(s)-array['status','updated_at'] from public.settlements s where id=pg_temp.id('closed')),
 (select value-array['status','updated_at'] from snapshots where k='closed'),'ENTIRE original except status and updated_at is unchanged');
select results_eq($$select commission_delta,cash_retained_delta,reason from public.settlement_corrections where settlement_id=pg_temp.id('closed')$$,
 $$values (5::numeric,-2::numeric,'commission difference'::text)$$,'linked immutable deltas');
select results_eq($$select direction,amount from public.collector_ledger_entries where settlement_id=pg_temp.id('closed') and entry_type='annulment' order by amount$$,
 $$values ('collector_credit'::text,2::numeric),('collector_credit',5)$$,'settlement exact compensation');
select is(public.collector_ledger_balance(pg_temp.id('campaign'),pg_temp.id('wrong')),7::numeric,'settlement balance plus seven');
select throws_ok($$select public.settlement_correct(pg_temp.id('closed'),'twice','{"commission_delta":1,"cash_retained_delta":0}','72-repeat')$$,'55000',null,'corrected terminal');
select is((select count(*)::int from public.settlement_corrections where settlement_id=pg_temp.id('closed')),1,'no duplicate adjustment');
select is((select count(*)::int from public.audit_log where request_id='72-repeat'),0,'repeat no audit');
select lives_ok($$set constraints public.settlement_corrections_check_original immediate$$,'linked adjustment invariant holds before commit');
select throws_ok($$insert into public.settlement_corrections(settlement_id,commission_delta,cash_retained_delta,reason,created_by)
 values(pg_temp.id('open'),1,0,'unpaired','b6720000-0000-0000-0000-000000000001')$$,
 '23514',null,'even privileged insertion cannot create an unpaired adjustment');
select throws_ok($$update public.settlement_corrections set reason='rewritten' where settlement_id=pg_temp.id('closed')$$,'23001',null,'adjustment immutable');
select throws_ok($$delete from public.settlement_corrections where settlement_id=pg_temp.id('closed')$$,'23001',null,'adjustment never deleted');

-- Each successful public call has exactly ONE audit and all nine fields.
select is((select count(*)::int from public.audit_log where request_id=r),1,'one audit: '||r)
 from unnest(array['72-buyer','72-cash','72-transfer','72-unsold','72-delegate','72-settlement']) r;
select ok((select bool_and(new_value ?& array['correction_type','affected_entity','related_entity','reason','user','date','previous_value','new_value','generated_compensatory_movements'])
 from public.audit_log where request_id in ('72-buyer','72-cash','72-transfer','72-unsold','72-delegate','72-settlement')),'nine audit fields');
select is((select jsonb_array_length(new_value->'generated_compensatory_movements') from public.audit_log where request_id='72-cash'),4,'cash audit actual movement IDs');
select is((select count(*)::int from public.audit_log a cross join lateral jsonb_array_elements_text(a.new_value->'generated_compensatory_movements') m
 join public.collector_ledger_entries e on e.id=m.value::uuid where a.request_id in ('72-cash','72-transfer','72-settlement')),8,'all generated audit IDs resolve');
insert into snapshots values('before_direct',pg_temp.state());
set local role authenticated;
select throws_ok($$update public.sales set buyer_id=pg_temp.id('buyer') where id=pg_temp.id('cash_sale')$$,'42501',null,'direct sale DML blocked');
select throws_ok($$update public.bonds set current_collector_id=pg_temp.id('wrong') where id=pg_temp.id('cash_bond')$$,'42501',null,'direct bond DML blocked');
select throws_ok($$update public.settlements set status='closed' where id=pg_temp.id('closed')$$,'42501',null,'direct settlement DML blocked');
select throws_ok($$insert into public.settlement_corrections(settlement_id,commission_delta,cash_retained_delta,reason,created_by) values(pg_temp.id('closed'),1,0,'forged','b6720000-0000-0000-0000-000000000001')$$,'42501',null,'direct adjustment blocked');
reset role;
select is(pg_temp.state(),(select value from snapshots where k='before_direct'),'direct DML denials leave state unchanged');
select is((select count(*)::int from public.audit_log where request_id='72-direct'),0,'direct DML has no correction audit');
select throws_ok($$select public.collector_ledger_annul_entry(
 (select id from public.collector_ledger_entries where corrects_sale_id=pg_temp.id('cash_sale') order by id limit 1),
 'do not erase compensation','72-annul-correction')$$,'55000',null,'sale compensation cannot be annulled');
select throws_ok($$select public.collector_ledger_annul_entry(
 (select id from public.collector_ledger_entries where settlement_id=pg_temp.id('closed') and entry_type='commission_generated' order by id limit 1),
 'do not erase corrected history','72-annul-closed')$$,'55000',null,'corrected settlement history cannot be annulled');
select is(pg_temp.state(),(select value from snapshots where k='before_direct'),'failed ledger annulments preserve full state');
select is((select count(*)::int from public.audit_log where request_id in ('72-annul-correction','72-annul-closed')),0,'failed ledger annulments have no audit');
-- Existing parties may become inactive; only the NEW reference must be active.
update public.collectors set status='inactive' where id=pg_temp.id('right');
select lives_ok($$select public.sale_correct_collector(pg_temp.id('delegate_sale'),pg_temp.id('wrong'),'inactive source','72-inactive-source')$$,'inactive original collector does not trap corrections');
select is((select collector_id from public.sales where id=pg_temp.id('delegate_sale')),pg_temp.id('wrong'),'active destination receives inactive source sale');
update public.sales set status='annulled' where id=pg_temp.id('delegate_sale');
select throws_ok($$select public.sale_correct_buyer(pg_temp.id('delegate_sale'),pg_temp.id('new_buyer'),'inactive sale','72-inactive-sale')$$,'55000',null,'inactive sale cannot change buyer');
select is((select count(*)::int from public.audit_log where request_id='72-inactive-sale'),0,'inactive sale refusal has no audit');
select ok(not has_table_privilege('service_role','public.settlement_corrections','insert')
 and not has_table_privilege('service_role','public.collector_ledger_entries','insert'),'service role cannot write financial tables');
select ok(not has_function_privilege('anon','public.sale_correct_buyer(uuid,uuid,text,text)','execute')
 and not has_function_privilege('service_role','public.settlement_correct(uuid,text,jsonb,text)','execute'),'RPC execution restricted');
select ok(not has_function_privilege('authenticated','public.sale_apply_correction(uuid,uuid,text,text,text)','execute'),'private helper unavailable');

-- REAL concurrency: fixtures stay uncommitted in A; B holds each ledger lock.
-- Rollback to a pre-call savepoint releases A's correction locks between cases.
-- Unlike a text/structural assertion, these prove both collector locks actually block
-- the RPC, and that settlement corrections use the same ledger serialization.
create extension if not exists dblink with schema extensions;
create function pg_temp.connect72(p_name text) returns text language sql as $$
 select extensions.dblink_connect(p_name,format('host=%s port=%s dbname=%s user=postgres password=postgres',
 coalesce(host(inet_server_addr()),'127.0.0.1'),coalesce(inet_server_port(),5432),current_database()))
$$;
select is(pg_temp.connect72('san72_a'),'OK','dblink session A');
select is(pg_temp.connect72('san72_b'),'OK','dblink session B');
insert into ids select 'race_'||k,gen_random_uuid() from unnest(
 array['user','profile','campaign','old','new','buyer','bond','sale','settlement']) k;
select extensions.dblink_exec('san72_a','begin');
select extensions.dblink_exec('san72_a',format($sql$
 insert into auth.users(id,email) values(%1$L,%1$L||'@race72.example.com');
 insert into public.profiles(id,auth_user_id,full_name,email,status)
 values(%2$L,%1$L,'Race72',%1$L||'@race72.example.com','active');
 insert into public.user_roles(user_id,role_id) select %2$L,id from public.roles where name='admin';
 insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode)
 values(%3$L,'Race72',100,1,100,'base_number');
 insert into public.collectors(id,display_name) values(%4$L,'Race old'),(%5$L,'Race new');
 insert into public.buyers(id,type,first_name) values(%6$L,'individual','Race buyer');
 insert into public.bonds(id,campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status)
 values(%7$L,%3$L,'simple','printed',1,100,'available');
 update public.bonds set commercial_status='delivered_to_collector',current_collector_id=%4$L where id=%7$L;
 update public.bonds set commercial_status='sold',current_buyer_id=%6$L where id=%7$L;
 insert into public.sales(id,campaign_id,bond_id,buyer_id,collector_id,payment_mode,total_amount,created_by)
 values(%8$L,%3$L,%7$L,%6$L,%4$L,'full_payment',100,%2$L);
 insert into public.settlements(id,campaign_id,settlement_number,collector_id,created_by)
 values(%9$L,%3$L,1,%4$L,%2$L);
 update public.settlements set status='closed',closed_at=now(),closed_by=%2$L where id=%9$L;
 $sql$,pg_temp.id('race_user'),pg_temp.id('race_profile'),pg_temp.id('race_campaign'),
 pg_temp.id('race_old'),pg_temp.id('race_new'),pg_temp.id('race_buyer'),pg_temp.id('race_bond'),
 pg_temp.id('race_sale'),pg_temp.id('race_settlement')));
select * from extensions.dblink('san72_a',format(
 'select set_config(''request.jwt.claims'',%L,true)',
 jsonb_build_object('sub',pg_temp.id('race_user'),'role','authenticated')::text)) as t(v text);
select extensions.dblink_exec('san72_a','savepoint correction');
create function pg_temp.wait72(p_pid int) returns boolean language plpgsql as $$
begin
 for i in 1..200 loop
  if exists(select 1 from pg_stat_activity where pid=p_pid and wait_event_type='Lock'
    and wait_event='advisory') then return true; end if;
  perform pg_sleep(0.01);
 end loop;
 return false;
end $$;
create function pg_temp.races72() returns setof text language plpgsql as $$
declare
 v_pid int; v_result text; v_error text; k text; v_query text; v_collector uuid;
begin
 select pid into v_pid from extensions.dblink('san72_a','select pg_backend_pid()') as t(pid int);
 foreach k in array array['old','new','settlement'] loop
  v_collector:=pg_temp.id(case when k='new' then 'race_new' else 'race_old' end);
  perform extensions.dblink_exec('san72_b','begin');
  perform * from extensions.dblink('san72_b',format(
   'select pg_advisory_xact_lock(hashtextextended(%L,68))',
   pg_temp.id('race_campaign')::text||v_collector::text)) as t(v text);
  v_query:=case when k='settlement' then format(
   'select public.settlement_correct(%L,''race adjustment'',''{"commission_delta":1,"cash_retained_delta":0}'',''72-race'')::text',
   pg_temp.id('race_settlement')) else format(
   'select public.sale_correct_collector(%L,%L,''race collector'',''72-race'')::text',
   pg_temp.id('race_sale'),pg_temp.id('race_new')) end;
  perform extensions.dblink_send_query('san72_a',v_query);
  return next ok(pg_temp.wait72(v_pid),'actual RPC waits on '||k||' ledger lock');
  perform extensions.dblink_exec('san72_b','commit');
  select v into v_result from extensions.dblink_get_result('san72_a',false) as t(v text);
  v_error:=extensions.dblink_error_message('san72_a');
  perform * from extensions.dblink_get_result('san72_a',false) as t(v text);
  return next is(v_error,'OK','actual RPC completes after '||k||' lock release');
  perform extensions.dblink_exec('san72_a','rollback to savepoint correction');
 end loop;
end $$;
select * from pg_temp.races72();
select is(extensions.dblink_exec('san72_a','rollback'),'ROLLBACK','all race fixtures and audit rolled back');
select is(extensions.dblink_exec('san72_b','rollback'),'ROLLBACK','second session clean');
select extensions.dblink_disconnect('san72_a');
select extensions.dblink_disconnect('san72_b');
select * from finish();
rollback;
