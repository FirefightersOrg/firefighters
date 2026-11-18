-- SAN-44: import_sessions, import_session_items, campaigns.barcode_pattern, bonds.import_session_id,
-- bond_numbers.barcode and the per-campaign barcode namespace; operator gets bond.scan.
begin;
select plan(145);

-- ---------------------------------------------------------------------------
-- Fixtures (created as the test owner)
-- ---------------------------------------------------------------------------
-- auth ids / profiles: ...01 admin, ...02 operator, ...03 treasurer, ...04 collector, ...05 read-only
insert into auth.users (id, email)
select ('a4400000-0000-0000-0000-00000000000' || n)::uuid, 'imports-' || n || '@example.com'
from generate_series(1, 5) as n;

insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b4400000-0000-0000-0000-00000000000' || n)::uuid,
  ('a4400000-0000-0000-0000-00000000000' || n)::uuid,
  'Imports user ' || n, 'imports-' || n || '@example.com', 'active'
from generate_series(1, 5) as n;

insert into public.user_roles (user_id, role_id)
select v.profile_id::uuid, r.id
from (values
  ('b4400000-0000-0000-0000-000000000001', 'admin'),
  ('b4400000-0000-0000-0000-000000000002', 'operator'),
  ('b4400000-0000-0000-0000-000000000003', 'treasurer'),
  ('b4400000-0000-0000-0000-000000000004', 'collector'),
  ('b4400000-0000-0000-0000-000000000005', 'read-only')
) as v (profile_id, role_name)
join public.roles r on r.name = v.role_name;

create function pg_temp.act_as(p_n int) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    format('{"sub":"a4400000-0000-0000-0000-00000000000%s","role":"authenticated"}', p_n),
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

-- Campaigns: 60000 in 10 installments, 4 digits, max 9999, offset 4871.
with c as (
  insert into public.campaigns
    (name, simple_bond_value, installment_count, installment_value, barcode_mode, starts_at, ends_at)
  select v.name, 60000, 10, 6000, v.mode, '2026-03-01 00:00-03', '2026-12-31 23:59:59-03'
  from (values ('Draft', 'base_number'), ('Active', 'base_number'), ('Closed', 'base_number'),
               ('Pattern', 'internal_code'), ('Codes', 'base_number'), ('Other', 'base_number'))
    as v (name, mode)
  returning id, name
)
insert into ids select 'c-' || lower(c.name), c.id from c;
update public.campaigns set status = 'active' where id in (pg_temp.id('c-active'), pg_temp.id('c-closed'));
update public.campaigns set status = 'closing' where id = pg_temp.id('c-closed');
update public.campaigns set status = 'closed' where id = pg_temp.id('c-closed');

create function pg_temp.session(
  p_campaign text, p_source text default 'barcode_scan', p_file text default null
) returns uuid language sql as $$
  insert into public.import_sessions (campaign_id, source_type, file_name, created_by)
  values (pg_temp.id(p_campaign), p_source, p_file, 'b4400000-0000-0000-0000-000000000002')
  returning id;
$$;

create function pg_temp.item(
  p_session uuid, p_row int, p_status text default 'valid', p_type text default 'simple',
  p_group text default null
) returns uuid language sql as $$
  insert into public.import_session_items
    (import_session_id, row_number, raw_value, item_type, group_key, base_number, barcode, status,
     error_code, error_message)
  values (p_session, p_row, 'raw ' || p_row, p_type, p_group, p_row, 'IT-' || p_row, p_status,
    case when p_status in ('error', 'warning') then 'some_problem' end,
    case when p_status in ('error', 'warning') then 'Something is off' end)
  returning id;
$$;

-- An available bond inserted as the owner (total = 60000 * units).
create function pg_temp.bond(
  p_campaign text, p_units int default 1, p_barcode text default null, p_session uuid default null
) returns uuid language sql as $$
  insert into public.bonds
    (campaign_id, kind, origin, commercial_unit_count, total_value, barcode, commercial_status,
     created_by, import_session_id)
  values (pg_temp.id(p_campaign), case when p_units = 1 then 'simple' else 'pata' end, 'printed',
    p_units, 60000 * p_units, p_barcode, 'available', 'b4400000-0000-0000-0000-000000000001',
    p_session)
  returning id;
$$;

-- A base number (with optional barcode) of a bond, as the owner.
create function pg_temp.base(p_bond uuid, p_value int, p_barcode text default null)
returns uuid language sql as $$
  insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind, barcode)
  select b.campaign_id, b.id, p_value, 'base', p_barcode from public.bonds b where b.id = p_bond
  returning id;
$$;

create function pg_temp.annul(p_bond uuid) returns void language sql as $$
  update public.bonds
  set commercial_status = 'annulled', annulled_by = 'b4400000-0000-0000-0000-000000000001',
      annul_reason = 'test'
  where id = p_bond;
