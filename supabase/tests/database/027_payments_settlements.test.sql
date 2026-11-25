-- SAN-62: settlements, payments and payment_installments.
begin;
-- Fixture dates must share the payment_date default's business timezone, including UTC midnight.
set local time zone 'America/Argentina/Buenos_Aires';
select plan(82);
insert into auth.users (id,email) select ('a6270000-0000-0000-0000-00000000000'||n)::uuid, 'pay-'||n||'@example.com' from generate_series(1,6)n;
insert into public.profiles (id,auth_user_id,full_name,email,status) select ('b6270000-0000-0000-0000-00000000000'||n)::uuid, ('a6270000-0000-0000-0000-00000000000'||n)::uuid, 'Pay '||n, 'pay-'||n||'@example.com','active' from generate_series(1,6)n;
insert into public.user_roles(user_id,role_id) select p.id,r.id from (values ('b6270000-0000-0000-0000-000000000001'::uuid,'admin'),('b6270000-0000-0000-0000-000000000002'::uuid,'operator'),('b6270000-0000-0000-0000-000000000003'::uuid,'treasurer'),('b6270000-0000-0000-0000-000000000004'::uuid,'read-only'),('b6270000-0000-0000-0000-000000000005'::uuid,'collector'))p(id,n) join public.roles r on r.name=p.n;
create function pg_temp.act_as(n int) returns void language sql as $$select set_config('request.jwt.claims',format('{"sub":"a6270000-0000-0000-0000-00000000000%s","role":"authenticated"}',n),true)$$; grant execute on function pg_temp.act_as(int) to authenticated,anon,service_role;
create temp table ids(k text primary key,id uuid not null); grant select,insert on ids to authenticated,anon,service_role;
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$; grant execute on function pg_temp.id(text) to authenticated,anon,service_role;
with x as (insert into public.campaigns(name,simple_bond_value,installment_count,installment_value,barcode_mode) values('Pay',100,2,50,'base_number') returning id) insert into ids select 'c',id from x;
with x as (insert into public.campaigns(name,simple_bond_value,installment_count,installment_value,barcode_mode) values('Other',100,2,50,'base_number') returning id) insert into ids select 'c2',id from x;
with x as (insert into public.collectors(display_name,user_profile_id) values('Ana','b6270000-0000-0000-0000-000000000005') returning id) insert into ids select 'ana',id from x;
with x as (insert into public.collectors(display_name) values('Beto') returning id) insert into ids select 'beto',id from x;
with x as (insert into public.buyers(type,first_name) values('individual','Eva') returning id) insert into ids select 'buyer',id from x;
with x as (insert into public.bonds(campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status) values(pg_temp.id('c'),'simple','printed',1,100,'available') returning id) insert into ids select 'bond',id from x;
with x as (insert into public.sales(campaign_id,bond_id,buyer_id,collector_id,payment_mode,total_amount,created_by) values(pg_temp.id('c'),pg_temp.id('bond'),pg_temp.id('buyer'),pg_temp.id('ana'),'installments',100,'b6270000-0000-0000-0000-000000000001') returning id) insert into ids select 'sale',id from x;
with x as (insert into public.payment_plans(sale_id,installment_count,total_amount) values(pg_temp.id('sale'),2,100) returning id) insert into ids select 'plan',id from x;
with x as (insert into public.installments(payment_plan_id,installment_number,due_date,amount) select pg_temp.id('plan'),n,date '2026-01-01'+n,50 from generate_series(1,2)n returning id,installment_number) insert into ids select 'i'||installment_number,id from x;
with x as (insert into public.settlements(campaign_id,settlement_number,collector_id,created_by) values(pg_temp.id('c'),1,pg_temp.id('ana'),'b6270000-0000-0000-0000-000000000001') returning id) insert into ids select 'set',id from x;
select columns_are('public','settlements',array['id','campaign_id','settlement_number','collector_id','status','opened_at','closed_at','created_by','closed_by','total_cash','total_transfer','total_amount','commission_amount','commission_paid_amount','net_to_firefighters','notes','updated_at','collector_balance_at_close'],'settlement columns');
select columns_are('public','payments',array['id','campaign_id','sale_id','collector_id','buyer_id','settlement_id','amount','payment_method','payment_date','status','created_by','created_at','updated_at','annulled_by','annulled_at','annulment_reason','replaces_payment_id','submitted_by_collector','collector_note'],'payment columns');
select columns_are('public','payment_installments',array['payment_id','installment_id','amount_applied'],'application columns');
select ok((
  select pg_get_expr(ad.adbin, ad.adrelid) like '%America/Argentina/Buenos_Aires%'
  from pg_attrdef ad join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
  where ad.adrelid = 'public.payments'::regclass and a.attname = 'payment_date'
),
  'payment date defaults in Buenos Aires'
);
select fk_ok('public','payments',array['sale_id','campaign_id'],'public','sales',array['id','campaign_id'],'payment sale campaign FK');
select fk_ok('public','payments',array['settlement_id','campaign_id'],'public','settlements',array['id','campaign_id'],'payment settlement campaign FK');
select fk_ok('public','payments','buyer_id','public','buyers','id','payment buyer FK');
select fk_ok('public','payments','collector_id','public','collectors','id','payment collector FK');
select col_is_unique('public','settlements',array['campaign_id','settlement_number'],'settlement number unique per campaign');
select col_is_pk('public','payment_installments',array['payment_id','installment_id'],'application composite PK');
select throws_ok($$insert into public.settlements(campaign_id,settlement_number,collector_id,created_by) values(pg_temp.id('c'),0,pg_temp.id('ana'),'b6270000-0000-0000-0000-000000000001')$$,'23514',null,'number positive');
select throws_ok($$insert into public.settlements(campaign_id,settlement_number,collector_id,created_by,total_cash) values(pg_temp.id('c'),2,pg_temp.id('ana'),'b6270000-0000-0000-0000-000000000001',-1)$$,'23514',null,'totals nonnegative');
select throws_ok($$insert into public.settlements(campaign_id,settlement_number,collector_id,created_by,total_cash,total_transfer,total_amount) values(pg_temp.id('c'),2,pg_temp.id('ana'),'b6270000-0000-0000-0000-000000000001',1,2,2)$$,'23514',null,'total amount equals cash plus transfer');
select throws_ok($$insert into public.settlements(campaign_id,settlement_number,collector_id,created_by,notes) values(pg_temp.id('c'),2,pg_temp.id('ana'),'b6270000-0000-0000-0000-000000000001',' ')$$,'23514',null,'notes not blank');
select throws_ok($$insert into public.settlements(campaign_id,settlement_number,collector_id,created_by,status) values(pg_temp.id('c'),2,pg_temp.id('ana'),'b6270000-0000-0000-0000-000000000001','closed')$$,'23514',null,'new settlement open');
select throws_ok($$insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,amount,payment_method,created_by) values(pg_temp.id('c'),pg_temp.id('sale'),pg_temp.id('ana'),pg_temp.id('buyer'),0,'cash','b6270000-0000-0000-0000-000000000001')$$,'23514',null,'payment positive');
select throws_ok($$insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,amount,payment_method,created_by) values(pg_temp.id('c'),pg_temp.id('sale'),pg_temp.id('ana'),pg_temp.id('buyer'),1,'card','b6270000-0000-0000-0000-000000000001')$$,'23514',null,'payment method');
select throws_ok($$insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,amount,payment_method,created_by,status) values(pg_temp.id('c'),pg_temp.id('sale'),pg_temp.id('ana'),pg_temp.id('buyer'),1,'cash','b6270000-0000-0000-0000-000000000001','confirmed')$$,'23514',null,'initial payment status');
select throws_ok($$insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,amount,payment_method,created_by,status,settlement_id) values(pg_temp.id('c'),pg_temp.id('sale'),pg_temp.id('ana'),pg_temp.id('buyer'),1,'cash','b6270000-0000-0000-0000-000000000001','pending_in_settlement',null)$$,'23514',null,'pending payment needs settlement');
select throws_ok($$insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,amount,payment_method,created_by,annulled_by,annulled_at,annulment_reason) values(pg_temp.id('c'),pg_temp.id('sale'),pg_temp.id('ana'),pg_temp.id('buyer'),1,'cash','b6270000-0000-0000-0000-000000000001','b6270000-0000-0000-0000-000000000001',now(),'x')$$,'23514',null,'annulment only annulled status');
with x as (insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,settlement_id,amount,payment_method,created_by,status) values(pg_temp.id('c'),pg_temp.id('sale'),pg_temp.id('ana'),pg_temp.id('buyer'),pg_temp.id('set'),100,'cash','b6270000-0000-0000-0000-000000000001','pending_in_settlement') returning id) insert into ids select 'pay',id from x;
select lives_ok($$update public.payments set status='confirmed' where id=pg_temp.id('pay')$$,'pending confirms');
-- SAN-71 gates confirmed corrections. This privileged fixture exercises the underlying
-- state machine; 033 proves direct/API DML cannot enter the correction path.
select set_config('app.payment_correction',pg_temp.id('pay')::text,true);
select lives_ok($$update public.payments set status='adjusted' where id=pg_temp.id('pay')$$,'confirmed adjusts');
select set_config('app.payment_correction','',true);
select throws_ok($$update public.payments set status='confirmed' where id=pg_temp.id('pay')$$,'23514',null,'adjusted final');
select throws_ok($$update public.payments set amount=99 where id=pg_temp.id('pay')$$,'23001',null,'amount immutable');
select throws_ok($$update public.payments set payment_method='transfer' where id=pg_temp.id('pay')$$,'23001',null,'method immutable');
select throws_ok($$update public.payments set payment_date=current_date-1 where id=pg_temp.id('pay')$$,'23001',null,'date immutable');
select lives_ok($$update public.settlements set total_cash=100, total_amount=100 where id=pg_temp.id('set')$$,'open totals editable');
select lives_ok($$update public.settlements set status='closed',closed_at=now(),closed_by='b6270000-0000-0000-0000-000000000001' where id=pg_temp.id('set')$$,'open closes');
-- SAN-72 requires the audited adjustment path, not a bare status update.
select pg_temp.act_as(1);
select lives_ok($$select public.settlement_correct(pg_temp.id('set'),'state machine fixture',
 '{"commission_delta":1,"cash_retained_delta":0}')$$,'closed corrects through adjustment');
