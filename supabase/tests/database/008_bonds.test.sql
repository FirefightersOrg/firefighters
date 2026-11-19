begin;
select plan(200);

-- ---------------------------------------------------------------------------
-- Fixtures (created as the test owner)
-- ---------------------------------------------------------------------------
-- auth ids / profiles:
--   ...01 admin      (bond.view, bond.create, bond.annul, campaign.update_rules, ...)
--   ...02 operator   (bond.view)
--   ...03 treasurer  (bond.view)
--   ...04 read-only  (bond.view)
--   ...05 collector  (no bond.view)
--   ...06 no roles
insert into auth.users (id, email)
select ('a8000000-0000-0000-0000-00000000000' || n)::uuid, 'bonds-' || n || '@example.com'
from generate_series(1, 6) as n;

insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b8000000-0000-0000-0000-00000000000' || n)::uuid,
  ('a8000000-0000-0000-0000-00000000000' || n)::uuid,
  'Bonds user ' || n, 'bonds-' || n || '@example.com', 'active'
from generate_series(1, 6) as n;

insert into public.user_roles (user_id, role_id)
select v.profile_id::uuid, r.id
from (values
  ('b8000000-0000-0000-0000-000000000001', 'admin'),
  ('b8000000-0000-0000-0000-000000000002', 'operator'),
  ('b8000000-0000-0000-0000-000000000003', 'treasurer'),
  ('b8000000-0000-0000-0000-000000000004', 'read-only'),
  ('b8000000-0000-0000-0000-000000000005', 'collector')
) as v (profile_id, role_name)
join public.roles r on r.name = v.role_name;

create function pg_temp.act_as(p_n int) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    format('{"sub":"a8000000-0000-0000-0000-00000000000%s","role":"authenticated"}', p_n),
    true
  );
$$;
grant execute on function pg_temp.act_as(int) to authenticated, anon;

create temporary table ids (k text primary key, id uuid not null);
grant select on ids to authenticated, anon, service_role;

-- Campaigns (as the owner): 60000 in 10 installments, 4 digits, max 9999, offset 4871.
with c as (
  insert into public.campaigns
    (name, simple_bond_value, installment_count, installment_value, barcode_mode, starts_at, ends_at)
  select v.name, 60000, 10, 6000, 'base_number', '2026-03-01 00:00-03', '2026-12-31 23:59:59-03'
  from (values ('Draft'), ('Other'), ('Active'), ('Closing'), ('Closed'), ('Annulled'), ('Freeze'))
    as v (name)
  returning id, name
)
insert into ids select 'c-' || lower(c.name), c.id from c;
update public.campaigns set status = 'active'
where id in (select id from ids where k in ('c-active', 'c-closing', 'c-closed'));
update public.campaigns set status = 'closing'
where id in (select id from ids where k in ('c-closing', 'c-closed'));
update public.campaigns set status = 'closed' where id = (select id from ids where k = 'c-closed');
update public.campaigns set status = 'annulled' where id = (select id from ids where k = 'c-annulled');

-- New bond as the owner: total_value = simple_bond_value * units (the guard requires it).
create function pg_temp.bond(
  p_campaign text,
  p_kind text default 'simple',
  p_origin text default 'printed',
  p_units int default 1,
  p_barcode text default null,
  p_code text default null,
  p_status text default 'available'
) returns uuid language sql as $$
  insert into public.bonds
    (campaign_id, kind, origin, commercial_unit_count, total_value, barcode, internal_code,
     commercial_status, created_by)
  select c.id, p_kind, p_origin, p_units, c.simple_bond_value * p_units, p_barcode, p_code,
    p_status, 'b8000000-0000-0000-0000-000000000001'
  from public.campaigns c join ids on ids.id = c.id and ids.k = p_campaign
  returning id;
$$;

create function pg_temp.id(p_k text) returns uuid language sql stable as $$
  select id from ids where k = p_k;
$$;
grant execute on function pg_temp.id(text) to authenticated, anon, service_role;

-- Annul (available -> annulled) with the required annulment data.
create function pg_temp.annul(p_k text) returns void language sql as $$
  update public.bonds
  set commercial_status = 'annulled', annulled_by = 'b8000000-0000-0000-0000-000000000001',
    annul_reason = 'Loaded by mistake'
  where id = pg_temp.id(p_k);
$$;

create function pg_temp.set_status(p_k text, p_status text) returns void language sql as $$
  update public.bonds set commercial_status = p_status where id = pg_temp.id(p_k);
$$;

-- New number as the owner.
create function pg_temp.num(
  p_bond text,
  p_value int,
  p_kind text default 'base',
  p_source text default null
) returns uuid language sql as $$
  insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind, source_base_number_id)
  select b.campaign_id, b.id, p_value, p_kind, pg_temp.id(p_source)
  from public.bonds b where b.id = pg_temp.id(p_bond)
  returning id;
$$;

-- New group membership as the owner.
create function pg_temp.grp(p_pata text, p_member text) returns uuid language sql as $$
  insert into public.bond_groups (pata_bond_id, member_bond_id, grouped_by)
  values (pg_temp.id(p_pata), pg_temp.id(p_member), 'b8000000-0000-0000-0000-000000000001')
  returning id;
$$;

-- ---------------------------------------------------------------------------
-- Definitions, grants and RLS
-- ---------------------------------------------------------------------------
select has_table('public', 'bonds', 'bonds exists');
select has_table('public', 'bond_numbers', 'bond_numbers exists');
select has_table('public', 'bond_groups', 'bond_groups exists');
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.bonds'::regclass, 'public.bond_numbers'::regclass, 'public.bond_groups'::regclass)),
  'RLS is enabled on bonds, bond_numbers and bond_groups'
);
select col_type_is('public', 'bonds', 'total_value', 'numeric(14,2)', 'bonds.total_value is numeric(14,2)');
select col_type_is('public', 'bond_numbers', 'number_value', 'integer', 'bond_numbers.number_value is an integer');
select col_default_is('public', 'bonds', 'commercial_status', 'available', 'bonds.commercial_status defaults to available');
select col_default_is('public', 'bonds', 'financial_status_snapshot', 'no_payments', 'bonds.financial_status_snapshot defaults to no_payments');
select col_default_is('public', 'bonds', 'commercial_unit_count', '1', 'bonds.commercial_unit_count defaults to 1');
select ok(
  (select count(*) = 2 from pg_constraint
   where conrelid = 'public.bonds'::regclass and contype = 'f'
     and conname in ('bonds_current_collector_fkey', 'bonds_current_buyer_fkey')),
  'current_collector_id / current_buyer_id reference collectors / buyers (Phase 5, SAN-49)'
);
select col_is_null('public', 'bonds', 'current_collector_id', 'current_collector_id is nullable');
select col_is_null('public', 'bonds', 'current_buyer_id', 'current_buyer_id is nullable');
select has_index('public', 'bonds', 'bonds_campaign_status_idx', array['campaign_id', 'commercial_status'],
  'index bonds(campaign_id, commercial_status)');
select has_index('public', 'bonds', 'bonds_campaign_collector_idx', array['campaign_id', 'current_collector_id'],
  'index bonds(campaign_id, current_collector_id)');
