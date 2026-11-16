begin;
select plan(136);

-- ---------------------------------------------------------------------------
-- Fixtures (created as the test owner, which bypasses RLS and privileges; triggers still fire)
-- ---------------------------------------------------------------------------
-- auth ids: d1 admin, d2 operator, d3 no roles, d4 inactive admin
insert into auth.users (id, email)
select ('d0000000-0000-0000-0000-00000000000' || n)::uuid, 'campaign-user-' || n || '@example.com'
from generate_series(1, 4) as n;

insert into public.profiles (id, auth_user_id, full_name, email, status) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Admin', 'campaign-user-1@example.com', 'active'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'Operator', 'campaign-user-2@example.com', 'active'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 'No roles', 'campaign-user-3@example.com', 'active'),
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000004', 'Inactive admin', 'campaign-user-4@example.com', 'inactive');

insert into public.user_roles (user_id, role_id)
select v.profile_id::uuid, r.id
from (values
  ('e0000000-0000-0000-0000-000000000001', 'admin'),
  ('e0000000-0000-0000-0000-000000000002', 'operator'),
  ('e0000000-0000-0000-0000-000000000004', 'admin')
) as v (profile_id, role_name)
join public.roles r on r.name = v.role_name;

-- Campaigns f02..f06 start as drafts; the transition tests move them through the state machine.
-- f01 is inserted by the defaults test below.
insert into public.campaigns (id, name, simple_bond_value, installment_count, installment_value, barcode_mode)
select ('f0000000-0000-0000-0000-00000000000' || n)::uuid, 'Fixture ' || n, 60000, 10, 6000, 'base_number'
from generate_series(2, 6) as n;

-- Returns the DETAIL of the error raised by p_sql (null when it succeeds).
create function pg_temp.error_detail(p_sql text) returns text language plpgsql as $$
declare
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;

-- ---------------------------------------------------------------------------
-- Schema: columns, types, nullability, defaults, keys, indexes
-- ---------------------------------------------------------------------------
select has_table('public', 'campaigns', 'campaigns table exists');
select columns_are('public', 'campaigns', array[
  'id', 'name', 'status', 'starts_at', 'ends_at', 'simple_bond_value', 'installment_count',
  'installment_value', 'number_digits', 'max_number', 'associated_number_offset', 'overflow_policy',
  'barcode_mode', 'created_by', 'created_at', 'updated_at'
], 'campaigns has exactly the expected columns');
select col_type_is('public', 'campaigns', 'id', 'uuid', 'id is uuid');
select col_type_is('public', 'campaigns', 'name', 'text', 'name is text');
select col_type_is('public', 'campaigns', 'status', 'text', 'status is text');
select col_type_is('public', 'campaigns', 'starts_at', 'timestamp with time zone', 'starts_at is timestamptz');
select col_type_is('public', 'campaigns', 'ends_at', 'timestamp with time zone', 'ends_at is timestamptz');
select col_type_is('public', 'campaigns', 'simple_bond_value', 'numeric(14,2)', 'simple_bond_value is numeric(14,2)');
select col_type_is('public', 'campaigns', 'installment_count', 'integer', 'installment_count is integer');
select col_type_is('public', 'campaigns', 'installment_value', 'numeric(14,2)', 'installment_value is numeric(14,2)');
select col_type_is('public', 'campaigns', 'number_digits', 'integer', 'number_digits is integer');
select col_type_is('public', 'campaigns', 'max_number', 'integer', 'max_number is integer');
select col_type_is('public', 'campaigns', 'associated_number_offset', 'integer', 'associated_number_offset is integer');
select col_type_is('public', 'campaigns', 'overflow_policy', 'text', 'overflow_policy is text');
select col_type_is('public', 'campaigns', 'barcode_mode', 'text', 'barcode_mode is text');
select col_type_is('public', 'campaigns', 'created_by', 'uuid', 'created_by is uuid');
select col_type_is('public', 'campaigns', 'created_at', 'timestamp with time zone', 'created_at is timestamptz');
select col_type_is('public', 'campaigns', 'updated_at', 'timestamp with time zone', 'updated_at is timestamptz');
select set_eq(
  $$select column_name::text from information_schema.columns
    where table_schema = 'public' and table_name = 'campaigns' and is_nullable = 'YES'$$,
  array['starts_at', 'ends_at', 'created_by'],
  'only starts_at, ends_at and created_by are nullable'
);
select col_default_is('public', 'campaigns', 'status', 'draft'::text, 'status defaults to draft');
select col_default_is('public', 'campaigns', 'number_digits', 4, 'number_digits defaults to 4');
select col_default_is('public', 'campaigns', 'max_number', 9999, 'max_number defaults to 9999');
select col_default_is('public', 'campaigns', 'associated_number_offset', 4871, 'associated_number_offset defaults to 4871');
select col_default_is('public', 'campaigns', 'overflow_policy', 'reject'::text, 'overflow_policy defaults to reject');
select col_is_pk('public', 'campaigns', 'id', 'id is the primary key');
select fk_ok('public', 'campaigns', 'created_by', 'public', 'profiles', 'id', 'created_by references profiles(id)');
select has_index('public', 'campaigns', 'campaigns_status_idx', 'index on status');
select has_index('public', 'campaigns', 'campaigns_starts_at_idx', 'index on starts_at');
select has_index('public', 'campaigns', 'campaigns_created_by_idx', 'index on created_by (FK)');

