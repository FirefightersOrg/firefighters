-- SAN-68: three-tier rule selection and settlement ledger services.
begin;
select plan(33);
insert into auth.users(id,email) values
  ('a6310000-0000-0000-0000-000000000001','admin631@example.com'),
  ('a6310000-0000-0000-0000-000000000002','denied631@example.com'),
  ('a6310000-0000-0000-0000-000000000003','collector631@example.com');
insert into public.profiles(id,auth_user_id,full_name,email,status) values
  ('b6310000-0000-0000-0000-000000000001','a6310000-0000-0000-0000-000000000001','Admin','admin631@example.com','active'),
  ('b6310000-0000-0000-0000-000000000002','a6310000-0000-0000-0000-000000000002','Denied','denied631@example.com','active'),
  ('b6310000-0000-0000-0000-000000000003','a6310000-0000-0000-0000-000000000003','Collector','collector631@example.com','active');
insert into public.user_roles(user_id,role_id) select 'b6310000-0000-0000-0000-000000000001',id from public.roles where name='admin';
create temp table ids(k text primary key,id uuid); grant select,insert on ids to authenticated;
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$;
grant execute on function pg_temp.id(text) to authenticated;
select set_config('request.jwt.claims','{"sub":"a6310000-0000-0000-0000-000000000001","role":"authenticated"}',true);
with x as (insert into public.campaigns(name,simple_bond_value,installment_count,installment_value,barcode_mode) values('SAN 68',100,1,100,'base_number') returning id) insert into ids select 'campaign',id from x;
with x as (insert into public.collectors(display_name,user_profile_id) values('Ana','b6310000-0000-0000-0000-000000000003') returning id) insert into ids select 'collector',id from x;
with x as (insert into public.collectors(display_name) values('Other') returning id) insert into ids select 'other_collector',id from x;
with x as (insert into public.buyers(type,first_name) values('individual','Eva') returning id) insert into ids select 'buyer',id from x;
with x as (insert into public.bonds(campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status) values(pg_temp.id('campaign'),'simple','printed',1,100,'available') returning id) insert into ids select 'bond',id from x;
with x as (insert into public.sales(campaign_id,bond_id,buyer_id,collector_id,payment_mode,total_amount,created_by) values(pg_temp.id('campaign'),pg_temp.id('bond'),pg_temp.id('buyer'),pg_temp.id('collector'),'full_payment',100,'b6310000-0000-0000-0000-000000000001') returning id) insert into ids select 'sale',id from x;
with x as (insert into public.payment_plans(sale_id,installment_count,total_amount) values(pg_temp.id('sale'),1,100) returning id) insert into ids select 'plan',id from x;
with x as (insert into public.installments(payment_plan_id,installment_number,due_date,amount) values(pg_temp.id('plan'),1,current_date,100) returning id) insert into ids select 'installment',id from x;
insert into public.commission_rules(campaign_id,rule_type,percentage,valid_from)
  values(pg_temp.id('campaign'),'cash_full_payment',10,current_date);

-- Specific beats general; custom beats type at equal specificity; newest valid_from then id.
insert into public.commission_rules(campaign_id,rule_type,installment_number,percentage,valid_from)
  values(pg_temp.id('campaign'),'custom',1,30,current_date);
insert into public.commission_rules(campaign_id,rule_type,installment_number,percentage,applies_to_collector_id,valid_from)
  values(pg_temp.id('campaign'),'custom',1,40,pg_temp.id('collector'),current_date);
select is(public.settlement_application_commission(pg_temp.id('campaign'),pg_temp.id('collector'),current_date,'full_payment',1,1,100,100),40::numeric,'specific custom wins');
select is(public.settlement_application_commission(pg_temp.id('campaign'),pg_temp.id('other_collector'),current_date,'full_payment',1,1,100,100),30::numeric,'custom wins over type rule');
-- Isolated type rules: no custom rule can mask the first/middle/last boundaries.
with x as (insert into public.campaigns(name,simple_bond_value,installment_count,installment_value,barcode_mode) values('SAN 68 tiers',500,5,100,'base_number') returning id) insert into ids select 'tiers',id from x;
insert into public.commission_rules(campaign_id,rule_type,percentage,valid_from,valid_to) values
  (pg_temp.id('tiers'),'installment_first',10,'2026-01-01','2026-01-31'),
  (pg_temp.id('tiers'),'installment_middle',20,'2026-01-01','2026-01-31'),
  (pg_temp.id('tiers'),'installment_last',30,'2026-01-01','2026-01-31');
select is(public.settlement_application_commission(pg_temp.id('tiers'),pg_temp.id('collector'),'2026-01-15','installments',1,1,100,100),10::numeric,'one-installment plan uses first, not last');
select is(public.settlement_application_commission(pg_temp.id('tiers'),pg_temp.id('collector'),'2026-01-15','installments',1,5,100,100),10::numeric,'first boundary excludes middle');
select is(public.settlement_application_commission(pg_temp.id('tiers'),pg_temp.id('collector'),'2026-01-15','installments',2,5,100,100),20::numeric,'middle starts at 2');
select is(public.settlement_application_commission(pg_temp.id('tiers'),pg_temp.id('collector'),'2026-01-15','installments',4,5,100,100),20::numeric,'middle ends at n-1');
select is(public.settlement_application_commission(pg_temp.id('tiers'),pg_temp.id('collector'),'2026-01-15','installments',5,5,100,100),30::numeric,'last applies at n when n>1');
select is(public.settlement_application_commission(pg_temp.id('tiers'),pg_temp.id('collector'),'2026-01-15','installments',2,2,100,100),30::numeric,'two-installment plan has no middle');
select is(public.settlement_application_commission(pg_temp.id('tiers'),pg_temp.id('collector'),'2026-01-01','installments',1,5,100,100),10::numeric,'valid_from is inclusive');
select is(public.settlement_application_commission(pg_temp.id('tiers'),pg_temp.id('collector'),'2026-01-31','installments',1,5,100,100),10::numeric,'valid_to is inclusive');
select is(public.settlement_application_commission(pg_temp.id('tiers'),pg_temp.id('collector'),'2025-12-31','installments',1,5,100,100),0::numeric,'before valid_from is excluded');
select is(public.settlement_application_commission(pg_temp.id('tiers'),pg_temp.id('collector'),'2026-02-01','installments',1,5,100,100),0::numeric,'after valid_to is excluded');
insert into public.commission_rules(campaign_id,rule_type,percentage,valid_from)
  values(pg_temp.id('tiers'),'cash_full_payment',33.33,'2026-01-01');