select has_index('public', 'bond_groups', 'bond_groups_pata_bond_id_idx', 'pata_bond_id', 'index bond_groups(pata_bond_id)');
select has_index('public', 'bond_groups', 'bond_groups_member_bond_id_idx', 'member_bond_id', 'index bond_groups(member_bond_id)');
select is(
  (select string_agg(format('%s unique=%s where %s', c.relname, i.indisunique,
      pg_get_expr(i.indpred, i.indrelid)), E'\n' order by c.relname)
   from pg_index i join pg_class c on c.oid = i.indexrelid
   where c.relname in ('bond_numbers_campaign_number_key', 'bond_numbers_one_associated_per_base',
     'bonds_campaign_barcode_key', 'bonds_campaign_internal_code_key', 'bond_groups_active_member_key')),
  concat_ws(E'\n',
    'bond_groups_active_member_key unique=t where (ungrouped_at IS NULL)',
    'bond_numbers_campaign_number_key unique=t where (released_at IS NULL)',
    'bond_numbers_one_associated_per_base unique=t where (number_kind = ''associated''::text)',
    'bonds_campaign_barcode_key unique=t where ((barcode IS NOT NULL) AND ((commercial_status <> ''annulled''::text) OR (annulled_from_status IS DISTINCT FROM ''available''::text)))',
    'bonds_campaign_internal_code_key unique=t where ((internal_code IS NOT NULL) AND ((commercial_status <> ''annulled''::text) OR (annulled_from_status IS DISTINCT FROM ''available''::text)))'),
  'partial unique indexes: active numbers, one associated per base, codes held unless annulled from available, active members'
);
select ok(
  has_table_privilege('authenticated', 'public.bonds', 'select')
  and has_table_privilege('authenticated', 'public.bond_numbers', 'select')
  and has_table_privilege('authenticated', 'public.bond_groups', 'select')
  and not exists (
    select 1
    from (values ('public.bonds'), ('public.bond_numbers'), ('public.bond_groups')) as t (tbl)
    cross join (values ('insert'), ('update'), ('delete'), ('truncate')) as p (priv)
    where has_table_privilege('authenticated', t.tbl, p.priv)
  ),
  'authenticated: SELECT only on the three tables'
);
select ok(
  not exists (
    select 1
    from (values ('public.bonds'), ('public.bond_numbers'), ('public.bond_groups')) as t (tbl)
    cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate')) as p (priv)
    where has_table_privilege('anon', t.tbl, p.priv)
  ),
  'anon: no access to the three tables'
);
select ok(
  not exists (
    select 1
    from (values ('public.bonds'), ('public.bond_numbers'), ('public.bond_groups')) as t (tbl)
    cross join (values ('select', true), ('insert', true), ('update', true), ('delete', false),
      ('truncate', false)) as p (priv, expected)
    where has_table_privilege('service_role', t.tbl, p.priv) <> p.expected
  ),
  'service_role: select/insert/update, never delete or truncate'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r (role_name)
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('bonds_guard_write', 'bond_numbers_guard_write', 'bond_groups_guard_write',
                        'bond_tables_forbid_delete', 'campaigns_rules_frozen_with_bonds')
      and has_function_privilege(r.role_name, p.oid, 'execute')
  ),
  'trigger functions are not executable by API roles'
);
select ok(
  (select bool_and(p.proconfig @> array['search_path=""'])
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('bonds_guard_write', 'bond_numbers_guard_write', 'bond_groups_guard_write',
                       'bond_tables_forbid_delete', 'campaigns_rules_frozen_with_bonds')),
  'trigger functions use an empty search_path'
);
select is(
  (select string_agg(format('%s %s %s %s', tablename, policyname, cmd, roles), E'\n' order by tablename)
   from pg_policies where schemaname = 'public' and tablename in ('bonds', 'bond_numbers', 'bond_groups')),
  concat_ws(E'\n',
    'bond_groups bond_groups_select SELECT {authenticated}',
    'bond_numbers bond_numbers_select SELECT {authenticated}',
    'bonds bonds_select SELECT {authenticated}'),
  'one SELECT policy per table, for authenticated only'
);

-- ---------------------------------------------------------------------------
-- bonds: table constraints (direct writes as the owner)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select pg_temp.bond('c-draft', 'ticket', 'printed', 2)$$,
  '23514', 'new row for relation "bonds" violates check constraint "bonds_kind_check"',
  'constraint: unknown kind'
);
select throws_ok(
  $$select pg_temp.bond('c-draft', 'pata', 'found', 2)$$,
  '23514', 'new row for relation "bonds" violates check constraint "bonds_origin_check"',
  'constraint: unknown origin'
);
select throws_ok(
  $$select pg_temp.bond('c-draft', 'simple', 'manual_grouping')$$,
  '23514', 'new row for relation "bonds" violates check constraint "bonds_simple_is_printed"',
  'constraint: a simple bond is always printed'
);
select throws_ok(
  $$select pg_temp.bond('c-draft', 'simple', 'printed', 2)$$,
  '23514', 'new row for relation "bonds" violates check constraint "bonds_commercial_unit_count_by_kind"',
  'constraint: a simple bond has commercial_unit_count = 1'
);
select throws_ok(
  $$select pg_temp.bond('c-draft', 'pata', 'printed', 1)$$,
  '23514', 'new row for relation "bonds" violates check constraint "bonds_commercial_unit_count_by_kind"',
  'constraint: a pata has commercial_unit_count >= 2'
);
select throws_ok(
  $$select pg_temp.bond('c-draft', p_barcode => '   ')$$,
  '23514', 'new row for relation "bonds" violates check constraint "bonds_barcode_valid"',
  'constraint: blank barcode'
);
select throws_ok(
  $$select pg_temp.bond('c-draft', p_barcode => ' 0068 ')$$,
  '23514', 'new row for relation "bonds" violates check constraint "bonds_barcode_valid"',
  'constraint: barcode with surrounding whitespace'
);
select throws_ok(
  $$select pg_temp.bond('c-draft', p_code => '')$$,
  '23514', 'new row for relation "bonds" violates check constraint "bonds_internal_code_valid"',
  'constraint: blank internal code'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.bonds'::regclass
    and conname = 'bonds_total_value_positive'
    and pg_get_constraintdef(oid) like '%''NaN''::numeric%'),
  'constraint: total_value rejects NaN (bonds_total_value_positive)'
);
select ok(
  (select count(*) = 2 from pg_constraint where conrelid = 'public.bonds'::regclass
    and conname in ('bonds_commercial_status_check', 'bonds_financial_status_snapshot_check')),
  'constraint: commercial_status and financial_status_snapshot domains'
);
select throws_ok(
  $$insert into public.bonds (campaign_id, kind, origin, total_value, annulled_from_status)
    values (pg_temp.id('c-draft'), 'simple', 'printed', 60000, 'available')$$,
  '23514', 'new row for relation "bonds" violates check constraint "bonds_annulment_consistent"',
  'constraint: a new (not annulled) bond has no annulled_from_status'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.bonds'::regclass
    and conname = 'bonds_annulled_from_status_check'
    and pg_get_constraintdef(oid) like '%available%sold%'),
  'constraint: annulled_from_status is available or sold (bonds_annulled_from_status_check)'
);