$$;

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
select has_table('public', 'import_sessions', 'import_sessions exists');
select has_table('public', 'import_session_items', 'import_session_items exists');
select columns_are('public', 'import_sessions', array[
  'id', 'campaign_id', 'source_type', 'status', 'file_name', 'notes', 'created_by', 'created_at',
  'updated_at', 'validated_at', 'confirmed_at', 'confirmed_by', 'cancelled_at', 'cancelled_by',
  'cancel_reason', 'failed_at', 'failed_by', 'failure_reason', 'rolled_back_at', 'rolled_back_by',
  'rollback_reason'
], 'import_sessions has exactly the expected columns');
select columns_are('public', 'import_session_items', array[
  'id', 'import_session_id', 'row_number', 'raw_value', 'parsed_value', 'barcode', 'item_type',
  'group_key', 'base_number', 'status', 'error_code', 'error_message', 'created_bond_id',
  'removed_at', 'removed_by', 'remove_reason', 'created_at', 'updated_at'
], 'import_session_items has exactly the expected columns');
select col_not_null('public', 'import_sessions', 'created_by', 'import_sessions.created_by is required');
select col_not_null('public', 'import_session_items', 'raw_value', 'import_session_items.raw_value is required');
select col_default_is('public', 'import_sessions', 'status', 'draft'::text, 'sessions default to draft');
select col_default_is('public', 'import_session_items', 'status', 'pending'::text, 'items default to pending');
select has_column('public', 'bonds', 'import_session_id', 'bonds.import_session_id exists');
select has_column('public', 'bond_numbers', 'barcode', 'bond_numbers.barcode exists');
select has_column('public', 'campaigns', 'barcode_pattern', 'campaigns.barcode_pattern exists');
select fk_ok('public', 'bonds', array['import_session_id', 'campaign_id'],
  'public', 'import_sessions', array['id', 'campaign_id'],
  'a bond''s import session belongs to the bond''s campaign');
select fk_ok('public', 'import_session_items', array['created_bond_id', 'import_session_id'],
  'public', 'bonds', array['id', 'import_session_id'],
  'an item''s created bond belongs to the item''s session');
select is(
  (select confdeltype from pg_constraint where conname = 'import_session_items_import_session_id_fkey'),
  'r'::"char", 'items reference their session ON DELETE RESTRICT (sessions are never deleted)'
);
select has_index('public', 'import_sessions', 'import_sessions_campaign_status_idx', 'index (campaign_id, status)');
select has_index('public', 'import_session_items', 'import_session_items_session_status_idx', 'index (import_session_id, status)');
select has_index('public', 'bond_numbers', 'bond_numbers_campaign_barcode_key', 'unique live barcode per campaign among numbers');
select has_index('public', 'bonds', 'bonds_import_session_idx', 'index on bonds.import_session_id');
select is(
  (select count(*)::int from pg_class
   where oid in ('public.import_sessions'::regclass, 'public.import_session_items'::regclass)
     and relrowsecurity),
  2, 'RLS is enabled on both import tables'
);
select is(
  (select array_agg(distinct cmd order by cmd) from pg_policies
   where schemaname = 'public' and tablename in ('import_sessions', 'import_session_items')),
  array['SELECT'], 'import tables only have SELECT policies'
);
select ok(
  has_table_privilege('authenticated', 'public.import_sessions', 'select')
  and has_table_privilege('authenticated', 'public.import_session_items', 'select')
  and not has_table_privilege('authenticated', 'public.import_sessions', 'insert,update,delete,truncate')
  and not has_table_privilege('authenticated', 'public.import_session_items', 'insert,update,delete,truncate'),
  'authenticated can only read the import tables'
);
select ok(
  not has_table_privilege('anon', 'public.import_sessions', 'select,insert,update,delete,truncate')
  and not has_table_privilege('anon', 'public.import_session_items', 'select,insert,update,delete,truncate'),
  'anon has no privilege on the import tables'
);
select ok(
  has_table_privilege('service_role', 'public.import_sessions', 'select')
  and has_table_privilege('service_role', 'public.import_sessions', 'insert')
  and has_table_privilege('service_role', 'public.import_sessions', 'update')
  and not has_table_privilege('service_role', 'public.import_sessions', 'delete,truncate')
  and not has_table_privilege('service_role', 'public.import_session_items', 'delete,truncate'),
  'service_role: select/insert/update, never delete or truncate'
);

-- ---------------------------------------------------------------------------
-- Permissions: operator has bond.scan
-- ---------------------------------------------------------------------------
select ok(
  exists (select 1 from public.role_permissions rp
          join public.roles r on r.id = rp.role_id
          join public.permissions p on p.id = rp.permission_id
          where r.name = 'operator' and p.code = 'bond.scan'),
  'operator role has bond.scan'
);
select is(
  (select array_agg(r.name order by r.name) from public.role_permissions rp
   join public.roles r on r.id = rp.role_id
   join public.permissions p on p.id = rp.permission_id
   where p.code = 'bond.scan'),
  array['admin', 'operator'], 'only admin and operator have bond.scan'
);

-- ---------------------------------------------------------------------------
-- campaigns.barcode_pattern
-- ---------------------------------------------------------------------------
select ok(public.campaign_barcode_pattern_valid('^BC-(\d+)$'), 'a pattern with a capture group is valid');
select ok(public.campaign_barcode_pattern_valid(null), 'no pattern is valid');
select ok(not public.campaign_barcode_pattern_valid('^BC-\d+$'), 'a pattern without a capture group is invalid');
select ok(not public.campaign_barcode_pattern_valid('^BC-(\d+$'), 'a pattern that does not compile is invalid');
select ok(not public.campaign_barcode_pattern_valid('(?i)bc-(\d+)'), 'embedded options are not supported');

