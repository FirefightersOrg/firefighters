begin;
set local time zone 'America/Argentina/Buenos_Aires';
select plan(35);
insert into auth.users(id,email) values
 ('a1100000-0000-0000-0000-000000000001','admin110@example.com'),
 ('a1100000-0000-0000-0000-000000000002','denied110@example.com');
insert into public.profiles(id,auth_user_id,full_name,email,status) values
 ('b1100000-0000-0000-0000-000000000001','a1100000-0000-0000-0000-000000000001','Admin','admin110@example.com','active'),
 ('b1100000-0000-0000-0000-000000000002','a1100000-0000-0000-0000-000000000002','Denied','denied110@example.com','active');
insert into public.user_roles(user_id,role_id)
 select 'b1100000-0000-0000-0000-000000000001',id from public.roles where name='admin';
select set_config('request.jwt.claims','{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}',true);
create temp table ids(k text primary key,id uuid);
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$;
grant execute on function pg_temp.id(text) to authenticated;
grant select,insert on ids to authenticated;
create temp table snapshots(k text primary key,value jsonb);
with x as (insert into public.campaigns(name,simple_bond_value,installment_count,installment_value,barcode_mode)
 values('SAN110',100,1,100,'base_number') returning id) insert into ids select 'campaign',id from x;
with x as (insert into public.collectors(display_name) values('SAN110 collector') returning id) insert into ids select 'collector',id from x;
with x as (insert into public.collectors(display_name) values('SAN110 destination') returning id) insert into ids select 'other',id from x;
with x as (insert into public.buyers(type,first_name) values('individual','SAN110 buyer') returning id) insert into ids select 'buyer',id from x;
insert into public.commission_rules(campaign_id,rule_type,percentage,valid_from)
 values(pg_temp.id('campaign'),'cash_full_payment',10,current_date-10);
do $$
declare k text; b uuid; s uuid; pp uuid; i uuid;
begin
 foreach k in array array['cash','transfer','pending'] loop
  insert into public.bonds(campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status)
   values(pg_temp.id('campaign'),'simple','printed',1,100,'available') returning id into b;
  update public.bonds set commercial_status='delivered_to_collector',current_collector_id=pg_temp.id('collector') where id=b;
  update public.bonds set commercial_status='sold',current_buyer_id=pg_temp.id('buyer') where id=b;
  insert into public.sales(campaign_id,bond_id,buyer_id,collector_id,payment_mode,total_amount,created_by)
   values(pg_temp.id('campaign'),b,pg_temp.id('buyer'),pg_temp.id('collector'),
    'full_payment',100,'b1100000-0000-0000-0000-000000000001') returning id into s;
  insert into public.payment_plans(sale_id,installment_count,total_amount) values(s,1,100) returning id into pp;
  insert into public.installments(payment_plan_id,installment_number,due_date,amount)
   values(pp,1,current_date-1,100) returning id into i;
  insert into ids values(k||'_sale',s),(k||'_installment',i);
 end loop;
end $$;
insert into ids values('closed',public.settlement_open(pg_temp.id('campaign'),pg_temp.id('collector')));
insert into ids values('cash',public.settlement_add_payment(pg_temp.id('closed'),pg_temp.id('cash_sale'),100,'cash',
 jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('cash_installment'),'amount_applied',100))));
insert into ids values('transfer',public.settlement_add_payment(pg_temp.id('closed'),pg_temp.id('transfer_sale'),100,'transfer',
 jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('transfer_installment'),'amount_applied',100))));
select public.settlement_close(pg_temp.id('closed'));
create function pg_temp.state() returns jsonb language sql as $$
 select jsonb_build_object(
 'settlements',(select jsonb_agg(to_jsonb(s) order by id) from public.settlements s where campaign_id=pg_temp.id('campaign')),
 'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.payments p where campaign_id=pg_temp.id('campaign')),
 'ledger',(select jsonb_agg(to_jsonb(e) order by id) from public.collector_ledger_entries e where campaign_id=pg_temp.id('campaign')),
 'applications',(select jsonb_agg(to_jsonb(a) order by a.payment_id,a.installment_id) from public.payment_installments a
   join public.payments p on p.id=a.payment_id where p.campaign_id=pg_temp.id('campaign')))