-- ---------------------------------------------------------------------------
-- bonds: guard on insert (campaign status, initial status, value, server timestamps)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.bonds (campaign_id, kind, origin, total_value)
    values (pg_temp.id('c-draft'), 'simple', 'printed', 50000)$$,
  '23514', 'bond total value must be 60000.00 (simple bond value 60000.00 x 1 units), got 50000.00',
  'guard: a simple bond is worth the campaign simple bond value'
);
select throws_ok(
  $$insert into public.bonds (campaign_id, kind, origin, commercial_unit_count, total_value)
    values (pg_temp.id('c-draft'), 'pata', 'printed', 3, 120000)$$,
  '23514', 'bond total value must be 180000.00 (simple bond value 60000.00 x 3 units), got 120000.00',
  'guard: a pata is worth simple bond value x N'
);
select throws_ok(
  $$insert into public.bonds (campaign_id, kind, origin, total_value)
    values (pg_temp.id('c-draft'), 'simple', 'printed', 'NaN')$$,
  '23514', 'bond total value must be 60000.00 (simple bond value 60000.00 x 1 units), got NaN',
  'guard: NaN total value is rejected'
);
select throws_ok(
  $$select pg_temp.bond('c-draft', p_status => 'sold')$$,
  '23514', 'new bonds must start in created or available status (got sold)',
  'guard: new bonds cannot start sold'
);
select throws_ok(
  $$select pg_temp.bond('c-draft', p_status => 'annulled')$$,
  '23514', 'new bonds must start in created or available status (got annulled)',
  'guard: new bonds cannot start annulled'
);
select throws_ok(
  $$insert into public.bonds (campaign_id, kind, origin, total_value, financial_status_snapshot)
    values (pg_temp.id('c-draft'), 'simple', 'printed', 60000, 'fully_paid')$$,
  '23514', 'new bonds must start with financial status no_payments (got fully_paid)',
  'guard: new bonds start without payments'
);
select throws_ok(
  $$select pg_temp.bond('c-closing')$$,
  '55000', 'bonds can only be created while the campaign is draft or active (status: closing)',
  'guard: no bonds for a closing campaign'
);
select throws_ok(
  $$select pg_temp.bond('c-closed')$$,
  '55000', 'bonds can only be created while the campaign is draft or active (status: closed)',
  'guard: no bonds for a closed campaign'
);
select throws_ok(
  $$select pg_temp.bond('c-annulled')$$,
  '55000', 'bonds can only be created while the campaign is draft or active (status: annulled)',
  'guard: no bonds for an annulled campaign'
);
select lives_ok(
  $$insert into ids values
      ('s1', pg_temp.bond('c-draft', p_barcode => '0068', p_code => 'A-0068')),
      ('s-active', pg_temp.bond('c-active', p_barcode => '0068')),
      ('s-created', pg_temp.bond('c-draft', p_status => 'created')),
      ('pp', pg_temp.bond('c-draft', 'pata', 'printed', 2, '0100')),
      ('mp', pg_temp.bond('c-draft', 'pata', 'manual_grouping', 2))$$,
  'guard: simple bonds, printed and manual patas in draft and active campaigns (available or created)'
);
select results_eq(
  $$select b.kind, b.origin, b.commercial_status, b.financial_status_snapshot,
      b.commercial_unit_count, b.total_value
    from public.bonds b where b.id in (pg_temp.id('s1'), pg_temp.id('pp')) order by b.kind desc$$,
  $$values ('simple'::text, 'printed'::text, 'available'::text, 'no_payments'::text, 1, 60000.00::numeric),
           ('pata', 'printed', 'available', 'no_payments', 2, 120000.00)$$,
  'stored: available, no payments, total value = simple bond value x units'
);
select lives_ok(
  $$with b as (
      insert into public.bonds (campaign_id, kind, origin, total_value, created_at, updated_at)
      values (pg_temp.id('c-draft'), 'simple', 'printed', 60000, '2000-01-01', '2000-01-01')
      returning id)
    insert into ids select 'ts', id from b$$,
  'insert with client-supplied timestamps'
);
select results_eq(
  $$select created_at = now(), updated_at = now() from public.bonds where id = pg_temp.id('ts')$$,
  $$values (true, true)$$,
  'guard: created_at and updated_at are set by the database on insert'
);

-- ---------------------------------------------------------------------------
-- bonds: guard on update (immutable columns, status machine, annulment, terminal states)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.bonds set campaign_id = pg_temp.id('c-other') where id = pg_temp.id('s1')$$,
  '23001', 'bonds.id, campaign_id, kind, origin, commercial_unit_count, total_value, created_at and created_by cannot be changed',
  'guard: campaign_id is immutable'
);
select throws_ok(
  $$update public.bonds set kind = 'pata', commercial_unit_count = 2, total_value = 120000 where id = pg_temp.id('s1')$$,
  '23001', 'bonds.id, campaign_id, kind, origin, commercial_unit_count, total_value, created_at and created_by cannot be changed',
  'guard: kind, commercial_unit_count and total_value are immutable'
);
select throws_ok(
  $$update public.bonds set origin = 'manual_grouping' where id = pg_temp.id('pp')$$,
  '23001', 'bonds.id, campaign_id, kind, origin, commercial_unit_count, total_value, created_at and created_by cannot be changed',
  'guard: origin is immutable'
);
select throws_ok(
  $$update public.bonds set created_at = '2000-01-01' where id = pg_temp.id('s1')$$,
  '23001', 'bonds.id, campaign_id, kind, origin, commercial_unit_count, total_value, created_at and created_by cannot be changed',
  'guard: created_at is immutable'
);
select lives_ok(
  $$update public.bonds set updated_at = '2000-01-01' where id = pg_temp.id('ts')$$,
  'update with a client-supplied updated_at'
);
select is(
  (select updated_at from public.bonds where id = pg_temp.id('ts')), now(),
  'guard: updated_at is set by the database on update'
);

select throws_ok(
  $$select pg_temp.set_status('s1', 'sold')$$,
  '23514', 'invalid bond status transition: available -> sold',
  'transition: available -> sold is not allowed (deliver first)'
);
select throws_ok(
  $$select pg_temp.set_status('s1', 'created')$$,
  '23514', 'invalid bond status transition: available -> created',
  'transition: back to created is not allowed'
);
select throws_ok(
  $$select pg_temp.set_status('s-created', 'delivered_to_collector')$$,
  '23514', 'invalid bond status transition: created -> delivered_to_collector',
  'transition: created bonds must be made available first'
);
select throws_ok(
  $$update public.bonds set commercial_status = 'annulled', annulled_by = 'b8000000-0000-0000-0000-000000000001',
      annul_reason = 'x' where id = pg_temp.id('s-created')$$,
  '23514', 'invalid bond status transition: created -> annulled',
  'transition: created -> annulled is not allowed'
);
select lives_ok($$select pg_temp.set_status('s-created', 'available')$$, 'transition: created -> available');