select throws_ok(
  $$update public.campaigns set barcode_pattern = '^(\d+)$' where id = pg_temp.id('c-draft')$$,
  '23514', null, 'a pattern needs the internal_code or external_legacy_code mode (CHECK)'
);
select throws_ok(
  $$update public.campaigns set barcode_pattern = '^\d+$' where id = pg_temp.id('c-pattern')$$,
  '23514', null, 'a pattern without a capture group is rejected by the CHECK'
);
select throws_ok(
  $$update public.campaigns set barcode_pattern = ' ^(\d+)$' where id = pg_temp.id('c-pattern')$$,
  '23514', null, 'a pattern with surrounding whitespace is rejected by the CHECK'
);

create function pg_temp.version_of(p_k text) returns timestamptz language sql stable as $$
  select updated_at from public.campaigns where id = pg_temp.id(p_k);
$$;
grant execute on function pg_temp.version_of(text) to authenticated;

set local role authenticated;
select pg_temp.act_as(1);
select is(
  public.campaign_update_rules(pg_temp.id('c-pattern'), 60000, 10, 4, 9999, 4871, 'reject',
    'internal_code', pg_temp.version_of('c-pattern'), 'req-pattern-1', null, '  ^BC-(\d{4})$  '),
  true, 'update_rules: admin sets a barcode pattern (trimmed)'
);
select is(
  (select barcode_pattern from public.campaigns where id = pg_temp.id('c-pattern')),
  '^BC-(\d{4})$', 'the pattern is stored trimmed'
);
select is(
  public.campaign_update_rules(pg_temp.id('c-pattern'), 60000, 10, 4, 9999, 4871, 'reject',
    'internal_code', pg_temp.version_of('c-pattern'), 'req-pattern-noop', null, '^BC-(\d{4})$'),
  false, 'update_rules: same pattern is a no-op'
);
reset role;
select is(
  (select new_value from public.audit_log where request_id = 'req-pattern-1'),
  jsonb_build_object('barcode_pattern', '^BC-(\d{4})$'),
  'the audit row records the pattern change only'
);
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$select public.campaign_update_rules(pg_temp.id('c-pattern'), 60000, 10, 4, 9999, 4871, 'reject',
      'internal_code', pg_temp.version_of('c-pattern'), null, null, '^BC-\d+$')$$,
  '22023', 'barcode pattern must be a valid regular expression with a capture group for the base number',
  'update_rules: a pattern without a capture group is rejected'
);
select throws_ok(
  $$select public.campaign_update_rules(pg_temp.id('c-pattern'), 60000, 10, 4, 9999, 4871, 'reject',
      'internal_code', pg_temp.version_of('c-pattern'), null, null, '^BC-((\d+)$')$$,
  '22023', 'barcode pattern must be a valid regular expression with a capture group for the base number',
  'update_rules: a pattern that does not compile is rejected'
);
select throws_ok(
  $$select public.campaign_update_rules(pg_temp.id('c-pattern'), 60000, 10, 4, 9999, 4871, 'reject',
      'internal_code', pg_temp.version_of('c-pattern'), null, null, '(' || repeat('a', 199) || ')')$$,
  '22023', 'barcode pattern must be at most 200 characters',
  'update_rules: a pattern longer than 200 characters is rejected'
);
select throws_ok(
  $$select public.campaign_update_rules(pg_temp.id('c-pattern'), 60000, 10, 4, 9999, 4871, 'reject',
      'base_number', pg_temp.version_of('c-pattern'), null, null, '^(\d+)$')$$,
  '22023', 'barcode pattern is only used with the internal code or external legacy code barcode modes',
  'update_rules: a pattern with the base_number mode is rejected'
);
select throws_ok(
  $$select public.campaign_update_rules(pg_temp.id('c-pattern'), 60000, 10, 4, 9999, 4871, 'reject',
      'internal_code', '2000-01-01', null, null, '^X(\d+)$')$$,
  'PT409', 'campaign was modified by someone else',
  'update_rules: a stale version is still rejected with PT409'
);
select throws_ok(
  $$select public.campaign_update_rules(pg_temp.id('c-active'), 60000, 10, 4, 9999, 4871, 'reject',
      'external_legacy_code', pg_temp.version_of('c-active'), null, null, '^X(\d+)$')$$,
  '55000', null, 'update_rules: the pattern cannot be set on an active campaign'
);
select is(
  public.campaign_update_rules(pg_temp.id('c-pattern'), 60000, 10, 4, 9999, 4871, 'reject',
    'internal_code', pg_temp.version_of('c-pattern'), 'req-pattern-blank', null, '   '),
  true, 'update_rules: a blank pattern clears it'
);
select is(
  (select barcode_pattern from public.campaigns where id = pg_temp.id('c-pattern')),
  null, 'the pattern is cleared'
);
insert into ids select 'c-created', public.campaign_create('With pattern', 60000, 10, 4, 9999, 4871,
  'reject', 'external_legacy_code', null, null, 'req-create-pattern', null, '^LEG(\d+)-');
