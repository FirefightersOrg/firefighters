-- SAN-45: staging and validation of import sessions (import_session_* functions).
begin;
select plan(91);

-- ---------------------------------------------------------------------------
-- Fixtures (created as the test owner)
-- ---------------------------------------------------------------------------
-- auth ids / profiles: ...01 admin, ...02 operator, ...03 treasurer, ...04 collector, ...05 read-only
insert into auth.users (id, email)
select ('a5500000-0000-0000-0000-00000000000' || n)::uuid, 'staging-' || n || '@example.com'
from generate_series(1, 5) as n;

insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b5500000-0000-0000-0000-00000000000' || n)::uuid,
  ('a5500000-0000-0000-0000-00000000000' || n)::uuid,
  'Staging user ' || n, 'staging-' || n || '@example.com', 'active'
from generate_series(1, 5) as n;

insert into public.user_roles (user_id, role_id)
select v.profile_id::uuid, r.id
from (values
  ('b5500000-0000-0000-0000-000000000001', 'admin'),
  ('b5500000-0000-0000-0000-000000000002', 'operator'),
  ('b5500000-0000-0000-0000-000000000003', 'treasurer'),
  ('b5500000-0000-0000-0000-000000000004', 'collector'),
  ('b5500000-0000-0000-0000-000000000005', 'read-only')
) as v (profile_id, role_name)
join public.roles r on r.name = v.role_name;

create function pg_temp.act_as(p_n int) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    format('{"sub":"a5500000-0000-0000-0000-00000000000%s","role":"authenticated"}', p_n),
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

-- Campaigns: 60000 in 10 installments, 4 digits, max 9999, offset 4871 (highest base: 5128).
with c as (
  insert into public.campaigns
    (name, simple_bond_value, installment_count, installment_value, barcode_mode, barcode_pattern,
     starts_at, ends_at)
  select v.name, 60000, 10, 6000, v.mode, v.pattern, '2026-03-01 00:00-03', '2026-12-31 23:59:59-03'
  from (values
    ('Import', 'base_number', null),
    ('Manual', 'manual_mapping', null),
    ('Pattern', 'internal_code', '^IT-([0-9]{4})$'),
    ('Closed', 'base_number', null)
  ) as v (name, mode, pattern)
  returning id, name
)
insert into ids select 'c-' || lower(c.name), c.id from c;
update public.campaigns set status = 'active' where id = pg_temp.id('c-closed');
update public.campaigns set status = 'closing' where id = pg_temp.id('c-closed');
update public.campaigns set status = 'closed' where id = pg_temp.id('c-closed');

-- A live bond of the Import campaign: base 100 (barcode LIVE-100) and its associated number.
with b as (
  insert into public.bonds
    (campaign_id, kind, origin, commercial_unit_count, total_value, barcode, commercial_status, created_by)
  values (pg_temp.id('c-import'), 'simple', 'printed', 1, 60000, 'LIVE-BOND', 'available',
    'b5500000-0000-0000-0000-000000000001')
  returning id
)
insert into ids select 'b-live', id from b;

with n as (
  insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind, barcode)
  values (pg_temp.id('c-import'), pg_temp.id('b-live'), 100, 'base', 'LIVE-100')
  returning id
)
insert into ids select 'n-live-base', id from n;

insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind, source_base_number_id)
values (pg_temp.id('c-import'), pg_temp.id('b-live'), 4971, 'associated', pg_temp.id('n-live-base'));

-- ---------------------------------------------------------------------------
-- Function surface and privileges
-- ---------------------------------------------------------------------------
select has_function('public', 'import_session_create', array['uuid', 'text', 'text', 'text', 'text'],
  'import_session_create exists');
select has_function('public', 'import_session_add_items', array['uuid', 'jsonb', 'text'],
  'import_session_add_items exists');
select has_function('public', 'import_session_add_scan', array['uuid', 'text', 'text', 'integer', 'text', 'text'],
  'import_session_add_scan exists');
select has_function('public', 'import_session_remove_item', array['uuid', 'text', 'text'],
  'import_session_remove_item exists');
select has_function('public', 'import_session_validate', array['uuid', 'text'],
  'import_session_validate exists');
