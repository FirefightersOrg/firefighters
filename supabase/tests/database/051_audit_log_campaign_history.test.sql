begin;
select plan(47);
-- Simulate history written before the migration: the insert trigger is off, so the sparse rows
-- below keep campaign_id NULL. Then run the migration's backfill statement (supabase test db cannot
-- \ir files outside tests/). All changes roll back with this test.
alter table public.audit_log disable trigger audit_log_set_campaign;

insert into auth.users(id,email)
values('a6510000-0000-0000-0000-000000000001','history051@example.com');
insert into public.profiles(id,auth_user_id,full_name,email,status)
values('b6510000-0000-0000-0000-000000000001','a6510000-0000-0000-0000-000000000001',
  'History admin','history051@example.com','active');
insert into public.user_roles(user_id,role_id)
select 'b6510000-0000-0000-0000-000000000001',id from public.roles where name='admin';
create temp table ids(k text primary key,id uuid not null);
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$;
grant execute on function pg_temp.id(text) to authenticated, anon, service_role;
grant select,insert on ids to authenticated;
insert into ids select k,gen_random_uuid() from unnest(array[
  'campaign','collector','buyer','bond','bond_number','sale','settlement','payment',
  'draw','draw_roster','prize','commission_rule','import_session','delivery_note',
  'collector_ledger_entry','commission_adjustment'
])k;
insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode)
values(pg_temp.id('campaign'),'History 051',100,1,100,'base_number');
insert into public.collectors(id,display_name) values(pg_temp.id('collector'),'History collector');
insert into public.buyers(id,type,first_name) values(pg_temp.id('buyer'),'individual','History buyer');
insert into public.bonds(id,campaign_id,kind,origin,commercial_unit_count,total_value)
values(pg_temp.id('bond'),pg_temp.id('campaign'),'simple','printed',1,100);
insert into public.bond_numbers(id,campaign_id,bond_id,number_value,number_kind)
values(pg_temp.id('bond_number'),pg_temp.id('campaign'),pg_temp.id('bond'),1,'base');
insert into public.sales(id,campaign_id,bond_id,buyer_id,collector_id,payment_mode,total_amount,created_by)
values(pg_temp.id('sale'),pg_temp.id('campaign'),pg_temp.id('bond'),pg_temp.id('buyer'),
  pg_temp.id('collector'),'full_payment',100,'b6510000-0000-0000-0000-000000000001');
insert into public.settlements(id,campaign_id,collector_id,settlement_number,created_by)
values(pg_temp.id('settlement'),pg_temp.id('campaign'),pg_temp.id('collector'),1,'b6510000-0000-0000-0000-000000000001');
insert into public.payments(id,campaign_id,sale_id,collector_id,buyer_id,settlement_id,amount,payment_method,status,created_by)
values(pg_temp.id('payment'),pg_temp.id('campaign'),pg_temp.id('sale'),pg_temp.id('collector'),
  pg_temp.id('buyer'),pg_temp.id('settlement'),10,'cash','pending_in_settlement','b6510000-0000-0000-0000-000000000001');
insert into public.commission_rules(id,campaign_id,rule_type,percentage,valid_from)
values(pg_temp.id('commission_rule'),pg_temp.id('campaign'),'cash_full_payment',10,
  (now() at time zone 'America/Argentina/Buenos_Aires')::date);
insert into public.import_sessions(id,campaign_id,source_type,file_name,created_by)
values(pg_temp.id('import_session'),pg_temp.id('campaign'),'csv_file','history.csv','b6510000-0000-0000-0000-000000000001');
insert into public.delivery_notes(id,campaign_id,collector_id,note_number,reason,created_by)
values(pg_temp.id('delivery_note'),pg_temp.id('campaign'),pg_temp.id('collector'),1,'delivery',
  'b6510000-0000-0000-0000-000000000001');
insert into public.collector_ledger_entries(id,campaign_id,collector_id,entry_type,direction,amount,created_by)
values(pg_temp.id('collector_ledger_entry'),pg_temp.id('campaign'),pg_temp.id('collector'),
  'commission_generated','collector_credit',10,'b6510000-0000-0000-0000-000000000001');
insert into public.commission_adjustments(id,campaign_id,collector_id,amount,direction,reason,created_by)
values(pg_temp.id('commission_adjustment'),pg_temp.id('campaign'),pg_temp.id('collector'),
  10,'in_favor_of_collector','History fixture','b6510000-0000-0000-0000-000000000001');
insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,created_by)
values(pg_temp.id('draw'),pg_temp.id('campaign'),'final','History draw',
  (now() at time zone 'America/Argentina/Buenos_Aires')::date,now(),'b6510000-0000-0000-0000-000000000001');
