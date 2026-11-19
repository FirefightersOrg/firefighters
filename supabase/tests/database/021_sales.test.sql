-- SAN-58: sales, payment_plans and installments tables, guards, privileges and RLS.
begin;
select plan(63);

-- auth ids / profiles: ...01 admin, ...02 operator, ...03 treasurer, ...04 read-only,
-- ...05 a collector's own login (collector role), ...06 no role at all.
insert into auth.users (id, email)
select ('a6210000-0000-0000-0000-00000000000' || n)::uuid, 'sales-' || n || '@example.com'
from generate_series(1, 6) as n;
insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b6210000-0000-0000-0000-00000000000' || n)::uuid,
  ('a6210000-0000-0000-0000-00000000000' || n)::uuid, 'Sales user ' || n,
  'sales-' || n || '@example.com', 'active'
from generate_series(1, 6) as n;
insert into public.user_roles (user_id, role_id)
select v.profile_id::uuid, r.id
from (values
  ('b6210000-0000-0000-0000-000000000001', 'admin'),
  ('b6210000-0000-0000-0000-000000000002', 'operator'),
  ('b6210000-0000-0000-0000-000000000003', 'treasurer'),
  ('b6210000-0000-0000-0000-000000000004', 'read-only'),
  ('b6210000-0000-0000-0000-000000000005', 'collector')
) as v (profile_id, role_name)
join public.roles r on r.name = v.role_name;

create function pg_temp.act_as(p_n int) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"a6210000-0000-0000-0000-00000000000%s","role":"authenticated"}', p_n), true);
$$;
grant execute on function pg_temp.act_as(int) to authenticated, anon;
create temporary table ids (k text primary key, id uuid not null);
grant select, insert on ids to authenticated, anon, service_role;
create function pg_temp.id(p_k text) returns uuid language sql stable as $$
  select id from ids where k = p_k;
$$;
grant execute on function pg_temp.id(text) to authenticated, anon, service_role;

