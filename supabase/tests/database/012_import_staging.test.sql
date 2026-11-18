-- SAN-45: import staging and validation functions (import_session_create / add_items /
-- add_scan / update_item / remove_item / cancel / validate).
begin;
select plan(63);

-- ---------------------------------------------------------------------------
-- Fixtures (created as the test owner)
-- ---------------------------------------------------------------------------
-- auth ids / profiles: ...01 admin, ...02 operator, ...03 treasurer, ...04 read-only
insert into auth.users (id, email)
select ('a4500000-0000-0000-0000-00000000000' || n)::uuid, 'staging-' || n || '@example.com'
from generate_series(1, 4) as n;

insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b4500000-0000-0000-0000-00000000000' || n)::uuid,
  ('a4500000-0000-0000-0000-00000000000' || n)::uuid,
  'Staging user ' || n, 'staging-' || n || '@example.com', 'active'
from generate_series(1, 4) as n;

insert into public.user_roles (user_id, role_id)
select v.profile_id::uuid, r.id
from (values
  ('b4500000-0000-0000-0000-000000000001', 'admin'),
  ('b4500000-0000-0000-0000-000000000002', 'operator'),
  ('b4500000-0000-0000-0000-000000000003', 'treasurer'),
  ('b4500000-0000-0000-0000-000000000004', 'read-only')
) as v (profile_id, role_name)
join public.roles r on r.name = v.role_name;

create function pg_temp.act_as(p_n int) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    format('{"sub":"a4500000-0000-0000-0000-00000000000%s","role":"authenticated"}', p_n),
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

-- The live item of a session at a row.
create function pg_temp.item(p_session text, p_row int) returns uuid language sql stable as $$
  select i.id from public.import_session_items i
  where i.import_session_id = pg_temp.id(p_session) and i.row_number = p_row;
$$;
grant execute on function pg_temp.item(text, int) to authenticated;

create function pg_temp.audits() returns bigint language sql stable security definer as $$
  select count(*) from public.audit_log where action like 'import.%';
$$;
grant execute on function pg_temp.audits() to authenticated;

create temporary table summaries (k text primary key, s jsonb);
grant select, insert on summaries to authenticated;

-- Campaigns: 60000 in 10 installments, 4 digits, max 9999, offset 4871.
with c as (
  insert into public.campaigns
    (name, simple_bond_value, installment_count, installment_value, barcode_mode, barcode_pattern,
     starts_at, ends_at)
  select v.name, 60000, 10, 6000, v.mode, v.pattern, '2026-03-01 00:00-03', '2026-12-31 23:59:59-03'
  from (values
    ('base', 'base_number', null),
    ('manual', 'manual_mapping', null),
    ('pattern', 'internal_code', '^BC-(\d+)$'),
    ('nopattern', 'external_legacy_code', null),
    ('closed', 'base_number', null)
  ) as v (name, mode, pattern)
  returning id, name
)
insert into ids select 'c-' || c.name, c.id from c;
update public.campaigns set status = 'active' where id = pg_temp.id('c-closed');
update public.campaigns set status = 'closing' where id = pg_temp.id('c-closed');
update public.campaigns set status = 'closed' where id = pg_temp.id('c-closed');

-- Existing bonds of c-base (as the admin, through the bond functions):
--   e-100   simple 0100 (+4971), barcode EXIST-1
--   e-200   simple 0200, barcode FREED, annulled from available (numbers and code freed)
--   e-300   simple 0300 whose base number carries the code NUM-CODE (owner insert)
set local role authenticated;
select pg_temp.act_as(1);
insert into ids select 'e-100', public.bond_create(pg_temp.id('c-base'), array[100], null, 'EXIST-1');
insert into ids select 'e-200', public.bond_create(pg_temp.id('c-base'), array[200], null, 'FREED');
select public.bond_annul(pg_temp.id('e-200'), 'loaded by mistake');
reset role;
with b as (
  insert into public.bonds
    (campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status, created_by)
  values (pg_temp.id('c-base'), 'simple', 'printed', 1, 60000, 'available',
    'b4500000-0000-0000-0000-000000000001')
  returning id
)
insert into ids select 'e-300', b.id from b;
insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind, barcode)
values (pg_temp.id('c-base'), pg_temp.id('e-300'), 300, 'base', 'NUM-CODE');