-- Full happy path: available -> delivered -> returned -> available -> delivered -> sold -> closed.
select lives_ok(
  $$insert into ids values ('flow', pg_temp.bond('c-active'));
    select pg_temp.set_status('flow', 'delivered_to_collector');
    select pg_temp.set_status('flow', 'returned');
    select pg_temp.set_status('flow', 'available');
    select pg_temp.set_status('flow', 'delivered_to_collector');
    select pg_temp.set_status('flow', 'sold');$$,
  'transition: available -> delivered -> returned -> available -> delivered -> sold'
);
select throws_ok(
  $$select pg_temp.set_status('flow', 'returned')$$,
  '23514', 'invalid bond status transition: sold -> returned',
  'transition: a sold bond cannot be returned'
);
select lives_ok($$select pg_temp.set_status('flow', 'closed')$$, 'transition: sold -> closed');
select throws_ok(
  $$update public.bonds set barcode = '9999' where id = pg_temp.id('flow')$$,
  '55000', null,
  'terminal: a closed bond cannot be changed'
);
select lives_ok(
  $$update public.bonds set financial_status_snapshot = 'fully_paid' where id = pg_temp.id('flow')$$,
  'terminal: the financial snapshot of a closed bond can still be recalculated'
);
select throws_ok(
  $$update public.bonds set financial_status_snapshot = 'paid' where id = pg_temp.id('flow')$$,
  '23514', 'new row for relation "bonds" violates check constraint "bonds_financial_status_snapshot_check"',
  'constraint: unknown financial status'
);

select lives_ok(
  $$insert into ids values ('lost', pg_temp.bond('c-active'));
    select pg_temp.set_status('lost', 'lost');$$,
  'transition: available -> lost'
);
select throws_ok(
  $$select pg_temp.set_status('lost', 'available')$$,
  '23514', 'invalid bond status transition: lost -> available',
  'transition: lost is final'
);
select lives_ok(
  $$insert into ids values ('lost2', pg_temp.bond('c-active'));
    select pg_temp.set_status('lost2', 'delivered_to_collector');
    select pg_temp.set_status('lost2', 'lost');$$,
  'transition: delivered_to_collector -> lost'
);

-- Annulment of a bond loaded by mistake (available -> annulled).
select throws_ok(
  $$select pg_temp.set_status('ts', 'annulled')$$,
  '23514', 'new row for relation "bonds" violates check constraint "bonds_annulment_consistent"',
  'annul: who and why are required'
);
select throws_ok(
  $$update public.bonds set commercial_status = 'annulled', annulled_by = 'b8000000-0000-0000-0000-000000000001',
      annul_reason = '  ' where id = pg_temp.id('ts')$$,
  '23514', 'new row for relation "bonds" violates check constraint "bonds_annulment_consistent"',
  'annul: a blank reason is rejected'
);
select throws_ok(
  $$update public.bonds set annul_reason = 'x' where id = pg_temp.id('ts')$$,
  '23514', 'new row for relation "bonds" violates check constraint "bonds_annulment_consistent"',
  'annul: a non-annulled bond carries no annulment data'
);
select lives_ok(
  $$update public.bonds set commercial_status = 'annulled', annulled_by = 'b8000000-0000-0000-0000-000000000001',
      annul_reason = 'Loaded by mistake', annulled_at = '2000-01-01' where id = pg_temp.id('ts')$$,
  'transition: available -> annulled with who and why'
);
select is(
  (select annulled_at from public.bonds where id = pg_temp.id('ts')), now(),
  'annul: annulled_at is set by the database'
);
select is(
  (select annulled_from_status from public.bonds where id = pg_temp.id('ts')), 'available',
  'annul: annulled_from_status records the previous status'
);
select throws_ok(
  $$update public.bonds set annulled_from_status = 'sold' where id = pg_temp.id('ts')$$,
  '23001', 'bonds.annulled_from_status is set by the database when the bond is annulled and cannot be changed',
  'annul: annulled_from_status is immutable once annulled'
);
select throws_ok(
  $$update public.bonds set annulled_from_status = 'available' where id = pg_temp.id('s-created')$$,
  '23001', 'bonds.annulled_from_status is set by the database when the bond is annulled and cannot be changed',
  'annul: callers cannot set annulled_from_status'
);
select lives_ok(
  $$insert into ids values ('ts2', pg_temp.bond('c-active'));
    update public.bonds set commercial_status = 'annulled', annulled_by = 'b8000000-0000-0000-0000-000000000001',
      annul_reason = 'Loaded by mistake', annulled_from_status = 'sold' where id = pg_temp.id('ts2');$$,
  'annul: with a client-supplied annulled_from_status'
);
select is(
  (select annulled_from_status from public.bonds where id = pg_temp.id('ts2')), 'available',
  'annul: a client-supplied annulled_from_status is overwritten by the database'
);
select throws_ok(
  $$select pg_temp.set_status('ts', 'available')$$,
  '55000', null,
  'terminal: an annulled bond cannot be restored'
);
select throws_ok(
  $$update public.bonds set annul_reason = 'Other reason' where id = pg_temp.id('ts')$$,
  '55000', null,
  'terminal: an annulled bond cannot be changed'
);
select throws_ok(
  $$select pg_temp.set_status('lost2', 'annulled')$$,
  '23514', 'invalid bond status transition: lost -> annulled',
  'transition: only available (or sold) bonds are annulled'
);

-- ---------------------------------------------------------------------------
-- bonds: barcode / internal code uniqueness per campaign (freed only by a mistaken-load annulment)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select pg_temp.bond('c-draft', p_barcode => '0068')$$,
  '23505', 'duplicate key value violates unique constraint "bonds_campaign_barcode_key"',
  'unique: barcode per campaign'
);
select throws_ok(
  $$select pg_temp.bond('c-draft', p_code => 'A-0068')$$,
  '23505', 'duplicate key value violates unique constraint "bonds_campaign_internal_code_key"',
  'unique: internal code per campaign'
);
select lives_ok(
  $$select pg_temp.bond('c-other', p_barcode => '0068', p_code => 'A-0068')$$,
  'unique: the same codes in another campaign are fine'
);
select lives_ok(
  $$select pg_temp.bond('c-draft'); select pg_temp.bond('c-draft');$$,
  'unique: several bonds without codes'
);
select lives_ok(
  $$insert into ids values ('dup', pg_temp.bond('c-draft', p_barcode => '0500', p_code => 'A-0500'));
    select pg_temp.annul('dup');
    insert into ids values ('dup2', pg_temp.bond('c-draft', p_barcode => '0500', p_code => 'A-0500'));$$,
  'unique: codes of a bond annulled from available can be used again'
);
-- A bond annulled from sold (Phase 10) keeps its codes held, like its numbers.
select lives_ok(
  $$insert into ids values ('code-sold', pg_temp.bond('c-draft', p_barcode => '0600', p_code => 'A-0600'));
    select pg_temp.set_status('code-sold', 'delivered_to_collector');
    select pg_temp.set_status('code-sold', 'sold');
    select pg_temp.annul('code-sold');$$,
  'unique: a sold bond with codes is annulled'
);
select throws_ok(
  $$select pg_temp.bond('c-draft', p_barcode => '0600')$$,
  '23505', 'duplicate key value violates unique constraint "bonds_campaign_barcode_key"',
  'unique: the barcode of a bond annulled from sold cannot be reused'
);
select throws_ok(
  $$select pg_temp.bond('c-draft', p_code => 'A-0600')$$,
  '23505', 'duplicate key value violates unique constraint "bonds_campaign_internal_code_key"',
  'unique: the internal code of a bond annulled from sold cannot be reused'
);

