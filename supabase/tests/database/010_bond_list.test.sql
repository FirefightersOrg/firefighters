-- SAN-26: public.bond_list (bonds list read model).
begin;
select plan(13);

-- Users: ...01 admin, ...02 operator (bond.view), ...03 collector (no bond.view).
insert into auth.users (id, email)
select ('a1000000-0000-0000-0000-00000000000' || n)::uuid, 'bond-list-' || n || '@example.com'
from generate_series(1, 3) as n;

insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b1000000-0000-0000-0000-00000000000' || n)::uuid,
  ('a1000000-0000-0000-0000-00000000000' || n)::uuid,
  'Bond list user ' || n, 'bond-list-' || n || '@example.com', 'active'
from generate_series(1, 3) as n;

insert into public.user_roles (user_id, role_id)
select v.profile_id::uuid, r.id
from (values
  ('b1000000-0000-0000-0000-000000000001', 'admin'),
  ('b1000000-0000-0000-0000-000000000002', 'operator'),
  ('b1000000-0000-0000-0000-000000000003', 'collector')
) as v (profile_id, role_name)
join public.roles r on r.name = v.role_name;

create function pg_temp.act_as(p_n int) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    format('{"sub":"a1000000-0000-0000-0000-00000000000%s","role":"authenticated"}', p_n),
    true
  );
$$;
grant execute on function pg_temp.act_as(int) to authenticated, anon;

create temporary table ids (k text primary key, id uuid not null);
grant select, insert on ids to authenticated, anon, service_role;
create function pg_temp.id(p_k text) returns uuid language sql stable as $$
  select id from ids where k = p_k;
$$;
grant execute on function pg_temp.id(text) to authenticated, anon, service_role;

with c as (
  insert into public.campaigns
    (name, simple_bond_value, installment_count, installment_value, number_digits, max_number,
     associated_number_offset, overflow_policy, barcode_mode)
  values ('bond-list', 60000, 10, 6000, 4, 9999, 4871, 'reject', 'base_number')
  returning id
)
insert into ids select 'c', id from c;

-- Fixtures through the audited functions (as the admin).
set local role authenticated;
select pg_temp.act_as(1);
insert into ids select 's-68', public.bond_create(pg_temp.id('c'), array[68], null, 'BC-68');
insert into ids select 's-69', public.bond_create(pg_temp.id('c'), array[69]);
insert into ids select 's-10', public.bond_create(pg_temp.id('c'), array[10]);
insert into ids select 'p-200', public.bond_create(pg_temp.id('c'), array[300, 200]);
insert into ids select 'mp', public.bond_group_into_pata(pg_temp.id('c'), array[pg_temp.id('s-68'), pg_temp.id('s-69')]);
select public.bond_annul(pg_temp.id('s-10'), 'Loaded by mistake');
-- 10 is free again: load it once more.
insert into ids select 's-10-new', public.bond_create(pg_temp.id('c'), array[10]);
reset role;

-- Definition
select has_view('public', 'bond_list', 'bond_list exists');
select ok(
  (select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.bond_list'::regclass),
  'bond_list is security_invoker (the RLS of the bond tables applies)'
);
select ok(
  has_table_privilege('authenticated', 'public.bond_list', 'select')
  and not has_table_privilege('authenticated', 'public.bond_list', 'insert')
  and not has_table_privilege('anon', 'public.bond_list', 'select'),
  'authenticated can only read bond_list; anon cannot'
);

-- Contents
select results_eq(
  $$select base_numbers, associated_numbers, sort_number from public.bond_list where id = pg_temp.id('p-200')$$,
  $$values (array[200, 300], array[5071, 5171], 200)$$,
  'a printed pata lists its own numbers, sorted; sort key = lowest base'
);
select results_eq(
  $$select base_numbers, associated_numbers, group_pata_id from public.bond_list where id = pg_temp.id('mp')$$,
  $$values (array[68, 69], array[4939, 4940], null::uuid)$$,
  'a manual pata lists its members'' numbers'
);
select results_eq(
  $$select base_numbers, group_pata_id from public.bond_list where id = pg_temp.id('s-68')$$,
  $$values (array[68], pg_temp.id('mp'))$$,
  'a grouped member keeps its numbers and names its pata'
);
select set_eq(
  $$select id from public.bond_list
    where campaign_id = pg_temp.id('c') and base_numbers @> array[68]$$,
  $$values (pg_temp.id('s-68')), (pg_temp.id('mp'))$$,
  'a number filter finds the simple bond and the manual pata it is in'
);
select set_eq(
  $$select id, commercial_status from public.bond_list
    where campaign_id = pg_temp.id('c') and base_numbers @> array[10]$$,
  $$values (pg_temp.id('s-10'), 'annulled'::text), (pg_temp.id('s-10-new'), 'available'::text)$$,
  'released numbers are kept: an annulled bond and the one that reused its number are both found'
);
select results_eq(
  $$select id from public.bond_list
    where campaign_id = pg_temp.id('c') and associated_numbers @> array[5171]$$,
  $$values (pg_temp.id('p-200'))$$,
  'associated number filter'
);

-- Ungrouping: the annulled pata is still found by the numbers it had; members are free.
set local role authenticated;
select pg_temp.act_as(1);
select public.bond_ungroup_pata(pg_temp.id('mp'), 'Wrong bonds');
reset role;
select results_eq(
  $$select commercial_status, base_numbers from public.bond_list where id = pg_temp.id('mp')$$,
  $$values ('annulled'::text, array[68, 69])$$,
  'an ungrouped pata keeps the numbers it had in the list'
);
select is(
  (select group_pata_id from public.bond_list where id = pg_temp.id('s-68')),
  null,
  'an ungrouped member no longer names a pata'
);

-- RLS through the view
set local role authenticated;
select pg_temp.act_as(2);
select is(
  (select count(*)::int from public.bond_list where campaign_id = pg_temp.id('c')),
  6,
  'bond.view (operator) sees every bond through the view'
);
select pg_temp.act_as(3);
select is(
  (select count(*)::int from public.bond_list where campaign_id = pg_temp.id('c')),
  0,
  'without bond.view the view returns nothing'
);
reset role;

select * from finish();
rollback;
