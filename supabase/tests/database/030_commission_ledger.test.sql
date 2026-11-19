-- SAN-67: commission adjustments and immutable collector ledger.
begin;
select plan(61);
insert into auth.users (id,email) select ('a6300000-0000-0000-0000-00000000000'||n)::uuid, 'ledger-'||n||'@example.com' from generate_series(1,6)n;
insert into public.profiles (id,auth_user_id,full_name,email,status)
  select ('b6300000-0000-0000-0000-00000000000'||n)::uuid, ('a6300000-0000-0000-0000-00000000000'||n)::uuid,
    'Ledger '||n, 'ledger-'||n||'@example.com','active' from generate_series(1,6)n;
insert into public.user_roles(user_id,role_id)
  select p.id,r.id from (values
    ('b6300000-0000-0000-0000-000000000001'::uuid,'admin'),
    ('b6300000-0000-0000-0000-000000000002'::uuid,'operator'),
    ('b6300000-0000-0000-0000-000000000003'::uuid,'treasurer'),
    ('b6300000-0000-0000-0000-000000000004'::uuid,'read-only'),
    ('b6300000-0000-0000-0000-000000000005'::uuid,'collector'))p(id,n)
  join public.roles r on r.name=p.n;
create function pg_temp.act_as(n int) returns void language sql as
  $$select set_config('request.jwt.claims',format('{"sub":"a6300000-0000-0000-0000-00000000000%s","role":"authenticated"}',n),true)$$;
grant execute on function pg_temp.act_as(int) to authenticated;
create temp table ids(k text primary key,id uuid not null);
grant select,insert on ids to authenticated,anon,service_role;
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$;
grant execute on function pg_temp.id(text) to authenticated,anon,service_role;
with x as (insert into public.campaigns(name,simple_bond_value,installment_count,installment_value,barcode_mode)
  values('Ledger',100,1,100,'base_number') returning id) insert into ids select 'c',id from x;
with x as (insert into public.campaigns(name,simple_bond_value,installment_count,installment_value,barcode_mode)
  values('Other',100,1,100,'base_number') returning id) insert into ids select 'other',id from x;
with x as (insert into public.collectors(display_name,user_profile_id) values('Ana','b6300000-0000-0000-0000-000000000005')
  returning id) insert into ids select 'ana',id from x;
with x as (insert into public.collectors(display_name) values('Beto') returning id) insert into ids select 'beto',id from x;
with x as (insert into public.buyers(type,first_name) values('individual','Eva') returning id) insert into ids select 'buyer',id from x;
with x as (insert into public.bonds(campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status)
  values(pg_temp.id('c'),'simple','printed',1,100,'available') returning id) insert into ids select 'bond',id from x;
with x as (insert into public.sales(campaign_id,bond_id,buyer_id,collector_id,payment_mode,total_amount,created_by)
  values(pg_temp.id('c'),pg_temp.id('bond'),pg_temp.id('buyer'),pg_temp.id('ana'),'full_payment',100,
    'b6300000-0000-0000-0000-000000000001') returning id) insert into ids select 'sale',id from x;
with x as (insert into public.settlements(campaign_id,settlement_number,collector_id,created_by)
  values(pg_temp.id('c'),1,pg_temp.id('ana'),'b6300000-0000-0000-0000-000000000001') returning id) insert into ids select 'set',id from x;
with x as (insert into public.settlements(campaign_id,settlement_number,collector_id,created_by)
  values(pg_temp.id('other'),1,pg_temp.id('ana'),'b6300000-0000-0000-0000-000000000001') returning id) insert into ids select 'other_set',id from x;
with x as (insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,amount,payment_method,created_by)
  values(pg_temp.id('c'),pg_temp.id('sale'),pg_temp.id('ana'),pg_temp.id('buyer'),10,'cash',
    'b6300000-0000-0000-0000-000000000001') returning id) insert into ids select 'pay',id from x;