-- ---------------------------------------------------------------------------
-- bond_numbers
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into ids values ('n68', pg_temp.num('s1', 68));
    insert into ids values ('n68a', pg_temp.num('s1', 4939, 'associated', 'n68'));$$,
  'numbers: simple bond with base 68 and associated 68 + 4871 = 4939'
);
select results_eq(
  $$select n.campaign_id, n.number_value, n.number_kind, n.source_base_number_id, n.created_at = now(),
      n.released_at is null
    from public.bond_numbers n where n.bond_id = pg_temp.id('s1') order by n.number_value$$,
  $$values (pg_temp.id('c-draft'), 68, 'base'::text, null::uuid, true, true),
           (pg_temp.id('c-draft'), 4939, 'associated', pg_temp.id('n68'), true, true)$$,
  'numbers: stored with the bond campaign, server created_at, not released'
);
select throws_ok(
  $$select pg_temp.num('s1', 69)$$,
  '23514', null,
  'numbers: a simple bond has one base number'
);
select throws_ok(
  $$insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind)
    values (pg_temp.id('c-other'), pg_temp.id('s-created'), 70, 'base')$$,
  '23503', 'insert or update on table "bond_numbers" violates foreign key constraint "bond_numbers_bond_fkey"',
  'numbers: campaign_id must be the bond campaign'
);
select throws_ok(
  $$select pg_temp.num('s-created', 10000)$$,
  '23514', 'number 10000 exceeds the campaign maximum number (9999)',
  'numbers: number_value <= campaigns.max_number'
);
select lives_ok(
  $$insert into ids values ('n9999', pg_temp.num('s-created', 9999))$$,
  'numbers: max_number itself is accepted'
);
select throws_ok(
  $$select pg_temp.num('dup2', -1)$$,
  '23514', 'new row for relation "bond_numbers" violates check constraint "bond_numbers_number_value_nonnegative"',
  'numbers: number_value >= 0'
);
select throws_ok(
  $$select pg_temp.num('dup2', 1, 'bonus')$$,
  '23514', 'new row for relation "bond_numbers" violates check constraint "bond_numbers_number_kind_check"',
  'numbers: unknown kind'
);
select throws_ok(
  $$select pg_temp.num('dup2', 4871, 'associated')$$,
  '23514', 'new row for relation "bond_numbers" violates check constraint "bond_numbers_source_by_kind"',
  'numbers: an associated number needs its base number'
);
select throws_ok(
  $$select pg_temp.num('dup2', 1, 'base', 'n68')$$,
  '23514', 'new row for relation "bond_numbers" violates check constraint "bond_numbers_source_by_kind"',
  'numbers: a base number has no source'
);
select throws_ok(
  $$select pg_temp.num('dup2', 5000, 'associated', 'n9999')$$,
  '23503', 'insert or update on table "bond_numbers" violates foreign key constraint "bond_numbers_source_base_number_fkey"',
  'numbers: the base number must belong to the same bond'
);
select lives_ok(
  $$insert into ids values ('n1', pg_temp.num('dup2', 1))$$,
  'numbers: base 1'
);
select throws_ok(
  $$select pg_temp.num('dup2', 4873, 'associated', 'n1')$$,
  '23514', 'associated number must be 4872 (base 1 + offset 4871), got 4873',
  'numbers: associated = base + associated_number_offset'
);
select throws_ok(
  $$select pg_temp.num('s-created', 4871 + 9999, 'associated', 'n9999')$$,
  '23514', 'number 14870 exceeds the campaign maximum number (9999)',
  'numbers: an associated number above max_number is rejected (overflow_policy reject)'
);
select throws_ok(
  $$select pg_temp.num('dup2', 68)$$,
  '23514', null,
  'numbers: a second base number on a simple bond is rejected before the duplicate'
);
select throws_ok(
  $$select pg_temp.num('pp', 68)$$,
  '23505', 'duplicate key value violates unique constraint "bond_numbers_campaign_number_key"',
  'unique: a participating number belongs to one bond per campaign'
);
select throws_ok(
  $$select pg_temp.num('pp', 4939)$$,
  '23505', 'duplicate key value violates unique constraint "bond_numbers_campaign_number_key"',
  'unique: across kinds (an associated number cannot be another bond base number)'
);
select lives_ok(
  $$select pg_temp.num('s-active', 68)$$,
  'unique: the same number in another campaign is fine'
);
select lives_ok(
  $$insert into ids values ('pp-b1', pg_temp.num('pp', 200)), ('pp-b2', pg_temp.num('pp', 201));
    select pg_temp.num('pp', 5071, 'associated', 'pp-b1');
    select pg_temp.num('pp', 5072, 'associated', 'pp-b2');$$,
  'numbers: a printed pata of 2 owns 2 base + 2 associated numbers'
);
select throws_ok(
  $$select pg_temp.num('pp', 202)$$,
  '23514', null,
  'numbers: a pata has commercial_unit_count base numbers at most'
);
select lives_ok(
  $$select pg_temp.num('pp', 300, 'extraordinary')$$,
  'numbers: extraordinary numbers are not limited by the unit count'
);
select throws_ok(
  $$select pg_temp.num('pp', 4939 - 4871 + 1000, 'associated', 'pp-b1')$$,
  '23514', null,
  'numbers: a pata has commercial_unit_count associated numbers at most'
);
select throws_ok(
  $$select pg_temp.num('mp', 400)$$,
  '23514', 'a manually grouped pata has no numbers of its own (its members keep theirs)',
  'numbers: a manual pata has no numbers'
);
select throws_ok(
  $$select pg_temp.num('ts', 401)$$,
  '55000', null,
  'numbers: no numbers for an annulled bond'
);
select throws_ok(
  $$insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind, released_at, released_by)
    values (pg_temp.id('c-draft'), pg_temp.id('mp'), 402, 'extraordinary', now(), 'b8000000-0000-0000-0000-000000000001')$$,
  '23514', 'new bond numbers cannot be released',
  'numbers: a new number cannot be released'
);
select throws_ok(
  $$update public.bond_numbers set number_value = 70 where id = pg_temp.id('n68')$$,
  '23001', 'bond_numbers.id, campaign_id, bond_id, number_value, number_kind, source_base_number_id and created_at cannot be changed',
  'numbers: number_value is immutable'
);
select throws_ok(
  $$update public.bond_numbers set bond_id = pg_temp.id('dup2') where id = pg_temp.id('n68')$$,
  '23001', 'bond_numbers.id, campaign_id, bond_id, number_value, number_kind, source_base_number_id and created_at cannot be changed',
  'numbers: bond_id is immutable'
);
select throws_ok(
  $$update public.bond_numbers set released_by = 'b8000000-0000-0000-0000-000000000001', released_at = now()
    where id = pg_temp.id('n68')$$,
  '55000', 'bond numbers can only be released once their bond is annulled (status: available)',
  'release: only numbers of an annulled bond are released'
);

