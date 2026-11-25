-- SAN-106 (a): a sale may carry an earlier sale date (never future, never before the campaign start), and
-- the first due date falls within [sale date, sale date + 1 year].
begin;
select plan(18);

insert into auth.users (id, email)
select ('a6690000-0000-0000-0000-00000000000' || n)::uuid, 'saledate-' || n || '@example.com'
from generate_series(1, 2) n;
insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b6690000-0000-0000-0000-00000000000' || n)::uuid,
  ('a6690000-0000-0000-0000-00000000000' || n)::uuid, 'Sale date ' || n, 'saledate-' || n || '@example.com', 'active'
from generate_series(1, 2) n;
insert into public.user_roles (user_id, role_id)
select v.id::uuid, r.id from (values
  ('b6690000-0000-0000-0000-000000000001', 'operator'),
  ('b6690000-0000-0000-0000-000000000002', 'read-only')
) v(id, role_name) join public.roles r on r.name = v.role_name;
create function pg_temp.act_as(n int) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"a6690000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true)
$$;
grant execute on function pg_temp.act_as(int) to authenticated;
create temporary table ids (k text primary key, id uuid not null);
grant select, insert on ids to authenticated;
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where ids.k = $1 $$;
grant execute on function pg_temp.id(text) to authenticated;
create function pg_temp.today() returns date language sql stable as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date
$$;
grant execute on function pg_temp.today() to authenticated;

-- The campaign started 100 days ago (Buenos Aires midnight).
with c as (insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('Sale date campaign', 60000, 10, 6000, 'base_number') returning id) insert into ids select 'campaign', id from c;
update public.campaigns
set status = 'active',
    starts_at = ((pg_temp.today() - 100)::timestamp at time zone 'America/Argentina/Buenos_Aires'),
    ends_at = ((pg_temp.today() + 300)::timestamp at time zone 'America/Argentina/Buenos_Aires')
where id = pg_temp.id('campaign');
with c as (insert into public.collectors (display_name) values ('Sale date collector') returning id) insert into ids select 'collector', id from c;
with b as (insert into public.buyers (type, first_name, last_name) values ('individual', 'Buyer', 'Date') returning id) insert into ids select 'buyer', id from b;
with b as (
  insert into public.bonds (campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
  select pg_temp.id('campaign'), 'simple', 'printed', 1, 60000, 'available' from generate_series(1, 6) returning id
) insert into ids select 'b' || row_number() over (order by id), id from b;
reset role;
insert into auth.users (id, email) values ('a6690000-0000-0000-0000-000000000009', 'saledate-admin@example.com');
insert into public.profiles (id, auth_user_id, full_name, email, status)
values ('b6690000-0000-0000-0000-000000000009', 'a6690000-0000-0000-0000-000000000009', 'Admin', 'saledate-admin@example.com', 'active');
insert into public.user_roles (user_id, role_id) select 'b6690000-0000-0000-0000-000000000009', id from public.roles where name = 'admin';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a6690000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select public.bond_deliver(pg_temp.id('campaign'), pg_temp.id('collector'),
  array(select id from ids where k ~ '^b[0-9]+$' order by k));

select pg_temp.act_as(1);
-- 1. Sale date bounds.
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b1'), pg_temp.id('buyer'),
  'full_payment', null, null, pg_temp.today() + 1)$$, '22023', 'sale date cannot be in the future',
  'a future sale date is rejected');
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b1'), pg_temp.id('buyer'),
  'full_payment', null, null, pg_temp.today() - 101)$$, '22023', 'sale date cannot be before the campaign start',
  'a sale date before the campaign start is rejected');

-- 2. First due date window, relative to the sale date.
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b1'), pg_temp.id('buyer'),
  'installments', pg_temp.today() - 61, null, pg_temp.today() - 60)$$, '22023',
  'first due date must be between the sale date and one year after it', 'a first due date before the sale date is rejected');
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b1'), pg_temp.id('buyer'),
  'installments', pg_temp.today() - 1)$$, '22023', null,
  'a sale of today cannot have a past first due date (no more 31-day grace)');
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b1'), pg_temp.id('buyer'),
  'installments', pg_temp.today() - 60 + 366, null, pg_temp.today() - 60)$$, '22023', null,
  'a first due date more than a year after the sale date is rejected');
select is((select count(*)::int from public.sales where campaign_id = pg_temp.id('campaign')), 0, 'rejected sales write nothing');