select has_function('public', 'import_session_cancel', array['uuid', 'text', 'text'],
  'import_session_cancel exists');
select has_function('public', 'import_session_summary', array['uuid'],
  'import_session_summary exists');
select ok(
  has_function_privilege('authenticated', 'public.import_session_create(uuid,text,text,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.import_session_add_items(uuid,jsonb,text)', 'execute')
  and has_function_privilege('authenticated', 'public.import_session_add_scan(uuid,text,text,integer,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.import_session_remove_item(uuid,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.import_session_validate(uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'public.import_session_cancel(uuid,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.import_session_summary(uuid)', 'execute'),
  'authenticated can execute the public import functions'
);
select ok(
  not has_function_privilege('anon', 'public.import_session_create(uuid,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.import_session_add_items(uuid,jsonb,text)', 'execute')
  and not has_function_privilege('anon', 'public.import_session_add_scan(uuid,text,text,integer,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.import_session_remove_item(uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.import_session_validate(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.import_session_cancel(uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.import_session_summary(uuid)', 'execute'),
  'anon cannot execute the import functions'
);
select ok(
  not has_function_privilege('authenticated', 'public.import_session_revalidate(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.import_lock_session(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.import_require_actor(text)', 'execute'),
  'internal import helpers are not callable by API roles'
);

-- ---------------------------------------------------------------------------
-- Permission checks
-- ---------------------------------------------------------------------------
set local role authenticated;

select pg_temp.act_as(3);
select throws_ok(
  $$select public.import_session_create(pg_temp.id('c-import'), 'csv_file', 'bonds.csv')$$,
  '42501', null, 'a treasurer without bond.import cannot create a file session'
);
select pg_temp.act_as(5);
select throws_ok(
  $$select public.import_session_create(pg_temp.id('c-import'), 'csv_file', 'bonds.csv')$$,
  '42501', null, 'a read-only user cannot create a file session'
);
select pg_temp.act_as(3);
select throws_ok(
  $$select public.import_session_create(pg_temp.id('c-import'), 'barcode_scan')$$,
  '42501', null, 'a treasurer without bond.scan cannot create a scan session'
);

select pg_temp.act_as(2);
select isnt(
  public.import_session_create(pg_temp.id('c-import'), 'csv_file', 'bonds.csv'),
  null, 'the operator creates a file import session (bond.import)'
);

-- ---------------------------------------------------------------------------
-- create: argument and campaign checks
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.import_session_create(pg_temp.id('c-import'), 'legacy_system_export', 'x.csv')$$,
  '22023', 'invalid import source type: legacy_system_export',
  'the post-MVP source type is rejected'
);
select throws_ok(
  $$select public.import_session_create(pg_temp.id('c-import'), 'barcode_scan', 'x.csv')$$,
  '22023', 'barcode_scan sessions do not keep a file name',
  'a scan session cannot keep a file name'
);
select throws_ok(
  $$select public.import_session_create(pg_temp.id('c-import'), 'csv_file', null)$$,
  '22023', 'a file import needs the original file name',
  'a file session needs the original file name'
);
select throws_ok(
  $$select public.import_session_create(pg_temp.id('c-closed'), 'csv_file', 'x.csv')$$,
  '55000', null, 'a closed campaign cannot receive an import session'
);
select throws_ok(
  $$select public.import_session_create('00000000-0000-0000-0000-000000000000', 'csv_file', 'x.csv')$$,
  'P0002', null, 'an unknown campaign is rejected'
);

insert into ids
select 's1', public.import_session_create(pg_temp.id('c-import'), 'csv_file', 'bonds.csv', 'March batch');
select is(
  (select status from public.import_sessions where id = pg_temp.id('s1')),
  'draft', 'a new session starts in draft'
);
select is(
  (select created_by from public.import_sessions where id = pg_temp.id('s1')),
  'b5500000-0000-0000-0000-000000000002'::uuid, 'created_by is the caller'
);
select is(
  (select file_name from public.import_sessions where id = pg_temp.id('s1')),
  'bonds.csv', 'the original file name is kept'
);

-- ---------------------------------------------------------------------------
-- add_items: malformed payloads are client bugs (22023)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.import_session_add_items(pg_temp.id('s1'), '{}'::jsonb)$$,
  '22023', 'rows must be a JSON array', 'a non-array payload is rejected'
);
select throws_ok(
  $$select public.import_session_add_items(pg_temp.id('s1'), '[]'::jsonb)$$,
  '22023', 'at least one row is required', 'an empty batch is rejected'
);
select throws_ok(
  $$select public.import_session_add_items(pg_temp.id('s1'),
      '[{"row_number":2,"item_type":"bundle"}]'::jsonb)$$,
  '22023', 'row 1: item_type must be simple or pata', 'an invalid item_type is rejected'
);
select throws_ok(
  $$select public.import_session_add_items(pg_temp.id('s1'),
      '[{"row_number":2,"item_type":"pata"}]'::jsonb)$$,
  '22023', 'row 1: a pata row needs its grupo_pata', 'a pata row without grupo is rejected'
);
select throws_ok(
  $$select public.import_session_add_items(pg_temp.id('s1'),
      '[{"row_number":2,"item_type":"simple","group_key":"P1"}]'::jsonb)$$,
  '22023', 'row 1: a simple row cannot have a grupo_pata', 'a simple row with grupo is rejected'
);
select throws_ok(
  $$select public.import_session_add_items(pg_temp.id('s1'),
      '[{"row_number":2,"item_type":"simple","error_code":"Bad Code","error_message":"x"}]'::jsonb)$$,
  '22023', 'row 1: error_code must be snake_case', 'a non snake_case error_code is rejected'
);
select throws_ok(
  $$select public.import_session_add_items(pg_temp.id('s1'),
      '[{"row_number":2,"base_number":-1}]'::jsonb)$$,
  '22023', 'row 1: base_number must be a non-negative integer', 'a negative base number is rejected'
);
select throws_ok(
  $$select public.import_session_add_items(pg_temp.id('s1'),
      '[{"row_number":2},{"row_number":2}]'::jsonb)$$,
  '22023', 'the batch repeats a row_number', 'a duplicated row_number in the batch is rejected'
);

