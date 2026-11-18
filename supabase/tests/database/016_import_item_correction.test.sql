-- SAN-46: correcting a staged import row (import_session_update_item).
begin;
select plan(30);

-- auth ids / profiles: ...01 admin, ...02 operator, ...03 treasurer
insert into auth.users (id, email)
select ('a5800000-0000-0000-0000-00000000000' || n)::uuid, 'correct-' || n || '@example.com'
from generate_series(1, 3) as n;

insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b5800000-0000-0000-0000-00000000000' || n)::uuid,
  ('a5800000-0000-0000-0000-00000000000' || n)::uuid,
  'Correct user ' || n, 'correct-' || n || '@example.com', 'active'
from generate_series(1, 3) as n;

insert into public.user_roles (user_id, role_id)
select v.profile_id::uuid, r.id
from (values
  ('b5800000-0000-0000-0000-000000000001', 'admin'),
  ('b5800000-0000-0000-0000-000000000002', 'operator'),
  ('b5800000-0000-0000-0000-000000000003', 'treasurer')
) as v (profile_id, role_name)
join public.roles r on r.name = v.role_name;

create function pg_temp.act_as(p_n int) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    format('{"sub":"a5800000-0000-0000-0000-00000000000%s","role":"authenticated"}', p_n),
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
create function pg_temp.item(p_session text, p_row int) returns uuid language sql stable as $$
  select id from public.import_session_items
  where import_session_id = pg_temp.id(p_session) and row_number = p_row;
$$;
grant execute on function pg_temp.item(text, int) to authenticated, anon, service_role;

-- Campaigns: 4 digits, max 9999, offset 4871 (highest base: 5128). 'c' uses manual_mapping (no
-- barcode rule, so the free-form codes below are fine); 'cb' and 'cp' check the barcode rules.
with c as (
  insert into public.campaigns
    (name, simple_bond_value, installment_count, installment_value, barcode_mode, barcode_pattern,
     starts_at, ends_at)
  select v.name, 60000, 10, 6000, v.mode, v.pattern, '2026-03-01 00:00-03', '2026-12-31 23:59:59-03'
  from (values
    ('c', 'Correct', 'manual_mapping', null),
    ('cb', 'Base', 'base_number', null),
    ('cp', 'Pattern', 'internal_code', '^IT-([0-9]{4})$')
  ) as v (k, name, mode, pattern)
  returning id, name
)
insert into ids
select case name when 'Correct' then 'c' when 'Base' then 'cb' else 'cp' end, id from c;

-- ---------------------------------------------------------------------------
-- Surface
-- ---------------------------------------------------------------------------
select has_function('public', 'import_session_update_item',
  array['uuid', 'text', 'text', 'integer', 'text', 'text'], 'import_session_update_item exists');
select ok(
  has_function_privilege('authenticated', 'public.import_session_update_item(uuid,text,text,integer,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.import_session_update_item(uuid,text,text,integer,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.import_session_update_item(uuid,text,text,integer,text,text)', 'execute'),
  'only authenticated can execute import_session_update_item'
);

-- ---------------------------------------------------------------------------
-- A batch with a parser error, an out-of-range number and a duplicate
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(2);
insert into ids select 's1', public.import_session_create(pg_temp.id('c'), 'csv_file', 'bonds.csv');
select public.import_session_add_items(pg_temp.id('s1'), $$[
  {"row_number":2,"item_type":"simple","base_number":10,"barcode":"B-10"},
  {"row_number":3,"error_code":"parse_bad_number","error_message":"Row 3: numero_base must be a whole number.","raw_value":"simple,,abc,B-X"},
  {"row_number":4,"item_type":"simple","base_number":6000,"barcode":"B-6000"},
  {"row_number":5,"item_type":"simple","base_number":10,"barcode":"B-10b"}
]$$::jsonb);

select is(
  (public.import_session_summary(pg_temp.id('s1')) ->> 'errors')::int, 4,
  'every row but none is clean: the duplicate pair, the parser error and the out-of-range row'
);

