-- SAN-117/SAN-152: legacy extra-number release on annulment; new rosters use the bond's own numbers.
begin;
select plan(30);
insert into auth.users(id,email) values
('a6470000-0000-0000-0000-000000000001','san117-admin@example.com'),
('a6470000-0000-0000-0000-000000000002','san117-reader@example.com');
insert into public.profiles(id,auth_user_id,full_name,email,status)
select ('b6470000-0000-0000-0000-00000000000'||n)::uuid,
('a6470000-0000-0000-0000-00000000000'||n)::uuid,'SAN117 '||n,'san117-'||n||'@example.com','active'
from generate_series(1,2)n;
insert into public.user_roles(user_id,role_id)
select ('b6470000-0000-0000-0000-00000000000'||n)::uuid,r.id
from (values(1,'admin'),(2,'read-only'))v(n,name) join public.roles r on r.name=v.name;
create function pg_temp.act_as(n int) returns void language sql as $$
select set_config('request.jwt.claims',format('{"sub":"a6470000-0000-0000-0000-00000000000%s","role":"authenticated"}',n),true)$$;
create function pg_temp.did(n int) returns uuid language sql immutable as $$
select ('d6470000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.act_as(int),pg_temp.did(int) to authenticated;
insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode,starts_at,ends_at)
values('c6470000-0000-0000-0000-000000000001','SAN117',100,1,100,'base_number',now(),now()+interval '1 day');
update public.campaigns set status='active' where id='c6470000-0000-0000-0000-000000000001';
insert into public.collectors(id,display_name) values('e6470000-0000-0000-0000-000000000001','SAN117');
insert into public.buyers(id,type,first_name,document_number)
values('f6470000-0000-0000-0000-000000000001','individual','SAN117','SAN117');
-- Use audited commercial/financial RPCs to build a genuinely paid source bond.
set local role authenticated;
select pg_temp.act_as(1);
create temp table fixture(k text primary key,id uuid);
insert into fixture values('bond',public.bond_create(
p_campaign_id=>'c6470000-0000-0000-0000-000000000001',p_base_numbers=>array[100],p_request_id=>'047-bond'));
select public.bond_deliver('c6470000-0000-0000-0000-000000000001','e6470000-0000-0000-0000-000000000001',
array[(select id from fixture where k='bond')],null,'047-deliver');
insert into fixture values('sale',public.sale_register('c6470000-0000-0000-0000-000000000001',
(select id from fixture where k='bond'),'f6470000-0000-0000-0000-000000000001','full_payment',
(now() at time zone 'America/Argentina/Buenos_Aires')::date,'047-sale'));
insert into fixture values('settlement',public.settlement_open('c6470000-0000-0000-0000-000000000001',
'e6470000-0000-0000-0000-000000000001',null,'047-open'));
select public.settlement_add_payment((select id from fixture where k='settlement'),(select id from fixture where k='sale'),
100,'cash',
(select jsonb_agg(jsonb_build_object('installment_id',i.id,'amount_applied',i.amount))
from public.installments i join public.payment_plans pp on pp.id=i.payment_plan_id
where pp.sale_id=(select id from fixture where k='sale')),
(now() at time zone 'America/Argentina/Buenos_Aires')::date,'047-payment');
select public.settlement_close((select id from fixture where k='settlement'),'047-close');
reset role;
insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,required_installment_number,created_by)
select pg_temp.did(n),'c6470000-0000-0000-0000-000000000001',
case when n=4 then 'monthly' else 'extraordinary_full_payment' end,'SAN117 '||n,
(now() at time zone 'America/Argentina/Buenos_Aires')::date,now(),1,'b6470000-0000-0000-0000-000000000001'
from generate_series(1,4)n;
set local role authenticated;
select pg_temp.act_as(1);
select public.draw_generate_roster(pg_temp.did(n),'047-initial-'||n) from generate_series(1,3)n;
reset role;
-- SAN-152: new rosters carry only the bond's own numbers, no extras.
select is((select count(*)::int from public.bond_numbers where campaign_id='c6470000-0000-0000-0000-000000000001'
  and number_kind='extraordinary'),0,'new extraordinary rosters allocate no extras');
select results_eq($$select e.number_value from public.draw_roster_entries e join public.draw_rosters r on r.id=e.draw_roster_id
  where r.draw_id=pg_temp.did(1) order by 1$$,$$select number_value from public.bond_numbers
  where campaign_id='c6470000-0000-0000-0000-000000000001' and released_at is null order by 1$$,'roster holds exactly the bond own numbers');
-- Legacy data (SAN-117, before SAN-152): one extra number frozen in the rosters of draws 1 and 2.
insert into public.bond_numbers(campaign_id,bond_id,number_value,number_kind,source_base_number_id)
select campaign_id,bond_id,0,'extraordinary',id from public.bond_numbers
where campaign_id='c6470000-0000-0000-0000-000000000001' and number_kind='base';
insert into public.draw_roster_entries(draw_roster_id,bond_id,bond_number_id,number_value,buyer_snapshot,collector_snapshot,eligible,created_by)
select r.id,n.bond_id,n.id,n.number_value,'{}','{}',true,'b6470000-0000-0000-0000-000000000001'
from public.draw_rosters r cross join public.bond_numbers n
where r.draw_id in (pg_temp.did(1),pg_temp.did(2)) and r.status='generated' and n.number_kind='extraordinary';
create temp table original_extra as select * from public.bond_numbers
where campaign_id='c6470000-0000-0000-0000-000000000001' and number_kind='extraordinary';
create temp table original_entries as select e.* from public.draw_roster_entries e
join public.draw_rosters r on r.id=e.draw_roster_id where r.draw_id=pg_temp.did(1);
set local role authenticated;
select pg_temp.act_as(2);
select throws_ok($$select public.draw_annul(pg_temp.did(1),'Denied','047-denied')$$,'42501',null,'annul requires permission');
reset role;
select is((select count(*)::int from public.audit_log where request_id='047-denied'),0,'denial has no audit');
select is((select status from public.draws where id=pg_temp.did(1)),'roster_generated','denial preserves draw');
-- A failing audit insert must roll back both the status change and every release.
create function pg_temp.fail_audit() returns trigger language plpgsql as $$
begin
  if new.request_id='047-audit-fail' then raise exception 'fixture audit failure' using errcode='23514'; end if;
  return new;