-- Annul s1 and release its numbers: 68 / 4939 can be entered again, the history stays.
select lives_ok(
  $$select pg_temp.annul('s1')$$,
  'release: annul the bond loaded by mistake'
);
select throws_ok(
  $$update public.bond_numbers set released_at = now() where id = pg_temp.id('n68')$$,
  '23514', 'new row for relation "bond_numbers" violates check constraint "bond_numbers_release_consistent"',
  'release: who released it is required'
);
select lives_ok(
  $$update public.bond_numbers set released_by = 'b8000000-0000-0000-0000-000000000001', released_at = '2000-01-01'
    where bond_id = pg_temp.id('s1')$$,
  'release: numbers of the annulled bond are released'
);
select is(
  (select count(*)::int from public.bond_numbers where bond_id = pg_temp.id('s1') and released_at = now()),
  2, 'release: released_at is set by the database'
);
select is(
  (select annulled_from_status from public.bonds where id = pg_temp.id('s1')), 'available',
  'release: allowed because the bond was annulled from available (mistaken load)'
);
select throws_ok(
  $$update public.bond_numbers set released_by = 'b8000000-0000-0000-0000-000000000002' where id = pg_temp.id('n68')$$,
  '55000', null,
  'release: a released number cannot be changed'
);
select lives_ok(
  $$insert into ids values ('s1b', pg_temp.bond('c-draft', p_barcode => '0068', p_code => 'A-0068'));
    insert into ids values ('n68b', pg_temp.num('s1b', 68));
    select pg_temp.num('s1b', 4939, 'associated', 'n68b');$$,
  'release: the same number and codes are entered again on a new bond'
);
select results_eq(
  $$select b.commercial_status, n.number_kind, n.released_at is not null
    from public.bond_numbers n join public.bonds b on b.id = n.bond_id
    where n.campaign_id = pg_temp.id('c-draft') and n.number_value = 68
    order by n.released_at nulls last$$,
  $$values ('annulled'::text, 'base'::text, true), ('available', 'base', false)$$,
  'release: history keeps the released number of the annulled bond'
);
select throws_ok(
  $$select pg_temp.num('pp', 68, 'extraordinary')$$,
  '23505', 'duplicate key value violates unique constraint "bond_numbers_campaign_number_key"',
  'release: the re-entered number is unique again'
);

-- An annulled sale (sold -> annulled, Phase 10) keeps its numbers held: only a mistaken load
-- (annulled from available) releases them.
select lives_ok(
  $$insert into ids values ('sold1', pg_temp.bond('c-draft'));
    insert into ids values ('n2500', pg_temp.num('sold1', 2500));
    select pg_temp.num('sold1', 7371, 'associated', 'n2500');
    select pg_temp.set_status('sold1', 'delivered_to_collector');
    select pg_temp.set_status('sold1', 'sold');
    select pg_temp.annul('sold1');$$,
  'release: a sold bond with numbers is annulled'
);
select is(
  (select annulled_from_status from public.bonds where id = pg_temp.id('sold1')), 'sold',
  'release: the annulled sale records annulled_from_status sold'
);
select throws_ok(
  $$update public.bond_numbers set released_by = 'b8000000-0000-0000-0000-000000000001', released_at = now()
    where bond_id = pg_temp.id('sold1')$$,
  '55000', 'bond numbers can only be released when their bond was annulled from available (annulled from: sold)',
  'release: numbers of a bond annulled from sold cannot be released'
);
select is(
  (select count(*)::int from public.bond_numbers where bond_id = pg_temp.id('sold1') and released_at is null),
  2, 'release: the annulled sale keeps its numbers held'
);
select throws_ok(
  $$insert into ids values ('sold2', pg_temp.bond('c-draft')); select pg_temp.num('sold2', 2500);$$,
  '23505', 'duplicate key value violates unique constraint "bond_numbers_campaign_number_key"',
  'release: another bond cannot take a number of an annulled sale'
);
select throws_ok(
  $$insert into ids values ('sold3', pg_temp.bond('c-draft')); select pg_temp.num('sold3', 7371, 'extraordinary');$$,
  '23505', 'duplicate key value violates unique constraint "bond_numbers_campaign_number_key"',
  'release: nor its associated number'
);

-- ---------------------------------------------------------------------------
-- bond_groups (manual patas)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into ids values
      ('m1', pg_temp.bond('c-draft')), ('m2', pg_temp.bond('c-draft')), ('m3', pg_temp.bond('c-draft')),
      ('m-other', pg_temp.bond('c-other')),
      ('mp2', pg_temp.bond('c-draft', 'pata', 'manual_grouping', 2)),
      ('mp-other', pg_temp.bond('c-other', 'pata', 'manual_grouping', 2));
    select pg_temp.num('m1', 1001); select pg_temp.num('m2', 1002);$$,
  'groups: fixtures (simple bonds with numbers, manual patas)'
);
select lives_ok(
  $$insert into ids values ('g1', pg_temp.grp('mp', 'm1')), ('g2', pg_temp.grp('mp', 'm2'))$$,
  'groups: a manual pata of 2 groups two available simple bonds'
);
select results_eq(
  $$select g.grouped_by, g.grouped_at = now(), g.ungrouped_at, g.ungrouped_by, g.reason
    from public.bond_groups g where g.id = pg_temp.id('g1')$$,
  $$values ('b8000000-0000-0000-0000-000000000001'::uuid, true, null::timestamptz, null::uuid, null::text)$$,
  'groups: active membership, grouped_at set by the database'
);
select is(
  (select count(*)::int from public.bond_numbers where bond_id in (pg_temp.id('m1'), pg_temp.id('m2'))),
  2, 'groups: members keep their own numbers'
);
select throws_ok(
  $$select pg_temp.grp('mp', 'm3')$$,
  '23514', null,
  'groups: a pata has commercial_unit_count members at most'
);
select throws_ok(
  $$select pg_temp.grp('mp2', 'm1')$$,
  '23505', 'duplicate key value violates unique constraint "bond_groups_active_member_key"',
  'groups: a simple bond belongs to one active pata'
);
select throws_ok(
  $$select pg_temp.grp('pp', 'm3')$$,
  '23514', null,
  'groups: printed patas do not use bond_groups'
);
select throws_ok(
  $$select pg_temp.grp('m1', 'm3')$$,
  '23514', null,
  'groups: the group must be a pata'
);
select throws_ok(
  $$select pg_temp.grp('mp2', 'pp')$$,
  '23514', null,
  'groups: only simple bonds are members'
);
select throws_ok(
  $$select pg_temp.grp('mp2', 'm-other')$$,
  '23514', 'a pata and its members must belong to the same campaign',
  'groups: members belong to the pata campaign'
);
select throws_ok(
  $$select pg_temp.grp('mp2', 'ts')$$,
  '55000', 'only available bonds can be grouped (pata: available, member: annulled)',
  'groups: an annulled bond cannot be grouped'
);
select throws_ok(
  $$update public.bond_groups set member_bond_id = pg_temp.id('m3') where id = pg_temp.id('g1')$$,
  '23001', 'bond_groups.id, pata_bond_id, member_bond_id, grouped_at and grouped_by cannot be changed',
  'groups: composition columns are immutable'
);

