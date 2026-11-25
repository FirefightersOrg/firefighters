-- SAN-59: sale_register creates complete, auditable payment schedules.
begin;
select plan(35);

insert into auth.users (id, email)
select ('a6220000-0000-0000-0000-00000000000' || n)::uuid, 'register-' || n || '@example.com'
from generate_series(1, 5) n;
insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b6220000-0000-0000-0000-00000000000' || n)::uuid,
  ('a6220000-0000-0000-0000-00000000000' || n)::uuid, 'Register ' || n,
  'register-' || n || '@example.com', case when n = 5 then 'inactive' else 'active' end
from generate_series(1, 5) n;
insert into public.user_roles (user_id, role_id)
select v.id::uuid, r.id from (values
  ('b6220000-0000-0000-0000-000000000001', 'admin'),
  ('b6220000-0000-0000-0000-000000000002', 'operator'),
  ('b6220000-0000-0000-0000-000000000003', 'treasurer'),
  ('b6220000-0000-0000-0000-000000000004', 'read-only'),
  ('b6220000-0000-0000-0000-000000000005', 'operator')
) v(id, role_name) join public.roles r on r.name = v.role_name;
create function pg_temp.act_as(n int) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"a6220000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true)
$$;
grant execute on function pg_temp.act_as(int) to authenticated;
create temporary table ids (k text primary key, id uuid not null);
grant select, insert on ids to authenticated;
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where ids.k = $1 $$;
grant execute on function pg_temp.id(text) to authenticated;

with c as (
  insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('Register active', 60000, 10, 6000, 'base_number') returning id
) insert into ids select 'campaign', id from c;
update public.campaigns set status = 'active', starts_at = current_date - 1, ends_at = current_date + 365
where id = pg_temp.id('campaign');
with c as (
  insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('Register draft', 60000, 10, 6000, 'base_number') returning id
) insert into ids select 'draft', id from c;
with c as (
  insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('Register other', 60000, 10, 6000, 'base_number') returning id
) insert into ids select 'other', id from c;
update public.campaigns set status = 'active', starts_at = current_date - 1, ends_at = current_date + 365
where id = pg_temp.id('other');
with c as (insert into public.collectors (display_name) values ('Sale collector') returning id)
insert into ids select 'collector', id from c;
with b as (insert into public.buyers (type, first_name, last_name) values ('individual', 'Buyer', 'Sale') returning id)
insert into ids select 'buyer', id from b;