select columns_are('public','commission_adjustments',array['id','campaign_id','collector_id','settlement_id','payment_id','amount','direction','reason','created_by','created_at'],'adjustment columns');
select columns_are('public','collector_ledger_entries',array['id','campaign_id','collector_id','settlement_id','payment_id','entry_type','direction','amount','status','occurred_at','created_by','created_at','reason','annulled_by','annulled_at','annul_reason'],'ledger columns');
select fk_ok('public','commission_adjustments','campaign_id','public','campaigns','id','adjustment campaign FK');
select fk_ok('public','commission_adjustments','collector_id','public','collectors','id','adjustment collector FK');
select fk_ok('public','commission_adjustments','settlement_id','public','settlements','id','adjustment settlement FK');
select fk_ok('public','commission_adjustments','payment_id','public','payments','id','adjustment payment FK');
select fk_ok('public','commission_adjustments','created_by','public','profiles','id','adjustment creator FK');
select fk_ok('public','collector_ledger_entries','campaign_id','public','campaigns','id','ledger campaign FK');
select fk_ok('public','collector_ledger_entries','collector_id','public','collectors','id','ledger collector FK');
select fk_ok('public','collector_ledger_entries','settlement_id','public','settlements','id','ledger settlement FK');
select fk_ok('public','collector_ledger_entries','payment_id','public','payments','id','ledger payment FK');
select fk_ok('public','collector_ledger_entries','created_by','public','profiles','id','ledger creator FK');
select fk_ok('public','collector_ledger_entries','annulled_by','public','profiles','id','ledger annuller FK');
select throws_ok($$insert into public.commission_adjustments(campaign_id,collector_id,amount,direction,reason,created_by) values(pg_temp.id('c'),pg_temp.id('ana'),0,'in_favor_of_collector','x','b6300000-0000-0000-0000-000000000001')$$,'23514',null,'adjustment amount positive');
select throws_ok($$insert into public.commission_adjustments(campaign_id,collector_id,amount,direction,reason,created_by) values(pg_temp.id('c'),pg_temp.id('ana'),'NaN','in_favor_of_collector','x','b6300000-0000-0000-0000-000000000001')$$,'23514',null,'adjustment NaN rejected');
select throws_ok($$insert into public.commission_adjustments(campaign_id,collector_id,amount,direction,reason,created_by) values(pg_temp.id('c'),pg_temp.id('ana'),1,'wrong','x','b6300000-0000-0000-0000-000000000001')$$,'23514',null,'adjustment direction checked');
select throws_ok($$insert into public.commission_adjustments(campaign_id,collector_id,amount,direction,reason,created_by) values(pg_temp.id('c'),pg_temp.id('ana'),1,'in_favor_of_collector',' ','b6300000-0000-0000-0000-000000000001')$$,'23514',null,'adjustment reason not blank');
select throws_ok($$insert into public.commission_adjustments(campaign_id,collector_id,amount,direction,reason,created_by) values(pg_temp.id('c'),pg_temp.id('ana'),1,'in_favor_of_collector',repeat('x',1001),'b6300000-0000-0000-0000-000000000001')$$,'23514',null,'adjustment reason length');
select throws_ok($$insert into public.collector_ledger_entries(campaign_id,collector_id,entry_type,direction,amount,created_by) values(pg_temp.id('c'),pg_temp.id('ana'),'wrong','collector_credit',1,'b6300000-0000-0000-0000-000000000001')$$,'23514',null,'ledger type checked');
select throws_ok($$insert into public.collector_ledger_entries(campaign_id,collector_id,entry_type,direction,amount,created_by) values(pg_temp.id('c'),pg_temp.id('ana'),'annulment','wrong',1,'b6300000-0000-0000-0000-000000000001')$$,'23514',null,'ledger direction checked');
select throws_ok($$insert into public.collector_ledger_entries(campaign_id,collector_id,entry_type,direction,amount,created_by) values(pg_temp.id('c'),pg_temp.id('ana'),'annulment','collector_credit','NaN','b6300000-0000-0000-0000-000000000001')$$,'23514',null,'ledger NaN rejected');
select throws_ok($$insert into public.collector_ledger_entries(campaign_id,collector_id,entry_type,direction,amount,reason,created_by) values(pg_temp.id('c'),pg_temp.id('ana'),'annulment','collector_credit',1,' ', 'b6300000-0000-0000-0000-000000000001')$$,'23514',null,'ledger reason not blank');
select throws_ok($$insert into public.collector_ledger_entries(campaign_id,collector_id,entry_type,direction,amount,reason,created_by) values(pg_temp.id('c'),pg_temp.id('ana'),'annulment','collector_credit',1,repeat('x',1001),'b6300000-0000-0000-0000-000000000001')$$,'23514',null,'ledger reason length');
select ok(to_regclass('public.commission_adjustments_campaign_idx') is not null and to_regclass('public.commission_adjustments_collector_idx') is not null and to_regclass('public.commission_adjustments_settlement_idx') is not null and to_regclass('public.commission_adjustments_payment_idx') is not null and to_regclass('public.commission_adjustments_created_by_idx') is not null,'adjustment FK indexes');
select ok(to_regclass('public.collector_ledger_entries_collector_campaign_occurred_at_idx') is not null,'ledger collector campaign occurred composite index');
select ok(to_regclass('public.collector_ledger_entries_campaign_idx') is not null and to_regclass('public.collector_ledger_entries_settlement_idx') is not null and to_regclass('public.collector_ledger_entries_payment_idx') is not null and to_regclass('public.collector_ledger_entries_created_by_idx') is not null and to_regclass('public.collector_ledger_entries_annulled_by_idx') is not null,'ledger FK indexes');
with x as (insert into public.commission_adjustments(campaign_id,collector_id,settlement_id,payment_id,amount,direction,reason,created_by) values(pg_temp.id('c'),pg_temp.id('ana'),pg_temp.id('set'),pg_temp.id('pay'),5,'in_favor_of_collector','Review','b6300000-0000-0000-0000-000000000001') returning id) insert into ids select 'adjustment',id from x;
with x as (insert into public.collector_ledger_entries(campaign_id,collector_id,settlement_id,payment_id,entry_type,direction,amount,created_by,reason) values(pg_temp.id('c'),pg_temp.id('ana'),pg_temp.id('set'),pg_temp.id('pay'),'commission_generated','collector_credit',10,'b6300000-0000-0000-0000-000000000001','Original reason') returning id) insert into ids select 'entry',id from x;
select throws_ok($$update public.commission_adjustments set amount=1 where id=pg_temp.id('adjustment')$$,'23001',null,'adjustments immutable');
select throws_ok($$update public.collector_ledger_entries set status='annulled',annulled_by='b6300000-0000-0000-0000-000000000001',annulled_at=now(),annul_reason='Correction',reason='Replacement' where id=pg_temp.id('entry')$$,'23001',null,'annulment cannot overwrite original reason');
select throws_ok($$update public.collector_ledger_entries set status='annulled',annulled_by='b6300000-0000-0000-0000-000000000001',annulled_at=now() where id=pg_temp.id('entry')$$,'23514',null,'annulment requires separate reason');
select throws_ok($$update public.collector_ledger_entries set status='annulled',annulled_by='b6300000-0000-0000-0000-000000000001',annulled_at=now(),annul_reason=' ' where id=pg_temp.id('entry')$$,'23514',null,'annul reason cannot be blank');
select throws_ok($$update public.collector_ledger_entries set status='annulled',annulled_by='b6300000-0000-0000-0000-000000000001',annulled_at=now(),annul_reason=' Correction ' where id=pg_temp.id('entry')$$,'23514',null,'annul reason must be trimmed');
select throws_ok($$update public.collector_ledger_entries set status='annulled',annulled_by='b6300000-0000-0000-0000-000000000001',annulled_at=now(),annul_reason=repeat('x',1001) where id=pg_temp.id('entry')$$,'23514',null,'annul reason length bounded');
select lives_ok($$update public.collector_ledger_entries set status='annulled',annulled_by='b6300000-0000-0000-0000-000000000001',annulled_at=now(),annul_reason='Correction' where id=pg_temp.id('entry')$$,'recorded ledger entry annuls');
select is((select reason from public.collector_ledger_entries where id=pg_temp.id('entry')),'Original reason','annulment preserves original reason');
select is((select annul_reason from public.collector_ledger_entries where id=pg_temp.id('entry')),'Correction','annulment stores separate reason');
select throws_ok($$update public.collector_ledger_entries set annul_reason='Rewritten' where id=pg_temp.id('entry')$$,'23514',null,'annul reason cannot change after annulment');
select throws_ok($$update public.collector_ledger_entries set amount=1 where id=pg_temp.id('entry')$$,'23001',null,'ledger amount immutable');
select throws_ok($$update public.collector_ledger_entries set status='compensated' where id=pg_temp.id('entry')$$,'23514',null,'annulled ledger entry is final');
select throws_ok($$delete from public.collector_ledger_entries where id=pg_temp.id('entry')$$,'23001',null,'ledger entries never delete');
select throws_ok($$truncate public.commission_adjustments,public.collector_ledger_entries$$,'23001',null,'ledger tables cannot truncate');
select ok(has_table_privilege('authenticated','public.commission_adjustments','select') and not has_table_privilege('authenticated','public.commission_adjustments','insert') and has_table_privilege('authenticated','public.collector_ledger_entries','select') and not has_table_privilege('authenticated','public.collector_ledger_entries','update'),'authenticated selects only');
select ok(not has_table_privilege('anon','public.collector_ledger_entries','select') and not has_table_privilege('service_role','public.collector_ledger_entries','delete') and not has_table_privilege('service_role','public.commission_adjustments','insert'),'anon and service role have no DML');
select ok(not has_function_privilege('authenticated','public.collector_ledger_entries_guard_update()','execute') and has_function_privilege('authenticated','public.collector_ledger_can_read()','execute'),'ledger function privileges');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.commission_adjustments'::regclass,'public.collector_ledger_entries'::regclass)),'ledger RLS enabled');
set local role authenticated;
select pg_temp.act_as(1); select is((select count(*)::int from public.commission_adjustments),1,'admin reads adjustments');
select pg_temp.act_as(2); select is((select count(*)::int from public.collector_ledger_entries),0,'operator cannot read ledger');
select pg_temp.act_as(3); select is((select count(*)::int from public.commission_adjustments),1,'treasurer reads adjustments');
select pg_temp.act_as(3); select is((select count(*)::int from public.collector_ledger_entries),1,'treasurer reads ledger');
select pg_temp.act_as(4); select is((select count(*)::int from public.commission_adjustments),1,'read-only reads commissions');
select pg_temp.act_as(4); select is((select count(*)::int from public.collector_ledger_entries),0,'read-only cannot read ledger');
select pg_temp.act_as(5); select is((select count(*)::int from public.collector_ledger_entries),1,'collector reads only own ledger rows');
select pg_temp.act_as(6); select is((select count(*)::int from public.collector_ledger_entries),0,'unassigned profile cannot read ledger');
reset role;
select throws_ok($$insert into public.commission_adjustments(campaign_id,collector_id,settlement_id,amount,direction,reason,created_by) values(pg_temp.id('c'),pg_temp.id('ana'),pg_temp.id('other_set'),1,'in_favor_of_collector','Mismatch','b6300000-0000-0000-0000-000000000001')$$,'23514',null,'cross-campaign settlement rejected');
select throws_ok($$insert into public.collector_ledger_entries(campaign_id,collector_id,payment_id,entry_type,direction,amount,created_by) values(pg_temp.id('c'),pg_temp.id('beto'),pg_temp.id('pay'),'cash_settled','collector_debit',1,'b6300000-0000-0000-0000-000000000001')$$,'23514',null,'cross-collector payment rejected');
select throws_ok($$insert into public.collector_ledger_entries(campaign_id,collector_id,entry_type,direction,amount,created_by,annul_reason) values(pg_temp.id('c'),pg_temp.id('ana'),'commission_generated','collector_credit',1,'b6300000-0000-0000-0000-000000000001','Premature')$$,'23514',null,'recorded inserts cannot have annul reason');
with x as (insert into public.collector_ledger_entries(campaign_id,collector_id,entry_type,direction,amount,created_by) values(pg_temp.id('c'),pg_temp.id('ana'),'commission_generated','collector_credit',1,'b6300000-0000-0000-0000-000000000001') returning id) insert into ids select 'nullable',id from x;
select throws_ok($$update public.collector_ledger_entries set status='compensated',reason='Changed' where id=pg_temp.id('nullable')$$,'23001',null,'compensation preserves original reason');
select throws_ok($$update public.collector_ledger_entries set status='compensated',annul_reason='Invalid' where id=pg_temp.id('nullable')$$,'23514',null,'compensated entries cannot have annul reason');
select lives_ok($$update public.collector_ledger_entries set status='annulled',annulled_by='b6300000-0000-0000-0000-000000000001',annulled_at=now(),annul_reason=repeat('x',1000) where id=pg_temp.id('nullable')$$,'entry without original reason can annul with maximum length reason');
select is((select reason from public.collector_ledger_entries where id=pg_temp.id('nullable')),null::text,'null original reason stays null');
with x as (insert into public.collector_ledger_entries(campaign_id,collector_id,entry_type,direction,amount,created_by) values(pg_temp.id('c'),pg_temp.id('ana'),'commission_generated','collector_credit',1,'b6300000-0000-0000-0000-000000000001') returning id) insert into ids select 'compensate',id from x;
select lives_ok($$update public.collector_ledger_entries set status='compensated' where id=pg_temp.id('compensate')$$,'recorded entry can still compensate without annul metadata');
select throws_ok($$update public.collector_ledger_entries set status='annulled',annul_reason='Invalid',annulled_at=now(),annulled_by='b6300000-0000-0000-0000-000000000001' where id=pg_temp.id('compensate')$$,'23514',null,'compensated entry is final');
select * from finish();
rollback;