-- 3. An old sale with its original schedule: past due dates are fine when the sale is old.
with s as (select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b1'), pg_temp.id('buyer'),
  'installments', pg_temp.today() - 60, 'req-669', pg_temp.today() - 60) id) insert into ids select 's1', id from s;
select is((select min(i.due_date) from public.installments i join public.payment_plans pp on pp.id = i.payment_plan_id
  where pp.sale_id = pg_temp.id('s1')), pg_temp.today() - 60, 'the first due date equals the old sale date');
select is((select (sold_at at time zone 'America/Argentina/Buenos_Aires')::text from public.sales where id = pg_temp.id('s1')),
  ((pg_temp.today() - 60) + time '12:00')::text, 'an earlier sale is stamped at noon of its date (Buenos Aires)');
reset role;
select is((select new_value ->> 'sale_date' from public.audit_log where action = 'sale.create' and entity_type = 'sale'
  and request_id = 'req-669'), (pg_temp.today() - 60)::text, 'the audit records the sale date');
select is(public.bond_financial_status_from_installments(pg_temp.id('b1')), 'no_payments',
  'an old sale without payments is "no payments" (status precedence), even with past due dates');
set local role authenticated;
select pg_temp.act_as(1);

-- 4. Bounds are inclusive: campaign start day and one year after the sale.
select lives_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b2'), pg_temp.id('buyer'),
  'full_payment', null, null, pg_temp.today() - 100)$$, 'the campaign start day is a valid sale date');
select lives_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b3'), pg_temp.id('buyer'),
  'installments', pg_temp.today() - 10 + 365, null, pg_temp.today() - 10)$$, 'one year after the sale date is a valid first due date');
-- 5. Defaults: no sale date means today; a full payment defaults its due date to the sale date.
with s as (select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b4'), pg_temp.id('buyer'), 'full_payment') id)
insert into ids select 's4', id from s;
select is((select (sold_at at time zone 'America/Argentina/Buenos_Aires')::date from public.sales where id = pg_temp.id('s4')),
  pg_temp.today(), 'without a sale date the sale is today');
with s as (select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b5'), pg_temp.id('buyer'), 'full_payment',
  null, null, pg_temp.today() - 5) id) insert into ids select 's5', id from s;
select is((select min(i.due_date) from public.installments i join public.payment_plans pp on pp.id = i.payment_plan_id
  where pp.sale_id = pg_temp.id('s5')), pg_temp.today() - 5, 'a full payment of an earlier sale is due on the sale date');

-- 5b. Presale: an active campaign whose start is still ahead accepts today's sales (as before), but not
-- an earlier date before its start.
reset role;
with c as (insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('Presale campaign', 60000, 10, 6000, 'base_number') returning id) insert into ids select 'presale', id from c;
update public.campaigns
set status = 'active',
    starts_at = ((pg_temp.today() + 10)::timestamp at time zone 'America/Argentina/Buenos_Aires'),
    ends_at = ((pg_temp.today() + 300)::timestamp at time zone 'America/Argentina/Buenos_Aires')
where id = pg_temp.id('presale');
with b as (
  insert into public.bonds (campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
  select pg_temp.id('presale'), 'simple', 'printed', 1, 60000, 'available' from generate_series(1, 2) returning id
) insert into ids select 'p' || row_number() over (order by id), id from b;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a6690000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select public.bond_deliver(pg_temp.id('presale'), pg_temp.id('collector'), array[pg_temp.id('p1'), pg_temp.id('p2')]);
select pg_temp.act_as(1);
select lives_ok($$select public.sale_register(pg_temp.id('presale'), pg_temp.id('p1'), pg_temp.id('buyer'), 'full_payment')$$,
  'a sale of today works in an active campaign that has not started yet');
select throws_ok($$select public.sale_register(pg_temp.id('presale'), pg_temp.id('p2'), pg_temp.id('buyer'),
  'full_payment', null, null, pg_temp.today() - 1)$$, '22023', 'sale date cannot be before the campaign start',
  'an earlier date before the campaign start is rejected');

-- 6. Permission unchanged: read-only cannot register.
select pg_temp.act_as(2);
select throws_ok($$select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b6'), pg_temp.id('buyer'),
  'full_payment', null, null, pg_temp.today() - 5)$$, '42501', null, 'read-only cannot register a sale');
reset role;
select ok(not has_function_privilege('anon', 'public.sale_register(uuid,uuid,uuid,text,date,text,date)', 'execute')
  and not exists (select 1 from pg_proc where proname = 'sale_register' and pronargs = 6),
  'the old 6-argument overload is gone and anon cannot execute the new one');

select * from finish();
rollback;
