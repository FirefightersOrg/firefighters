begin;
select plan(22);

insert into auth.users(id,email) values
('a6430000-0000-0000-0000-000000000001','san83-admin@example.com'),
('a6430000-0000-0000-0000-000000000002','san83-operator@example.com'),
('a6430000-0000-0000-0000-000000000003','san83-reader@example.com');
insert into public.profiles(id,auth_user_id,full_name,email,status) values
('b6430000-0000-0000-0000-000000000001','a6430000-0000-0000-0000-000000000001','Certificate Admin','san83-admin@example.com','active'),
('b6430000-0000-0000-0000-000000000002','a6430000-0000-0000-0000-000000000002','Certificate Operator','san83-operator@example.com','active'),
('b6430000-0000-0000-0000-000000000003','a6430000-0000-0000-0000-000000000003','Certificate Reader','san83-reader@example.com','active');
insert into public.user_roles(user_id,role_id)
select v.id,r.id from (values
('b6430000-0000-0000-0000-000000000001'::uuid,'admin'),
('b6430000-0000-0000-0000-000000000002'::uuid,'operator'),
('b6430000-0000-0000-0000-000000000003'::uuid,'read-only')) v(id,name)
join public.roles r on r.name=v.name;

create temp table ids(k text primary key,id uuid not null);
insert into ids select k,gen_random_uuid() from unnest(array[
  'campaign','draw','roster','bond1','bond2','number1','number2','entry1','entry2',
  'buyer','collector','delivered','manual','automatic'
]) k;
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where ids.k=$1$$;
create function pg_temp.act(n int) returns void language sql as $$
select set_config('request.jwt.claims',format('{"sub":"a6430000-0000-0000-0000-00000000000%s","role":"authenticated"}',n),true)$$;
grant execute on function pg_temp.id(text),pg_temp.act(int) to authenticated;
grant select,update on ids to authenticated;

insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode,max_number,associated_number_offset)
values(pg_temp.id('campaign'),'SAN83',100,2,50,'base_number',9999,100);
insert into public.buyers(id,type,first_name,last_name)
values(pg_temp.id('buyer'),'individual','Frozen','Buyer');
insert into public.collectors(id,display_name) values(pg_temp.id('collector'),'Frozen Collector');
insert into public.bonds(id,campaign_id,kind,origin,commercial_unit_count,total_value,commercial_status,internal_code)
select pg_temp.id(k),pg_temp.id('campaign'),'simple','printed',1,100,'available','CERT-'||n
from (values('bond1',1),('bond2',2)) v(k,n);
insert into public.bond_numbers(id,campaign_id,bond_id,number_value,number_kind)
values
(pg_temp.id('number1'),pg_temp.id('campaign'),pg_temp.id('bond1'),7,'base'),
(pg_temp.id('number2'),pg_temp.id('campaign'),pg_temp.id('bond2'),8,'base');
insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,created_by)
values(pg_temp.id('draw'),pg_temp.id('campaign'),'final','Certificate draw',
  (now() at time zone 'America/Argentina/Buenos_Aires')::date,now(),
  'b6430000-0000-0000-0000-000000000001');
insert into public.draw_rosters(id,draw_id,generated_by,created_by)
values(pg_temp.id('roster'),pg_temp.id('draw'),
  'b6430000-0000-0000-0000-000000000001','b6430000-0000-0000-0000-000000000001');
insert into public.draw_roster_entries(id,draw_roster_id,bond_id,bond_number_id,number_value,
  buyer_snapshot,collector_snapshot,eligible,ineligibility_reason,created_by)
values
(pg_temp.id('entry1'),pg_temp.id('roster'),pg_temp.id('bond1'),pg_temp.id('number1'),7,
 '{"id":"00000000-0000-0000-0000-000000000001","business_name":"Frozen Business"}',
 '{"id":"00000000-0000-0000-0000-000000000002","display_name":"Frozen Collector"}',
 true,null,'b6430000-0000-0000-0000-000000000001'),
(pg_temp.id('entry2'),pg_temp.id('roster'),pg_temp.id('bond2'),pg_temp.id('number2'),8,
 '{"id":"00000000-0000-0000-0000-000000000001","first_name":"Frozen","last_name":"Buyer"}',
 '{"id":"00000000-0000-0000-0000-000000000002","display_name":"Frozen Collector"}',
 false,'not_fully_paid','b6430000-0000-0000-0000-000000000001');
-- Awards require the snapshot ids to reference the real frozen parties.
update public.draw_roster_entries set
  buyer_snapshot=jsonb_set(buyer_snapshot,'{id}',to_jsonb(pg_temp.id('buyer')::text)),
  collector_snapshot=jsonb_set(collector_snapshot,'{id}',to_jsonb(pg_temp.id('collector')::text));
update public.draws set status='roster_generated' where id=pg_temp.id('draw');
update public.draw_rosters set status='frozen',frozen_at=now(),
  frozen_by='b6430000-0000-0000-0000-000000000001' where id=pg_temp.id('roster');