-- Campaigns, collectors (Ana is linked to profile ...05), a buyer and bonds (owner).
with c as (
  insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('Sales', 60000, 10, 6000, 'base_number') returning id
)
insert into ids select 'c', id from c;
with c as (
  insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('Other', 60000, 10, 6000, 'base_number') returning id
)
insert into ids select 'c2', id from c;
with c as (
  insert into public.collectors (display_name, user_profile_id)
  values ('Ana', 'b6210000-0000-0000-0000-000000000005') returning id
)
insert into ids select 'ana', id from c;
with c as (insert into public.collectors (display_name) values ('Beto') returning id)
insert into ids select 'beto', id from c;
with b as (
  insert into public.buyers (type, first_name, last_name) values ('individual', 'Eva', 'Paz') returning id
)
insert into ids select 'buyer', id from b;
with b as (
  insert into public.bonds (campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
  select pg_temp.id('c'), 'simple', 'printed', 1, 60000, 'available' from generate_series(1, 3)
  returning id
)
insert into ids select 'b' || row_number() over (order by id), id from b;

-- Sale of b1 by Ana, sale of b2 by Beto; b1 has a 3-installment plan (owner, as the SAN-59
-- functions will).
create function pg_temp.sale(p_bond text, p_collector text, p_key text) returns void language sql as $$
  with s as (
    insert into public.sales (campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by)
    values (pg_temp.id('c'), pg_temp.id(p_bond), pg_temp.id('buyer'), pg_temp.id(p_collector),
      'installments', 60000, 'b6210000-0000-0000-0000-000000000002')
    returning id
  )
  insert into ids select p_key, id from s;
$$;
select pg_temp.sale('b1', 'ana', 's1');
select pg_temp.sale('b2', 'beto', 's2');
with p as (
  insert into public.payment_plans (sale_id, installment_count, total_amount)
  values (pg_temp.id('s1'), 3, 60000) returning id
)
insert into ids select 'p1', id from p;
with i as (
  insert into public.installments (payment_plan_id, installment_number, due_date, amount)
  select pg_temp.id('p1'), n, date '2026-12-10' + (n - 1) * interval '1 month', 20000
  from generate_series(1, 3) as n
  returning id, installment_number
)
insert into ids select 'i' || installment_number, id from i;

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
select columns_are('public', 'sales', array['id', 'campaign_id', 'bond_id', 'buyer_id',
  'collector_id', 'sold_at', 'payment_mode', 'total_amount', 'status', 'created_by', 'created_at',
  'updated_at'], 'sales columns');
select columns_are('public', 'payment_plans', array['id', 'sale_id', 'installment_count',
  'total_amount', 'status', 'created_at'], 'payment_plans columns');
select columns_are('public', 'installments', array['id', 'payment_plan_id', 'installment_number',
  'due_date', 'amount', 'status', 'updated_at'], 'installments columns');
select col_type_is('public', 'sales', 'total_amount', 'numeric(12,2)', 'sales.total_amount is numeric(12,2)');
select col_type_is('public', 'installments', 'due_date', 'date', 'installments.due_date is a date');
select fk_ok('public', 'sales', array['bond_id', 'campaign_id'], 'public', 'bonds', array['id', 'campaign_id'],
  'a sale''s bond is in the sale''s campaign');
select fk_ok('public', 'sales', 'buyer_id', 'public', 'buyers', 'id', 'sales.buyer_id references buyers');
select fk_ok('public', 'sales', 'collector_id', 'public', 'collectors', 'id', 'sales.collector_id references collectors');
select fk_ok('public', 'payment_plans', 'sale_id', 'public', 'sales', 'id', 'payment_plans.sale_id references sales');
select fk_ok('public', 'installments', 'payment_plan_id', 'public', 'payment_plans', 'id',
  'installments.payment_plan_id references payment_plans');
select col_is_unique('public', 'installments', array['payment_plan_id', 'installment_number'],
  'unique (payment_plan_id, installment_number)');

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.sales (campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by)
    values (pg_temp.id('c2'), pg_temp.id('b3'), pg_temp.id('buyer'), pg_temp.id('ana'), 'full_payment', 60000,
      'b6210000-0000-0000-0000-000000000001')$$,
  '23503', null, 'the bond must belong to the sale''s campaign'
);
select throws_ok(
  $$insert into public.sales (campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by)
    values (pg_temp.id('c'), pg_temp.id('b1'), pg_temp.id('buyer'), pg_temp.id('ana'), 'full_payment', 60000,
      'b6210000-0000-0000-0000-000000000001')$$,
  '23505', null, 'a bond has at most one active sale'
);
select throws_ok(
  $$insert into public.sales (campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by)
    values (pg_temp.id('c'), pg_temp.id('b3'), pg_temp.id('buyer'), pg_temp.id('ana'), 'barter', 60000,
      'b6210000-0000-0000-0000-000000000001')$$,
  '23514', null, 'payment_mode is full_payment or installments'
);
select throws_ok(
  $$insert into public.sales (campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by)
    values (pg_temp.id('c'), pg_temp.id('b3'), pg_temp.id('buyer'), pg_temp.id('ana'), 'full_payment', 0,
      'b6210000-0000-0000-0000-000000000001')$$,
  '23514', null, 'a sale total is positive'
);
select throws_ok(
  $$insert into public.sales (campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by, status)
    values (pg_temp.id('c'), pg_temp.id('b3'), pg_temp.id('buyer'), pg_temp.id('ana'), 'full_payment', 60000,
      'b6210000-0000-0000-0000-000000000001', 'annulled')$$,
  '23514', null, 'a new sale starts active'
);
select throws_ok(
  $$insert into public.payment_plans (sale_id, installment_count, total_amount)
    values (pg_temp.id('s1'), 3, 60000)$$,
  '23505', null, 'a sale has at most one active payment plan'
);
select throws_ok(
  $$insert into public.payment_plans (sale_id, installment_count, total_amount)
    values (pg_temp.id('s2'), 0, 60000)$$,
  '23514', null, 'a plan has at least one installment'
);
select throws_ok(
  $$insert into public.installments (payment_plan_id, installment_number, due_date, amount)
    values (pg_temp.id('p1'), 2, date '2027-01-10', 20000)$$,
  '23505', null, 'installment numbers are unique per plan'
);
select throws_ok(
  $$insert into public.installments (payment_plan_id, installment_number, due_date, amount)
    values (pg_temp.id('p1'), 0, date '2027-01-10', 20000)$$,
  '23514', null, 'installment numbers start at 1'
);
select throws_ok(
  $$insert into public.installments (payment_plan_id, installment_number, due_date, amount)
    values (pg_temp.id('p1'), 4, date '2027-01-10', -1)$$,
  '23514', null, 'an installment amount is positive'
);
select throws_ok(
  $$insert into public.installments (payment_plan_id, installment_number, due_date, amount, status)
    values (pg_temp.id('p1'), 4, date '2027-01-10', 1, 'paid')$$,
  '23514', null, 'a new installment starts pending'
);
select throws_ok(
  $$update public.installments set status = 'refunded' where id = pg_temp.id('i1')$$,
  '23514', null, 'installment status only allows the documented values'
);