select is(
  (select barcode_pattern from public.campaigns where id = pg_temp.id('c-created')),
  '^LEG(\d+)-', 'campaign_create stores the pattern'
);
select throws_ok(
  $$select public.campaign_create('Bad pattern', 60000, 10, 4, 9999, 4871, 'reject', 'base_number',
      null, null, null, null, '^(\d+)$')$$,
  '22023', null, 'campaign_create rejects a pattern with the base_number mode'
);
reset role;

-- Frozen once the campaign has bonds (even in draft).
update public.campaigns set barcode_pattern = '^BC-(\d+)$' where id = pg_temp.id('c-pattern');
select pg_temp.bond('c-pattern');
select throws_ok(
  $$update public.campaigns set barcode_pattern = '^BX-(\d+)$' where id = pg_temp.id('c-pattern')$$,
  '55000', 'campaign rules cannot be changed once the campaign has bonds',
  'the pattern is frozen once the campaign has bonds'
);
select throws_ok(
  $$update public.campaigns set barcode_pattern = '^BX-(\d+)$' where id = pg_temp.id('c-active')$$,
  '55000', null, 'the pattern can only change while the campaign is draft'
);

-- ---------------------------------------------------------------------------
-- import_sessions: creation and checks
-- ---------------------------------------------------------------------------
insert into ids select 's1', pg_temp.session('c-draft');
select is(
  (select (status, validated_at, confirmed_at) from public.import_sessions where id = pg_temp.id('s1')),
  row('draft'::text, null::timestamptz, null::timestamptz), 'a new session starts as draft'
);
select lives_ok(
  $$select pg_temp.session('c-active', 'csv_file', 'bonds.csv')$$,
  'a csv session can be created for an active campaign'
);
select lives_ok(
  $$select pg_temp.session('c-active', 'excel_file', 'bonds.xlsx')$$,
  'an excel session can be created'
);
select throws_ok(
  $$select pg_temp.session('c-closed')$$,
  '55000', 'import sessions can only be created while the campaign is draft or active (status: closed)',
  'no session for a closed campaign'
);
select throws_ok(
  $$select pg_temp.session('c-draft', 'legacy_system_export', 'x.csv')$$,
  '23514', null, 'legacy_system_export is not a source type (post-MVP)'
);
select throws_ok(
  $$select pg_temp.session('c-draft', 'csv_file')$$,
  '23514', null, 'a file import requires the file name'
);
select throws_ok(
  $$select pg_temp.session('c-draft', 'barcode_scan', 'x.csv')$$,
  '23514', null, 'a scan session has no file name'
);
select throws_ok(
  $$insert into public.import_sessions (campaign_id, source_type) values (pg_temp.id('c-draft'), 'barcode_scan')$$,
  '23502', null, 'created_by is required'
);
select throws_ok(
  $$insert into public.import_sessions (campaign_id, source_type, status, validated_at, created_by)
    values (pg_temp.id('c-draft'), 'barcode_scan', 'validated', now(), 'b4400000-0000-0000-0000-000000000002')$$,
  '23514', 'new import sessions must start in draft status (got validated)',
  'a session cannot be created validated'
);
select throws_ok(
  $$update public.import_sessions set campaign_id = pg_temp.id('c-active') where id = pg_temp.id('s1')$$,
  '23001', null, 'campaign_id is immutable'
);
select throws_ok(
  $$update public.import_sessions set source_type = 'csv_file', file_name = 'x.csv' where id = pg_temp.id('s1')$$,
  '23001', null, 'source_type and file_name are immutable'
);
select throws_ok(
  $$update public.import_sessions set rolled_back_by = 'b4400000-0000-0000-0000-000000000001',
      rollback_reason = 'x' where id = pg_temp.id('s1')$$,
  '55000', 'only a confirmed import session can be rolled back (status: draft)',
  'a draft session cannot be rolled back'
);

-- ---------------------------------------------------------------------------
-- import_session_items: checks
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select pg_temp.item(pg_temp.id('s1'), 90, 'valid', 'pata', null)$$,
  '23514', null, 'a pata item needs its group key'
);
select throws_ok(
  $$select pg_temp.item(pg_temp.id('s1'), 90, 'valid', 'simple', 'G1')$$,
  '23514', null, 'a simple item has no group key'
);
select throws_ok(
  $$insert into public.import_session_items (import_session_id, row_number, raw_value, status)
    values (pg_temp.id('s1'), 90, 'x', 'valid')$$,
  '23514', null, 'a valid item needs its type and base number'
);
select throws_ok(
  $$insert into public.import_session_items (import_session_id, row_number, raw_value, status)
    values (pg_temp.id('s1'), 90, 'x', 'error')$$,
  '23514', null, 'an item in error needs a message'
);
select throws_ok(
  $$insert into public.import_session_items (import_session_id, row_number, raw_value, error_message)
    values (pg_temp.id('s1'), 90, 'x', 'msg')$$,
  '23514', null, 'a pending item has no error message'
);
select throws_ok(
  $$insert into public.import_session_items (import_session_id, row_number, raw_value, parsed_value)
    values (pg_temp.id('s1'), 90, 'x', '[1]')$$,
  '23514', null, 'parsed_value must be a JSON object'
);
select throws_ok(
  $$insert into public.import_session_items (import_session_id, row_number, raw_value)
    values (pg_temp.id('s1'), 0, 'x')$$,
  '23514', null, 'row numbers start at 1'
);
select throws_ok(
  $$insert into public.import_session_items (import_session_id, row_number, raw_value, removed_at, removed_by)
    values (pg_temp.id('s1'), 90, 'x', now(), 'b4400000-0000-0000-0000-000000000002')$$,
  '23514', 'new import session items cannot be linked to a bond or removed',
  'a new item cannot be removed'
);