set constraints public.settlement_corrections_check_original immediate;
select throws_ok($$update public.settlements set total_cash=1 where id=pg_temp.id('set')$$,'23001',null,'corrected totals immutable');
select throws_ok($$update public.settlements set status='open' where id=pg_temp.id('set')$$,'23514',null,'corrected final');
with x as (insert into public.settlements(campaign_id,settlement_number,collector_id,created_by)
  values(pg_temp.id('c'),5,pg_temp.id('ana'),'b6270000-0000-0000-0000-000000000001') returning id)
insert into ids select 'transition_set', id from x;
with x as (insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,amount,payment_method,created_by) values(pg_temp.id('c'),pg_temp.id('sale'),pg_temp.id('ana'),pg_temp.id('buyer'),50,'transfer','b6270000-0000-0000-0000-000000000001') returning id) insert into ids select 'draft',id from x;
select lives_ok($$insert into public.payment_installments values(pg_temp.id('draft'),pg_temp.id('i1'),50)$$,'active sale plan application');
select throws_ok($$insert into public.payment_installments values(pg_temp.id('pay'),pg_temp.id('i1'),1)$$,'23514',null,'over application refused');
select throws_ok($$update public.payment_installments set amount_applied=1 where payment_id=pg_temp.id('draft')$$,'23001',null,'applications immutable');
select throws_ok($$update public.payments set settlement_id=pg_temp.id('transition_set') where id=pg_temp.id('draft')$$,
  '23514','pending payment settlement is inconsistent','draft payment cannot gain a settlement');