-- ---------------------------------------------------------------------------
-- Definitions and privileges
-- ---------------------------------------------------------------------------
select ok(
  (select count(*) = 7 and bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('import_session_create', 'import_session_add_items', 'import_session_add_scan',
       'import_session_update_item', 'import_session_remove_item', 'import_session_cancel',
       'import_session_validate')),
  'the seven staging functions exist, SECURITY DEFINER with an empty search_path'
);
select ok(
  (select bool_and(has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute')
     and not has_function_privilege('service_role', p.oid, 'execute'))
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'import\_session\_%'
     and p.proname not in ('import_session_snapshot', 'import_session_items_guard_write')),
  'authenticated (not anon / service_role) can execute the staging functions'
);
select ok(
  not exists (
    select 1 from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('import_require_actor', 'import_require_permission', 'import_trim',
        'import_rows_label', 'import_parse_payload', 'import_interpret_item', 'import_barcode_holder',
        'import_lock_campaign', 'import_lock_session', 'import_lock_item', 'import_session_snapshot',
        'import_item_snapshot', 'import_default_raw')
      and has_function_privilege(r, p.oid, 'execute')
  ),
  'internal import helpers are not executable by API roles'
);
select ok(
  (select prosrc ~* 'for share' from pg_proc where oid = 'public.import_lock_campaign(uuid)'::regprocedure)
  and (select prosrc ~* 'for update' from pg_proc where oid = 'public.import_lock_session(uuid)'::regprocedure),
  'staging locks the session FOR UPDATE and the campaign FOR SHARE'
);

-- ---------------------------------------------------------------------------
-- import_session_create
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(4);
select throws_ok(
  $$select public.import_session_create(pg_temp.id('c-base'), 'csv_file', 'a.csv')$$,
  '42501', 'permission denied: bond.import is required', 'read-only cannot create a file import'
);
select pg_temp.act_as(3);
select throws_ok(
  $$select public.import_session_create(pg_temp.id('c-base'), 'barcode_scan')$$,
  '42501', 'permission denied: bond.scan is required', 'treasurer cannot create a scan session'
);
select pg_temp.act_as(2);
select throws_ok(
  $$select public.import_session_create(pg_temp.id('c-base'), 'csv_file')$$,
  '22023', 'a file name is required for a file import', 'a file import needs a file name'
);
select throws_ok(
  $$select public.import_session_create(pg_temp.id('c-base'), 'barcode_scan', 'x.csv')$$,
  '22023', 'a barcode scan session has no file name', 'a scan session has no file name'
);
select throws_ok(
  $$select public.import_session_create(pg_temp.id('c-base'), 'legacy_system_export', 'x')$$,
  '22023', 'unknown import source type legacy_system_export', 'unknown source types are rejected'
);
select throws_ok(
  $$select public.import_session_create(pg_temp.id('c-closed'), 'csv_file', 'x.csv')$$,
  '55000', 'imports can only be staged or validated while the campaign is draft or active (status: closed)',
  'no sessions for a closed campaign'
);
select throws_ok(
  $$select public.import_session_create('00000000-0000-0000-0000-000000000000', 'csv_file', 'x.csv')$$,
  'P0002', null, 'unknown campaign'
);
select is(pg_temp.audits(), 0::bigint, 'rejected calls write no audit row');

