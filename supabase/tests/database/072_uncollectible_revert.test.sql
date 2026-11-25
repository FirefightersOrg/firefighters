-- Follow-up of SAN-106: an admin may revert an uncollectible mark with an audited reason.
begin;
select plan(17);

insert into auth.users (id, email)
select ('a6720000-0000-0000-0000-00000000000' || n)::uuid, 'revert-' || n || '@example.com' from generate_series(1, 2) n;
insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b6720000-0000-0000-0000-00000000000' || n)::uuid, ('a6720000-0000-0000-0000-00000000000' || n)::uuid,
  'Revert ' || n, 'revert-' || n || '@example.com', 'active' from generate_series(1, 2) n;
insert into public.user_roles (user_id, role_id)
select v.id::uuid, r.id from (values
  ('b6720000-0000-0000-0000-000000000001', 'admin'),
  ('b6720000-0000-0000-0000-000000000002', 'treasurer')
) v(id, role_name) join public.roles r on r.name = v.role_name;
create function pg_temp.act_as(n int) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"a6720000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true)
$$;
grant execute on function pg_temp.act_as(int) to authenticated;
create temporary table ids (k text primary key, id uuid not null);
grant select, insert on ids to authenticated;
create function pg_temp.id(k text) returns uuid language sql stable as $$ select id from ids where ids.k = $1 $$;
grant execute on function pg_temp.id(text) to authenticated;

with c as (insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('Revert campaign', 60000, 10, 6000, 'base_number') returning id) insert into ids select 'campaign', id from c;
update public.campaigns set status = 'active', starts_at = current_date - 1, ends_at = current_date + 365
where id = pg_temp.id('campaign');
with c as (insert into public.collectors (display_name) values ('Revert collector') returning id) insert into ids select 'collector', id from c;
with b as (insert into public.buyers (type, first_name, last_name) values ('individual', 'Buyer', 'Revert') returning id) insert into ids select 'buyer', id from b;
with b as (
  insert into public.bonds (campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
  select pg_temp.id('campaign'), 'simple', 'printed', 1, 60000, 'available' from generate_series(1, 2) returning id
) insert into ids select 'b' || row_number() over (order by id), id from b;
set local role authenticated;
select pg_temp.act_as(1);
select public.bond_deliver(pg_temp.id('campaign'), pg_temp.id('collector'), array[pg_temp.id('b1'), pg_temp.id('b2')]);
with s as (select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b1'), pg_temp.id('buyer'), 'full_payment') id)
insert into ids select 's1', id from s;
with s as (select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b2'), pg_temp.id('buyer'), 'full_payment') id)
insert into ids select 's2', id from s;
select public.sale_mark_uncollectible(pg_temp.id('s1'), 'Se mudó', 'req-mark');

-- 1. Permission: admin only (the treasurer may mark but not revert).
select pg_temp.act_as(2);
select throws_ok($$select public.sale_revert_uncollectible(pg_temp.id('s1'), 'Apareció')$$, '42501', null,
  'the treasurer cannot revert a mark');
select pg_temp.act_as(1);
-- 2. Input and state.
select throws_ok($$select public.sale_revert_uncollectible(pg_temp.id('s1'), '  ')$$, '22023', null, 'a blank reason is rejected');
select throws_ok($$select public.sale_revert_uncollectible(pg_temp.id('s1'), repeat('x', 1001))$$, '22023', null,
  'a reason over 1000 characters is rejected');
select throws_ok($$select public.sale_revert_uncollectible('00000000-0000-0000-0000-000000000001', 'x')$$, 'P0002', null,
  'an unknown sale is rejected');
select throws_ok($$select public.sale_revert_uncollectible(pg_temp.id('s2'), 'x')$$, '55000',
  'sale is not marked uncollectible', 'an unmarked sale cannot be reverted');
reset role;
select is((select financial_status_snapshot from public.bonds where id = pg_temp.id('b1')), 'uncollectible', 'before: uncollectible');
set local role authenticated;
select pg_temp.act_as(1);

-- 3. The revert.
select lives_ok($$select public.sale_revert_uncollectible(pg_temp.id('s1'), '  Apareció y pagó  ', 'req-revert')$$,
  'the admin reverts the mark');
reset role;
select is((select row(uncollectible_at, uncollectible_by, uncollectible_reason)::text from public.sales where id = pg_temp.id('s1')),
  '(,,)', 'the mark is cleared');
select is((select financial_status_snapshot from public.bonds where id = pg_temp.id('b1')), 'no_payments',
  'the bond gets its installment-derived status back');
select is((select row(actor_user_id, reason, request_id, campaign_scope,
    old_value ->> 'uncollectible_reason', old_value ->> 'uncollectible_by',
    old_value ->> 'financial_status_snapshot', new_value ->> 'financial_status_snapshot')::text
  from public.audit_log where action = 'sale.revert_uncollectible' and entity_id = pg_temp.id('s1')::text),
  row('b6720000-0000-0000-0000-000000000001'::uuid, 'Apareció y pagó', 'req-revert', pg_temp.id('campaign')::text,
    'Se mudó', 'b6720000-0000-0000-0000-000000000001', 'uncollectible', 'no_payments')::text,
  'one audit row keeps the reverted mark (who and why) and the new reason');
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok($$select public.sale_revert_uncollectible(pg_temp.id('s1'), 'Otra vez')$$, '55000', null,
  'a reverted sale cannot be reverted again');
-- 4. It can be marked again later.
select lives_ok($$select public.sale_mark_uncollectible(pg_temp.id('s1'), 'Volvió a irse')$$, 'a reverted sale may be marked again');
reset role;
select is((select uncollectible_reason from public.sales where id = pg_temp.id('s1')), 'Volvió a irse', 'the new mark is stored');

-- 5. Only the function clears a mark: a direct update, or the flag of another sale, is refused.
select throws_ok($$update public.sales set uncollectible_at = null, uncollectible_by = null, uncollectible_reason = null
  where id = pg_temp.id('s1')$$, '23001', null, 'a direct clear without the flag is refused');
select set_config('app.uncollectible_revert', pg_temp.id('s2')::text, true);
select throws_ok($$update public.sales set uncollectible_at = null, uncollectible_by = null, uncollectible_reason = null
  where id = pg_temp.id('s1')$$, '23001', null, 'the flag of another sale does not open this one');
select set_config('app.uncollectible_revert', '', true);

-- 6. Grants and permission catalog.
select ok(not has_function_privilege('anon', 'public.sale_revert_uncollectible(uuid,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.sale_revert_uncollectible(uuid,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.sale_revert_uncollectible(uuid,text,text)', 'execute'),
  'only authenticated can execute sale_revert_uncollectible');
select is((select array_agg(r.name::text order by r.name) from public.role_permissions rp
  join public.roles r on r.id = rp.role_id join public.permissions p on p.id = rp.permission_id
  where p.code = 'sale.revert_uncollectible'), array['admin'], 'sale.revert_uncollectible is granted to admin only');

select * from finish();
rollback;