-- ---------------------------------------------------------------------------
-- Session transitions and items
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.import_sessions set status = 'validated' where id = pg_temp.id('s1')$$,
  '55000', null, 'a session without items cannot be validated'
);
insert into ids select 'i1', pg_temp.item(pg_temp.id('s1'), 1);
insert into ids select 'i2', pg_temp.item(pg_temp.id('s1'), 2, 'pending');
select throws_ok(
  $$select pg_temp.item(pg_temp.id('s1'), 1)$$,
  '23505', null, 'row numbers are unique per session'
);
select throws_ok(
  $$update public.import_sessions set status = 'validated' where id = pg_temp.id('s1')$$,
  '55000', null, 'a session with pending items cannot be validated'
);
update public.import_session_items
set status = 'error', error_code = 'duplicate_number', error_message = 'Number 0002 is already used'
where id = pg_temp.id('i2');
select throws_ok(
  $$update public.import_sessions set status = 'validated' where id = pg_temp.id('s1')$$,
  '55000', null, 'a session with items in error cannot be validated'
);
update public.import_session_items
set removed_by = 'b4400000-0000-0000-0000-000000000002', remove_reason = 'Wrong row'
where id = pg_temp.id('i2');
select isnt(
  (select removed_at from public.import_session_items where id = pg_temp.id('i2')),
  null, 'removing an item sets removed_at'
);
select throws_ok(
  $$update public.import_session_items set raw_value = 'edited' where id = pg_temp.id('i2')$$,
  '55000', null, 'a removed item cannot be changed'
);
insert into ids select 'i3', pg_temp.item(pg_temp.id('s1'), 3, 'warning', 'pata', 'P1');
insert into ids select 'i4', pg_temp.item(pg_temp.id('s1'), 4, 'valid', 'pata', 'P1');
select lives_ok(
  $$update public.import_sessions set status = 'validated' where id = pg_temp.id('s1')$$,
  'valid and warning items (errors removed) validate the session'
);
select isnt(
  (select validated_at from public.import_sessions where id = pg_temp.id('s1')),
  null, 'validated_at is set'
);
select throws_ok(
  $$update public.import_sessions set status = 'confirmed', confirmed_by = 'b4400000-0000-0000-0000-000000000001'
    where id = pg_temp.id('s1')$$,
  '55000', null, 'confirming requires every item to be linked to its bond'
);

-- Editing items of a validated session sends it back to draft.
select pg_temp.item(pg_temp.id('s1'), 5);
select is(
  (select (status, validated_at) from public.import_sessions where id = pg_temp.id('s1')),
  row('draft'::text, null::timestamptz), 'adding an item returns a validated session to draft'
);
update public.import_sessions set status = 'validated' where id = pg_temp.id('s1');
update public.import_session_items set raw_value = 'raw 5 fixed' where import_session_id = pg_temp.id('s1') and row_number = 5;
select is(
  (select status from public.import_sessions where id = pg_temp.id('s1')),
  'draft', 'editing an item returns a validated session to draft'
);
select throws_ok(
  $$update public.import_sessions set status = 'confirmed', confirmed_by = 'b4400000-0000-0000-0000-000000000001'
    where id = pg_temp.id('s1')$$,
  '23514', 'invalid import session status transition: draft -> confirmed',
  'a draft session cannot be confirmed'
);
select throws_ok(
  $$select pg_temp.bond('c-draft', 1, null, pg_temp.id('s1'))$$,
  '55000', 'bonds can only be created for a validated import session (status: draft)',
  'bonds are attached only to a validated session'
);
update public.import_session_items set removed_by = 'b4400000-0000-0000-0000-000000000002'
where import_session_id = pg_temp.id('s1') and row_number = 5;
update public.import_sessions set status = 'validated' where id = pg_temp.id('s1');