-- ---------------------------------------------------------------------------
-- RLS, policies and privileges
-- ---------------------------------------------------------------------------
select ok(
  (select c.relrowsecurity and not c.relforcerowsecurity from pg_class c
   where c.oid = 'public.campaigns'::regclass),
  'RLS is enabled (not forced) on campaigns'
);
select is(
  (select array_agg(cmd || ':' || array_to_string(roles, ',')) from pg_policies
   where schemaname = 'public' and tablename = 'campaigns'),
  array['SELECT:authenticated'], 'campaigns has only a SELECT policy for authenticated'
);
select table_privs_are('public', 'campaigns', 'anon', array[]::text[], 'anon has no privileges on campaigns');
select table_privs_are('public', 'campaigns', 'authenticated', array['SELECT'], 'authenticated can only SELECT campaigns');
select table_privs_are('public', 'campaigns', 'service_role', array['SELECT', 'INSERT', 'UPDATE'],
  'service_role can SELECT/INSERT/UPDATE campaigns (no DELETE, no TRUNCATE)');
select ok(
  not has_function_privilege('authenticated', 'public.campaigns_guard_write()', 'execute')
  and not has_function_privilege('anon', 'public.campaigns_guard_write()', 'execute')
  and not has_function_privilege('authenticated', 'public.campaigns_forbid_delete()', 'execute'),
  'campaign trigger functions are not executable by API roles'
);

-- ---------------------------------------------------------------------------
-- Defaults and server-controlled timestamps
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.campaigns
      (id, name, simple_bond_value, installment_count, installment_value, barcode_mode, created_by, created_at, updated_at)
    values ('f0000000-0000-0000-0000-000000000001', 'Campaign 2026', 60000, 10, 6000, 'base_number',
      'e0000000-0000-0000-0000-000000000001', '2000-01-01', '2000-01-01')$$,
  'minimal draft campaign is created'
);
select results_eq(
  $$select status, number_digits, max_number, associated_number_offset, overflow_policy,
      created_at = now(), updated_at = now()
    from public.campaigns where id = 'f0000000-0000-0000-0000-000000000001'$$,
  $$values ('draft'::text, 4, 9999, 4871, 'reject'::text, true, true)$$,
  'defaults applied: draft, 4 digits, max 9999, offset 4871, reject; timestamps forced to now()'
);