-- ---------------------------------------------------------------------------
-- add_items: business errors are staged, not raised
-- ---------------------------------------------------------------------------
select is(
  public.import_session_add_items(pg_temp.id('s1'), $$[
    {"row_number":2,"item_type":"simple","base_number":10,"barcode":"B-10","raw_value":"2"},
    {"row_number":3,"item_type":"simple","base_number":5129,"barcode":"B-5129","raw_value":"3"},
    {"row_number":4,"item_type":"simple","base_number":20,"barcode":"B-20","raw_value":"4"},
    {"row_number":5,"item_type":"simple","base_number":20,"barcode":"B-20b","raw_value":"5"},
    {"row_number":6,"item_type":"simple","base_number":100,"barcode":"X-100","raw_value":"6"},
    {"row_number":7,"item_type":"simple","base_number":30,"barcode":"B-30","raw_value":"7"},
    {"row_number":8,"item_type":"simple","base_number":40,"barcode":"LIVE-100","raw_value":"8"},
    {"row_number":9,"item_type":"pata","group_key":"P1","base_number":50,"raw_value":"9"},
    {"row_number":10,"item_type":"pata","group_key":"P1","base_number":51,"barcode":"P1","raw_value":"10"},
    {"row_number":11,"item_type":"simple","raw_value":"11"},
    {"row_number":12,"item_type":"simple","base_number":60,"error_code":"parse_bad_number","error_message":"Row 12 has no numeric base.","raw_value":"12"}
  ]$$::jsonb) ->> 'errors',
  '9', 'the staged batch reports every row in error'
);
select is(
  (select status from public.import_session_items where import_session_id = pg_temp.id('s1') and row_number = 2),
  'valid', 'a clean simple row is valid'
);
select is(
  (select error_code from public.import_session_items where import_session_id = pg_temp.id('s1') and row_number = 3),
  'number_out_of_range', 'a base whose associated number overflows is out of range'
);
select is(
  (select error_code from public.import_session_items where import_session_id = pg_temp.id('s1') and row_number = 4),
  'number_conflict', 'the first row of a repeated participating number is flagged'
);
select is(
  (select error_code from public.import_session_items where import_session_id = pg_temp.id('s1') and row_number = 5),
  'number_conflict', 'the second row of a repeated participating number is flagged'
);
select is(
  (select error_code from public.import_session_items where import_session_id = pg_temp.id('s1') and row_number = 6),
  'number_in_use', 'a base number already held by a live bond is rejected'
);
select is(
  (select status from public.import_session_items where import_session_id = pg_temp.id('s1') and row_number = 7),
  'valid', 'a distinct barcode remains valid'
);
select is(
  (select error_code from public.import_session_items where import_session_id = pg_temp.id('s1') and row_number = 10),
  'duplicate_barcode', 'a pata group code cannot also be a row barcode'
);
select is(
  (select error_code from public.import_session_items where import_session_id = pg_temp.id('s1') and row_number = 8),
  'barcode_in_use', 'a barcode already held by a live base number is rejected'
);
select is(
  (select error_code from public.import_session_items where import_session_id = pg_temp.id('s1') and row_number = 9),
  'missing_barcode', 'a pata row without barcode is rejected'
);
select is(
  (select error_code from public.import_session_items where import_session_id = pg_temp.id('s1') and row_number = 11),
  'missing_base_number', 'a row without base number is rejected'
);
select is(
  (select status || ':' || error_code from public.import_session_items
   where import_session_id = pg_temp.id('s1') and row_number = 12),
  'error:parse_bad_number', 'a parser error sent by the client is preserved'
);
select is(
  (select count(*)::int from public.import_session_items
   where import_session_id = pg_temp.id('s1') and status = 'valid'),
  2, 'only the clean rows are valid'
);