select lives_ok(
  $$insert into ids select 's-file', public.import_session_create(pg_temp.id('c-base'), 'csv_file', '  bonos.csv ', '  First batch ', 'req-create')$$,
  'operator creates a CSV import session'
);
reset role;
select results_eq(
  $$select s.status, s.source_type, s.file_name, s.notes, s.created_by from public.import_sessions s where s.id = pg_temp.id('s-file')$$,
  $$values ('draft'::text, 'csv_file'::text, 'bonos.csv'::text, 'First batch'::text, 'b4500000-0000-0000-0000-000000000002'::uuid)$$,
  'create: draft session with trimmed file name and notes, created by the actor'
);
select results_eq(
  $$select action, entity_type, request_id, new_value ->> 'file_name' from public.audit_log where entity_id = pg_temp.id('s-file')::text$$,
  $$values ('import.create'::text, 'import_session'::text, 'req-create'::text, 'bonos.csv'::text)$$,
  'create: one import.create audit row'
);

-- ---------------------------------------------------------------------------
-- import_session_add_items
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(2);
select throws_ok(
  $$select public.import_session_add_items(pg_temp.id('s-file'), '[]')$$,
  '22023', 'at least one import item is required', 'an empty batch is rejected'
);
select throws_ok(
  $$select public.import_session_add_items(pg_temp.id('s-file'), '[{"barcode": "1"}]')$$,
  '22023', null, 'each item needs a row number'
);
select throws_ok(
  $$select public.import_session_add_items(pg_temp.id('s-file'), '[{"row_number": 2, "barcode": "1"}, {"row_number": 2, "barcode": "2"}]')$$,
  '22023', 'row 2 is already in this import session', 'repeated row numbers are rejected'
);
select throws_ok(
  $$select public.import_session_add_items(pg_temp.id('s-file'), jsonb_build_array(jsonb_build_object('row_number', 2, 'barcode', repeat('x', 501))))$$,
  '22023', 'import item field barcode is longer than 500 characters', 'overlong fields are rejected'
);
select throws_ok(
  $$select public.import_session_add_items(pg_temp.id('s-file'), '[{"row_number": 2, "barcode": 5}]')$$,
  '22023', 'import item field barcode must be text', 'fields must be text'
);

select is(
  public.import_session_add_items(pg_temp.id('s-file'), $j$[
    {"row_number": 2,  "raw": "simple,,0068,0068", "tipo_bono": "simple", "grupo_pata": "", "numero_base": "0068", "barcode": "0068"},
    {"row_number": 3,  "tipo_bono": " Simple ", "barcode": "77"},
    {"row_number": 4,  "tipo_bono": "pata", "grupo_pata": "P1", "numero_base": "1200", "barcode": "1200"},
    {"row_number": 5,  "tipo_bono": "pata", "grupo_pata": "P1", "numero_base": "1315", "barcode": "1315"},
    {"row_number": 6,  "tipo_bono": "pata", "grupo_pata": "P2", "numero_base": "1400", "barcode": "1400"},
    {"row_number": 7,  "tipo_bono": "simple", "barcode": "0100"},
    {"row_number": 8,  "tipo_bono": "pata", "grupo_pata": "EXIST-1", "barcode": "1500"},
    {"row_number": 9,  "tipo_bono": "pata", "grupo_pata": "EXIST-1", "barcode": "1501"},
    {"row_number": 10, "tipo_bono": "simple", "barcode": "6000"},
    {"row_number": 11, "tipo_bono": "simple", "numero_base": "0071", "barcode": "0070"},
    {"row_number": 12, "tipo_bono": "simple", "barcode": "0200"},
    {"row_number": 13, "tipo_bono": "bogus", "barcode": "0001"},
    {"row_number": 14, "tipo_bono": "simple", "barcode": "0050"},
    {"row_number": 15, "tipo_bono": "simple", "barcode": "4921"},
    {"row_number": 16, "tipo_bono": "simple", "barcode": "0700"},
    {"row_number": 17, "tipo_bono": "pata", "grupo_pata": "0700", "barcode": "0701"},
    {"row_number": 18, "tipo_bono": "pata", "grupo_pata": "0700", "barcode": "0702"}
  ]$j$, 'req-add'),
  17, 'operator stages 17 file rows'
);
reset role;