end$$;
grant execute on function pg_temp.fail_audit() to authenticated;
create trigger san117_fail_audit before insert on public.audit_log
for each row execute function pg_temp.fail_audit();
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok($$select public.draw_annul(pg_temp.did(1),'Rollback','047-audit-fail')$$,'23514','fixture audit failure','audit failure aborts annulment');
reset role;
drop trigger san117_fail_audit on public.audit_log;
select is((select status from public.draws where id=pg_temp.did(1)),'roster_generated','failed audit rolls back draw');
select results_eq($$select * from public.bond_numbers where id in (select id from original_extra) order by id$$,
$$select * from original_extra order by id$$,'failed audit rolls back release');
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok($$select public.draw_annul(pg_temp.did(1),' ','047-invalid')$$,'22023',null,'blank reason refused');
select throws_ok($$select public.draw_annul(null,'Reason','047-null')$$,'22023',null,'null id refused');
select throws_ok($$select public.draw_annul(gen_random_uuid(),'Reason','047-missing')$$,'P0002',null,'missing draw');
-- Draw 2 still references the legacy extra, so annulling draw 1 keeps it reserved.
select lives_ok($$select public.draw_annul(pg_temp.did(1),'  Cancel one  ','047-keep')$$,'annul succeeds when another roster shares the legacy extra');
reset role;
select is((select count(*)::int from public.bond_numbers where number_kind='extraordinary' and released_at is null
  and campaign_id='c6470000-0000-0000-0000-000000000001'),1,'shared legacy extra stays reserved');
select is((select new_value->'released_number_ids' from public.audit_log where request_id='047-keep'),'[]'::jsonb,'kept reservations absent from released ids');
select results_eq($$select e.* from public.draw_roster_entries e join public.draw_rosters r on r.id=e.draw_roster_id
where r.draw_id=pg_temp.did(1) order by e.id$$,$$select * from original_entries order by id$$,'annulled roster entries retained verbatim');
set local role authenticated;
select lives_ok($$select public.draw_annul(pg_temp.did(2),'  Cancel extra  ','047-release')$$,'last legacy roster annulled');
reset role;
select ok((select bool_and(released_at is not null and released_by='b6470000-0000-0000-0000-000000000001'::uuid)
from public.bond_numbers where id in (select id from original_extra)),'legacy extra released with actor');
select is((select count(*)::int from public.bond_numbers where campaign_id='c6470000-0000-0000-0000-000000000001'
and number_kind<>'extraordinary' and released_at is not null),0,'own base and associated numbers untouched');
select is((select count(*)::int from public.audit_log where request_id='047-release'),1,'one transactional audit');
select ok((select old_value->>'status'='roster_generated' and new_value->>'status'='annulled' and reason='Cancel extra'
and new_value->'released_number_ids'=(select jsonb_agg(id order by id) from original_extra)
from public.audit_log where request_id='047-release'),'audit includes exact released ids and before/after');
set local role authenticated;
select throws_ok($$select public.draw_annul(pg_temp.did(2),'Again','047-again')$$,'55000',null,'repeat annulment refused');
-- SAN-152: a draw without legacy extras annuls and releases nothing.
select lives_ok($$select public.draw_annul(pg_temp.did(3),'No extras','047-plain')$$,'new-style extraordinary draw annulled');
reset role;
select is((select new_value->'released_number_ids' from public.audit_log where request_id='047-plain'),'[]'::jsonb,'nothing released for a roster of own numbers');
select is((select count(*)::int from public.bond_numbers where campaign_id='c6470000-0000-0000-0000-000000000001'
and number_kind<>'extraordinary' and released_at is not null),0,'own numbers still reserved after annulment');
-- A new generation never reuses the released legacy extra.
update public.draws set status='scheduled' where id=pg_temp.did(4);
set local role authenticated;
select lives_ok($$select public.draw_generate_roster(pg_temp.did(4),'047-monthly')$$,'later generation succeeds');
select throws_ok($$select public.draw_annul(pg_temp.did(4),'Monthly','047-monthly-annul')$$,'55000',null,'generated ordinary draws cannot annul');
reset role;
select is((select count(*)::int from public.draw_roster_entries e join public.draw_rosters r on r.id=e.draw_roster_id
  join public.bond_numbers n on n.id=e.bond_number_id where r.draw_id=pg_temp.did(4) and n.number_kind='extraordinary'),0,'monthly roster excludes legacy extras');
select ok(not has_table_privilege(r,'public.draws','UPDATE'),r||' cannot annul draws directly')
from unnest(array['anon','authenticated','service_role'])r;
select * from finish();
rollback;
