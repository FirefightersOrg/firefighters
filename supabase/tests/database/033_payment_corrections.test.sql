begin;
set local time zone 'America/Argentina/Buenos_Aires';
select plan(100);
insert into auth.users(id,email) values
 ('a6710000-0000-0000-0000-000000000001','admin671@example.com'),
 ('a6710000-0000-0000-0000-000000000002','denied671@example.com');
insert into public.profiles(id,auth_user_id,full_name,email,status) values
 ('b6710000-0000-0000-0000-000000000001','a6710000-0000-0000-0000-000000000001','Admin','admin671@example.com','active'),
 ('b6710000-0000-0000-0000-000000000002','a6710000-0000-0000-0000-000000000002','Denied','denied671@example.com','active');
insert into public.user_roles(user_id,role_id)
 select 'b6710000-0000-0000-0000-000000000001',id from public.roles where name='admin';
select set_config('request.jwt.claims','{"sub":"a6710000-0000-0000-0000-000000000001","role":"authenticated"}',true);
create temp table ids(k text primary key,id uuid);
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$;
grant execute on function pg_temp.id(text) to authenticated;
grant select,insert on ids to authenticated;
create temp table snapshots(k text primary key,value jsonb);
with x as (insert into public.campaigns(name,simple_bond_value,installment_count,installment_value,barcode_mode)
 values('SAN71',100,1,100,'base_number') returning id) insert into ids select 'campaign',id from x;
with x as (insert into public.collectors(display_name) values('SAN71 collector') returning id) insert into ids select 'collector',id from x;
with x as (insert into public.buyers(type,first_name) values('individual','SAN71 buyer') returning id) insert into ids select 'buyer',id from x;
insert into public.commission_rules(campaign_id,rule_type,percentage,valid_from)
 values(pg_temp.id('campaign'),'cash_full_payment',10,current_date-10),
 (pg_temp.id('campaign'),'installment_first',20,current_date-10);
-- Separate sales permit isolated coverage tests; destination uses a different commission rule.
do $$
declare k text; b uuid; s uuid; pp uuid; i uuid;
begin
 foreach k in array array['cash','transfer','method','reverse','old','new','pending','partial','zero','advance'] loop
  insert into public.bonds(campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status)
   values(pg_temp.id('campaign'),'simple','printed',1,100,'available') returning id into b;
  insert into public.sales(campaign_id,bond_id,buyer_id,collector_id,payment_mode,total_amount,created_by,sold_at)
   values(pg_temp.id('campaign'),b,pg_temp.id('buyer'),pg_temp.id('collector'),
    case when k='new' then 'installments' else 'full_payment' end,100,'b6710000-0000-0000-0000-000000000001',now() - interval '30 days') returning id into s;
  insert into public.payment_plans(sale_id,installment_count,total_amount) values(s,1,100) returning id into pp;
  insert into public.installments(payment_plan_id,installment_number,due_date,amount)
   values(pp,1,case when k='advance' then current_date+10 else current_date-1 end,100) returning id into i;
  insert into ids values(k||'_bond',b),(k||'_sale',s),(k||'_installment',i);
 end loop;
end $$;
insert into ids values('settlement',public.settlement_open(pg_temp.id('campaign'),pg_temp.id('collector')));
do $$
declare k text; p uuid;
begin
 foreach k in array array['cash','transfer','method','reverse','old','partial','advance'] loop
  p:=public.settlement_add_payment(pg_temp.id('settlement'),pg_temp.id(k||'_sale'),100,
   case when k in ('cash','method','advance') then 'cash' else 'transfer' end,
   jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id(k||'_installment'),'amount_applied',100)));
  insert into ids values(k||'_payment',p);
 end loop;
end $$;
select public.settlement_close(pg_temp.id('settlement'));
insert into snapshots select 'closed',to_jsonb(s) from public.settlements s where id=pg_temp.id('settlement');
create function pg_temp.balance() returns numeric language sql as $$
 select coalesce(sum(case when direction='collector_credit' then amount else -amount end),0)
 from public.collector_ledger_entries where collector_id=pg_temp.id('collector') and status<>'annulled' and affects_balance