-- ---------------------------------------------------------------------------
-- CHECK constraints
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
    values ('   ', 60000, 10, 6000, 'base_number')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_name_not_blank"',
  'blank name is rejected'
);
-- The write guard rejects non-draft inserts first, so disable it to reach the CHECK itself.
alter table public.campaigns disable trigger campaigns_guard_write;
select throws_ok(
  $$insert into public.campaigns (name, status, simple_bond_value, installment_count, installment_value, barcode_mode)
    values ('Bad status', 'paused', 60000, 10, 6000, 'base_number')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_status_check"',
  'unknown status is rejected by the CHECK'
);
alter table public.campaigns enable trigger campaigns_guard_write;
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode, starts_at, ends_at)
    values ('Same dates', 60000, 10, 6000, 'base_number', '2026-03-01', '2026-03-01')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_dates_order"',
  'ends_at equal to starts_at is rejected'
);
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode, starts_at, ends_at)
    values ('Reversed dates', 60000, 10, 6000, 'base_number', '2026-12-01', '2026-03-01')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_dates_order"',
  'ends_at before starts_at is rejected'
);
select lives_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode, starts_at)
    values ('Open-ended', 60000, 10, 6000, 'base_number', '2026-03-01')$$,
  'starts_at without ends_at is allowed'
);
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
    values ('Zero value', 0, 10, 0, 'base_number')$$,
  '23514', null, 'simple_bond_value 0 is rejected'
);
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
    values ('Negative value', -60000, 10, -6000, 'base_number')$$,
  '23514', null, 'negative simple_bond_value is rejected'
);
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
    values ('Zero installments', 60000, 0, 6000, 'base_number')$$,
  '23514', null, 'installment_count 0 is rejected'
);
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
    values ('Zero installment value', 60000, 10, 0, 'base_number')$$,
  '23514', null, 'installment_value 0 is rejected'
);
select lives_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
    values ('Exact installments', 60000, 10, 6000, 'base_number')$$,
  '60000 in 10 installments of 6000 is accepted'
);
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
    values ('Inexact rounded up', 60000, 7, 8571.43, 'base_number')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_installment_value_exact"',
  '60000 in 7 installments of 8571.43 is rejected (not exact)'
);
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
    values ('Inexact rounded down', 60000, 7, 8571.42, 'base_number')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_installment_value_exact"',
  '60000 in 7 installments of 8571.42 is rejected (not exact)'
);
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
    values ('Inexact high precision', 60000, 7, 60000::numeric / 7, 'base_number')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_installment_value_exact"',
  'a high-precision quotient rounded to numeric(14,2) is still rejected'
);
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode, number_digits)
    values ('Zero digits', 60000, 10, 6000, 'base_number', 0)$$,
  '23514', null, 'number_digits 0 is rejected'
);
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode, max_number, associated_number_offset)
    values ('Zero max', 60000, 10, 6000, 'base_number', 0, 0)$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_max_number_positive"',
  'max_number 0 is rejected'
);
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode, associated_number_offset)
    values ('Negative offset', 60000, 10, 6000, 'base_number', -1)$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_associated_number_offset_nonnegative"',
  'negative associated_number_offset is rejected'
);
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode, max_number)
    values ('Max too wide', 60000, 10, 6000, 'base_number', 10000)$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_max_number_fits_digits"',
  'max_number 10000 does not fit in 4 digits'
);
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode, max_number, associated_number_offset)
    values ('Offset beyond max', 60000, 10, 6000, 'base_number', 4999, 5000)$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_associated_number_offset_within_max"',
  'associated_number_offset greater than max_number is rejected'
);
select lives_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode, max_number, associated_number_offset)
    values ('Offset equals max', 60000, 10, 6000, 'base_number', 4871, 4871)$$,
  'associated_number_offset equal to max_number is allowed'
);
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode, overflow_policy)
    values ('Wrap policy', 60000, 10, 6000, 'base_number', 'wrap')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_overflow_policy_check"',
  'overflow_policy other than reject is rejected'
);
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
    values ('QR mode', 60000, 10, 6000, 'qr')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_barcode_mode_check"',
  'unknown barcode_mode is rejected'
);
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value)
    values ('No barcode mode', 60000, 10, 6000)$$,
  '23502', null, 'barcode_mode is required (no default)'
);
select lives_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
    select 'Mode ' || m, 60000, 10, 6000, m
    from unnest(array['base_number', 'internal_code', 'external_legacy_code', 'manual_mapping']) as m$$,
  'every documented barcode_mode is accepted'
);
select lives_ok(
  $$insert into public.campaigns
      (id, name, simple_bond_value, installment_count, installment_value, barcode_mode, number_digits, max_number, associated_number_offset)
    values ('f0000000-0000-0000-0000-000000000007', 'Five digits', 60000, 10, 6000, 'base_number', 5, 99999, 4871)$$,
  '5-digit configuration (max 99999) is accepted'
);
select results_eq(
  $$select number_digits, max_number, associated_number_offset from public.campaigns
    where id = 'f0000000-0000-0000-0000-000000000007'$$,
  $$values (5, 99999, 4871)$$,
  '5-digit configuration is stored as given'
);