select results_eq(
  $$select row_number, status, item_type, group_key, base_number, barcode from public.import_session_items
    where import_session_id = pg_temp.id('s-file') and row_number in (2, 3, 4, 10, 11, 13) order by row_number$$,
  $$values (2, 'pending'::text, 'simple'::text, null::text, 68, '0068'::text),
           (3, 'pending', 'simple', null, 77, '77'),
           (4, 'pending', 'pata', 'P1', 1200, '1200'),
           (10, 'pending', 'simple', null, 6000, '6000'),
           (11, 'pending', 'simple', null, null, '0070'),
           (13, 'pending', null, null, 1, '0001')$$,
  'add: items are pending with the columns derived from the campaign rules'
);
select results_eq(
  $$select raw_value, parsed_value from public.import_session_items where id = pg_temp.item('s-file', 2)
    union all
    select raw_value, parsed_value from public.import_session_items where id = pg_temp.item('s-file', 3)$$,
  $$values ('simple,,0068,0068'::text, '{"tipo_bono": "simple", "grupo_pata": null, "numero_base": "0068", "barcode": "0068"}'::jsonb),
           ('Simple,,,77', '{"tipo_bono": "Simple", "grupo_pata": null, "numero_base": null, "barcode": "77"}')$$,
  'add: raw value kept (or rebuilt from the fields), parsed fields trimmed with blanks as null'
);
select results_eq(
  $$select action, (new_value ->> 'added')::int, (new_value ->> 'first_row')::int, (new_value ->> 'last_row')::int, request_id
    from public.audit_log where entity_id = pg_temp.id('s-file')::text and action = 'import.add_items'$$,
  $$values ('import.add_items'::text, 17, 2, 18, 'req-add'::text)$$,
  'add: one import.add_items audit row with the counts'
);

-- ---------------------------------------------------------------------------
-- import_session_validate: every check against the live campaign data
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(4);
select throws_ok(
  $$select public.import_session_validate(pg_temp.id('s-file'))$$,
  '42501', 'permission denied: bond.import is required', 'read-only cannot validate'
);
select pg_temp.act_as(2);
select lives_ok(
  $$insert into summaries select 'first', public.import_session_validate(pg_temp.id('s-file'), 'req-validate')$$,
  'operator validates the session'
);
reset role;

select results_eq(
  $$select row_number, status, error_code from public.import_session_items
    where import_session_id = pg_temp.id('s-file') order by row_number$$,
  $$values (2, 'valid'::text, null::text),
           (3, 'warning', 'base_number_not_padded'),
           (4, 'valid', null), (5, 'valid', null),
           (6, 'error', 'pata_incomplete'),
           (7, 'error', 'duplicate_number_in_campaign'),
           (8, 'error', 'duplicate_barcode_in_campaign'),
           (9, 'error', 'duplicate_barcode_in_campaign'),
           (10, 'error', 'overflow'),
           (11, 'error', 'base_number_mismatch'),
           (12, 'valid', null),
           (13, 'error', 'invalid_type'),
           (14, 'error', 'duplicate_number_in_batch'),
           (15, 'error', 'duplicate_number_in_batch'),
           (16, 'error', 'duplicate_barcode_in_batch'),
           (17, 'error', 'duplicate_barcode_in_batch'),
           (18, 'error', 'duplicate_barcode_in_batch')$$,
  'validate: statuses and codes (numbers and codes freed by an annulment are usable again)'
);
select results_eq(
  $$select row_number, error_message from public.import_session_items
    where import_session_id = pg_temp.id('s-file') and row_number in (3, 6, 7, 8, 10, 11, 13, 14, 16)
    order by row_number$$,
  $$values (3, 'Base number "77" is not padded to 4 digits (read as 0077)'::text),
           (6, 'Pata "P2" needs at least 2 valid rows (it has 1)'),
           (7, 'Number 0100 is already used by bond ' || pg_temp.id('e-100')),
           (8, 'Barcode "EXIST-1" is already used by bond ' || pg_temp.id('e-100')),
           (10, 'Base number 6000 overflows: its associated number 10871 exceeds the campaign maximum number 9999 (the highest allowed base number is 5128)'),
           (11, 'Base number 0071 does not match the number in barcode "0070" (0070)'),
           (13, 'Unknown bond type "bogus" (use simple or pata)'),
           (14, 'Number 4921 is repeated in this import (rows 14, 15)'),
           (16, 'Barcode "0700" is repeated in this import (rows 16, 17, 18)')$$,
  'validate: messages name the number, code, rows and the bond that holds it'
);
select is(
  (select s from summaries where k = 'first'),
  '{"status": "draft", "total_items": 17, "valid": 4, "warnings": 1, "errors": 12, "pending": 0,
    "simple_bonds": 3, "patas": 1, "base_numbers": 5, "participating_numbers": 10, "duplicates": 8}'::jsonb,
  'validate: preview summary; blocking errors keep the session in draft'
);
select is(
  (select status from public.import_sessions where id = pg_temp.id('s-file')), 'draft',
  'validate: session stays draft with errors'
);
select results_eq(
  $$select old_value ->> 'status', new_value ->> 'status', (new_value ->> 'errors')::int, request_id
    from public.audit_log where entity_id = pg_temp.id('s-file')::text and action = 'import.validate'$$,
  $$values ('draft'::text, 'draft'::text, 12, 'req-validate'::text)$$,
  'validate: one import.validate audit row with the summary'
);