$$;
select is(pg_temp.balance(),40::numeric,'initial transfer commission balance');

-- Permission failures are atomic across all three RPCs, with real API role.
insert into snapshots select 'before_denied',jsonb_build_object(
 'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.payments p),
 'ledger',(select jsonb_agg(to_jsonb(e) order by id) from public.collector_ledger_entries e),
 'audit',(select count(*) from public.audit_log));
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a6710000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.payment_annul(pg_temp.id('cash_payment'),'denied')$$,'42501',null,'annul permission required');
select throws_ok($$select public.payment_correct_method(pg_temp.id('method_payment'),'transfer','denied')$$,'42501',null,'method permission required');
select throws_ok($$select public.payment_reassociate_transfer(pg_temp.id('old_payment'),pg_temp.id('new_sale'),'[]','denied')$$,'42501',null,'reassociation permission required');
reset role;
select is(jsonb_build_object(
 'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.payments p),
 'ledger',(select jsonb_agg(to_jsonb(e) order by id) from public.collector_ledger_entries e),
 'audit',(select count(*) from public.audit_log)),(select value from snapshots where k='before_denied'),'denials write nothing');
select set_config('request.jwt.claims','{"sub":"a6710000-0000-0000-0000-000000000001","role":"authenticated"}',true);

-- Validation happens before any writes.
select throws_ok($$select public.payment_annul(pg_temp.id('cash_payment'),'  ')$$,'22023',null,'blank reason rejected');
select throws_ok($$select public.payment_annul(pg_temp.id('cash_payment'),repeat('😀',1001))$$,'22023',null,'reason code-point limit');
select throws_ok($$select public.payment_annul('00000000-0000-0000-0000-000000000000','missing')$$,'P0002',null,'missing payment');
select throws_ok($$select public.payment_correct_method(pg_temp.id('method_payment'),'cash','same')$$,'22023',null,'same method rejected');
select throws_ok($$select public.payment_correct_method(pg_temp.id('method_payment'),null,'null')$$,'22023',null,'null method rejected');
select throws_ok($$select public.payment_reassociate_transfer(pg_temp.id('cash_payment'),pg_temp.id('new_sale'),'[]','cash')$$,'22023',null,'cash cannot reassociate');
select throws_ok($$select public.payment_reassociate_transfer(pg_temp.id('old_payment'),pg_temp.id('old_sale'),'[]','same')$$,'22023',null,'same sale rejected');
select throws_ok($$select public.payment_reassociate_transfer(pg_temp.id('old_payment'),pg_temp.id('new_sale'),null,'null')$$,'22023',null,'null applications');
select throws_ok($$select public.payment_reassociate_transfer(pg_temp.id('old_payment'),pg_temp.id('new_sale'),'{}','object')$$,'22023',null,'non-array applications');
select throws_ok($$select public.payment_reassociate_transfer(pg_temp.id('old_payment'),pg_temp.id('new_sale'),'[]','empty')$$,'22023',null,'empty applications');
select throws_ok($$select public.payment_reassociate_transfer(pg_temp.id('old_payment'),pg_temp.id('new_sale'),
 jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('new_installment'),'amount_applied',99)),'sum')$$,'22023',null,'sum mismatch');
select throws_ok($$select public.payment_reassociate_transfer(pg_temp.id('old_payment'),pg_temp.id('new_sale'),
 jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('new_installment'),'amount_applied',100.001)),'scale')$$,'22023',null,'fractional cents rejected');
select throws_ok($$select public.payment_reassociate_transfer(pg_temp.id('old_payment'),pg_temp.id('new_sale'),
 jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('new_installment'),'amount_applied',50),
 jsonb_build_object('installment_id',pg_temp.id('new_installment'),'amount_applied',50)),'duplicate')$$,'22023',null,'duplicates rejected');
select throws_ok($$select public.payment_reassociate_transfer(pg_temp.id('old_payment'),pg_temp.id('new_sale'),
 jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('cash_installment'),'amount_applied',100)),'wrong installment')$$,'22023',null,'foreign installment rejected');
select is(jsonb_build_object(
 'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.payments p),
 'ledger',(select jsonb_agg(to_jsonb(e) order by id) from public.collector_ledger_entries e),
 'audit',(select count(*) from public.audit_log)),(select value from snapshots where k='before_denied'),'invalid requests write nothing');