-- ---------------------------------------------------------------------------
-- Transitions and immutability
-- ---------------------------------------------------------------------------
select lives_ok(
  $$update public.installments set status = 'overdue' where id = pg_temp.id('i1')$$,
  'installment pending -> overdue'
);
select lives_ok(
  $$update public.installments set status = 'paid' where id = pg_temp.id('i1')$$,
  'installment overdue -> paid'
);
select lives_ok(
  $$update public.installments set status = 'annulled' where id = pg_temp.id('i1')$$,
  'installment paid -> annulled'
);
select throws_ok(
  $$update public.installments set status = 'pending' where id = pg_temp.id('i1')$$,
  '23514', null, 'an annulled installment is final'
);
select lives_ok(
  $$update public.installments set status = 'paid_advance' where id = pg_temp.id('i2')$$,
  'installment pending -> paid_advance'
);
select throws_ok(
  $$update public.installments set status = 'overdue' where id = pg_temp.id('i2')$$,
  '23514', null, 'paid_advance cannot become overdue'
);
select throws_ok(
  $$update public.installments set amount = 1 where id = pg_temp.id('i3')$$,
  '23001', null, 'an installment amount never changes'
);
select throws_ok(
  $$update public.installments set due_date = date '2030-01-01' where id = pg_temp.id('i3')$$,
  '23001', null, 'an installment due date never changes'
);
select throws_ok(
  $$update public.payment_plans set installment_count = 5 where id = pg_temp.id('p1')$$,
  '23001', null, 'a plan''s installment count never changes'
);
select throws_ok(
  $$update public.sales set total_amount = 1 where id = pg_temp.id('s2')$$,
  '23001', null, 'a sale total never changes'
);
select throws_ok(
  $$update public.sales set buyer_id = pg_temp.id('buyer'), collector_id = pg_temp.id('ana') where id = pg_temp.id('s2')$$,
  '23001', null, 'a sale''s collector never changes'
);
select lives_ok(
  $$update public.sales set status = 'corrected' where id = pg_temp.id('s2')$$,
  'sale active -> corrected'
);
select throws_ok(
  $$update public.sales set status = 'active' where id = pg_temp.id('s2')$$,
  '23514', null, 'a corrected sale is final'
);
select lives_ok(
  $$insert into public.sales (campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by)
    values (pg_temp.id('c'), pg_temp.id('b2'), pg_temp.id('buyer'), pg_temp.id('beto'), 'full_payment', 60000,
      'b6210000-0000-0000-0000-000000000001')$$,
  'once corrected, the bond can have a new active sale'
);
select throws_ok(
  $$update public.payment_plans set status = 'paused' where id = pg_temp.id('p1')$$,
  '23514', null, 'plan status only allows active and annulled'
);