select lives_ok($$update public.payments set settlement_id=pg_temp.id('transition_set'),status='pending_in_settlement' where id=pg_temp.id('draft')$$,
  'draft payment enters a settlement in one update');
select lives_ok($$update public.payments set status='confirmed' where id=pg_temp.id('draft')$$,
  'pending payment confirms after entering settlement');
select is((select settlement_id from public.payments where id=pg_temp.id('draft')),pg_temp.id('transition_set'),
  'confirmed payment keeps its settlement');
select throws_ok($$delete from public.payment_installments where payment_id=pg_temp.id('draft')$$,'23001',null,'applications never deleted');
select throws_ok($$delete from public.payments where id=pg_temp.id('draft')$$,'23001',null,'payments never deleted');
select throws_ok($$delete from public.settlements where id=pg_temp.id('set')$$,'23001',null,'settlements never deleted');
select throws_ok($$truncate public.settlement_corrections,public.payment_installments,public.commission_adjustments,public.collector_ledger_entries,public.payments,public.settlements$$,'23001',null,'tables cannot truncate');
select ok(has_table_privilege('authenticated','public.payments','select') and not has_table_privilege('authenticated','public.payments','insert') and not has_table_privilege('authenticated','public.settlements','update'),'authenticated select only');
select ok(not has_table_privilege('service_role','public.payments','delete') and not has_table_privilege('anon','public.payments','select'),'no anonymous or delete privileges');
select ok(not has_function_privilege('authenticated','public.payments_guard_update()','execute') and has_function_privilege('authenticated','public.payment_can_read()','execute'),'function privileges');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.payments'::regclass,'public.settlements'::regclass,'public.payment_installments'::regclass)),'RLS enabled');
select ok(to_regclass('public.payments_campaign_status_idx') is not null,'payment campaign status index');
select ok(to_regclass('public.payments_settlement_idx') is not null,'payment settlement index');
select ok(to_regclass('public.payments_sale_idx') is not null,'payment sale FK index');
select ok(to_regclass('public.payments_collector_idx') is not null,'payment collector FK index');
select ok(to_regclass('public.payments_buyer_idx') is not null,'payment buyer FK index');
select ok(to_regclass('public.payments_created_by_idx') is not null,'payment creator FK index');
select ok(to_regclass('public.payment_installments_installment_idx') is not null,'application installment FK index');
select ok(has_table_privilege('authenticated','public.payment_installments','select'),'authenticated reads applications');
select ok(not has_table_privilege('authenticated','public.payment_installments','delete'),'authenticated cannot delete applications');
select ok(not has_table_privilege('service_role','public.settlements','insert')
  and not has_table_privilege('service_role','public.payments','update'),
  'service role has no direct settlement or payment writes');