-- ---------------------------------------------------------------------------
-- Write guard: inserts start in draft, immutable columns, updated_at
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.campaigns (name, status, simple_bond_value, installment_count, installment_value, barcode_mode)
    values ('Born active', 'active', 60000, 10, 6000, 'base_number')$$,
  '23514', 'new campaigns must start in draft status (got active)',
  'a campaign cannot be inserted in a non-draft status'
);
select throws_ok(
  $$update public.campaigns set id = gen_random_uuid() where id = 'f0000000-0000-0000-0000-000000000001'$$,
  '23001', 'campaigns.id, created_at and created_by cannot be changed', 'id is immutable'
);
select throws_ok(
  $$update public.campaigns set created_at = '2000-01-01' where id = 'f0000000-0000-0000-0000-000000000001'$$,
  '23001', 'campaigns.id, created_at and created_by cannot be changed', 'created_at is immutable'
);
select throws_ok(
  $$update public.campaigns set created_by = 'e0000000-0000-0000-0000-000000000002' where id = 'f0000000-0000-0000-0000-000000000001'$$,
  '23001', 'campaigns.id, created_at and created_by cannot be changed', 'created_by is immutable'
);
select lives_ok(
  $$update public.campaigns set name = 'Campaign 2026 (renamed)', updated_at = '2000-01-01'
    where id = 'f0000000-0000-0000-0000-000000000001'$$,
  'draft campaign can be renamed'
);
select is(
  (select updated_at from public.campaigns where id = 'f0000000-0000-0000-0000-000000000001'),
  now(), 'updated_at is maintained by the trigger (client value ignored)'
);

-- ---------------------------------------------------------------------------
-- Rules are editable while draft (f01)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$update public.campaigns
    set number_digits = 5, max_number = 99999, associated_number_offset = 10000,
        simple_bond_value = 90000, installment_count = 12, installment_value = 7500,
        barcode_mode = 'internal_code'
    where id = 'f0000000-0000-0000-0000-000000000001'$$,
  'draft: numbering, installment and barcode rules can be changed'
);
select results_eq(
  $$select number_digits, max_number, associated_number_offset, simple_bond_value, installment_count,
      installment_value, barcode_mode
    from public.campaigns where id = 'f0000000-0000-0000-0000-000000000001'$$,
  $$values (5, 99999, 10000, 90000.00::numeric, 12, 7500.00::numeric, 'internal_code'::text)$$,
  'draft: rule changes are stored'
);
select throws_ok(
  $$update public.campaigns set installment_count = 7 where id = 'f0000000-0000-0000-0000-000000000001'$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_installment_value_exact"',
  'draft: rule changes are still validated by the CHECK constraints'
);