-- Members are blocked from individual operations while grouped.
select throws_ok(
  $$select pg_temp.set_status('m1', 'delivered_to_collector')$$,
  '55000', null,
  'groups: an active member cannot be delivered on its own'
);
select throws_ok(
  $$select pg_temp.annul('m1')$$,
  '55000', null,
  'groups: an active member cannot be annulled on its own'
);
select throws_ok(
  $$update public.bonds set barcode = '7777' where id = pg_temp.id('m1')$$,
  '55000', null,
  'groups: an active member cannot be edited on its own'
);
select is(
  (select commercial_status from public.bonds where id = pg_temp.id('m1')), 'available',
  'groups: members keep their commercial status'
);
select throws_ok(
  $$select pg_temp.annul('mp')$$,
  '55000', format('manually grouped pata %s has 2 active members and must be ungrouped before annulment', pg_temp.id('mp')),
  'groups: a manual pata with active members cannot be annulled directly'
);

-- Ungrouping (reason and who are required; the row stays as history).
select throws_ok(
  $$update public.bond_groups set ungrouped_at = now(), ungrouped_by = 'b8000000-0000-0000-0000-000000000002'
    where id = pg_temp.id('g1')$$,
  '23514', 'new row for relation "bond_groups" violates check constraint "bond_groups_ungrouping_consistent"',
  'ungroup: a reason is required'
);
select throws_ok(
  $$update public.bond_groups set reason = 'Note' where id = pg_temp.id('g1')$$,
  '23514', 'new row for relation "bond_groups" violates check constraint "bond_groups_ungrouping_consistent"',
  'ungroup: an active membership has no reason'
);
select lives_ok(
  $$update public.bond_groups set ungrouped_at = '2000-01-01', ungrouped_by = 'b8000000-0000-0000-0000-000000000002',
      reason = 'Customer wants them separately' where pata_bond_id = pg_temp.id('mp')$$,
  'ungroup: with who and why'
);
select is(
  (select count(*)::int from public.bond_groups where pata_bond_id = pg_temp.id('mp') and ungrouped_at = now()),
  2, 'ungroup: ungrouped_at is set by the database, rows are kept'
);
select throws_ok(
  $$update public.bond_groups set reason = 'Other' where id = pg_temp.id('g1')$$,
  '55000', null,
  'ungroup: an ungrouped row cannot be changed'
);
select lives_ok(
  $$update public.bonds set barcode = '7777' where id = pg_temp.id('m1')$$,
  'ungroup: the former member can be operated again'
);
select lives_ok(
  $$select pg_temp.grp('mp2', 'm1')$$,
  'ungroup: the former member can join another pata'
);
select is(
  (select count(*)::int from public.bond_groups where member_bond_id = pg_temp.id('m1')),
  2, 'groups: membership history is kept'
);
select throws_ok(
  $$select pg_temp.set_status('m2', 'delivered_to_collector'); select pg_temp.grp('mp2', 'm2');$$,
  '55000', 'only available bonds can be grouped (pata: available, member: delivered_to_collector)',
  'groups: only available simple bonds are grouped'
);

-- A sold manual pata cannot be ungrouped.
select lives_ok(
  $$select pg_temp.grp('mp2', 'm3');
    select pg_temp.set_status('mp2', 'delivered_to_collector');
    select pg_temp.set_status('mp2', 'sold');$$,
  'groups: the manual pata itself is delivered and sold'
);
select throws_ok(
  $$update public.bond_groups set ungrouped_at = now(), ungrouped_by = 'b8000000-0000-0000-0000-000000000001',
      reason = 'Too late' where pata_bond_id = pg_temp.id('mp2')$$,
  '55000', 'only an available pata can be ungrouped (pata status: sold)',
  'ungroup: a sold pata keeps its members'
);

-- A manual pata leaves available only with all its members, and is ungrouped only while available.
select lives_ok(
  $$select pg_temp.grp('mp-other', 'm-other')$$,
  'groups: a manual pata of 2 with one member so far'
);
select throws_ok(
  $$select pg_temp.set_status('mp-other', 'delivered_to_collector')$$,
  '55000', format('manually grouped pata %s has 1 of 2 members and cannot leave available', pg_temp.id('mp-other')),
  'groups: a manual pata cannot be delivered without all its members'
);
select throws_ok(
  $$select pg_temp.set_status('mp-other', 'lost')$$,
  '55000', format('manually grouped pata %s has 1 of 2 members and cannot leave available', pg_temp.id('mp-other')),
  'groups: nor leave available in any other way (lost)'
);
select lives_ok(
  $$insert into ids values ('m-other2', pg_temp.bond('c-other')), ('m-other3', pg_temp.bond('c-other'));
    select pg_temp.grp('mp-other', 'm-other2');
    select pg_temp.set_status('mp-other', 'delivered_to_collector');$$,
  'groups: a complete manual pata is delivered'
);
select throws_ok(
  $$select pg_temp.grp('mp-other', 'm-other3')$$,
  '55000', 'only available bonds can be grouped (pata: delivered_to_collector, member: available)',
  'groups: members are added while the pata is available'
);
select throws_ok(
  $$update public.bond_groups set ungrouped_at = now(), ungrouped_by = 'b8000000-0000-0000-0000-000000000001',
      reason = 'Collector has it' where pata_bond_id = pg_temp.id('mp-other')$$,
  '55000', 'only an available pata can be ungrouped (pata status: delivered_to_collector)',
  'ungroup: a pata delivered to a collector cannot be ungrouped'
);
select lives_ok(
  $$select pg_temp.set_status('mp-other', 'returned')$$,
  'groups: the manual pata is returned'
);
select throws_ok(
  $$update public.bond_groups set ungrouped_at = now(), ungrouped_by = 'b8000000-0000-0000-0000-000000000001',
      reason = 'Returned' where pata_bond_id = pg_temp.id('mp-other')$$,
  '55000', 'only an available pata can be ungrouped (pata status: returned)',
  'ungroup: a returned pata cannot be ungrouped (make it available first)'
);
select is(
  (select count(*)::int from public.bond_groups where pata_bond_id = pg_temp.id('mp-other') and ungrouped_at is null),
  2, 'ungroup: the rejected ungroupings keep every member'
);

-- ---------------------------------------------------------------------------
-- Never deleted (owner backstop) and no direct writes for API roles
-- ---------------------------------------------------------------------------
select throws_ok(
  $$delete from public.bonds where id = pg_temp.id('ts')$$,
  '23001', 'bonds cannot be deleted: DELETE is not allowed (annul, release or ungroup instead)',
  'delete: bonds (owner)'
);
select throws_ok(
  $$delete from public.bond_numbers where id = pg_temp.id('n68')$$,
  '23001', 'bond_numbers cannot be deleted: DELETE is not allowed (annul, release or ungroup instead)',
  'delete: bond_numbers (owner)'
);
select throws_ok(
  $$delete from public.bond_groups where id = pg_temp.id('g1')$$,
  '23001', 'bond_groups cannot be deleted: DELETE is not allowed (annul, release or ungroup instead)',
  'delete: bond_groups (owner)'
);
select throws_ok(
  $$truncate public.bond_groups$$,
  '23001', 'bond_groups cannot be deleted: TRUNCATE is not allowed (annul, release or ungroup instead)',
  'truncate: bond_groups (owner)'
);
select throws_ok(
  -- Every table referencing bonds is listed so the FK check does not fail first:
  -- import_session_items (SAN-44), delivery_note_items and bond_assignments (SAN-53), and the
  -- sales tables (SAN-58).
  $$truncate public.bonds, public.bond_numbers, public.bond_groups, public.import_session_items,
    public.delivery_note_items, public.bond_assignments, public.installments,
    public.payment_plans, public.sales$$,
  '23001', null,
  'truncate: bonds and bond_numbers (owner)'
);