insert into ids select 'i3', pg_temp.item('s1', 3);
select pg_temp.act_as(3);
select throws_ok(
  $$select public.import_session_update_item(pg_temp.id('i3'), 'simple', null, 20, 'B-20')$$,
  '42501', null, 'a treasurer without bond.import cannot correct a file row'
);

select pg_temp.act_as(2);
select throws_ok(
  $$select public.import_session_update_item('00000000-0000-0000-0000-000000000000', 'simple', null, 1, 'X')$$,
  'P0002', null, 'an unknown item is rejected'
);
select throws_ok(
  $$select public.import_session_update_item(pg_temp.item('s1', 3), 'bundle', null, 20, 'B-20')$$,
  '22023', 'item_type must be simple or pata', 'an invalid item_type is rejected'
);
select throws_ok(
  $$select public.import_session_update_item(pg_temp.item('s1', 3), 'pata', '  ', 20, 'B-20')$$,
  '22023', 'a pata row needs its grupo_pata', 'a pata correction needs its grupo_pata'
);
select throws_ok(
  $$select public.import_session_update_item(pg_temp.item('s1', 3), 'simple', 'P1', 20, 'B-20')$$,
  '22023', 'only a pata row can have a grupo_pata', 'a simple correction cannot keep a grupo_pata'
);
select throws_ok(
  $$select public.import_session_update_item(pg_temp.item('s1', 3), 'simple', null, -1, 'B-20')$$,
  '22023', 'base_number must be a non-negative integer', 'a negative base number is rejected'
);

-- Correcting the parser error clears it and revalidates the row.
select is(
  (public.import_session_update_item(pg_temp.item('s1', 3), ' simple ', '', 20, '  B-20 ', 'req-fix')
     ->> 'errors')::int,
  3, 'correcting the parser row clears its error'
);
select is(
  (select status || ':' || item_type || ':' || base_number || ':' || barcode || ':' || raw_value
   from public.import_session_items where id = pg_temp.item('s1', 3)),
  'valid:simple:20:B-20:simple,,abc,B-X',
  'the corrected row is valid, its fields are trimmed and the source row is kept'
);

-- A correction that is still wrong keeps a business error.
select is(
  (public.import_session_update_item(pg_temp.item('s1', 4), 'simple', null, 5200, 'B-5200')
     ->> 'errors')::int,
  3, 'a correction that still overflows stays in error'
);
select is(
  (select error_code from public.import_session_items where id = pg_temp.item('s1', 4)),
  'number_out_of_range', 'the revalidated error is reported'
);
select is(
  (public.import_session_update_item(pg_temp.item('s1', 4), 'simple', null, 40, 'B-40') ->> 'errors')::int,
  2, 'fixing the range leaves only the duplicate pair'
);

-- Fixing one side of a duplicate frees its twin too.
select is(
  (public.import_session_update_item(pg_temp.item('s1', 5), 'simple', null, 11, 'B-11') ->> 'errors')::int,
  0, 'fixing one duplicate clears both rows'
);
select is(
  public.import_session_validate(pg_temp.id('s1')) ->> 'status', 'validated',
  'the corrected session validates'
);

-- Editing a validated session sends it back to draft.
select public.import_session_update_item(pg_temp.item('s1', 5), 'simple', null, 12, 'B-12');
select is(
  (select status from public.import_sessions where id = pg_temp.id('s1')),
  'draft', 'correcting a row of a validated session returns it to draft'
);

-- Removed rows and final sessions cannot be corrected.
select public.import_session_remove_item(pg_temp.item('s1', 5), 'not needed');
select throws_ok(
  $$select public.import_session_update_item(pg_temp.item('s1', 5), 'simple', null, 13, 'B-13')$$,
  '55000', null, 'a removed row cannot be corrected'
);
select public.import_session_validate(pg_temp.id('s1'));
select public.import_session_confirm(pg_temp.id('s1'));
select throws_ok(
  $$select public.import_session_update_item(pg_temp.item('s1', 2), 'simple', null, 14, 'B-14')$$,
  '55000', null, 'a row of a confirmed session cannot be corrected'
);