select ok(not has_function_privilege('authenticated','public.settlements_guard_update()','execute'),'settlement guard is internal');
select ok(not has_function_privilege('authenticated','public.payment_installments_guard_insert()','execute'),'application guard is internal');
select ok(has_function_privilege('authenticated','public.settlement_can_read()','execute'),'settlement RLS helper is granted');
select ok(has_function_privilege('authenticated','public.payment_settlement_is_own_collector(uuid)','execute'),'own collector helper is granted');
select ok(not has_function_privilege('anon','public.payment_can_read()','execute'),'anonymous cannot use RLS helper');
select ok(not has_table_privilege('authenticated','public.settlements','insert'),'authenticated cannot insert settlements');
select ok(not has_table_privilege('authenticated','public.payment_installments','update'),'authenticated cannot update applications');
set local role authenticated;
select pg_temp.act_as(2);
select throws_ok($$insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,amount,payment_method,created_by) values(pg_temp.id('c'),pg_temp.id('sale'),pg_temp.id('ana'),pg_temp.id('buyer'),1,'cash','b6270000-0000-0000-0000-000000000002')$$,'42501',null,'payment create cannot directly insert');
select is((select count(*)::int from public.payments),2,'operator reads payments');
select is((select count(*)::int from public.settlements),2,'operator reads settlements');
select pg_temp.act_as(1); select is((select count(*)::int from public.payments),2,'admin reads payments');
select pg_temp.act_as(3); select is((select count(*)::int from public.settlements),2,'treasurer reads settlements');
select pg_temp.act_as(4); select is((select count(*)::int from public.payments),0,'read-only cannot read payments');
select pg_temp.act_as(5); select is((select count(*)::int from public.payments),2,'collector reads own payments');
select is((select count(*)::int from public.payment_installments),1,'collector reads own applications');
select pg_temp.act_as(6); select is((select count(*)::int from public.payments),0,'no role sees no payments');
select is((select count(*)::int from public.settlements),0,'no role sees no settlements');
select is((select count(*)::int from public.payment_installments),0,'no role sees no applications');
reset role;

-- A payment enters only an open settlement of its own collector; it never applies more than its amount.
reset role;
select throws_ok($$insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,settlement_id,amount,payment_method,payment_date,status,created_by)
  values(pg_temp.id('c'),pg_temp.id('sale'),pg_temp.id('beto'),pg_temp.id('buyer'),pg_temp.id('set'),10,'cash',current_date,'pending_in_settlement','b6270000-0000-0000-0000-000000000001')$$,
  '23514','a payment can only enter an open settlement of its collector','a payment cannot enter another collector''s settlement');