-- Confirmation: bonds created with the session, items linked, then confirmed.
insert into ids select 'b-s1-simple', pg_temp.bond('c-draft', 1, 'IT-1', pg_temp.id('s1'));
insert into ids select 'b-s1-pata', pg_temp.bond('c-draft', 2, 'P1', pg_temp.id('s1'));
select throws_ok(
  $$select pg_temp.bond('c-active', 1, null, pg_temp.id('s1'))$$,
  '23503', null, 'a bond cannot belong to a session of another campaign'
);
select is(
  (select status from public.import_sessions where id = pg_temp.id('s1')),
  'validated', 'creating the session''s bonds keeps it validated'
);
insert into ids select 'b-outside', pg_temp.bond('c-draft');
select throws_ok(
  $$update public.import_session_items set created_bond_id = pg_temp.id('b-outside') where id = pg_temp.id('i1')$$,
  '23503', null, 'an item cannot point to a bond outside its session'
);
update public.import_session_items set created_bond_id = pg_temp.id('b-s1-simple') where id = pg_temp.id('i1');
update public.import_session_items set created_bond_id = pg_temp.id('b-s1-pata') where id in (pg_temp.id('i3'), pg_temp.id('i4'));
select is(
  (select status from public.import_sessions where id = pg_temp.id('s1')),
  'validated', 'linking items to their bonds keeps the session validated'
);
select throws_ok(
  $$update public.import_session_items set raw_value = 'late edit' where id = pg_temp.id('i1')$$,
  '55000', null, 'an item linked to a bond cannot be edited'
);
select throws_ok(
  $$update public.import_session_items set created_bond_id = pg_temp.id('b-s1-pata') where id = pg_temp.id('i1')$$,
  '23001', null, 'created_bond_id cannot change once set'
);
select throws_ok(
  $$update public.import_sessions set status = 'draft' where id = pg_temp.id('s1')$$,
  '55000', null, 'a validated session with bonds cannot go back to draft'
);
select throws_ok(
  $$update public.import_sessions set status = 'cancelled', cancelled_by = 'b4400000-0000-0000-0000-000000000001'
    where id = pg_temp.id('s1')$$,
  '55000', null, 'a validated session with bonds cannot be cancelled'
);
select lives_ok(
  $$update public.import_sessions set status = 'confirmed', confirmed_by = 'b4400000-0000-0000-0000-000000000001'
    where id = pg_temp.id('s1')$$,
  'a validated session with every item linked is confirmed'
);
select isnt(
  (select confirmed_at from public.import_sessions where id = pg_temp.id('s1')),
  null, 'confirmed_at is set by the database'
);
select throws_ok(
  $$select pg_temp.bond('c-draft', 1, null, pg_temp.id('s1'))$$,
  '55000', null, 'no more bonds for a confirmed session'
);

-- Confirmed is final (except the rollback marker).
select throws_ok(
  $$update public.import_session_items set raw_value = 'x' where id = pg_temp.id('i2')$$,
  '55000', 'items of a confirmed import session cannot be changed',
  'items of a confirmed session are immutable'
);
select throws_ok(
  $$select pg_temp.item(pg_temp.id('s1'), 50)$$,
  '55000', 'items cannot be added to a confirmed import session',
  'no items can be added to a confirmed session'
);
select throws_ok(
  $$update public.import_sessions set notes = 'later' where id = pg_temp.id('s1')$$,
  '55000', null, 'a confirmed session cannot be edited'
);
select throws_ok(
  $$update public.import_sessions set status = 'cancelled', cancelled_by = 'b4400000-0000-0000-0000-000000000001'
    where id = pg_temp.id('s1')$$,
  '55000', null, 'a confirmed session cannot be cancelled'
);
select throws_ok(
  $$update public.import_sessions set rolled_back_by = 'b4400000-0000-0000-0000-000000000001',
      rollback_reason = 'Imported the wrong file' where id = pg_temp.id('s1')$$,
  '55000', null, 'the rollback marker requires every bond of the session to be annulled'
);
select throws_ok(
  $$update public.bonds set import_session_id = null where id = pg_temp.id('b-s1-simple')$$,
  '23001', 'bonds.import_session_id cannot be changed', 'bonds.import_session_id is immutable'
);
select pg_temp.annul(pg_temp.id('b-s1-simple'));
select pg_temp.annul(pg_temp.id('b-s1-pata'));
select throws_ok(
  $$update public.import_sessions set rolled_back_by = 'b4400000-0000-0000-0000-000000000001',
      rollback_reason = '  ' where id = pg_temp.id('s1')$$,
  '23514', null, 'the rollback needs a reason'
);
select lives_ok(
  $$update public.import_sessions set rolled_back_by = 'b4400000-0000-0000-0000-000000000001',
      rollback_reason = 'Imported the wrong file' where id = pg_temp.id('s1')$$,
  'a confirmed session whose bonds are annulled is marked as rolled back'
);
select is(
  (select (status, rolled_back_at is not null) from public.import_sessions where id = pg_temp.id('s1')),
  row('confirmed'::text, true), 'it stays confirmed with rolled_back_at set by the database'
);
select throws_ok(
  $$update public.import_sessions set rollback_reason = 'again' where id = pg_temp.id('s1')$$,
  '55000', null, 'the rollback marker is set once'
);