-- ---------------------------------------------------------------------------
-- Allowed status transitions
-- ---------------------------------------------------------------------------
select lives_ok(
  $$update public.campaigns set status = 'active', starts_at = '2026-03-01', ends_at = '2026-12-31'
    where id = 'f0000000-0000-0000-0000-000000000002'$$,
  'draft -> active'
);
select lives_ok(
  $$update public.campaigns set status = 'closing' where id = 'f0000000-0000-0000-0000-000000000002'$$,
  'active -> closing'
);
select lives_ok(
  $$update public.campaigns set status = 'closed' where id = 'f0000000-0000-0000-0000-000000000002'$$,
  'closing -> closed'
);
select lives_ok(
  $$update public.campaigns set status = 'active' where id = 'f0000000-0000-0000-0000-000000000003'$$,
  'draft -> active (campaign to annul)'
);
select lives_ok(
  $$update public.campaigns set status = 'annulled' where id = 'f0000000-0000-0000-0000-000000000003'$$,
  'active -> annulled'
);
select lives_ok(
  $$update public.campaigns set status = 'active' where id = 'f0000000-0000-0000-0000-000000000004'$$,
  'draft -> active (second active campaign: several active campaigns are allowed)'
);
select lives_ok(
  $$update public.campaigns set status = 'active' where id = 'f0000000-0000-0000-0000-000000000005'$$,
  'draft -> active (campaign to leave in closing)'
);
select lives_ok(
  $$update public.campaigns set status = 'closing' where id = 'f0000000-0000-0000-0000-000000000005'$$,
  'active -> closing (campaign left in closing)'
);

-- ---------------------------------------------------------------------------
-- Disallowed status transitions
-- (f06 draft, f04 active, f05 closing, f02 closed, f03 annulled)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.campaigns set status = 'closing' where id = 'f0000000-0000-0000-0000-000000000006'$$,
  '23514', 'invalid campaign status transition: draft -> closing', 'draft -> closing is rejected'
);
select throws_ok(
  $$update public.campaigns set status = 'closed' where id = 'f0000000-0000-0000-0000-000000000006'$$,
  '23514', 'invalid campaign status transition: draft -> closed', 'draft -> closed is rejected'
);
select throws_ok(
  $$update public.campaigns set status = 'annulled' where id = 'f0000000-0000-0000-0000-000000000006'$$,
  '23514', 'invalid campaign status transition: draft -> annulled', 'draft -> annulled is rejected'
);
select throws_ok(
  $$update public.campaigns set status = 'paused' where id = 'f0000000-0000-0000-0000-000000000006'$$,
  '23514', 'invalid campaign status transition: draft -> paused', 'transition to an unknown status is rejected'
);
select throws_ok(
  $$update public.campaigns set status = 'draft' where id = 'f0000000-0000-0000-0000-000000000004'$$,
  '23514', 'invalid campaign status transition: active -> draft', 'active -> draft is rejected'
);
select throws_ok(
  $$update public.campaigns set status = 'closed' where id = 'f0000000-0000-0000-0000-000000000004'$$,
  '23514', 'invalid campaign status transition: active -> closed', 'active -> closed is rejected'
);
select throws_ok(
  $$update public.campaigns set status = 'active' where id = 'f0000000-0000-0000-0000-000000000005'$$,
  '23514', 'invalid campaign status transition: closing -> active', 'closing -> active is rejected'
);
select throws_ok(
  $$update public.campaigns set status = 'annulled' where id = 'f0000000-0000-0000-0000-000000000005'$$,
  '23514', 'invalid campaign status transition: closing -> annulled', 'closing -> annulled is rejected'
);
select throws_ok(
  $$update public.campaigns set status = 'draft' where id = 'f0000000-0000-0000-0000-000000000005'$$,
  '23514', 'invalid campaign status transition: closing -> draft', 'closing -> draft is rejected'
);
select throws_ok(
  $$update public.campaigns set status = 'active' where id = 'f0000000-0000-0000-0000-000000000002'$$,
  '23514', 'invalid campaign status transition: closed -> active', 'closed -> active is rejected'
);
select throws_ok(
  $$update public.campaigns set status = 'annulled' where id = 'f0000000-0000-0000-0000-000000000002'$$,
  '23514', 'invalid campaign status transition: closed -> annulled', 'closed -> annulled is rejected'
);
select throws_ok(
  $$update public.campaigns set status = 'active' where id = 'f0000000-0000-0000-0000-000000000003'$$,
  '23514', 'invalid campaign status transition: annulled -> active', 'annulled -> active is rejected'
);
select throws_ok(
  $$update public.campaigns set status = 'draft' where id = 'f0000000-0000-0000-0000-000000000003'$$,
  '23514', 'invalid campaign status transition: annulled -> draft', 'annulled -> draft is rejected'
);