select is(public.settlement_application_commission(pg_temp.id('tiers'),pg_temp.id('collector'),'2026-01-15','full_payment',1,1,10,100),3.33::numeric,'33.33 percent rounds to cents');
insert into public.commission_rules(campaign_id,rule_type,installment_number,fixed_amount,valid_from)
  values(pg_temp.id('tiers'),'custom',3,10,'2026-01-01');
select is(public.settlement_application_commission(pg_temp.id('tiers'),pg_temp.id('collector'),'2026-01-15','installments',3,5,25,100),2.50::numeric,'fixed amount is prorated for partial payment');
update public.commission_rules set percentage=50 where campaign_id=pg_temp.id('tiers') and rule_type='cash_full_payment';
select is(public.settlement_application_commission(pg_temp.id('tiers'),pg_temp.id('collector'),'2026-01-15','full_payment',1,1,20.15,20.15),10.08::numeric,'numeric half-cent rounding is authoritative over floating-point preview');

set local role authenticated;
with x as (select public.settlement_open(pg_temp.id('campaign'),pg_temp.id('collector')) id) insert into ids select 'settlement',id from x;
select public.settlement_add_payment(pg_temp.id('settlement'),pg_temp.id('sale'),60,'cash',jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('installment'),'amount_applied',60)));
-- A transfer needs a second payment application only up to the installment amount.
select public.settlement_add_payment(pg_temp.id('settlement'),pg_temp.id('sale'),40,'transfer',jsonb_build_array(jsonb_build_object('installment_id',pg_temp.id('installment'),'amount_applied',40)));
select is((select commission_amount from public.settlement_totals(pg_temp.id('settlement'))),40::numeric,'commission covers cash and transfer applications');
select is((select commission_paid_amount from public.settlement_totals(pg_temp.id('settlement'))),24::numeric,'cash commission retained');
select is((select net_to_firefighters from public.settlement_totals(pg_temp.id('settlement'))),76::numeric,'net excludes only cash-retained commission');
select lives_ok($$select public.settlement_close(pg_temp.id('settlement'))$$,'close posts ledger entries');
select throws_ok($$select public.settlement_close(pg_temp.id('settlement'))$$,'55000','settlement must be open','second close fails by state');
reset role;
select is((select count(*)::int from public.collector_ledger_entries where settlement_id=pg_temp.id('settlement') and entry_type='commission_generated'),1,'generated entry posted');
select is((select count(*)::int from public.collector_ledger_entries where settlement_id=pg_temp.id('settlement')),2,'second close does not duplicate any ledger postings');
select is((select count(*)::int from public.collector_ledger_entries where settlement_id=pg_temp.id('settlement') and entry_type='commission_settled'),1,'cash settled entry posted');
select is((select sum(case when direction='collector_credit' then amount else -amount end) from public.collector_ledger_entries where collector_id=pg_temp.id('collector')),16::numeric,'transfer commission remains in balance');

set local role authenticated;
select throws_ok($$select public.commission_settle('00000000-0000-4000-8000-000000000068',pg_temp.id('collector'),1,'missing campaign')$$,'P0002','campaign 00000000-0000-4000-8000-000000000068 not found','missing campaign is explicitly not found');
select throws_ok($$select public.commission_settle(pg_temp.id('campaign'),'00000000-0000-4000-8000-000000000068',1,'missing collector')$$,'P0002','collector 00000000-0000-4000-8000-000000000068 not found','missing collector remains explicitly not found');
select throws_ok($$select public.commission_settle(pg_temp.id('campaign'),pg_temp.id('collector'),17,'too much')$$,'22023','amount cannot exceed current collector balance','cannot settle over balance');
reset role;
insert into public.collector_ledger_entries(campaign_id,collector_id,entry_type,direction,amount,created_by)
  values(pg_temp.id('campaign'),pg_temp.id('collector'),'commission_generated','collector_credit',5,'b6310000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$select public.commission_settle(pg_temp.id('campaign'),pg_temp.id('collector'),21,'manual payout','req-631')$$,'settles available balance');
reset role;
select is((select count(*)::int from public.audit_log where action='commission.settle' and request_id='req-631'),1,'commission settlement is audited');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a6310000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.commission_settle(pg_temp.id('campaign'),pg_temp.id('collector'),1,'no')$$,'42501',null,'commission settlement requires permission');
select throws_ok($$select public.collector_ledger_balance(pg_temp.id('campaign'),pg_temp.id('collector'))$$,'42501',null,'other user cannot read ledger balance');
select set_config('request.jwt.claims','{"sub":"a6310000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is(public.collector_ledger_balance(pg_temp.id('campaign'),pg_temp.id('collector')),0::numeric,'collector reads own balance');
select throws_ok($$select public.collector_ledger_balance(pg_temp.id('campaign'),pg_temp.id('other_collector'))$$,'42501',null,'collector cannot read another balance');
reset role;
select * from finish();
rollback;