insert into public.draw_rosters(id,draw_id,generated_by,created_by)
values(pg_temp.id('draw_roster'),pg_temp.id('draw'),'b6510000-0000-0000-0000-000000000001','b6510000-0000-0000-0000-000000000001');
insert into public.prizes(id,draw_id,name,position,created_by)
values(pg_temp.id('prize'),pg_temp.id('draw'),'History prize',1,'b6510000-0000-0000-0000-000000000001');
insert into public.audit_log(action,entity_type,entity_id,new_value,request_id)
select 'history.sparse',k,id::text,'{"status":"changed"}','051-backfill-'||k
from ids where k not in ('collector','buyer');
create temp table original_history as
select id,old_value,new_value,created_at from public.audit_log where request_id like '051-backfill-%';

select is((select count(*)::int from public.audit_log where request_id like '051-backfill-%' and campaign_id is not null),0,
  'pre-migration sparse history has no campaign');
-- Same statements as the migration backfill (20270107000000).
alter table public.audit_log enable trigger audit_log_set_campaign;
alter table public.audit_log disable trigger audit_log_forbid_update_delete;
update public.audit_log
set campaign_id = public.audit_log_resolve_campaign(entity_type, entity_id, old_value, new_value)
where request_id like '051-backfill-%';
alter table public.audit_log enable trigger audit_log_forbid_update_delete;

select is(a.campaign_id,pg_temp.id('campaign')::text,'backfilled sparse '||a.entity_type)
from public.audit_log a where request_id like '051-backfill-%' order by entity_type;
select results_eq(
  $$select id,old_value,new_value,created_at from public.audit_log where request_id like '051-backfill-%' order by id$$,
  $$select * from original_history order by id$$,'backfill preserves snapshots and timestamps');

insert into public.audit_log(action,entity_type,entity_id,new_value,campaign_id,request_id)
select 'history.sparse',k,id::text,'{"status":"changed"}','untrusted','051-insert-'||k
from ids where k not in ('collector','buyer');
select is(campaign_id,pg_temp.id('campaign')::text,'new sparse '||entity_type)
from public.audit_log where request_id like '051-insert-%' order by entity_type;
insert into public.audit_log(action,entity_type,entity_id,new_value,request_id)
select 'history.global',k,pg_temp.id('campaign')::text,
  jsonb_build_object('campaign_id',pg_temp.id('campaign')),'051-global-'||k
from unnest(array['user','profile','role','permission','user_role','role_permission','collector','buyer'])k;
select is(campaign_id,null::text,'global '||entity_type)
from public.audit_log where request_id like '051-global-%' order by entity_type;
insert into public.audit_log(action,entity_type,entity_id,old_value,new_value,request_id) values
('payment.annul','payment','not-a-uuid',null,
 '{"previous_value":{"payment":{"campaign_id":"snapshot-campaign"}}}','051-nested'),
('sale.create','sale','not-a-uuid','{"campaign_id":"old-campaign"}',null,'051-old');
select is((select campaign_id from public.audit_log where request_id='051-nested'),'snapshot-campaign','nested correction retained without live entity');
select is((select campaign_id from public.audit_log where request_id='051-old'),'old-campaign','old snapshot retained without live entity');
select throws_ok($$update public.audit_log set campaign_id='tampered' where request_id='051-nested'$$,
  '23001',null,'immutability re-enabled after backfill');
select throws_ok($$delete from public.audit_log where request_id='051-nested'$$,
  '23001',null,'delete remains forbidden');
select ok(to_regclass('public.audit_log_campaign_history_idx') is not null,'campaign history index exists');
create function pg_temp.history_plan() returns text language plpgsql as $$
declare v_plan json;
begin
  execute format('explain (format json) select id from public.audit_log where campaign_id=%L order by created_at desc,id desc limit 50',pg_temp.id('campaign')::text) into v_plan;
  return v_plan::text;
end $$;
-- A realistically selective campaign amid many unrelated rows, with normal planner settings.
insert into public.audit_log(action,entity_type,entity_id,request_id)
select 'history.noise','user',n::text,'051-noise' from generate_series(1,10000)n;
analyze public.audit_log;
select alike(pg_temp.history_plan(),'%audit_log_campaign_history_idx%','EXPLAIN chooses campaign history index');
set local role authenticated;
select throws_ok($$insert into public.audit_log(action,entity_type) values('forged','sale')$$,
  '42501',null,'authenticated cannot insert forged history');
select throws_ok($$select public.audit_log_resolve_campaign('sale',null,null,null)$$,
  '42501',null,'resolver is internal, not a scope-disclosure RPC');
reset role;
select is((select count(*)::int from public.audit_log where action='forged'),0,'denied writes leave no history');
select * from finish();
rollback;