-- Start bonds as available, then deliver them through the supported API.
with b as (
  insert into public.bonds (campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
  select pg_temp.id('campaign'), 'simple', 'printed', 1, 60000, 'available' from generate_series(1, 9)
  returning id
) insert into ids select 'b' || row_number() over (order by id), id from b;
with b as (
  insert into public.bonds (campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
  values (pg_temp.id('draft'), 'simple', 'printed', 1, 60000, 'available') returning id
) insert into ids select 'draft-bond', id from b;
with b as (
  insert into public.bonds (campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
  values (pg_temp.id('other'), 'simple', 'printed', 1, 60000, 'available') returning id
) insert into ids select 'other-bond', id from b;

set local role authenticated;
select pg_temp.act_as(1);
select lives_ok($$select public.bond_deliver(pg_temp.id('campaign'), pg_temp.id('collector'),
  array[pg_temp.id('b1'), pg_temp.id('b2'), pg_temp.id('b3'), pg_temp.id('b4'), pg_temp.id('b5'), pg_temp.id('b6'), pg_temp.id('b7')])$$,
  'admin delivers sale candidates');
select lives_ok($$select public.bond_deliver(pg_temp.id('other'), pg_temp.id('collector'), array[pg_temp.id('other-bond')])$$,
  'admin delivers the other-campaign bond');
with b as (select public.bond_create(pg_temp.id('campaign'), array[101]) id) insert into ids select 'member-1', id from b;
with b as (select public.bond_create(pg_temp.id('campaign'), array[102]) id) insert into ids select 'member-2', id from b;
with b as (select public.bond_group_into_pata(pg_temp.id('campaign'), array[pg_temp.id('member-1'), pg_temp.id('member-2')]) id)
insert into ids select 'pata', id from b;
select lives_ok($$select public.bond_deliver(pg_temp.id('campaign'), pg_temp.id('collector'), array[pg_temp.id('pata')])$$,
  'manual pata is delivered whole');

-- Put representative unavailable bonds in their terminal/current states.
reset role;
update public.bonds set commercial_status = 'lost', current_collector_id = null where id = pg_temp.id('b3');
update public.bonds set commercial_status = 'sold', current_buyer_id = pg_temp.id('buyer') where id = pg_temp.id('b4');
update public.bonds set commercial_status = 'annulled', annulled_at = now(), annulled_by = 'b6220000-0000-0000-0000-000000000001',
  annul_reason = 'test' where id = pg_temp.id('b8');

set local role authenticated;
select pg_temp.act_as(2);
with s as (select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b1'), pg_temp.id('buyer'), 'full_payment', null, 'full') id)
insert into ids select 'full-sale', id from s;
select is((select payment_mode || ':' || total_amount from public.sales where id = pg_temp.id('full-sale')),
  'full_payment:60000.00', 'full payment sale has the bond total');
select is((select installment_count || ':' || total_amount from public.payment_plans where sale_id = pg_temp.id('full-sale')),
  '1:60000.00', 'full payment has a one-installment plan');
select is((select installment_number || ':' || amount || ':' || due_date from public.installments i join public.payment_plans p on p.id = i.payment_plan_id
  where p.sale_id = pg_temp.id('full-sale')), '1:60000.00:' || (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  'full payment is due today in Argentina');
select is((select commercial_status || ':' || current_buyer_id || ':' || current_collector_id || ':' || financial_status_snapshot
  from public.bonds where id = pg_temp.id('b1')),
  'sold:' || pg_temp.id('buyer') || ':' || pg_temp.id('collector') || ':no_payments',
  'sale retains collector and records buyer and financial snapshot');
reset role;
select is((select count(*)::int from public.audit_log where request_id = 'full' and action = 'sale.create'), 2,
  'sale and bond changes have two audit rows');
select ok(has_function_privilege('authenticated', 'public.sale_register(uuid,uuid,uuid,text,date,text,date)', 'execute'),
  'authenticated users may execute sale_register');
set local role authenticated;
select pg_temp.act_as(2);

with s as (select public.sale_register(pg_temp.id('campaign'), pg_temp.id('pata'), pg_temp.id('buyer'), 'installments', date '2027-01-31', 'pata') id)
insert into ids select 'pata-sale', id from s;
select is((select count(*)::int from public.installments i join public.payment_plans p on p.id = i.payment_plan_id where p.sale_id = pg_temp.id('pata-sale')),
  10, 'installments sale creates campaign installment count');
select is((select array_agg(installment_number order by installment_number) from public.installments i join public.payment_plans p on p.id = i.payment_plan_id where p.sale_id = pg_temp.id('pata-sale')),
  array[1,2,3,4,5,6,7,8,9,10], 'installment numbers are sequential');
select is((select array_agg(amount order by installment_number) from public.installments i join public.payment_plans p on p.id = i.payment_plan_id where p.sale_id = pg_temp.id('pata-sale')),
  array[12000.00,12000.00,12000.00,12000.00,12000.00,12000.00,12000.00,12000.00,12000.00,12000.00]::numeric[],
  'a two-unit pata doubles each installment');
select is((select array_agg(due_date order by installment_number) from public.installments i join public.payment_plans p on p.id = i.payment_plan_id where p.sale_id = pg_temp.id('pata-sale')),
  array['2027-01-31'::date,'2027-02-28'::date,'2027-03-31'::date,'2027-04-30'::date,'2027-05-31'::date,'2027-06-30'::date,'2027-07-31'::date,'2027-08-31'::date,'2027-09-30'::date,'2027-10-31'::date],
  'monthly schedule clamps January 31 to February 28');

select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b8'), pg_temp.id('buyer'), 'cash')$$, '22023', null, 'invalid payment mode is rejected');
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b2'), '00000000-0000-0000-0000-000000000001', 'full_payment')$$, 'P0002', null, 'unknown buyer is rejected');
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), '00000000-0000-0000-0000-000000000001', pg_temp.id('buyer'), 'full_payment')$$, 'P0002', null, 'unknown bond is rejected');
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('other-bond'), pg_temp.id('buyer'), 'full_payment')$$, '22023', null, 'other campaign bond is rejected');
select throws_ok($$select public.sale_register(pg_temp.id('draft'), pg_temp.id('draft-bond'), pg_temp.id('buyer'), 'full_payment')$$, '55000', null, 'draft campaign is rejected');
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b9'), pg_temp.id('buyer'), 'full_payment')$$, '55000', null, 'available bond is rejected');
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b3'), pg_temp.id('buyer'), 'full_payment')$$, '55000', null, 'lost bond is rejected');
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b4'), pg_temp.id('buyer'), 'full_payment')$$, '55000', null, 'sold bond is rejected');
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b8'), pg_temp.id('buyer'), 'full_payment')$$, '55000', null, 'annulled bond is rejected');
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('member-1'), pg_temp.id('buyer'), 'full_payment')$$, '55000', null, 'manual pata member is rejected');
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b2'), pg_temp.id('buyer'), 'full_payment',
  (now() at time zone 'America/Argentina/Buenos_Aires')::date - 32)$$, '22023', null, 'too-early first due date is rejected');
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b2'), pg_temp.id('buyer'), 'full_payment',
  (now() at time zone 'America/Argentina/Buenos_Aires')::date + 366)$$, '22023', null, 'too-late first due date is rejected');
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b1'), pg_temp.id('buyer'), 'full_payment')$$, '55000', null, 'same bond cannot be sold twice');
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b9'), pg_temp.id('buyer'), 'full_payment', null, 'reject-audit')$$,
  '55000', null, 'a rejected sale writes nothing');
select is((select count(*)::int from public.sales where bond_id = pg_temp.id('b9')), 0, 'rejected request creates no sale');
select is((select count(*)::int from public.audit_log where request_id = 'reject-audit'), 0, 'rejected request creates no audit');

select pg_temp.act_as(1);
select lives_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b7'), pg_temp.id('buyer'), 'full_payment')$$, 'admin can register a sale');
select pg_temp.act_as(3);
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b6'), pg_temp.id('buyer'), 'full_payment')$$, '42501', null, 'treasurer cannot register a sale');
select pg_temp.act_as(4);
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b6'), pg_temp.id('buyer'), 'full_payment')$$, '42501', null, 'read-only cannot register a sale');
select pg_temp.act_as(5);
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b6'), pg_temp.id('buyer'), 'full_payment')$$, '42501', null, 'inactive profile cannot register a sale');
select throws_ok($$insert into public.sales (campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by)
  values (pg_temp.id('campaign'), pg_temp.id('b6'), pg_temp.id('buyer'), pg_temp.id('collector'), 'full_payment', 60000, 'b6220000-0000-0000-0000-000000000002')$$,
  '42501', null, 'authenticated users cannot insert sales directly');
reset role;
select is((select count(*)::int from public.payment_plans where sale_id = pg_temp.id('pata-sale')), 1,
  'installment sale has one payment plan');
reset role;
select * from finish();
rollback;
