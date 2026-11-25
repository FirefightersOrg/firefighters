-- SAN-152: the extraordinary draw uses each bond's own base and associated numbers.
begin;
select plan(9);
insert into auth.users(id,email) values('a6690000-0000-0000-0000-000000000001','san152@example.com');
insert into public.profiles(id,auth_user_id,full_name,email,status)
values('b6690000-0000-0000-0000-000000000001','a6690000-0000-0000-0000-000000000001','SAN152','san152@example.com','active');
insert into public.user_roles(user_id,role_id)
select 'b6690000-0000-0000-0000-000000000001',id from public.roles where name='admin';
create temp table ids(k text primary key,id uuid not null);
create function pg_temp.id(k text) returns uuid language sql stable as $$select id from ids where k=$1$$;
grant execute on function pg_temp.id(text) to authenticated;
grant select,insert on ids to authenticated;
insert into ids select k,gen_random_uuid() from unnest(array['c','collector','buyer','set','draw','draw2'])k;
-- Tiny range 0..19 so the whole campaign can be assigned.
insert into public.campaigns(id,name,simple_bond_value,installment_count,installment_value,barcode_mode,max_number,associated_number_offset)
values(pg_temp.id('c'),'SAN152',100,1,100,'base_number',19,10);
insert into public.collectors(id,display_name) values(pg_temp.id('collector'),'SAN152');
insert into public.buyers(id,type,first_name,document_number) values(pg_temp.id('buyer'),'individual','SAN152','152');
insert into public.settlements(id,campaign_id,collector_id,settlement_number,created_by)
values(pg_temp.id('set'),pg_temp.id('c'),pg_temp.id('collector'),1,'b6690000-0000-0000-0000-000000000001');
-- Bond 1: simple, paid. Bond 2: pata of 2, paid. Bond 3: simple, unpaid. Together they fill 0..19.
create function pg_temp.fixture(n int, paid boolean) returns void language plpgsql as $$
declare b uuid; s uuid; pp uuid; pay uuid; i uuid; units int := case when n=2 then 2 else 1 end;
  base_first int := case n when 1 then 0 when 2 then 1 else 3 end;
begin
  insert into public.bonds(campaign_id,kind,origin,commercial_unit_count,total_value)
  values(pg_temp.id('c'),case when n=2 then 'pata' else 'simple' end,'printed',units,100*units) returning id into b;
  insert into ids values('bond'||n,b);
  insert into public.bond_numbers(campaign_id,bond_id,number_value,number_kind)
  select pg_temp.id('c'),b,base_first+j,'base' from generate_series(0,units-1)j;
  insert into public.bond_numbers(campaign_id,bond_id,number_value,number_kind,source_base_number_id)
  select pg_temp.id('c'),b,number_value+10,'associated',id from public.bond_numbers where bond_id=b and number_kind='base';
  update public.bonds set commercial_status='delivered_to_collector',current_collector_id=pg_temp.id('collector') where id=b;
  update public.bonds set commercial_status='sold',current_buyer_id=pg_temp.id('buyer') where id=b;
  insert into public.sales(campaign_id,bond_id,buyer_id,collector_id,payment_mode,total_amount,created_by)
  values(pg_temp.id('c'),b,pg_temp.id('buyer'),pg_temp.id('collector'),'installments',100*units,'b6690000-0000-0000-0000-000000000001') returning id into s;
  insert into public.payment_plans(sale_id,installment_count,total_amount) values(s,1,100*units) returning id into pp;
  insert into public.installments(payment_plan_id,installment_number,due_date,amount)
  values(pp,1,(now() at time zone 'America/Argentina/Buenos_Aires')::date,100*units) returning id into i;
  if not paid then return; end if;
  insert into public.payments(campaign_id,sale_id,collector_id,buyer_id,settlement_id,amount,payment_method,payment_date,status,created_by)
  values(pg_temp.id('c'),s,pg_temp.id('collector'),pg_temp.id('buyer'),pg_temp.id('set'),100*units,'cash',
    (now() at time zone 'America/Argentina/Buenos_Aires')::date-1,'pending_in_settlement','b6690000-0000-0000-0000-000000000001') returning id into pay;
  insert into public.payment_installments(payment_id,installment_id,amount_applied) values(pay,i,100*units);
  update public.payments set status='confirmed' where id=pay;
end $$;
select pg_temp.fixture(1,true);
select pg_temp.fixture(2,true);
select pg_temp.fixture(3,false);
-- Fill the rest of the range with fixture-only legacy extraordinary rows: no free number remains.
insert into public.bond_numbers(campaign_id,bond_id,number_value,number_kind)
select pg_temp.id('c'),pg_temp.id('bond3'),v,'extraordinary'
from generate_series(0,19)v where not exists (
  select 1 from public.bond_numbers where campaign_id=pg_temp.id('c') and number_value=v and released_at is null);
select is((select count(*)::int from public.bond_numbers where campaign_id=pg_temp.id('c') and released_at is null),20,'campaign fully assigned');
create temp table extras_before as select count(*)::int as n from public.bond_numbers
where campaign_id=pg_temp.id('c') and number_kind='extraordinary';
insert into public.draws(id,campaign_id,draw_type,name,draw_date,payment_cutoff_at,created_by)
select pg_temp.id(k),pg_temp.id('c'),'extraordinary_full_payment',k,
  (now() at time zone 'America/Argentina/Buenos_Aires')::date,now(),'b6690000-0000-0000-0000-000000000001'
from unnest(array['draw','draw2'])k;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a6690000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.draw_generate_roster(pg_temp.id('draw'),'069-generate')$$,'full campaign generates an extraordinary roster');
reset role;
select is((select count(*)::int from public.bond_numbers where campaign_id=pg_temp.id('c') and number_kind='extraordinary'),(select n from extras_before),'generation creates no extra numbers');
select results_eq($$select e.bond_id,array_agg(e.number_value order by e.number_value) from public.draw_roster_entries e
  join public.draw_rosters r on r.id=e.draw_roster_id where r.draw_id=pg_temp.id('draw') and e.eligible group by e.bond_id order by min(e.number_value)$$,
$$select * from (values(pg_temp.id('bond1'),array[0,10]),(pg_temp.id('bond2'),array[1,2,11,12]))v$$,'simple bond and pata of 2 participate with exactly their own numbers');
select is((select count(*)::int from public.draw_roster_entries e join public.draw_rosters r on r.id=e.draw_roster_id
  where r.draw_id=pg_temp.id('draw') and e.bond_id=pg_temp.id('bond3') and not e.eligible and e.ineligibility_reason='not_fully_paid'),
  2,'ineligible bond is listed as not eligible, with its own base and associated only');
select is((select count(*)::int from public.draw_roster_entries e join public.draw_rosters r on r.id=e.draw_roster_id
  where r.draw_id=pg_temp.id('draw') and e.eligible),6,'only eligible own numbers participate');
select is((select count(*)::int from public.draw_roster_entries e join public.draw_rosters r on r.id=e.draw_roster_id
  where r.draw_id=pg_temp.id('draw')),8,'roster holds only the bonds own numbers, never legacy extras');
select is((select count(*)::int from public.audit_log where request_id='069-generate' and action='draw.generate_roster'),1,'one audit event');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a6690000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.draw_generate_roster(pg_temp.id('draw2'),'069-generate2')$$,'a second extraordinary draw also generates');
select * from finish();
rollback;