$$;
insert into snapshots select 'before',pg_temp.state();
insert into snapshots select 'closed',to_jsonb(s) from public.settlements s where id=pg_temp.id('closed');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1100000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.payment_correct_method(pg_temp.id('cash'),'transfer','denied','110-denied')$$,'42501',null,'permission denial');
reset role;
select is(pg_temp.state(),(select value from snapshots where k='before'),'denial leaves all financial state unchanged');
select is((select count(*)::int from public.audit_log where request_id='110-denied'),0,'denial writes no audit');
select set_config('request.jwt.claims','{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.payment_correct_method(pg_temp.id('cash'),'cash','same','110-invalid')$$,'22023',null,'same method rejected');
select throws_ok($$select public.payment_correct_method(pg_temp.id('cash'),'transfer',' ','110-invalid')$$,'22023',null,'blank reason rejected');
select is(pg_temp.state(),(select value from snapshots where k='before'),'invalid corrections write nothing');
select is((select count(*)::int from public.audit_log where request_id='110-invalid'),0,'invalid corrections have no audit');
set local role authenticated;
with x as (select public.payment_correct_method(pg_temp.id('cash'),'transfer','wrong cash','110-c2t') id)
 insert into ids select 'replacement',id from x;
reset role;
select is((select row(total_cash,total_transfer,total_amount,commission_amount,commission_paid_amount,net_to_firefighters)::text from public.settlements where id=pg_temp.id('closed')),'(0.00,200.00,200.00,20.00,0.00,200.00)','cash to transfer updates method totals, retention and net only');
select is((select to_jsonb(s)-array['total_cash','total_transfer','commission_paid_amount','net_to_firefighters']
 from public.settlements s where id=pg_temp.id('closed')),
 (select value-array['total_cash','total_transfer','commission_paid_amount','net_to_firefighters'] from snapshots where k='closed'),
 'identity, timestamps and original commission are preserved');
select is((select old_value->'settlement' from public.audit_log where request_id='110-c2t'),
 (select value from snapshots where k='closed'),'audit has exact before settlement');
select is((select new_value->'previous_value'->'settlement' from public.audit_log where request_id='110-c2t'),
 (select value from snapshots where k='closed'),'correction envelope has exact before settlement');
select is((select new_value->'new_value'->'settlement' from public.audit_log where request_id='110-c2t'),
 (select to_jsonb(s) from public.settlements s where id=pg_temp.id('closed')),'audit has exact after settlement');
select is((select count(*)::int from public.audit_log where request_id='110-c2t'),1,'one audit, not an additional settlement audit');
select is(public.collector_ledger_balance(pg_temp.id('campaign'),pg_temp.id('collector')),20::numeric,'ledger credits restored retention');
insert into snapshots select 'corrected_method',pg_temp.state();
select throws_ok($$select public.payment_correct_method(pg_temp.id('cash'),'transfer','again','110-repeat')$$,'55000',null,'repeated original correction rejected');
select is(pg_temp.state(),(select value from snapshots where k='corrected_method'),'repeat does not double count');
select is((select count(*)::int from public.audit_log where request_id='110-repeat'),0,'repeat has no audit');
set local role authenticated;
select lives_ok($$select public.payment_correct_method(pg_temp.id('replacement'),'cash','reverse','110-t2c')$$,'confirmed replacement can reverse method');
reset role;
select is((select to_jsonb(s) from public.settlements s where id=pg_temp.id('closed')),
 (select value from snapshots where k='closed'),'transfer to cash restores exact original settlement');
select is(public.collector_ledger_balance(pg_temp.id('campaign'),pg_temp.id('collector')),10::numeric,'reverse matches ledger retention debit');

-- Existing open-settlement path is unchanged and still rejects pending method corrections.
insert into ids values('open',public.settlement_open(pg_temp.id('campaign'),pg_temp.id('collector')));
insert into ids values('pending',public.settlement_add_payment(pg_temp.id('open'),pg_temp.id('pending_sale'),100,'cash',
 jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('pending_installment'),'amount_applied',100))));