-- Cancel and fail.
insert into ids select 's2', pg_temp.session('c-draft', 'csv_file', 'b.csv');
select pg_temp.item(pg_temp.id('s2'), 1);
select throws_ok(
  $$update public.import_sessions set status = 'cancelled', cancelled_by = 'b4400000-0000-0000-0000-000000000002',
      cancel_reason = ' ' where id = pg_temp.id('s2')$$,
  '23514', null, 'a cancel reason, if given, is not blank'
);
select throws_ok(
  $$update public.import_sessions set status = 'cancelled' where id = pg_temp.id('s2')$$,
  '23514', null, 'cancelling records who cancelled'
);
select lives_ok(
  $$update public.import_sessions set status = 'cancelled', cancelled_by = 'b4400000-0000-0000-0000-000000000002'
    where id = pg_temp.id('s2')$$,
  'a draft session is cancelled'
);
select isnt(
  (select cancelled_at from public.import_sessions where id = pg_temp.id('s2')),
  null, 'cancelled_at is set by the database'
);
select throws_ok(
  $$update public.import_sessions set notes = 'x' where id = pg_temp.id('s2')$$,
  '55000', 'import session ' || pg_temp.id('s2') || ' is cancelled and cannot be changed',
  'a cancelled session is final'
);
select throws_ok(
  $$update public.import_session_items set raw_value = 'x' where import_session_id = pg_temp.id('s2')$$,
  '55000', null, 'items of a cancelled session are immutable'
);
insert into ids select 's3', pg_temp.session('c-draft');
select throws_ok(
  $$update public.import_sessions set status = 'failed' where id = pg_temp.id('s3')$$,
  '23514', null, 'a failed session needs a failure reason'
);
select lives_ok(
  $$update public.import_sessions set status = 'failed', failure_reason = 'Parser crashed' where id = pg_temp.id('s3')$$,
  'a draft session can be marked as failed'
);
select throws_ok(
  $$update public.import_sessions set status = 'draft', failed_at = null, failure_reason = null where id = pg_temp.id('s3')$$,
  '55000', null, 'a failed session is final'
);
insert into ids select 's4', pg_temp.session('c-draft');
select throws_ok(
  $$update public.import_sessions set status = 'confirmed', confirmed_by = 'b4400000-0000-0000-0000-000000000001'
    where id = pg_temp.id('s4')$$,
  '23514', null, 'draft -> confirmed is not a transition'
);

-- Validating requires a draft/active campaign.
insert into ids select 's5', pg_temp.session('c-active');
select pg_temp.item(pg_temp.id('s5'), 1);
update public.campaigns set status = 'closing' where id = pg_temp.id('c-active');
select throws_ok(
  $$update public.import_sessions set status = 'validated' where id = pg_temp.id('s5')$$,
  '55000', null, 'a session of a closing campaign cannot be validated'
);
select lives_ok(
  $$update public.import_sessions set status = 'cancelled', cancelled_by = 'b4400000-0000-0000-0000-000000000002'
    where id = pg_temp.id('s5')$$,
  'a session of a closing campaign can still be cancelled'
);

-- Never deleted.
select throws_ok(
  $$delete from public.import_session_items where import_session_id = pg_temp.id('s1')$$,
  '23001', null, 'items cannot be deleted (owner)'
);
select throws_ok(
  $$delete from public.import_sessions where id = pg_temp.id('s4')$$,
  '23001', null, 'sessions cannot be deleted (owner)'
);
select throws_ok(
  $$truncate public.import_session_items$$,
  '23001', null, 'items cannot be truncated (owner)'
);
select throws_ok(
  $$truncate public.import_sessions cascade$$,
  '23001', null, 'sessions cannot be truncated (owner)'
);

-- ---------------------------------------------------------------------------
-- Barcode namespace per campaign (bonds.barcode + bond_numbers.barcode)
-- ---------------------------------------------------------------------------
insert into ids select 'simple-x1', pg_temp.bond('c-codes', 1, 'X1');
insert into ids select 'pata-1', pg_temp.bond('c-codes', 2, 'PATA-1');
select lives_ok(
  $$select pg_temp.base(pg_temp.id('pata-1'), 100, 'PATA-1-100')$$,
  'a base number of a pata keeps its own barcode'
);
select throws_ok(
  $$insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind, source_base_number_id, barcode)
    select campaign_id, bond_id, 4971, 'associated', id, 'ASSOC' from public.bond_numbers
    where barcode = 'PATA-1-100'$$,
  '23514', null, 'only base numbers carry a barcode'
);
select throws_ok(
  $$select pg_temp.base(pg_temp.id('pata-1'), 101, 'X1')$$,
  '23505', 'barcode X1 is already used by bond ' || pg_temp.id('simple-x1'),
  'a number cannot take a barcode held by a live bond'
);
select throws_ok(
  $$select pg_temp.base(pg_temp.id('pata-1'), 101, 'PATA-1')$$,
  '23505', null, 'a number cannot take the barcode of its own pata either'
);
select throws_ok(
  $$select pg_temp.bond('c-codes', 1, 'PATA-1-100')$$,
  '23505', 'barcode PATA-1-100 is already used by bond ' || pg_temp.id('pata-1'),
  'a bond cannot take a barcode held by a live number'
);
select throws_ok(
  $$update public.bonds set barcode = 'PATA-1-100' where id = pg_temp.id('simple-x1')$$,
  '23505', null, 'changing a bond''s barcode is checked too'
);
select throws_ok(
  $$select pg_temp.base(pg_temp.id('pata-1'), 101, 'PATA-1-100')$$,
  '23505', null, 'two live numbers cannot share a barcode (unique index)'
);
select lives_ok(
  $$select pg_temp.bond('c-other', 1, 'PATA-1-100')$$,
  'the namespace is per campaign'
);
select throws_ok(
  $$update public.bond_numbers set barcode = 'OTHER' where barcode = 'PATA-1-100'$$,
  '23001', 'bond_numbers.barcode cannot be changed', 'bond_numbers.barcode is immutable'
);