-- Confirmed cash annulment: debit generation, credit cash retention; net zero.
set local role authenticated;
select lives_ok($$select public.payment_annul(pg_temp.id('cash_payment'),'  cash mistake  ','cash-annul')$$,'cash annul succeeds');
reset role;
select is((select status from public.payments where id=pg_temp.id('cash_payment')),'annulled','original annulled');
select results_eq($$select direction,amount from public.collector_ledger_entries where payment_id=pg_temp.id('cash_payment') order by direction$$,
 $$values ('collector_credit'::text,10::numeric),('collector_debit',10::numeric)$$,'cash annul exact ledger');
select is(pg_temp.balance(),40::numeric,'cash annul balance unchanged');
select is((select status from public.installments where id=pg_temp.id('cash_installment')),'overdue','cash installment reverts overdue');
select is((select financial_status_snapshot from public.bonds where id=pg_temp.id('cash_bond')),'no_payments','cash bond recomputed with existing snapshot function');
select is((select to_jsonb(s) from public.settlements s where id=pg_temp.id('settlement')),(select value from snapshots where k='closed'),'cash annul preserves full closed row');

select lives_ok($$select public.payment_annul(pg_temp.id('transfer_payment'),'transfer mistake','transfer-annul')$$,'transfer annul succeeds');
select results_eq($$select direction,amount from public.collector_ledger_entries where payment_id=pg_temp.id('transfer_payment')$$,
 $$values ('collector_debit'::text,10::numeric)$$,'transfer annul exact debit');
select is(pg_temp.balance(),30::numeric,'transfer annul reduces balance');
select is((select status from public.installments where id=pg_temp.id('transfer_installment')),'overdue','transfer installment reverted');
select is((select to_jsonb(s) from public.settlements s where id=pg_temp.id('settlement')),(select value from snapshots where k='closed'),'transfer annul preserves full closed row');
select throws_ok($$select public.payment_annul(pg_temp.id('transfer_payment'),'again')$$,'55000',null,'repeat annul blocked');

-- Method corrections preserve coverage, link immutable originals, and adjust cash retention only.
insert into snapshots select 'method_installment',to_jsonb(i) from public.installments i where id=pg_temp.id('method_installment');
insert into ids values('method_replacement',public.payment_correct_method(pg_temp.id('method_payment'),'transfer','method mistake','method-correction'));
select is((select status from public.payments where id=pg_temp.id('method_payment')),'adjusted','method original adjusted');
select ok((select status='confirmed' and payment_method='transfer' and replaces_payment_id=pg_temp.id('method_payment')
 and amount=100 and settlement_id=pg_temp.id('settlement') from public.payments where id=pg_temp.id('method_replacement')),'confirmed replacement identity');
select results_eq($$select installment_id,amount_applied from public.payment_installments where payment_id=pg_temp.id('method_replacement')$$,
 $$select installment_id,amount_applied from public.payment_installments where payment_id=pg_temp.id('method_payment')$$,'method applications copied');
select is((select to_jsonb(i) from public.installments i where id=pg_temp.id('method_installment')),(select value from snapshots where k='method_installment'),'method installment fully unchanged');
select results_eq($$select direction,amount from public.collector_ledger_entries where payment_id=pg_temp.id('method_payment') and affects_balance$$,
 $$values ('collector_credit'::text,10::numeric)$$,'cash to transfer restores retained commission');
select is(pg_temp.balance(),40::numeric,'cash to transfer balance');
select is((select to_jsonb(s) from public.settlements s where id=pg_temp.id('settlement')),
 (select value||jsonb_build_object('total_cash',200,'total_transfer',500,
 'commission_paid_amount',20,'net_to_firefighters',680) from snapshots where k='closed'),
 'method correction updates only method totals, retention and net (SAN-110)');
insert into ids values('reverse_replacement',public.payment_correct_method(pg_temp.id('reverse_payment'),'cash','reverse mistake','reverse-correction'));
select results_eq($$select direction,amount from public.collector_ledger_entries where payment_id=pg_temp.id('reverse_replacement') and affects_balance$$,
 $$values ('collector_debit'::text,10::numeric)$$,'transfer to cash posts retained commission debit');