insert into snapshots select 'open',to_jsonb(s) from public.settlements s where id=pg_temp.id('open');
select throws_ok($$select public.payment_correct_method(pg_temp.id('pending'),'transfer','pending','110-open')$$,'55000',null,'pending method correction remains ineligible');
select is((select to_jsonb(s) from public.settlements s where id=pg_temp.id('open')),(select value from snapshots where k='open'),'open stored totals unchanged');
select is((select row(total_cash,total_transfer)::text from public.settlement_totals(pg_temp.id('open'))),'(100.00,0)','open computed summary unchanged');
select is((select count(*)::int from public.audit_log where request_id='110-open'),0,'ineligible open correction writes no audit');

-- Linked manual adjustments remain immutable when correcting a method afterwards.
select public.settlement_correct(pg_temp.id('closed'),'manual difference','{"commission_delta":1,"cash_retained_delta":0}','110-adjustment');
insert into snapshots select 'manual',to_jsonb(c) from public.settlement_corrections c where settlement_id=pg_temp.id('closed');
select lives_ok($$select public.payment_correct_method(pg_temp.id('transfer'),'cash','after manual adjustment','110-after-adjustment')$$,'method correction also supports corrected status');
select is((select row(status,total_cash,total_transfer,commission_amount,commission_paid_amount,net_to_firefighters)::text from public.settlements where id=pg_temp.id('closed')),'(corrected,200.00,0.00,20.00,20.00,180.00)','corrected status and generated commission remain unchanged');
select is((select to_jsonb(c) from public.settlement_corrections c where settlement_id=pg_temp.id('closed')),
 (select value from snapshots where k='manual'),'manual adjustment is never rewritten');
insert into snapshots select 'before_direct',pg_temp.state();
set local role authenticated;
select throws_ok($$update public.settlements set total_cash=1 where id=pg_temp.id('closed')$$,'42501',null,'direct API DML blocked');
reset role;
select throws_ok($$update public.settlements set total_cash=1 where id=pg_temp.id('closed')$$,'23001',null,'even privileged arbitrary closed totals blocked');
select is(pg_temp.state(),(select value from snapshots where k='before_direct'),'direct write denials preserve state');
select ok(not has_table_privilege('anon','public.settlements','update')
 and not has_table_privilege('service_role','public.settlements','update'),'anon and service role have no DML');
select ok(not has_function_privilege('authenticated','public.payment_method_settlement_totals()','execute')
 and not has_function_privilege('anon','public.payment_method_totals_audit()','execute')
 and not has_function_privilege('service_role','public.settlement_method_totals_allowed(public.settlements,public.settlements)','execute'),
 'new internal helpers have no API execute');

-- Keep the moved-sale guard: totals/ledger/audit roll back as well as the payment.
select public.sale_correct_collector(pg_temp.id('cash_sale'),pg_temp.id('other'),'move for guard','110-move');
insert into snapshots select 'before_guard',pg_temp.state();
select throws_ok($$select public.payment_correct_method(
 (select id from public.payments where sale_id=pg_temp.id('cash_sale') and status='confirmed'),
 'transfer','moved','110-guard')$$,'55000',
 'This payment''s sale was moved to another collector. Correct the sale collector back before annulling or correcting this payment.',
 'moved-sale guard still raises its exact SQLSTATE and message');
select is(pg_temp.state(),(select value from snapshots where k='before_guard'),'moved-sale denial preserves all financial state');
select is((select count(*)::int from public.audit_log where request_id='110-guard'),0,'moved-sale denial writes no audit');
select * from finish();
rollback;