update public.draws set status='roster_frozen' where id=pg_temp.id('draw');

select pg_temp.act(1);
set local role authenticated;
select public.prize_create(pg_temp.id('draw'),'Delivered',null,1,true,'043-delivered-create') as p \gset
update ids set id=:'p' where k='delivered';
select public.draw_load_winning_number(pg_temp.id('delivered'),7,'Delivery winner note','043-delivered-load');
select public.prize_resolve(pg_temp.id('delivered'),'award','Awarded','043-delivered-resolve');
select lives_ok($$select public.prize_deliver(pg_temp.id('delivered'),'Handed to winner','043-delivered')$$,'delivered fixture');
select public.prize_create(pg_temp.id('draw'),'Manual',null,2,true,'043-manual-create') as p \gset
update ids set id=:'p' where k='manual';
select public.draw_load_winning_number(pg_temp.id('manual'),7,'Manual winner note','043-manual-load');
select lives_ok($$select public.prize_resolve(pg_temp.id('manual'),'unaward','Winner declined','043-manual')$$,'manual fixture');
select public.prize_create(pg_temp.id('draw'),'Automatic',null,3,true,'043-auto-create') as p \gset
update ids set id=:'p' where k='automatic';
select lives_ok($$select public.draw_load_winning_number(pg_temp.id('automatic'),8,'Coverage note','043-auto')$$,'automatic fixture');
reset role;
create temp table denial_snapshot as
select
  (select jsonb_agg(to_jsonb(p) order by p.id) from public.prizes p
    where p.id in (pg_temp.id('delivered'),pg_temp.id('manual'),pg_temp.id('automatic'))) prizes,
  (select count(*) from public.audit_log where request_id like '043-%') audits;

select pg_temp.act(2);
set local role authenticated;
select ok((public.prize_certificate_data(pg_temp.id('delivered')) ?&
  array['campaign_id','draw_id','draw_name','draw_type','draw_date','prize_id','prize_name',
  'prize_position','prize_status','winning_number','winner_status','winner_notes','roster_eligible',
  'ineligibility_reason','buyer_snapshot','collector_snapshot','bond_id','bond_label','award_status',
  'delivered_at','delivery_notes','delivered_by_name','unawarded_by_name','unawarded_at','resolution_notes']),
  'delivered result has all expected keys');
select is(public.prize_certificate_data(pg_temp.id('delivered'))->>'prize_status','delivered','delivered status');
select is(public.prize_certificate_data(pg_temp.id('delivered'))->>'delivered_by_name','Certificate Admin','delivery actor name');
select ok((public.prize_certificate_data(pg_temp.id('manual')) ?& array['unawarded_by_name','unawarded_at','resolution_notes','winner_notes']),
  'manual result has unaward keys');
select is(public.prize_certificate_data(pg_temp.id('manual'))->>'resolution_notes','Winner declined','manual resolution notes');
select is(public.prize_certificate_data(pg_temp.id('manual'))->>'unawarded_by_name','Certificate Admin','manual actor');
select ok((public.prize_certificate_data(pg_temp.id('automatic')) ?& array['unawarded_by_name','unawarded_at','resolution_notes','winner_notes']),
  'automatic result has unaward keys');
select is(public.prize_certificate_data(pg_temp.id('automatic'))->>'winner_status','not_eligible','automatic result status');
select is(public.prize_certificate_data(pg_temp.id('automatic'))->>'unawarded_by_name','Certificate Admin','automatic actor');
select throws_ok($$select public.prize_certificate_data(gen_random_uuid())$$,'P0002','prize not found','missing prize');
select is((select count(*) from public.profiles where id='b6430000-0000-0000-0000-000000000001'),0::bigint,
  'RPC grants no direct access to another profile');
select is((select count(*) from public.audit_log where request_id like '043-%'),0::bigint,
  'RPC grants no direct audit access');
reset role;

select pg_temp.act(3);
set local role authenticated;
select throws_ok(format('select public.prize_certificate_data(%L)',pg_temp.id('delivered')),
  '42501','prize certificate permission required','unauthorized role denied');
reset role;
select is(
  (select jsonb_agg(to_jsonb(p) order by p.id) from public.prizes p
    where p.id in (pg_temp.id('delivered'),pg_temp.id('manual'),pg_temp.id('automatic'))),
  (select prizes from denial_snapshot),'denial preserves prize state');
select is((select count(*) from public.audit_log where request_id like '043-%'),
  (select audits from denial_snapshot),'denial writes no audit row');
select ok(has_function_privilege('authenticated','public.prize_certificate_data(uuid)','EXECUTE'),
  'authenticated has explicit execute');
select ok(not has_function_privilege('anon','public.prize_certificate_data(uuid)','EXECUTE'),'anon denied execute');
select ok(not has_function_privilege('service_role','public.prize_certificate_data(uuid)','EXECUTE'),'service role denied execute');
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
  where p.oid='public.prize_certificate_data(uuid)'::regprocedure and a.grantee=0
    and a.privilege_type='EXECUTE'),'PUBLIC has no execute');
select * from finish();
rollback;