-- The summary of the staging preview.
select is(
  public.import_session_summary(pg_temp.id('s1')) ->> 'live_items', '11', 'the summary counts the live rows'
);
select is(
  public.import_session_summary(pg_temp.id('s1')) ->> 'errors', '9', 'the summary counts the rows in error'
);
select is(
  public.import_session_summary(pg_temp.id('s1')) ->> 'pata_groups', '1', 'the summary counts the pata groups'
);
select is(
  (public.import_session_summary(pg_temp.id('s1')) ->> 'valid')::boolean,
  false, 'a session with errors is not valid'
);

-- remove_item: soft removal frees the duplicate and revalidates.
insert into ids select 'i4',
  (select id from public.import_session_items where import_session_id = pg_temp.id('s1') and row_number = 4);
select is(
  public.import_session_remove_item(pg_temp.id('i4'), 'duplicate row') ->> 'errors', '7',
  'removing a row revalidates and clears its twin'
);
select is(
  (select error_code from public.import_session_items where import_session_id = pg_temp.id('s1') and row_number = 5),
  null, 'the twin of the removed row is valid again'
);
select isnt(
  (select removed_at from public.import_session_items where id = pg_temp.id('i4')),
  null, 'the removed row is kept as history'
);
select throws_ok(
  $$select public.import_session_remove_item(pg_temp.id('i4'))$$,
  '55000', null, 'a removed row cannot be removed twice'
);
select throws_ok(
  $$select public.import_session_remove_item('00000000-0000-0000-0000-000000000000')$$,
  'P0002', null, 'an unknown item is rejected'
);

-- validate: errors keep the session in draft.
select is(
  (public.import_session_validate(pg_temp.id('s1')) ->> 'validated')::boolean,
  false, 'validation fails while rows are in error'
);
select is(
  (select status from public.import_sessions where id = pg_temp.id('s1')),
  'draft', 'the session stays in draft'
);

-- ---------------------------------------------------------------------------
-- Successful import: a complete pata plus simple bonds
-- ---------------------------------------------------------------------------
insert into ids
select 's2', public.import_session_create(pg_temp.id('c-import'), 'csv_file', 'march.csv');

