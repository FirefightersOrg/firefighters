-- Follow-up of SAN-106 (#50, answer 1): a sale marked uncollectible is not eligible for draws.
begin;
select plan(6);

insert into auth.users (id, email) values ('a6760000-0000-0000-0000-000000000001', 'noteligible@example.com');
insert into public.profiles (id, auth_user_id, full_name, email, status)
values ('b6760000-0000-0000-0000-000000000001', 'a6760000-0000-0000-0000-000000000001', 'Admin 676', 'noteligible@example.com', 'active');
insert into public.user_roles (user_id, role_id) select 'b6760000-0000-0000-0000-000000000001', id from public.roles where name = 'admin';
select set_config('request.jwt.claims', '{"sub":"a6760000-0000-0000-0000-000000000001","role":"authenticated"}', true);
create temporary table ids (k text primary key, id uuid not null);
grant select, insert on ids to authenticated;
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where ids.k = $1 $$;
grant execute on function pg_temp.id(text) to authenticated;

with c as (insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('Not eligible campaign', 60000, 10, 6000, 'base_number') returning id) insert into ids select 'campaign', id from c;
update public.campaigns set status = 'active', starts_at = current_date - 1, ends_at = current_date + 365
where id = pg_temp.id('campaign');
with c as (insert into public.collectors (display_name) values ('NE collector') returning id) insert into ids select 'collector', id from c;
with b as (insert into public.buyers (type, first_name, last_name) values ('individual', 'Buyer', 'NE') returning id) insert into ids select 'buyer', id from b;
set local role authenticated;
with b as (select public.bond_create(pg_temp.id('campaign'), array[11]) id) insert into ids select 'b1', id from b;
with b as (select public.bond_create(pg_temp.id('campaign'), array[12]) id) insert into ids select 'b2', id from b;
select public.bond_deliver(pg_temp.id('campaign'), pg_temp.id('collector'), array[pg_temp.id('b1'), pg_temp.id('b2')]);
with s as (select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b1'), pg_temp.id('buyer'), 'full_payment') id)
insert into ids select 's1', id from s;
with s as (select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b2'), pg_temp.id('buyer'), 'full_payment') id)
insert into ids select 's2', id from s;
select public.sale_mark_uncollectible(pg_temp.id('s1'), 'Se mudó');

with d as (select public.draw_create(pg_temp.id('campaign'), 'final', 'Final NE', current_date + 30,
  (current_date + 25)::timestamp at time zone 'America/Argentina/Buenos_Aires', null, '{}'::jsonb) id)
insert into ids select 'draw', id from d;
select lives_ok($$select public.draw_generate_roster(pg_temp.id('draw'))$$, 'the roster is generated');
reset role;

create temporary view entries as
  select e.bond_id, e.number_value, e.eligible, e.ineligibility_reason
  from public.draw_roster_entries e join public.draw_rosters r on r.id = e.draw_roster_id
  where r.draw_id = pg_temp.id('draw') and r.status = 'generated';
select is((select count(*)::int from entries where bond_id = pg_temp.id('b1')), 2,
  'the marked bond is still listed (base and associated numbers)');
select is((select array_agg(distinct ineligibility_reason) from entries where bond_id = pg_temp.id('b1')),
  array['uncollectible'], 'its numbers are not eligible, with reason uncollectible');
select ok((select bool_and(not eligible) from entries where bond_id = pg_temp.id('b1')), 'and not eligible');
select is((select array_agg(distinct ineligibility_reason) from entries where bond_id = pg_temp.id('b2')),
  array['not_fully_paid'], 'an unmarked unpaid sale keeps its usual reason');
select is((select count(*)::int from entries where ineligibility_reason = 'uncollectible'), 2,
  'only the marked sale is uncollectible');

select * from finish();
rollback;