select is(pg_temp.balance(),30::numeric,'transfer to cash balance');
select throws_ok($$select public.payment_correct_method(pg_temp.id('method_payment'),'cash','again')$$,'55000',null,'adjusted cannot correct twice');

-- Transfer reassociation: old commission 10, destination commission 20.
set local role authenticated;
with x as (select public.payment_reassociate_transfer(pg_temp.id('old_payment'),pg_temp.id('new_sale'),
 jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('new_installment'),'amount_applied',100)),'wrong sale','reassociate') id)
 insert into ids select 'new_payment',id from x;
reset role;
select is((select status from public.payments where id=pg_temp.id('old_payment')),'adjusted','old association adjusted');
select ok((select status='confirmed' and payment_method='transfer' and sale_id=pg_temp.id('new_sale')
 and replaces_payment_id=pg_temp.id('old_payment') from public.payments where id=pg_temp.id('new_payment')),'new association confirmed and linked');
select results_eq($$select direction,amount from public.collector_ledger_entries where payment_id in (pg_temp.id('old_payment'),pg_temp.id('new_payment')) order by direction$$,
 $$values ('collector_credit'::text,20::numeric),('collector_debit',10::numeric)$$,'reassociation exact ledger');
select is(pg_temp.balance(),40::numeric,'reassociation balance includes commission difference');
select is((select status from public.installments where id=pg_temp.id('old_installment')),'overdue','old installment reverted');
select is((select status from public.installments where id=pg_temp.id('new_installment')),'paid','new installment paid');
select is((select financial_status_snapshot from public.bonds where id=pg_temp.id('old_bond')),'no_payments','old bond recomputed with existing snapshot function');
select is((select financial_status_snapshot from public.bonds where id=pg_temp.id('new_bond')),'fully_paid','new bond recomputed');
select is((select to_jsonb(s) from public.settlements s where id=pg_temp.id('settlement')),(select value from snapshots where k='closed'),'reassociation preserves full closed row');

-- Pending annulment requires payment.annul, no ledger, no settlement write.
insert into ids values('open',public.settlement_open(pg_temp.id('campaign'),pg_temp.id('collector')));
insert into ids values('pending_payment',public.settlement_add_payment(pg_temp.id('open'),pg_temp.id('pending_sale'),100,'cash',
 jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('pending_installment'),'amount_applied',100))));
select lives_ok($$select public.payment_annul(pg_temp.id('pending_payment'),'pending mistake','pending-annul')$$,'pending annul succeeds');
select is((select count(*)::int from public.collector_ledger_entries where payment_id=pg_temp.id('pending_payment')),0,'pending has no compensation');
select is((select status from public.payments where id=pg_temp.id('pending_payment')),'annulled','pending annulled');
select is((select total_amount from public.settlement_totals(pg_temp.id('open'))),0::numeric,'open summary excludes annulled');
select lives_ok($$select public.payment_annul(pg_temp.id('advance_payment'),repeat('😀',1000),'advance-annul')$$,'1000 code-point reason accepted');
select is((select status from public.installments where id=pg_temp.id('advance_installment')),'pending','paid advance reverts pending');

-- Every correction has exactly one audit carrying every minimum field and real ledger ids.
select is((select count(*)::int from public.audit_log where request_id in
 ('cash-annul','transfer-annul','method-correction','reverse-correction','reassociate','pending-annul','advance-annul')),7,'one audit per correction');
select ok((select bool_and(new_value ?& array['correction_type','affected_entity','related_entity','reason','user','date',
 'previous_value','new_value','generated_compensatory_movements'] and reason=new_value->>'reason'
 and actor_user_id::text=new_value->>'user') from public.audit_log where request_id in
 ('cash-annul','transfer-annul','method-correction','reverse-correction','reassociate','pending-annul','advance-annul')),'audit contains all nine fields');