select is(
  public.import_session_add_items(pg_temp.id('s2'), $$[
    {"row_number":2,"item_type":"simple","base_number":200,"barcode":"B-200"},
    {"row_number":3,"item_type":"simple","base_number":201,"barcode":"B-201"},
    {"row_number":4,"item_type":"pata","group_key":"P2","base_number":300,"barcode":"P2-300"},
    {"row_number":5,"item_type":"pata","group_key":"P2","base_number":301,"barcode":"P2-301"}
  ]$$::jsonb) ->> 'valid',
  'true', 'a complete batch is valid'
);
select is(
  public.import_session_summary(pg_temp.id('s2')) ->> 'simple_items', '2', 'the summary counts simple bonds'
);
select is(
  public.import_session_summary(pg_temp.id('s2')) ->> 'pata_rows', '2', 'the summary counts pata rows'
);
select is(
  public.import_session_summary(pg_temp.id('s2')) ->> 'base_numbers', '4', 'the summary counts base numbers'
);
select is(
  public.import_session_summary(pg_temp.id('s2')) ->> 'participating_numbers', '8',
  'the summary counts bases plus associated numbers'
);
select is(
  (public.import_session_validate(pg_temp.id('s2')) ->> 'validated')::boolean,
  true, 'a clean session is validated'
);
select is(
  (select status from public.import_sessions where id = pg_temp.id('s2')),
  'validated', 'the session moves to validated'
);
select isnt(
  (select validated_at from public.import_sessions where id = pg_temp.id('s2')),
  null, 'validated_at is set by the database'
);

-- Adding a row to a validated session sends it back to draft.
select is(
  public.import_session_add_items(pg_temp.id('s2'), $$[
    {"row_number":6,"item_type":"simple","base_number":202,"barcode":"B-202"}
  ]$$::jsonb) ->> 'status',
  'draft', 'staging a row of a validated session returns it to draft'
);
select is(
  (public.import_session_validate(pg_temp.id('s2')) ->> 'validated')::boolean,
  true, 'the session can be validated again'
);

-- ---------------------------------------------------------------------------
-- A pata group with a single row is incomplete at validation
-- ---------------------------------------------------------------------------
insert into ids
select 's3', public.import_session_create(pg_temp.id('c-import'), 'csv_file', 'pata.csv');
select public.import_session_add_items(pg_temp.id('s3'), $$[
  {"row_number":2,"item_type":"pata","group_key":"P3","base_number":400,"barcode":"P3-400"}
]$$::jsonb);
select is(
  (public.import_session_validate(pg_temp.id('s3')) ->> 'validated')::boolean,
  false, 'a pata with one row cannot be validated'
);
select is(
  (select error_code from public.import_session_items where import_session_id = pg_temp.id('s3') and row_number = 2),
  'incomplete_pata', 'the lone pata row is marked incomplete'
);

-- ---------------------------------------------------------------------------
-- Scans: barcode_mode resolution
-- ---------------------------------------------------------------------------
select pg_temp.act_as(2);
insert into ids
select 's4', public.import_session_create(pg_temp.id('c-import'), 'barcode_scan');
select is(
  public.import_session_add_scan(pg_temp.id('s4'), '0688') ->> 'valid',
  'true', 'a base_number barcode resolves to its base number'
);
select is(
  (select base_number from public.import_session_items where import_session_id = pg_temp.id('s4') and row_number = 1),
  688, 'the scanned base number is stored'
);
select is(
  (select item_type from public.import_session_items where import_session_id = pg_temp.id('s4') and row_number = 1),
  'simple', 'a scan without grupo is a simple bond'
);
select is(
  public.import_session_add_scan(pg_temp.id('s4'), 'ABC') ->> 'errors',
  '1', 'a non-numeric code is staged as an error'
);
select is(
  (select error_code from public.import_session_items where import_session_id = pg_temp.id('s4') and row_number = 2),
  'parse_code_not_a_number', 'the code is reported as not a number'
);
select throws_ok(
  $$select public.import_session_add_scan(pg_temp.id('s4'), null)$$,
  '22023', 'a barcode is required', 'an empty scan is rejected'
);
select throws_ok(
  $$select public.import_session_add_scan(pg_temp.id('s1'), '0700')$$,
  '55000', null, 'a scan cannot be added to a file session'
);