set local role service_role;
select throws_ok(
  $$delete from public.bonds$$,
  '42501', 'permission denied for table bonds',
  'service_role cannot delete bonds'
);
select throws_ok(
  $$insert into public.bonds (campaign_id, kind, origin, total_value) values (pg_temp.id('c-closed'), 'simple', 'printed', 60000)$$,
  '55000', 'bonds can only be created while the campaign is draft or active (status: closed)',
  'service_role writes go through the same guard'
);
select lives_ok(
  $$insert into public.bonds (campaign_id, kind, origin, total_value) values (pg_temp.id('c-active'), 'simple', 'printed', 60000)$$,
  'service_role can insert bonds'
);
reset role;

set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$insert into public.bonds (campaign_id, kind, origin, total_value) values (pg_temp.id('c-draft'), 'simple', 'printed', 60000)$$,
  '42501', 'permission denied for table bonds',
  'authenticated (even admin) cannot insert bonds directly'
);
select throws_ok(
  $$update public.bond_numbers set released_at = now()$$,
  '42501', 'permission denied for table bond_numbers',
  'authenticated cannot update bond_numbers directly'
);
select throws_ok(
  $$insert into public.bond_groups (pata_bond_id, member_bond_id, grouped_by) values (pg_temp.id('mp'), pg_temp.id('m3'), 'b8000000-0000-0000-0000-000000000001')$$,
  '42501', 'permission denied for table bond_groups',
  'authenticated cannot insert bond_groups directly'
);
reset role;

-- ---------------------------------------------------------------------------
-- RLS: bond.view
-- ---------------------------------------------------------------------------
create temporary table expected_counts as
select (select count(*) from public.bonds)::int as bonds,
  (select count(*) from public.bond_numbers)::int as numbers,
  (select count(*) from public.bond_groups)::int as groups;
grant select on expected_counts to authenticated;

create function pg_temp.visible() returns text language sql stable as $$
  select format('%s/%s/%s',
    (select count(*) from public.bonds), (select count(*) from public.bond_numbers),
    (select count(*) from public.bond_groups));
$$;
grant execute on function pg_temp.visible() to authenticated;

select ok((select bonds > 0 and numbers > 0 and groups > 0 from expected_counts), 'RLS: fixtures exist');

set local role authenticated;
select pg_temp.act_as(1);
select is(pg_temp.visible(), (select format('%s/%s/%s', bonds, numbers, groups) from expected_counts),
  'RLS: admin sees every bond, number and group');
select pg_temp.act_as(2);
select is(pg_temp.visible(), (select format('%s/%s/%s', bonds, numbers, groups) from expected_counts),
  'RLS: operator (bond.view) sees everything');
select pg_temp.act_as(3);
select is(pg_temp.visible(), (select format('%s/%s/%s', bonds, numbers, groups) from expected_counts),
  'RLS: treasurer (bond.view) sees everything');
select pg_temp.act_as(4);
select is(pg_temp.visible(), (select format('%s/%s/%s', bonds, numbers, groups) from expected_counts),
  'RLS: read-only (bond.view) sees everything');
select pg_temp.act_as(5);
select is(pg_temp.visible(), '0/0/0', 'RLS: collector (no bond.view) sees nothing');
select pg_temp.act_as(6);
select is(pg_temp.visible(), '0/0/0', 'RLS: a user without roles sees nothing');
reset role;

set local role anon;
select throws_ok(
  $$select count(*) from public.bonds$$,
  '42501', 'permission denied for table bonds',
  'anon cannot read bonds'
);
reset role;

-- ---------------------------------------------------------------------------
-- Campaign rules are frozen once the campaign has bonds (even in draft)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$update public.campaigns set max_number = 99999, number_digits = 5 where id = pg_temp.id('c-freeze')$$,
  'freeze: a draft without bonds can still change its rules'
);
select lives_ok(
  $$insert into ids values ('f1', pg_temp.bond('c-freeze')); select pg_temp.annul('f1');$$,
  'freeze: a bond is created in the draft (and annulled: it still counts)'
);
select throws_ok(
  $$update public.campaigns set max_number = 9999, number_digits = 4 where id = pg_temp.id('c-freeze')$$,
  '55000', 'campaign rules cannot be changed once the campaign has bonds',
  'freeze: numbering rules are frozen'
);
select throws_ok(
  $$update public.campaigns set associated_number_offset = 100 where id = pg_temp.id('c-freeze')$$,
  '55000', 'campaign rules cannot be changed once the campaign has bonds',
  'freeze: the associated number offset is frozen'
);
select throws_ok(
  $$update public.campaigns set simple_bond_value = 120000, installment_value = 12000 where id = pg_temp.id('c-freeze')$$,
  '55000', 'campaign rules cannot be changed once the campaign has bonds',
  'freeze: the bond value is frozen'
);
select throws_ok(
  $$update public.campaigns set installment_count = 12, installment_value = 5000 where id = pg_temp.id('c-freeze')$$,
  '55000', 'campaign rules cannot be changed once the campaign has bonds',
  'freeze: installments are frozen'
);
select throws_ok(
  $$update public.campaigns set barcode_mode = 'internal_code' where id = pg_temp.id('c-freeze')$$,
  '55000', 'campaign rules cannot be changed once the campaign has bonds',
  'freeze: the barcode mode is frozen'
);
select lives_ok(
  $$update public.campaigns set max_number = max_number, name = 'Freeze renamed', ends_at = '2027-01-31 23:59:59-03'
    where id = pg_temp.id('c-freeze')$$,
  'freeze: name and dates stay editable; unchanged rules are not a change'
);
select throws_ok(
  $$update public.campaigns set max_number = 5000 where id = pg_temp.id('c-active')$$,
  '55000', 'campaign rules can only be changed while the campaign is draft (status: active)',
  'freeze: outside draft the status message comes first'
);

set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$select public.campaign_update_rules(pg_temp.id('c-freeze'), 60000, 12, 5, 99999, 4871, 'reject', 'base_number',
      (select updated_at from public.campaigns where id = pg_temp.id('c-freeze')), 'req-freeze', 'More installments')$$,
  '55000', 'campaign rules cannot be changed once the campaign has bonds',
  'freeze: campaign_update_rules is rejected for a draft with bonds'
);
select lives_ok(
  $$select public.campaign_transition(pg_temp.id('c-freeze'), 'active', null, 'req-freeze-activate')$$,
  'freeze: a draft with bonds can still be activated'
);
reset role;
select is(
  (select count(*)::int from public.audit_log where request_id = 'req-freeze'),
  0, 'freeze: no audit row for the rejected rules change'
);

select * from finish();
rollback;
