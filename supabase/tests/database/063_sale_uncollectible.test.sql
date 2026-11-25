-- SAN-106: `uncollectible` is manual only (admin or treasurer), with a mandatory audited reason,
-- and the mark is final.
begin;
select plan(23);

insert into auth.users (id, email)
select ('a6630000-0000-0000-0000-00000000000' || n)::uuid, 'uncollectible-' || n || '@example.com'
from generate_series(1, 4) n;
insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b6630000-0000-0000-0000-00000000000' || n)::uuid,
  ('a6630000-0000-0000-0000-00000000000' || n)::uuid, 'Uncollectible ' || n,
  'uncollectible-' || n || '@example.com', 'active'
from generate_series(1, 4) n;
insert into public.user_roles (user_id, role_id)
select v.id::uuid, r.id from (values
  ('b6630000-0000-0000-0000-000000000001', 'admin'),
  ('b6630000-0000-0000-0000-000000000002', 'operator'),
  ('b6630000-0000-0000-0000-000000000003', 'treasurer'),
  ('b6630000-0000-0000-0000-000000000004', 'read-only')
) v(id, role_name) join public.roles r on r.name = v.role_name;
create function pg_temp.act_as(n int) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"a6630000-0000-0000-0000-00000000000%s","role":"authenticated"}', n), true)
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

with c as (
  insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('Uncollectible campaign', 60000, 10, 6000, 'base_number') returning id
) insert into ids select 'campaign', id from c;
update public.campaigns set status = 'active', starts_at = current_date - 1, ends_at = current_date + 365
where id = pg_temp.id('campaign');
with c as (insert into public.collectors (display_name) values ('Uncollectible collector') returning id)
insert into ids select 'collector', id from c;
with b as (insert into public.buyers (type, first_name, last_name) values ('individual', 'Buyer', 'Uncollectible') returning id)
insert into ids select 'buyer', id from b;
with b as (
  insert into public.bonds (campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
  select pg_temp.id('campaign'), 'simple', 'printed', 1, 60000, 'available' from generate_series(1, 5)
  returning id
) insert into ids select 'b' || row_number() over (order by id), id from b;

set local role authenticated;
select pg_temp.act_as(1);
select public.bond_deliver(pg_temp.id('campaign'), pg_temp.id('collector'),
  array[pg_temp.id('b1'), pg_temp.id('b2'), pg_temp.id('b3'), pg_temp.id('b4'), pg_temp.id('b5')]);

-- Sales s1..s5 on bonds b1..b5 (installments for s1 and s2, full payment for the rest).
with s as (select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b1'), pg_temp.id('buyer'),
  'installments', pg_temp.today()) id) insert into ids select 's1', id from s;
with s as (select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b2'), pg_temp.id('buyer'),
  'installments', pg_temp.today()) id) insert into ids select 's2', id from s;