select is((select reason from public.audit_log where request_id='cash-annul'),'cash mistake','reason trimmed in audit');
select ok(not exists(select 1 from public.audit_log a cross join lateral jsonb_array_elements_text(a.new_value->'generated_compensatory_movements') m(id)
 where a.request_id in ('cash-annul','transfer-annul','method-correction','reverse-correction','reassociate','pending-annul','advance-annul')
 and not exists(select 1 from public.collector_ledger_entries e where e.id=m.id::uuid and (e.entry_type='annulment' or not e.affects_balance) and e.reason=a.reason)),'audit ledger ids resolve to compensatory rows');

-- Narrow guard path is closed after RPC, including privileged DML.
select throws_ok($$update public.payments set status='adjusted' where id=pg_temp.id('partial_payment')$$,'23001',null,'direct confirmed adjustment blocked');
select throws_ok($$update public.payments set replaces_payment_id=pg_temp.id('cash_payment') where id=pg_temp.id('partial_payment')$$,'23001',null,'replacement link immutable');
select throws_ok($$update public.installments set status='pending' where id=pg_temp.id('partial_installment')$$,'23514',null,'direct paid revert blocked');
select throws_ok($$insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,settlement_id,amount,payment_method,status,created_by,replaces_payment_id)
 select campaign_id,sale_id,collector_id,buyer_id,settlement_id,amount,payment_method,'confirmed',created_by,id
 from public.payments where id=pg_temp.id('old_payment')$$,'23514',null,'direct replacement in closed settlement blocked');
select throws_ok($$insert into public.payment_installments(payment_id,installment_id,amount_applied)
 values(pg_temp.id('new_payment'),pg_temp.id('new_installment'),1)$$,'23514',null,'direct confirmed application blocked');
set local role authenticated;
select set_config('app.payment_correction','on',true);
select throws_ok($$update public.payments set status='adjusted' where id=pg_temp.id('partial_payment')$$,'42501',null,'GUC grants no API DML');
reset role;
select ok(not has_function_privilege('service_role','public.payment_annul(uuid,text,text)','execute'),'service role cannot annul');
select ok(not has_function_privilege('anon','public.payment_correct_method(uuid,text,text,text)','execute'),'anon cannot correct');
select ok(not has_function_privilege('authenticated','public.payment_apply_correction(text,uuid,text,uuid,jsonb,text,text)','execute'),'implementation private');

-- Partial confirmed coverage survives annulment but is no longer enough to stay paid.
select set_config('app.payment_correction','',true);
select public.payment_annul(pg_temp.id('partial_payment'),'prepare partial');
insert into ids values('split_cash',public.settlement_add_payment(pg_temp.id('open'),pg_temp.id('partial_sale'),40,'cash',
 jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('partial_installment'),'amount_applied',40))));
insert into ids values('split_transfer',public.settlement_add_payment(pg_temp.id('open'),pg_temp.id('partial_sale'),60,'transfer',
 jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('partial_installment'),'amount_applied',60))));
select public.settlement_close(pg_temp.id('open'));
insert into snapshots select 'split_closed',to_jsonb(s) from public.settlements s where id=pg_temp.id('open');
select lives_ok($$select public.payment_annul(pg_temp.id('split_cash'),'partial annul','partial-annul')$$,'partial cash annul succeeds');
select is((select status from public.installments where id=pg_temp.id('partial_installment')),'overdue','remaining coverage under amount reverts paid');
select is((select sum(pi.amount_applied) from public.payment_installments pi join public.payments p on p.id=pi.payment_id
 where pi.installment_id=pg_temp.id('partial_installment') and p.status='confirmed'),60::numeric,'remaining confirmed coverage preserved');
select results_eq($$select direction,amount from public.collector_ledger_entries where payment_id=pg_temp.id('split_cash') order by direction$$,
 $$values ('collector_credit'::text,4::numeric),('collector_debit',4::numeric)$$,'partial commission prorated exactly');
select is((select to_jsonb(s) from public.settlements s where id=pg_temp.id('open')),(select value from snapshots where k='split_closed'),'split closed row untouched');
select is(pg_temp.balance(),36::numeric,'partial cash annul keeps transfer commission balance');