-- bond_create reports a barcode held by a number like any duplicate barcode.
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$select public.bond_create(pg_temp.id('c-codes'), array[500], null, 'PATA-1-100')$$,
  '23505', 'barcode PATA-1-100 is already used by bond ' || pg_temp.id('pata-1'),
  'bond_create: a barcode held by a bond number is a duplicate'
);
reset role;

-- Freeing: a bond annulled from available frees its barcode; its released numbers free theirs.
select pg_temp.annul(pg_temp.id('simple-x1'));
select lives_ok(
  $$select pg_temp.base(pg_temp.id('pata-1'), 101, 'X1')$$,
  'the barcode of a bond annulled from available can be used by a number'
);
select pg_temp.annul(pg_temp.id('pata-1'));
update public.bond_numbers set released_at = now(), released_by = 'b4400000-0000-0000-0000-000000000001'
where bond_id = pg_temp.id('pata-1');
select lives_ok(
  $$select pg_temp.bond('c-codes', 1, 'PATA-1-100')$$,
  'the barcode of a released number can be used again'
);
select lives_ok(
  $$select pg_temp.bond('c-codes', 1, 'X1')$$,
  'released number barcodes and annulled bond barcodes are both free'
);
-- A bond annulled from sold keeps its codes held.
insert into ids select 'sold-1', pg_temp.bond('c-codes', 2, 'SOLD-PATA');
select pg_temp.base(pg_temp.id('sold-1'), 300, 'SOLD-300');
update public.bonds set commercial_status = 'delivered_to_collector' where id = pg_temp.id('sold-1');
update public.bonds set commercial_status = 'sold' where id = pg_temp.id('sold-1');
select pg_temp.annul(pg_temp.id('sold-1'));
select throws_ok(
  $$select pg_temp.base(pg_temp.bond('c-codes', 2), 301, 'SOLD-PATA')$$,
  '23505', null, 'the barcode of a bond annulled from sold stays held'
);
select throws_ok(
  $$select pg_temp.bond('c-codes', 1, 'SOLD-300')$$,
  '23505', null, 'the barcode of a held (never released) number stays held'
);

-- ---------------------------------------------------------------------------
-- RLS per seeded role
-- ---------------------------------------------------------------------------
create temporary table visible (role_name text primary key, sessions int, items int);
grant insert on visible to authenticated;
set local role authenticated;
select pg_temp.act_as(1);
insert into visible select 'admin', (select count(*) from public.import_sessions), (select count(*) from public.import_session_items);
select pg_temp.act_as(2);
insert into visible select 'operator', (select count(*) from public.import_sessions), (select count(*) from public.import_session_items);
select ok(public.has_permission('bond.scan'), 'operator has bond.scan at runtime');
select pg_temp.act_as(3);
insert into visible select 'treasurer', (select count(*) from public.import_sessions), (select count(*) from public.import_session_items);
select pg_temp.act_as(4);
insert into visible select 'collector', (select count(*) from public.import_sessions), (select count(*) from public.import_session_items);
select pg_temp.act_as(5);
insert into visible select 'read-only', (select count(*) from public.import_sessions), (select count(*) from public.import_session_items);
select pg_temp.act_as(2);
select throws_ok(
  $$insert into public.import_sessions (campaign_id, source_type, created_by)
    values (pg_temp.id('c-draft'), 'barcode_scan', 'b4400000-0000-0000-0000-000000000002')$$,
  '42501', null, 'operator cannot insert sessions directly'
);
select throws_ok(
  $$update public.import_session_items set raw_value = 'x'$$,
  '42501', null, 'operator cannot update items directly'
);
select throws_ok(
  $$delete from public.import_sessions$$,
  '42501', null, 'operator cannot delete sessions'
);
reset role;

select is(
  (select sessions from visible where role_name = 'admin'),
  (select count(*)::int from public.import_sessions),
  'admin (bond.import, bond.scan) sees every session'
);
select is(
  (select items from visible where role_name = 'admin'),
  (select count(*)::int from public.import_session_items),
  'admin sees every item'
);
select is(
  (select (sessions, items) from visible where role_name = 'operator'),
  (select (sessions, items) from visible where role_name = 'admin'),
  'operator (bond.import, bond.scan) sees every session and item'
);
select is(
  (select (sessions, items) from visible where role_name = 'treasurer'),
  row(0, 0), 'treasurer sees no import data'
);
select is(
  (select (sessions, items) from visible where role_name = 'collector'),
  row(0, 0), 'collector sees no import data'
);
select is(
  (select (sessions, items) from visible where role_name = 'read-only'),
  row(0, 0), 'read-only sees no import data'
);
set local role anon;
select throws_ok(
  $$select count(*) from public.import_sessions$$,
  '42501', null, 'anon cannot read sessions'
);
reset role;

select * from finish();
rollback;