-- manual_mapping: the operator types the base number.
insert into ids select 's5', public.import_session_create(pg_temp.id('c-manual'), 'barcode_scan');
select is(
  public.import_session_add_scan(pg_temp.id('s5'), 'M-1') ->> 'errors', '1',
  'manual_mapping without a base number is staged as an error'
);
select is(
  (select error_code from public.import_session_items where import_session_id = pg_temp.id('s5') and row_number = 1),
  'parse_base_number_required', 'the missing base number is reported'
);
select public.import_session_add_scan(pg_temp.id('s5'), 'M-2', null, 700);
select is(
  (select status from public.import_session_items where import_session_id = pg_temp.id('s5') and row_number = 2),
  'valid', 'manual_mapping accepts the typed base number'
);

-- internal_code: the pattern's first capture group is the base number.
insert into ids select 's6', public.import_session_create(pg_temp.id('c-pattern'), 'barcode_scan');
select public.import_session_add_scan(pg_temp.id('s6'), 'IT-0800');
select is(
  (select base_number from public.import_session_items where import_session_id = pg_temp.id('s6') and row_number = 1),
  800, 'the pattern capture group is the base number'
);
select is(
  public.import_session_add_scan(pg_temp.id('s6'), 'XX-1') ->> 'errors', '1',
  'a code that does not match the pattern is an error'
);
select is(
  (select error_code from public.import_session_items where import_session_id = pg_temp.id('s6') and row_number = 2),
  'parse_code_not_recognized', 'the unmatched code is reported'
);

-- Pata scans keep the group and the row barcode.
select public.import_session_add_scan(pg_temp.id('s6'), 'IT-0801', 'P6');
select is(
  (select status from public.import_session_items where import_session_id = pg_temp.id('s6') and row_number = 3),
  'valid', 'a scan with a grupo is staged as a pata row'
);
select is(
  (select item_type || ':' || group_key from public.import_session_items
   where import_session_id = pg_temp.id('s6') and row_number = 3),
  'pata:P6', 'the pata row keeps its group'
);

-- ---------------------------------------------------------------------------
-- Cancel and audit
-- ---------------------------------------------------------------------------
insert into ids
select 's7', public.import_session_create(pg_temp.id('c-import'), 'csv_file', 'cancel.csv');
select public.import_session_add_items(pg_temp.id('s7'), $$[
  {"row_number":2,"item_type":"simple","base_number":900,"barcode":"B-900"}
]$$::jsonb);
select public.import_session_cancel(pg_temp.id('s7'), 'wrong file');
select is(
  (select status from public.import_sessions where id = pg_temp.id('s7')),
  'cancelled', 'a draft session can be cancelled'
);
select is(
  (select cancel_reason from public.import_sessions where id = pg_temp.id('s7')),
  'wrong file', 'the cancel reason is kept'
);
select throws_ok(
  $$select public.import_session_add_items(pg_temp.id('s7'), '[{"row_number":3,"item_type":"simple","base_number":901}]'::jsonb)$$,
  '55000', null, 'a cancelled session cannot receive rows'
);
select throws_ok(
  $$select public.import_session_cancel(pg_temp.id('s7'))$$,
  '55000', null, 'a cancelled session cannot be cancelled twice'
);

reset role;

select ok(
  exists (select 1 from public.audit_log where action = 'import.create' and entity_id = pg_temp.id('s1')::text),
  'creating a session is audited'
);
select ok(
  exists (select 1 from public.audit_log where action = 'import.stage' and entity_id = pg_temp.id('s1')::text),
  'staging a batch is audited'
);
select ok(
  exists (select 1 from public.audit_log where action = 'import.remove_item' and entity_id = pg_temp.id('s1')::text),
  'removing a row is audited'
);
select ok(
  exists (select 1 from public.audit_log where action = 'import.validate' and entity_id = pg_temp.id('s2')::text),
  'validating the session is audited'
);
select ok(
  exists (select 1 from public.audit_log where action = 'import.cancel' and entity_id = pg_temp.id('s7')::text),
  'cancelling the session is audited'
);

-- Summary requires the import/scan permission (RLS + explicit check).
set local role authenticated;
select pg_temp.act_as(3);
select throws_ok(
  $$select public.import_session_summary(pg_temp.id('s1'))$$,
  '42501', null, 'a user without bond.import or bond.scan cannot read a summary'
);

select * from finish();
rollback;