-- An adjusted payment no longer reserves installments; its replacement does.
insert into ids values('open2',public.settlement_open(pg_temp.id('campaign'),pg_temp.id('collector')));
select throws_ok($$select public.settlement_add_payment(pg_temp.id('open2'),pg_temp.id('new_sale'),1,'transfer',
 jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('new_installment'),'amount_applied',1)))$$,'23514',null,'replacement coverage prevents overpayment');
select throws_ok($$select public.payment_reassociate_transfer(pg_temp.id('method_replacement'),pg_temp.id('new_sale'),
 jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('new_installment'),'amount_applied',100)),'full destination')$$,'22023',null,'destination remaining balance enforced');
select lives_ok($$select public.settlement_add_payment(pg_temp.id('open2'),pg_temp.id('old_sale'),100,'transfer',
 jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('old_installment'),'amount_applied',100)))$$,'adjusted application does not reserve old installment');

-- Commission-free payment: no illegal zero ledger rows; replacement can itself be annulled.
insert into ids values('zero_payment',public.settlement_add_payment(pg_temp.id('open2'),pg_temp.id('zero_sale'),100,'cash',
 jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('zero_installment'),'amount_applied',100)),current_date-20));
select public.settlement_close(pg_temp.id('open2'));
select lives_ok($$select public.payment_annul(pg_temp.id('zero_payment'),'zero commission','zero-annul')$$,'zero commission annul succeeds');
select is((select count(*)::int from public.collector_ledger_entries where payment_id=pg_temp.id('zero_payment')),0,'zero commission creates no ledger row');
select is((select new_value->'generated_compensatory_movements' from public.audit_log where request_id='zero-annul'),'[]'::jsonb,'zero compensation audit is explicit empty array');
select is(pg_temp.balance(),46::numeric,'zero commission annul leaves balance unchanged');
select lives_ok($$select public.payment_annul(pg_temp.id('method_replacement'),'annul replacement')$$,'replacement may be annulled');
select is((select status from public.payments where id=pg_temp.id('method_payment')),'adjusted','replacement annul preserves original history');
select is((select status from public.payments where id=pg_temp.id('method_replacement')),'annulled','replacement annulled');
select is((select status from public.installments where id=pg_temp.id('method_installment')),'overdue','adjusted original not confirmed coverage');
select is((select to_jsonb(s) from public.settlements s where id=pg_temp.id('settlement')),(select value from snapshots where k='closed'),'all corrections preserve original settlement');
select ok((select count(*)=2 from public.payment_installments where payment_id in (pg_temp.id('method_payment'),pg_temp.id('method_replacement'))),'all application history retained');
select is(pg_temp.balance(),36::numeric,'annulled replacement reverses its commission');

-- New association can pay an advance installment and can itself be corrected again.
insert into ids values('advance_replacement',public.payment_reassociate_transfer(pg_temp.id('new_payment'),pg_temp.id('advance_sale'),
 jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('advance_installment'),'amount_applied',100)),'advance destination','advance-reassociation'));
select is((select status from public.installments where id=pg_temp.id('advance_installment')),'paid_advance','new future installment paid in advance');
select is((select status from public.installments where id=pg_temp.id('new_installment')),'overdue','second reassociation reverts previous destination');
select results_eq($$select direction,amount from public.collector_ledger_entries where reason='advance destination' order by direction$$,
 $$values ('collector_credit'::text,10::numeric),('collector_debit',20::numeric)$$,'second reassociation applies distinct rules exactly');
select is(pg_temp.balance(),26::numeric,'second reassociation balance');
select is((select financial_status_snapshot from public.bonds where id=pg_temp.id('advance_bond')),'fully_paid','advance destination bond paid');
select is((select to_jsonb(s) from public.settlements s where id=pg_temp.id('settlement')),(select value from snapshots where k='closed'),'second reassociation preserves closed row');
select is((select replaces_payment_id from public.payments where id=pg_temp.id('advance_replacement')),pg_temp.id('new_payment'),'replacement chain preserved');
select is((select count(*)::int from public.audit_log where request_id='advance-reassociation'),1,'one audit for repeated reassociation');
select is((select jsonb_array_length(new_value->'generated_compensatory_movements') from public.audit_log where request_id='advance-reassociation'),2,'audit lists both reassociation movements');
select * from finish();
rollback;