-- ---------------------------------------------------------------------------
-- Corrections, removal and the validated state
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(2);
select is(
  public.import_session_update_item(pg_temp.item('s-file', 11), '{"tipo_bono": "simple", "numero_base": "0070", "barcode": "0070"}', 'req-fix'),
  true, 'operator corrects row 11'
);
select is(
  public.import_session_update_item(pg_temp.item('s-file', 11), '{"tipo_bono": "simple", "numero_base": "0070", "barcode": "0070"}'),
  false, 'the same correction again changes nothing'
);
select throws_ok(
  $$select public.import_session_update_item(pg_temp.item('s-file', 11), '"x"')$$,
  '22023', 'each import item must be an object', 'a correction must be an object'
);
reset role;
select results_eq(
  $$select status, error_code, base_number, raw_value from public.import_session_items where id = pg_temp.item('s-file', 11)$$,
  $$values ('pending'::text, null::text, 70, 'simple,,0071,0070'::text)$$,
  'update: back to pending with the new number; raw value keeps the source'
);
select is(
  (select count(*)::int from public.audit_log where entity_id = pg_temp.item('s-file', 11)::text and action = 'import.update_item'),
  1, 'update: one import.update_item audit row (none for the no-op)'
);

set local role authenticated;
select pg_temp.act_as(2);
select lives_ok(
  $$select public.import_session_remove_item(i.id, ' bad row ', 'req-remove')
    from public.import_session_items i
    where i.import_session_id = pg_temp.id('s-file') and i.status = 'error' and i.removed_at is null$$,
  'operator removes the rows in error'
);
select throws_ok(
  format('select public.import_session_remove_item(%L)', pg_temp.item('s-file', 6)),
  '55000', null, 'a removed item cannot be removed again'
);
select throws_ok(
  format('select public.import_session_update_item(%L, %L)', pg_temp.item('s-file', 6), '{"tipo_bono":"simple","barcode":"0006"}'),
  '55000', null, 'a removed item cannot be corrected'
);
insert into summaries select 'second', public.import_session_validate(pg_temp.id('s-file'));
reset role;

select results_eq(
  $$select count(*)::int, min(remove_reason), bool_and(removed_by = 'b4500000-0000-0000-0000-000000000002')
    from public.import_session_items where import_session_id = pg_temp.id('s-file') and removed_at is not null$$,
  $$values (11, 'bad row'::text, true)$$,
  'remove: 11 rows soft-removed with the trimmed reason and the actor'
);
select is(
  (select s from summaries where k = 'second'),
  '{"status": "validated", "total_items": 6, "valid": 5, "warnings": 1, "errors": 0, "pending": 0,
    "simple_bonds": 4, "patas": 1, "base_numbers": 6, "participating_numbers": 12, "duplicates": 0}'::jsonb,
  'validate: without blocking errors (warnings allowed) the session is validated'
);
select isnt(
  (select validated_at from public.import_sessions where id = pg_temp.id('s-file') and status = 'validated'),
  null, 'validate: validated_at is set'
);