-- ---------------------------------------------------------------------------
-- Edit windows: active (f04)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.campaigns set max_number = 9000 where id = 'f0000000-0000-0000-0000-000000000004'$$,
  '55000', 'campaign rules can only be changed while the campaign is draft (status: active)',
  'active: max_number is frozen'
);
select throws_ok(
  $$update public.campaigns set number_digits = 5 where id = 'f0000000-0000-0000-0000-000000000004'$$,
  '55000', 'campaign rules can only be changed while the campaign is draft (status: active)',
  'active: number_digits is frozen'
);
select throws_ok(
  $$update public.campaigns set associated_number_offset = 1000 where id = 'f0000000-0000-0000-0000-000000000004'$$,
  '55000', 'campaign rules can only be changed while the campaign is draft (status: active)',
  'active: associated_number_offset is frozen'
);
select throws_ok(
  $$update public.campaigns set simple_bond_value = 90000, installment_value = 9000
    where id = 'f0000000-0000-0000-0000-000000000004'$$,
  '55000', 'campaign rules can only be changed while the campaign is draft (status: active)',
  'active: installment rules are frozen'
);
select throws_ok(
  $$update public.campaigns set installment_count = 12, installment_value = 5000
    where id = 'f0000000-0000-0000-0000-000000000004'$$,
  '55000', 'campaign rules can only be changed while the campaign is draft (status: active)',
  'active: installment_count is frozen'
);
select throws_ok(
  $$update public.campaigns set barcode_mode = 'manual_mapping' where id = 'f0000000-0000-0000-0000-000000000004'$$,
  '55000', 'campaign rules can only be changed while the campaign is draft (status: active)',
  'active: barcode_mode is frozen'
);
select is(
  pg_temp.error_detail($$update public.campaigns set max_number = 9000, barcode_mode = 'manual_mapping'
    where id = 'f0000000-0000-0000-0000-000000000004'$$),
  'changed rule columns: max_number, barcode_mode',
  'rule-freeze error DETAIL lists the changed rule columns'
);
select throws_ok(
  $$update public.campaigns set status = 'closing', max_number = 9000 where id = 'f0000000-0000-0000-0000-000000000004'$$,
  '55000', 'campaign rules can only be changed while the campaign is draft (status: active)',
  'active: a rule change cannot ride along with a transition'
);
select lives_ok(
  $$update public.campaigns
    set number_digits = number_digits, max_number = max_number, simple_bond_value = simple_bond_value,
        barcode_mode = barcode_mode
    where id = 'f0000000-0000-0000-0000-000000000004'$$,
  'active: assigning a rule its current value is not a change'
);
select lives_ok(
  $$update public.campaigns set name = 'Active renamed' where id = 'f0000000-0000-0000-0000-000000000004'$$,
  'active: name can be changed'
);
select lives_ok(
  $$update public.campaigns set starts_at = '2026-03-01', ends_at = '2026-12-31'
    where id = 'f0000000-0000-0000-0000-000000000004'$$,
  'active: dates can be changed'
);