with x as (insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,amount,payment_method,payment_date,status,created_by)
  values(pg_temp.id('c'),pg_temp.id('sale'),pg_temp.id('ana'),pg_temp.id('buyer'),5,'cash',current_date,'draft','b6270000-0000-0000-0000-000000000001') returning id)
insert into ids select 'small', id from x;
select lives_ok($$insert into public.payment_installments(payment_id,installment_id,amount_applied) values(pg_temp.id('small'),pg_temp.id('i2'),5)$$,
  'a payment applies up to its amount');
select throws_ok($$insert into public.payment_installments(payment_id,installment_id,amount_applied) values(pg_temp.id('small'),pg_temp.id('i1'),1)$$,
  '23514','payment applications exceed the payment amount','a payment never applies more than its own amount');
select throws_ok($$update public.payments set status='pending_in_settlement' where id=pg_temp.id('small')$$,
  '23514','pending payment settlement is inconsistent','draft cannot become pending without a settlement');
with x as (
  insert into public.settlements(campaign_id,settlement_number,collector_id,created_by)
  values(pg_temp.id('c'),2,pg_temp.id('ana'),'b6270000-0000-0000-0000-000000000001') returning id
) insert into ids select 'closed_set',id from x;
update public.settlements set status='closed',closed_at=now(),closed_by='b6270000-0000-0000-0000-000000000001'
  where id=pg_temp.id('closed_set');
select throws_ok($$insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,settlement_id,amount,payment_method,status,created_by)
  values(pg_temp.id('c'),pg_temp.id('sale'),pg_temp.id('ana'),pg_temp.id('buyer'),pg_temp.id('closed_set'),1,'cash','pending_in_settlement','b6270000-0000-0000-0000-000000000001')$$,
  '23514','a payment can only enter an open settlement of its collector','payment cannot enter a closed settlement');
with x as (
  insert into public.settlements(campaign_id,settlement_number,collector_id,created_by)
  values(pg_temp.id('c'),3,pg_temp.id('ana'),'b6270000-0000-0000-0000-000000000001') returning id
) insert into ids select 'annulled_set',id from x;
update public.settlements set status='annulled' where id=pg_temp.id('annulled_set');
select throws_ok($$insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,settlement_id,amount,payment_method,status,created_by)
  values(pg_temp.id('c'),pg_temp.id('sale'),pg_temp.id('ana'),pg_temp.id('buyer'),pg_temp.id('annulled_set'),1,'cash','pending_in_settlement','b6270000-0000-0000-0000-000000000001')$$,
  '23514','a payment can only enter an open settlement of its collector','payment cannot enter an annulled settlement');
with x as (
  insert into public.settlements(campaign_id,settlement_number,collector_id,created_by)
  values(pg_temp.id('c'),4,pg_temp.id('ana'),'b6270000-0000-0000-0000-000000000001') returning id
) insert into ids select 'open_set',id from x;
update public.payments set settlement_id=pg_temp.id('open_set'),status='pending_in_settlement' where id=pg_temp.id('small');
update public.payments set status='confirmed' where id=pg_temp.id('small');
select throws_ok($$insert into public.payment_installments(payment_id,installment_id,amount_applied)
  values(pg_temp.id('small'),pg_temp.id('i2'),1)$$,
  '23514','payment applications require a draft or pending payment','confirmed payment cannot receive applications');
with x as (
  insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,settlement_id,amount,payment_method,status,created_by)
  values(pg_temp.id('c'),pg_temp.id('sale'),pg_temp.id('ana'),pg_temp.id('buyer'),pg_temp.id('open_set'),1,'cash','pending_in_settlement','b6270000-0000-0000-0000-000000000001') returning id
) insert into ids select 'annulled_pay',id from x;
update public.payments set status='annulled',annulled_by='b6270000-0000-0000-0000-000000000001',
  annulled_at=now(),annulment_reason='Review test' where id=pg_temp.id('annulled_pay');
select throws_ok($$insert into public.payment_installments(payment_id,installment_id,amount_applied)
  values(pg_temp.id('annulled_pay'),pg_temp.id('i2'),1)$$,
  '23514','payment applications require a draft or pending payment','annulled payment cannot receive applications');

select * from finish(); rollback;