-- Consistency of sale, plan and installments (#54 review).
select pg_temp.sale('b3', 'beto', 's3');
select throws_ok(
  $$insert into public.payment_plans (sale_id, installment_count, total_amount) values (pg_temp.id('s3'), 3, 50000)$$,
  '23514', null, 'a plan total equals its sale total'
);
-- The new active sale of b2 is a full payment.
select throws_ok(
  $$insert into public.payment_plans (sale_id, installment_count, total_amount)
    select id, 3, 60000 from public.sales where bond_id = pg_temp.id('b2') and status = 'active'$$,
  '23514', null, 'a full payment plan has exactly one installment'
);
set constraints all immediate;
select throws_ok(
  $$insert into public.payment_plans (sale_id, installment_count, total_amount) values (pg_temp.id('s3'), 3, 60000)$$,
  '23514', null, 'at commit, an active plan needs all its installments'
);
select throws_ok(
  $$with p as (insert into public.payment_plans (sale_id, installment_count, total_amount)
      select id, 1, 60000 from public.sales where bond_id = pg_temp.id('b2') and status = 'active' returning id)
    insert into public.installments (payment_plan_id, installment_number, due_date, amount)
    select id, 1, date '2026-12-10', 59999 from p$$,
  '23514', null, 'at commit, the installments add up to the plan total'
);
select lives_ok(
  $$with p as (insert into public.payment_plans (sale_id, installment_count, total_amount)
      select id, 1, 60000 from public.sales where bond_id = pg_temp.id('b2') and status = 'active' returning id)
    insert into public.installments (payment_plan_id, installment_number, due_date, amount)
    select id, 1, date '2026-12-10', 60000 from p$$,
  'a consistent full payment plan is accepted'
);
set constraints all deferred;

-- No deletion, for any role.
select throws_ok($$delete from public.sales where id = pg_temp.id('s1')$$,
  '23001', null, 'sales are never deleted');
select throws_ok($$delete from public.payment_plans where id = pg_temp.id('p1')$$,
  '23001', null, 'payment plans are never deleted');
select throws_ok($$delete from public.installments where id = pg_temp.id('i3')$$,
  '23001', null, 'installments are never deleted');
select throws_ok($$truncate public.payment_installments, public.payments, public.settlements,
  public.installments, public.payment_plans, public.sales$$,
  '23001', null, 'sales tables cannot be truncated');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
select ok(
  has_table_privilege('authenticated', 'public.sales', 'select')
  and not has_table_privilege('authenticated', 'public.sales', 'insert')
  and not has_table_privilege('authenticated', 'public.sales', 'update')
  and not has_table_privilege('authenticated', 'public.installments', 'insert')
  and not has_table_privilege('authenticated', 'public.installments', 'update')
  and not has_table_privilege('authenticated', 'public.payment_plans', 'insert'),
  'authenticated only reads sales, plans and installments'
);
select ok(
  not has_table_privilege('anon', 'public.sales', 'select')
  and not has_table_privilege('anon', 'public.installments', 'select')
  and not has_table_privilege('authenticated', 'public.sales', 'delete')
  and not has_table_privilege('service_role', 'public.sales', 'delete'),
  'anon reads nothing; nobody has DELETE'
);
select ok(
  not has_function_privilege('authenticated', 'public.sales_guard_update()', 'execute')
  and not has_function_privilege('service_role', 'public.installments_guard_update()', 'execute')
  and has_function_privilege('authenticated', 'public.sale_can_read()', 'execute')
  and not has_function_privilege('anon', 'public.sale_can_read()', 'execute'),
  'trigger functions are internal; the RLS helper runs for authenticated'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.sales'::regclass, 'public.payment_plans'::regclass, 'public.installments'::regclass)),
  'RLS is enabled on the three tables'
);

-- ---------------------------------------------------------------------------
-- RLS reads
-- ---------------------------------------------------------------------------
set local role authenticated;

select pg_temp.act_as(2);
select throws_ok(
  $$insert into public.sales (campaign_id, bond_id, buyer_id, collector_id, payment_mode, total_amount, created_by)
    values (pg_temp.id('c'), pg_temp.id('b3'), pg_temp.id('buyer'), pg_temp.id('ana'), 'full_payment', 60000,
      'b6210000-0000-0000-0000-000000000002')$$,
  '42501', null, 'even with sale.create, the operator cannot insert a sale directly'
);
select throws_ok(
  $$update public.installments set status = 'paid' where id = pg_temp.id('i3')$$,
  '42501', null, 'the operator cannot change an installment directly'
);
select is((select count(*)::int from public.sales where campaign_id = pg_temp.id('c')), 4,
  'the operator (sale.create, bond.view) reads every sale');
select is((select count(*)::int from public.installments where payment_plan_id = pg_temp.id('p1')), 3,
  'the operator reads the installments');

select pg_temp.act_as(1);
select is((select count(*)::int from public.sales where campaign_id = pg_temp.id('c')), 4,
  'the admin reads every sale');
select pg_temp.act_as(3);
select is((select count(*)::int from public.payment_plans where sale_id = pg_temp.id('s1')), 1,
  'the treasurer (bond.view) reads the plans');
select pg_temp.act_as(4);
select is((select count(*)::int from public.installments where payment_plan_id = pg_temp.id('p1')), 3,
  'read-only (bond.view) reads the installments');

-- The collector's own login sees its sales and their plans/installments, nobody else's.
select pg_temp.act_as(5);
select is((select array_agg(id) from public.sales), array[pg_temp.id('s1')],
  'a collector''s own login reads only its own sales');
select is((select count(*)::int from public.installments
  where payment_plan_id in (select p.id from public.payment_plans p where p.sale_id = pg_temp.id('s1'))), 3,
  'and the installments of its own sales');

select pg_temp.act_as(6);
select is((select count(*)::int from public.sales), 0, 'a user without permissions reads no sale');
select is((select count(*)::int from public.payment_plans), 0, 'nor any plan');
select is((select count(*)::int from public.installments), 0, 'nor any installment');

reset role;
select * from finish();
rollback;