set local role authenticated;
select pg_temp.act_as(2);
select public.import_session_update_item(pg_temp.item('s-file', 3), '{"tipo_bono": "simple", "barcode": "0077"}');
reset role;
select is(
  (select status from public.import_sessions where id = pg_temp.id('s-file')), 'draft',
  'correcting an item of a validated session sends it back to draft'
);
set local role authenticated;
select pg_temp.act_as(1);
select is(
  public.import_session_validate(pg_temp.id('s-file')) ->> 'status', 'validated',
  'admin validates it again'
);
reset role;
select is(
  (select status || '/' || coalesce(error_code, '-') from public.import_session_items where id = pg_temp.item('s-file', 3)),
  'valid/-', 'the corrected row is valid (padded)'
);
select is(
  (select count(*)::int from public.bonds where import_session_id = pg_temp.id('s-file')),
  0, 'staging and validation create no bonds'
);

-- A new bond using a staged number: validation catches it and the session returns to draft.
set local role authenticated;
select pg_temp.act_as(1);
select public.bond_create(pg_temp.id('c-base'), array[1200]);
select is(
  public.import_session_validate(pg_temp.id('s-file')) ->> 'status', 'draft',
  'a bond created meanwhile with a staged number makes validation fail'
);
reset role;
select results_eq(
  $$select row_number, status, error_code from public.import_session_items
    where import_session_id = pg_temp.id('s-file') and group_key = 'P1' order by row_number$$,
  $$values (4, 'error'::text, 'duplicate_number_in_campaign'::text), (5, 'valid', null)$$,
  'the conflicting pata row is in error'
);

-- ---------------------------------------------------------------------------
-- Scan sessions and barcode modes
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(2);
insert into ids select 's-pattern', public.import_session_create(pg_temp.id('c-pattern'), 'barcode_scan');
insert into ids select 's-manual', public.import_session_create(pg_temp.id('c-manual'), 'barcode_scan');
insert into ids select 's-nopattern', public.import_session_create(pg_temp.id('c-nopattern'), 'barcode_scan');
select throws_ok(
  $$select public.import_session_validate(pg_temp.id('s-pattern'))$$,
  '55000', null, 'a session without items cannot be validated'
);
select throws_ok(
  $$select public.import_session_add_items(pg_temp.id('s-pattern'), '[{"row_number": 1, "barcode": "BC-1"}]')$$,
  '22023', 'items of a barcode scan session are added one at a time', 'scans are not added in bulk'
);
select throws_ok(
  $$select public.import_session_add_scan(pg_temp.id('s-file'), '{"barcode": "1"}')$$,
  '22023', 'items of a file import are added in bulk', 'file rows are not added as scans'
);
select lives_ok(
  $$select public.import_session_add_scan(pg_temp.id('s-pattern'), '{"tipo_bono": "simple", "barcode": "BC-0042"}', 'req-scan')$$,
  'operator scans a code matching the campaign pattern'
);
select public.import_session_add_scan(pg_temp.id('s-pattern'), '{"tipo_bono": "simple", "barcode": "XX-0043"}');
select public.import_session_add_scan(pg_temp.id('s-pattern'), '{"tipo_bono": "simple", "barcode": "BC-0044", "numero_base": "0045"}');
select public.import_session_add_scan(pg_temp.id('s-pattern'), '{"tipo_bono": "simple", "barcode": "BC-123456"}');
select public.import_session_add_scan(pg_temp.id('s-manual'), '{"tipo_bono": "simple", "barcode": "ANY-1"}');
select public.import_session_add_scan(pg_temp.id('s-manual'), '{"tipo_bono": "simple", "barcode": "ANY-2", "numero_base": "0042"}');
select public.import_session_add_scan(pg_temp.id('s-nopattern'), '{"tipo_bono": "simple", "barcode": "LEG-9"}');
select public.import_session_validate(pg_temp.id('s-pattern'));
select public.import_session_validate(pg_temp.id('s-manual'));
select public.import_session_validate(pg_temp.id('s-nopattern'));
reset role;