with s as (select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b3'), pg_temp.id('buyer'), 'full_payment') id)
insert into ids select 's3', id from s;
with s as (select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b4'), pg_temp.id('buyer'), 'full_payment') id)
insert into ids select 's4', id from s;
with s as (select public.sale_register(pg_temp.id('campaign'), pg_temp.id('b5'), pg_temp.id('buyer'), 'full_payment') id)
insert into ids select 's5', id from s;

-- 2. Permission: admin and treasurer only.
select pg_temp.act_as(2);
select throws_ok($$select public.sale_mark_uncollectible(pg_temp.id('s1'), 'Buyer moved away')$$, '42501', null,
  'the operator cannot mark a sale uncollectible');
select pg_temp.act_as(4);
select throws_ok($$select public.sale_mark_uncollectible(pg_temp.id('s1'), 'Buyer moved away')$$, '42501', null,
  'read-only cannot mark a sale uncollectible');
reset role;
select is((select uncollectible_at from public.sales where id = pg_temp.id('s1')), null, 'denied attempts write nothing');
set local role authenticated;

-- 3. Mandatory reason.
select pg_temp.act_as(3);
select throws_ok($$select public.sale_mark_uncollectible(pg_temp.id('s1'), null)$$, '22023', null, 'a null reason is rejected');
select throws_ok($$select public.sale_mark_uncollectible(pg_temp.id('s1'), '   ')$$, '22023', null, 'a blank reason is rejected');
select throws_ok($$select public.sale_mark_uncollectible(pg_temp.id('s1'), repeat('x', 1001))$$, '22023', null,
  'a reason over 1000 characters is rejected');
select throws_ok($$select public.sale_mark_uncollectible('00000000-0000-0000-0000-000000000001', 'Gone')$$, 'P0002', null,
  'an unknown sale is rejected');

-- 4. The treasurer marks; the mark, the snapshot and the audit row are written.
select lives_ok($$select public.sale_mark_uncollectible(pg_temp.id('s1'), '  Buyer moved away, unreachable  ', 'req-663')$$,
  'the treasurer marks an active sale uncollectible');
reset role;
select is((select row(uncollectible_by, uncollectible_reason)::text from public.sales where id = pg_temp.id('s1')),
  row('b6630000-0000-0000-0000-000000000003'::uuid, 'Buyer moved away, unreachable')::text,
  'the mark stores who and the trimmed reason');
select ok((select uncollectible_at is not null from public.sales where id = pg_temp.id('s1')), 'the mark stores when');
select is((select financial_status_snapshot from public.bonds where id = pg_temp.id('b1')), 'uncollectible',
  'the bond snapshot becomes uncollectible');
select is((select row(actor_user_id, entity_type, reason, request_id, campaign_scope,
    old_value ->> 'financial_status_snapshot', new_value ->> 'financial_status_snapshot')::text
  from public.audit_log where action = 'sale.mark_uncollectible' and entity_id = pg_temp.id('s1')::text),
  row('b6630000-0000-0000-0000-000000000003'::uuid, 'sale', 'Buyer moved away, unreachable', 'req-663',
    pg_temp.id('campaign')::text, 'no_payments', 'uncollectible')::text,
  'one audit row with actor, reason, request id, campaign scope and the status change');
set local role authenticated;

-- 5. The admin can mark too; a mark is set once.
select pg_temp.act_as(1);
select lives_ok($$select public.sale_mark_uncollectible(pg_temp.id('s2'), 'Unpaid for a year')$$,
  'the admin marks an active sale uncollectible');
select throws_ok($$select public.sale_mark_uncollectible(pg_temp.id('s1'), 'Again')$$, '55000',
  'sale is already marked uncollectible', 'a sale cannot be marked twice');

-- 6. Only active sales.
reset role;
update public.sales set status = 'annulled' where id = pg_temp.id('s3');
set local role authenticated;
select throws_ok($$select public.sale_mark_uncollectible(pg_temp.id('s3'), 'Too late')$$, '55000', null,
  'an annulled sale cannot be marked');

-- 7. Only the function writes the mark, and it is final.
select throws_ok($$update public.sales set uncollectible_reason = 'x' where id = pg_temp.id('s4')$$, '42501', null,
  'authenticated users cannot write the mark directly');
reset role;
select throws_ok($$update public.sales set uncollectible_at = null, uncollectible_by = null, uncollectible_reason = null
  where id = pg_temp.id('s1')$$, '23001', null, 'the mark cannot be removed, even by the owner');
select throws_ok($$update public.sales set uncollectible_reason = 'Other' where id = pg_temp.id('s1')$$, '23001', null,
  'the reason cannot be rewritten');
select throws_ok($$update public.sales set uncollectible_at = now(), uncollectible_by = 'b6630000-0000-0000-0000-000000000001',
  uncollectible_reason = 'x' where id = pg_temp.id('s3')$$, '23001', null, 'an inactive sale cannot get a mark');
select throws_ok($$update public.sales set uncollectible_at = now() where id = pg_temp.id('s4')$$, '23514', null,
  'a partial mark (no actor or reason) is rejected');

-- 8. Precedence: the mark beats every installment-derived status, payments included.
update public.installments i set status = 'paid'
from public.payment_plans pp
where pp.id = i.payment_plan_id and pp.sale_id = pg_temp.id('s1') and i.installment_number = 1;
select is(public.bond_financial_status_from_installments(pg_temp.id('b1')), 'uncollectible',
  'a payment after the mark keeps the sale uncollectible');
update public.installments i set status = 'paid'
from public.payment_plans pp
where pp.id = i.payment_plan_id and pp.sale_id = pg_temp.id('s5');
select is(public.bond_financial_status_from_installments(pg_temp.id('b5')), 'fully_paid',
  'an unmarked sale keeps its installment-derived status');

-- 9. Grants.
select ok(not has_function_privilege('anon', 'public.sale_mark_uncollectible(uuid,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.sale_mark_uncollectible(uuid,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.sale_mark_uncollectible(uuid,text,text)', 'execute'),
  'only authenticated can execute sale_mark_uncollectible');

select * from finish();
rollback;
