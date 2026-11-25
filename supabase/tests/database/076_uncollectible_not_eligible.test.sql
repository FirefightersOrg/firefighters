-- Follow-up of SAN-106 (#50, answer 1): a sale marked uncollectible is not eligible for ANY draw while the
-- mark lasts; reverting the mark (#156) makes it eligible again for rosters generated afterwards; a roster
-- frozen before the mark never changes. Both sales are fully paid, so the only difference is the mark.
begin;
select plan(12);

insert into auth.users (id, email) values ('a6760000-0000-0000-0000-000000000001', 'noteligible@example.com');
insert into public.profiles (id, auth_user_id, full_name, email, status)
values ('b6760000-0000-0000-0000-000000000001', 'a6760000-0000-0000-0000-000000000001', 'Admin 676', 'noteligible@example.com', 'active');
insert into public.user_roles (user_id, role_id) select 'b6760000-0000-0000-0000-000000000001', id from public.roles where name = 'admin';
select set_config('request.jwt.claims', '{"sub":"a6760000-0000-0000-0000-000000000001","role":"authenticated"}', true);
create temporary table ids (k text primary key, id uuid not null);
grant select, insert on ids to authenticated;
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where ids.k = $1 $$;
grant execute on function pg_temp.id(text) to authenticated;
-- Reasons of one bond's entries in a draw's roster with the given status.
create function pg_temp.reasons(p_draw text, p_bond text, p_status text default 'generated') returns text
language sql stable as $$
  select coalesce(string_agg(distinct coalesce(e.ineligibility_reason, 'eligible'), ','), 'none')
  from public.draw_roster_entries e join public.draw_rosters r on r.id = e.draw_roster_id
  where r.draw_id = pg_temp.id(p_draw) and r.status = p_status and e.bond_id = pg_temp.id(p_bond)
$$;
grant execute on function pg_temp.reasons(text, text, text) to authenticated;

-- One-installment campaign: a full payment covers every installment (monthly, consolation, final, extraordinary).
with c as (insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('Not eligible campaign', 1000, 1, 1000, 'base_number') returning id) insert into ids select 'campaign', id from c;
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
-- Pay both in full through a closed settlement.
insert into ids values ('settlement', public.settlement_open(pg_temp.id('campaign'), pg_temp.id('collector')));
select public.settlement_add_payment(pg_temp.id('settlement'), pg_temp.id(s), 1000, 'cash',
  jsonb_build_array(jsonb_build_object('installment_id', (select i.id from public.installments i
    join public.payment_plans pp on pp.id = i.payment_plan_id where pp.sale_id = pg_temp.id(s)), 'amount_applied', 1000)))
from (values ('s1'), ('s2')) v(s);
select public.settlement_close(pg_temp.id('settlement'));

-- 1. A roster frozen BEFORE the mark.
with d as (select public.draw_create(pg_temp.id('campaign'), 'monthly', 'Frozen before', current_date + 30,
  (current_date + 25)::timestamp at time zone 'America/Argentina/Buenos_Aires', 1, '{}'::jsonb) id)
insert into ids select 'frozen', id from d;
select public.draw_generate_roster(pg_temp.id('frozen'));
select public.draw_freeze_roster(pg_temp.id('frozen'));
select is(pg_temp.reasons('frozen', 'b1', 'frozen'), 'eligible', 'before the mark, the paid sale is eligible (frozen roster)');

-- 2. Mark the sale; every draw type excludes it, the unmarked paid sale stays eligible.
select public.sale_mark_uncollectible(pg_temp.id('s1'), 'Se mudó');
with d as (
  select t, public.draw_create(pg_temp.id('campaign'), t, 'NE ' || t, current_date + 40,
    (current_date + 35)::timestamp at time zone 'America/Argentina/Buenos_Aires',
    case when t in ('monthly', 'consolation') then 1 end, '{}'::jsonb) id
  from unnest(array['monthly', 'extraordinary_full_payment', 'final', 'consolation']) t
) insert into ids select t, id from d;
select public.draw_generate_roster(pg_temp.id(t))
from unnest(array['monthly', 'extraordinary_full_payment', 'final', 'consolation']) t;
select is(pg_temp.reasons('monthly', 'b1'), 'uncollectible', 'monthly: the marked sale is not eligible');
select is(pg_temp.reasons('extraordinary_full_payment', 'b1'), 'uncollectible', 'extraordinary: the marked sale is not eligible');
select is(pg_temp.reasons('final', 'b1'), 'uncollectible', 'final: the marked sale is not eligible');
select is(pg_temp.reasons('consolation', 'b1'), 'uncollectible', 'consolation: the marked sale is not eligible');
select is((select string_agg(pg_temp.reasons(t, 'b2'), ',' order by t)
  from unnest(array['monthly', 'extraordinary_full_payment', 'final', 'consolation']) t),
  'eligible,eligible,eligible,eligible', 'the unmarked paid sale is eligible in all four');
reset role;
select ok((select bool_and(not e.eligible) from public.draw_roster_entries e join public.draw_rosters r on r.id = e.draw_roster_id
  where r.status = 'generated' and e.bond_id = pg_temp.id('b1')), 'every generated entry of the marked bond is not eligible');
set local role authenticated;

-- 3. The roster frozen before the mark does not change.
select is(pg_temp.reasons('frozen', 'b1', 'frozen'), 'eligible', 'a roster frozen before the mark keeps the sale eligible');
select throws_ok($$select public.draw_generate_roster(pg_temp.id('frozen'))$$, '55000', null,
  'a frozen roster cannot be regenerated, so the mark never rewrites it');

-- 4. Reverting the mark (#156) makes it eligible again for rosters generated afterwards.
select public.sale_revert_uncollectible(pg_temp.id('s1'), 'Apareció');
select lives_ok($$select public.draw_generate_roster(pg_temp.id('final'))$$, 'the final roster is regenerated after the revert');
select is(pg_temp.reasons('final', 'b1'), 'eligible', 'after the revert the sale is eligible again');
select is(pg_temp.reasons('monthly', 'b1'), 'uncollectible',
  'a roster generated while it was marked keeps its snapshot until regenerated');

select * from finish();
rollback;