select results_eq(
  $$select row_number, raw_value, base_number from public.import_session_items
    where import_session_id = pg_temp.id('s-pattern') and row_number = 1$$,
  $$values (1, 'BC-0042'::text, 42)$$,
  'scan: row numbers follow the scan order; the pattern reads the base number'
);
select results_eq(
  $$select s.k, i.row_number, i.status, i.error_code from public.import_session_items i
    join ids s on s.id = i.import_session_id
    where s.k in ('s-pattern', 's-manual', 's-nopattern') order by s.k, i.row_number$$,
  $$values ('s-manual'::text, 1, 'error'::text, 'missing_base_number'::text),
           ('s-manual', 2, 'valid', null),
           ('s-nopattern', 1, 'error', 'missing_base_number'),
           ('s-pattern', 1, 'valid', null),
           ('s-pattern', 2, 'error', 'barcode_pattern_mismatch'),
           ('s-pattern', 3, 'error', 'base_number_mismatch'),
           ('s-pattern', 4, 'error', 'invalid_barcode')$$,
  'barcode modes: pattern, manual mapping and a pattern mode without pattern'
);
select is(
  (select error_message from public.import_session_items where import_session_id = pg_temp.id('s-pattern') and row_number = 4),
  'The base number read from barcode "BC-123456" ("123456") is not a number of up to 4 digits',
  'pattern captures follow the campaign digit count'
);
select is(
  (select count(*)::int from public.audit_log where action = 'import.add_item'
     and new_value ->> 'import_session_id' = pg_temp.id('s-pattern')::text),
  4, 'scan: one import.add_item audit row per scan'
);

-- ---------------------------------------------------------------------------
-- Cancel
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(3);
select throws_ok(
  $$select public.import_session_cancel(pg_temp.id('s-manual'))$$,
  '42501', null, 'treasurer cannot cancel a scan session'
);
select pg_temp.act_as(2);
select lives_ok(
  $$select public.import_session_cancel(pg_temp.id('s-manual'), 'wrong campaign', 'req-cancel')$$,
  'operator cancels a session'
);
select throws_ok(
  $$select public.import_session_add_scan(pg_temp.id('s-manual'), '{"tipo_bono": "simple", "barcode": "ANY-3"}')$$,
  '55000', format('import session %s is cancelled and cannot be changed', pg_temp.id('s-manual')),
  'a cancelled session cannot receive items'
);
select throws_ok(
  $$select public.import_session_cancel(pg_temp.id('s-manual'))$$,
  '55000', null, 'a cancelled session cannot be cancelled again'
);
select throws_ok(
  $$select public.import_session_validate('00000000-0000-0000-0000-000000000000')$$,
  'P0002', null, 'unknown session'
);
reset role;
select results_eq(
  $$select s.status, s.cancel_reason, s.cancelled_by, a.action, a.reason, a.request_id
    from public.import_sessions s join public.audit_log a on a.entity_id = s.id::text and a.action = 'import.cancel'
    where s.id = pg_temp.id('s-manual')$$,
  $$values ('cancelled'::text, 'wrong campaign'::text, 'b4500000-0000-0000-0000-000000000002'::uuid,
      'import.cancel'::text, 'wrong campaign'::text, 'req-cancel'::text)$$,
  'cancel: cancelled with reason and actor, one import.cancel audit row'
);
select is(
  (select count(*)::int from public.audit_log where entity_id = pg_temp.id('s-manual')::text),
  3, 'session audit rows of the scan session: create, validate, cancel (scans are item rows)'
);

select * from finish();
rollback;