-- Rules may change in the same statement that activates a draft (window uses the old status).
select lives_ok(
  $$update public.campaigns set status = 'active', max_number = 9000 where id = 'f0000000-0000-0000-0000-000000000006'$$,
  'draft -> active with a final rule change in the same statement'
);

-- ---------------------------------------------------------------------------
-- Edit windows: closing (f05), closed (f02), annulled (f03)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$update public.campaigns set name = 'Closing renamed' where id = 'f0000000-0000-0000-0000-000000000005'$$,
  'closing: name can be changed'
);
select throws_ok(
  $$update public.campaigns set ends_at = '2027-01-31' where id = 'f0000000-0000-0000-0000-000000000005'$$,
  '55000', 'campaign dates can only be changed while the campaign is draft or active (status: closing)',
  'closing: dates are frozen'
);
select throws_ok(
  $$update public.campaigns set max_number = 9000 where id = 'f0000000-0000-0000-0000-000000000005'$$,
  '55000', 'campaign rules can only be changed while the campaign is draft (status: closing)',
  'closing: rules are frozen'
);
select throws_ok(
  $$update public.campaigns set name = 'Closed renamed' where id = 'f0000000-0000-0000-0000-000000000002'$$,
  '55000', 'campaign name cannot be changed once the campaign is closed',
  'closed: name is frozen'
);
select throws_ok(
  $$update public.campaigns set starts_at = '2026-01-01' where id = 'f0000000-0000-0000-0000-000000000002'$$,
  '55000', 'campaign dates can only be changed while the campaign is draft or active (status: closed)',
  'closed: dates are frozen'
);
select throws_ok(
  $$update public.campaigns set installment_count = 5, installment_value = 12000 where id = 'f0000000-0000-0000-0000-000000000002'$$,
  '55000', 'campaign rules can only be changed while the campaign is draft (status: closed)',
  'closed: rules are frozen'
);
select throws_ok(
  $$update public.campaigns set name = 'Annulled renamed' where id = 'f0000000-0000-0000-0000-000000000003'$$,
  '55000', 'campaign name cannot be changed once the campaign is annulled',
  'annulled: name is frozen'
);
select throws_ok(
  $$update public.campaigns set ends_at = '2027-01-31' where id = 'f0000000-0000-0000-0000-000000000003'$$,
  '55000', 'campaign dates can only be changed while the campaign is draft or active (status: annulled)',
  'annulled: dates are frozen'
);
select throws_ok(
  $$update public.campaigns set barcode_mode = 'manual_mapping' where id = 'f0000000-0000-0000-0000-000000000003'$$,
  '55000', 'campaign rules can only be changed while the campaign is draft (status: annulled)',
  'annulled: rules are frozen'
);
select results_eq(
  $$select id::text, status from public.campaigns where id::text like 'f0000000-%' order by id$$,
  $$values
    ('f0000000-0000-0000-0000-000000000001', 'draft'),
    ('f0000000-0000-0000-0000-000000000002', 'closed'),
    ('f0000000-0000-0000-0000-000000000003', 'annulled'),
    ('f0000000-0000-0000-0000-000000000004', 'active'),
    ('f0000000-0000-0000-0000-000000000005', 'closing'),
    ('f0000000-0000-0000-0000-000000000006', 'active'),
    ('f0000000-0000-0000-0000-000000000007', 'draft')$$,
  'fixture campaigns end in the expected statuses'
);

-- ---------------------------------------------------------------------------
-- No deletes, even for the owner (privileges deny every API role; trigger is the backstop)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$delete from public.campaigns where id = 'f0000000-0000-0000-0000-000000000001'$$,
  '23001', 'campaigns cannot be deleted: DELETE is not allowed (annul the campaign instead)',
  'owner cannot delete a campaign (trigger)'
);
select throws_ok(
  $$truncate public.campaigns$$,
  '23001', 'campaigns cannot be deleted: TRUNCATE is not allowed (annul the campaign instead)',
  'owner cannot truncate campaigns (trigger)'
);

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select * from public.campaigns$$, '42501', null, 'anon cannot select campaigns');
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
    values ('anon', 60000, 10, 6000, 'base_number')$$,
  '42501', null, 'anon cannot insert campaigns'
);
reset role;