-- Audit (readable with audit.view only).
reset role;
select is(
  (select count(*)::int from public.audit_log
   where action = 'import.update_item' and entity_id = pg_temp.id('s1')::text),
  5, 'every correction is audited on the session'
);
select is(
  (select old_value ->> 'error_code' || '>' || (new_value ->> 'base_number')
   from public.audit_log
   where action = 'import.update_item' and request_id = 'req-fix'),
  'parse_bad_number>20', 'the audit entry keeps the replaced error and the new fields'
);
select is(
  (select (old_value ->> 'row_number') || ':' || (new_value ->> 'item_id')
   from public.audit_log where action = 'import.update_item' and request_id = 'req-fix'),
  '3:' || pg_temp.item('s1', 3)::text, 'the audit entry names the corrected row'
);

-- ---------------------------------------------------------------------------
-- The campaign's barcode rule is applied again on correction (review on #39)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(2);
insert into ids select 'sb', public.import_session_create(pg_temp.id('cb'), 'csv_file', 'base.csv');
select public.import_session_add_items(pg_temp.id('sb'),
  '[{"row_number":2,"item_type":"simple","base_number":30,"barcode":"0030"}]'::jsonb);
select public.import_session_update_item(pg_temp.item('sb', 2), 'simple', null, 31, '0030');
select is(
  (select status || ':' || error_code from public.import_session_items where id = pg_temp.item('sb', 2)),
  'error:parse_base_number_mismatch',
  'base_number mode: a code that is not the typed number stays a parse error'
);
select public.import_session_update_item(pg_temp.item('sb', 2), 'simple', null, 31, 'X-31');
select is(
  (select error_code from public.import_session_items where id = pg_temp.item('sb', 2)),
  'parse_code_not_a_number', 'base_number mode: a code that is not a number stays a parse error'
);
select public.import_session_update_item(pg_temp.item('sb', 2), 'simple', null, 31, '0031');
select is(
  (select status from public.import_session_items where id = pg_temp.item('sb', 2)),
  'valid', 'base_number mode: a matching code and number are valid'
);

insert into ids select 'sp', public.import_session_create(pg_temp.id('cp'), 'csv_file', 'pattern.csv');
select public.import_session_add_items(pg_temp.id('sp'),
  '[{"row_number":2,"item_type":"simple","base_number":40,"barcode":"IT-0040"}]'::jsonb);
select public.import_session_update_item(pg_temp.item('sp', 2), 'simple', null, 40, 'ZZ');
select is(
  (select error_code from public.import_session_items where id = pg_temp.item('sp', 2)),
  'parse_code_not_recognized', 'pattern mode: a code that does not match the pattern stays a parse error'
);
select public.import_session_update_item(pg_temp.item('sp', 2), 'simple', null, 41, 'IT-0040');
select is(
  (select error_code from public.import_session_items where id = pg_temp.item('sp', 2)),
  'parse_base_number_mismatch', 'pattern mode: the captured number must be the typed number'
);
select public.import_session_update_item(pg_temp.item('sp', 2), 'simple', null, 41, 'IT-0041');
select is(
  (select status from public.import_session_items where id = pg_temp.item('sp', 2)),
  'valid', 'pattern mode: a matching code is valid'
);

-- import_session_add_scan returns the row it staged (concurrent scans report their own row).
insert into ids select 'ss', public.import_session_create(pg_temp.id('cb'), 'barcode_scan');
create temporary table scan_result as
  select public.import_session_add_scan(pg_temp.id('ss'), '0050') as r;
select is(
  (select (r ->> 'item_id')::uuid from scan_result), pg_temp.item('ss', 1),
  'add_scan returns the id of the staged row'
);
select is(
  (select (r ->> 'row_number')::int || ':' || (r ->> 'status') from scan_result), '1:draft',
  'add_scan returns the row number together with the summary'
);

select * from finish();
rollback;