-- ---------------------------------------------------------------------------
-- Admin (d1, has campaign.view and campaign.create): reads, but cannot write directly
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_eq(
  $$select id::text from public.campaigns where id::text like 'f0000000-%'$$,
  array[
    'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002',
    'f0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000004',
    'f0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000006',
    'f0000000-0000-0000-0000-000000000007'
  ],
  'admin (campaign.view) reads campaigns in every status'
);
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
    values ('Direct insert', 60000, 10, 6000, 'base_number')$$,
  '42501', null, 'admin cannot insert campaigns directly'
);
select throws_ok(
  $$update public.campaigns set name = 'Direct update' where id = 'f0000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'admin cannot update campaigns directly'
);
select throws_ok(
  $$update public.campaigns set status = 'active' where id = 'f0000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'admin cannot change campaign status directly'
);
select throws_ok(
  $$delete from public.campaigns where id = 'f0000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'admin cannot delete campaigns'
);
select throws_ok($$truncate public.campaigns$$, '42501', null, 'admin cannot truncate campaigns');
reset role;

-- ---------------------------------------------------------------------------
-- Operator (d2, has campaign.view)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.campaigns where id::text like 'f0000000-%'),
  7, 'operator (campaign.view) reads campaigns'
);
select throws_ok(
  $$update public.campaigns set name = 'Operator update' where id = 'f0000000-0000-0000-0000-000000000004'$$,
  '42501', null, 'operator cannot update campaigns directly'
);
reset role;

-- ---------------------------------------------------------------------------
-- No-role user (d3) and inactive admin (d4): no campaign.view
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is_empty($$select 1 from public.campaigns$$, 'user without campaign.view reads no campaigns');
select throws_ok(
  $$insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
    values ('No role insert', 60000, 10, 6000, 'base_number')$$,
  '42501', null, 'user without permissions cannot insert campaigns'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is_empty($$select 1 from public.campaigns$$, 'inactive admin reads no campaigns');
reset role;

-- ---------------------------------------------------------------------------
-- service_role: bypasses RLS and may insert/update, but every invariant still applies
-- ---------------------------------------------------------------------------
set local role service_role;
select isnt_empty($$select 1 from public.campaigns$$, 'service_role reads campaigns');
select lives_ok(
  $$insert into public.campaigns
      (id, name, simple_bond_value, installment_count, installment_value, barcode_mode, created_by)
    values ('f0000000-0000-0000-0000-000000000008', 'Service campaign', 60000, 10, 6000, 'base_number',
      'e0000000-0000-0000-0000-000000000001')$$,
  'service_role can insert a draft campaign'
);
select lives_ok(
  $$update public.campaigns set status = 'active' where id = 'f0000000-0000-0000-0000-000000000008'$$,
  'service_role can activate a draft campaign'
);
select throws_ok(
  $$update public.campaigns set max_number = 9000 where id = 'f0000000-0000-0000-0000-000000000008'$$,
  '55000', 'campaign rules can only be changed while the campaign is draft (status: active)',
  'service_role cannot change rules of an active campaign'
);
select throws_ok(
  $$update public.campaigns set status = 'draft' where id = 'f0000000-0000-0000-0000-000000000008'$$,
  '23514', 'invalid campaign status transition: active -> draft',
  'service_role cannot make an invalid transition'
);
select throws_ok(
  $$delete from public.campaigns where id = 'f0000000-0000-0000-0000-000000000008'$$,
  '42501', null, 'service_role cannot delete campaigns'
);
select throws_ok($$truncate public.campaigns$$, '42501', null, 'service_role cannot truncate campaigns');
reset role;

select * from finish();
rollback;
