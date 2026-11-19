-- SAN-100: import_session_add_items verifies/derives the base number from the barcode, and
-- import_session_revalidate produces duplicate_number.
begin;
select plan(25);

-- ---------------------------------------------------------------------------
-- Fixtures (created as the test owner)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values ('a5800000-0000-0000-0000-000000000001', 'san100@example.com');
insert into public.profiles (id, auth_user_id, full_name, email, status)
values ('b5800000-0000-0000-0000-000000000001', 'a5800000-0000-0000-0000-000000000001',
  'SAN-100 operator', 'san100@example.com', 'active');
insert into public.user_roles (user_id, role_id)
select 'b5800000-0000-0000-0000-000000000001', r.id from public.roles r where r.name = 'operator';

create function pg_temp.act_as() returns void language sql as $$
  select set_config('request.jwt.claims',
    '{"sub":"a5800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
$$;
grant execute on function pg_temp.act_as() to authenticated;

create temporary table ids (k text primary key, id uuid not null);
grant select, insert on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql stable as $$
  select id from ids where k = p_k;
$$;
grant execute on function pg_temp.id(text) to authenticated;

-- 4 digits, max 9999, associated number offset 4871.
with c as (
  insert into public.campaigns
    (name, simple_bond_value, installment_count, installment_value, barcode_mode, barcode_pattern,
     starts_at, ends_at)
  select v.name, 60000, 10, 6000, v.mode, v.pattern, '2026-03-01 00:00-03', '2026-12-31 23:59:59-03'
  from (values
    ('Plain', 'base_number', null),
    ('Pattern', 'internal_code', '^IT-([0-9]{4})$'),
    ('NoPattern', 'external_legacy_code', null),
    ('Manual', 'manual_mapping', null)
  ) as v (name, mode, pattern)
  returning id, name
)
insert into ids select 'c-' || lower(c.name), c.id from c;

-- A live bond of the Manual campaign holding base number 100.
with b as (
  insert into public.bonds
    (campaign_id, kind, origin, commercial_unit_count, total_value, barcode, commercial_status, created_by)
  values (pg_temp.id('c-manual'), 'simple', 'printed', 1, 60000, 'LIVE-BOND', 'available',
    'b5800000-0000-0000-0000-000000000001')
  returning id
)
insert into ids select 'b-live', id from b;
insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind, barcode)
values (pg_temp.id('c-manual'), pg_temp.id('b-live'), 100, 'base', 'LIVE-100');
insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind, source_base_number_id)
select pg_temp.id('c-manual'), pg_temp.id('b-live'), 4971, 'associated', n.id
from public.bond_numbers n where n.bond_id = pg_temp.id('b-live') and n.number_kind = 'base';

select pg_temp.act_as();
set local role authenticated;

insert into ids select 's-plain', public.import_session_create(pg_temp.id('c-plain'), 'csv_file', 'plain.csv');
insert into ids select 's-pattern', public.import_session_create(pg_temp.id('c-pattern'), 'csv_file', 'pattern.csv');
insert into ids select 's-nopattern', public.import_session_create(pg_temp.id('c-nopattern'), 'csv_file', 'nopattern.csv');
insert into ids select 's-manual', public.import_session_create(pg_temp.id('c-manual'), 'csv_file', 'manual.csv');

create function pg_temp.item(p_session text, p_row int, p_col text) returns text
language sql stable as $$
  select (to_jsonb(i) ->> p_col) from public.import_session_items i
  where i.import_session_id = pg_temp.id(p_session) and i.row_number = p_row;
$$;
grant execute on function pg_temp.item(text, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- base_number mode: the barcode is the number
-- ---------------------------------------------------------------------------
select public.import_session_add_items(pg_temp.id('s-plain'), $$[
  {"row_number":2,"item_type":"simple","base_number":10,"barcode":"0010"},
  {"row_number":3,"item_type":"simple","base_number":11,"barcode":"0020"},
  {"row_number":4,"item_type":"simple","barcode":"0030"},
  {"row_number":5,"item_type":"simple","base_number":40,"barcode":"ABC"},
  {"row_number":6,"item_type":"simple","base_number":50},
  {"row_number":7,"item_type":"simple","barcode":"0060","base_number":60,
   "error_code":"parse_invalid_type","error_message":"from the parser"},
  {"row_number":8,"item_type":"simple","barcode":"99999999999"}
]$$::jsonb);
select is(pg_temp.item('s-plain', 2, 'status'), 'valid', 'a number that matches its barcode is valid');
select is(pg_temp.item('s-plain', 3, 'error_code'), 'parse_base_number_mismatch',
  'a base number that does not match the barcode is staged as a parse error');
select is(pg_temp.item('s-plain', 3, 'status'), 'error', 'the mismatching row is an error row');
select is(pg_temp.item('s-plain', 4, 'base_number'), '30', 'a missing base number is derived from the barcode');
select is(pg_temp.item('s-plain', 4, 'status'), 'valid', 'the derived row is valid');
select is(pg_temp.item('s-plain', 5, 'error_code'), 'parse_code_not_a_number', 'a barcode that is not a number is a parse error');
select is(pg_temp.item('s-plain', 6, 'status'), 'valid', 'a row without barcode keeps the client number');
select is(pg_temp.item('s-plain', 7, 'error_code'), 'parse_invalid_type', 'a parser error is kept as sent');
select is(pg_temp.item('s-plain', 8, 'error_code'), 'parse_code_not_a_number', 'a barcode over the integer range is not a number');

-- The parse error survives revalidation, so the mismatching row can never be confirmed.
select public.import_session_validate(pg_temp.id('s-plain'));
select is(pg_temp.item('s-plain', 3, 'error_code'), 'parse_base_number_mismatch',
  'the mismatch survives revalidation');
select is(
  (select status from public.import_sessions where id = pg_temp.id('s-plain')),
  'draft', 'a session with a mismatching row cannot be validated'
);

-- ---------------------------------------------------------------------------
-- pattern modes
-- ---------------------------------------------------------------------------
select public.import_session_add_items(pg_temp.id('s-pattern'), $$[
  {"row_number":2,"item_type":"simple","base_number":30,"barcode":"IT-0030"},
  {"row_number":3,"item_type":"simple","base_number":31,"barcode":"IT-0030"},
  {"row_number":4,"item_type":"simple","barcode":"IT-0040"},
  {"row_number":5,"item_type":"simple","base_number":50,"barcode":"XX-0050"}
]$$::jsonb);
select is(pg_temp.item('s-pattern', 2, 'status'), 'valid', 'the pattern capture matches the number');
select is(pg_temp.item('s-pattern', 3, 'error_code'), 'parse_base_number_mismatch', 'a number that differs from the capture is rejected');
select is(pg_temp.item('s-pattern', 4, 'base_number'), '40', 'the number is derived from the pattern capture');
select is(pg_temp.item('s-pattern', 5, 'error_code'), 'parse_code_not_recognized', 'a barcode outside the pattern is rejected');

-- A pattern mode without a pattern, and manual_mapping: the client's value is kept.
select public.import_session_add_items(pg_temp.id('s-nopattern'), $$[
  {"row_number":2,"item_type":"simple","base_number":70,"barcode":"ANY-1"}
]$$::jsonb);
select is(pg_temp.item('s-nopattern', 2, 'status'), 'valid', 'without a pattern the client number is trusted');
select is(pg_temp.item('s-nopattern', 2, 'base_number'), '70', 'without a pattern the client number is stored');

-- ---------------------------------------------------------------------------
-- duplicate_number / number_conflict / number_in_use (manual_mapping: the numbers are typed)
-- ---------------------------------------------------------------------------
select public.import_session_add_items(pg_temp.id('s-manual'), $$[
  {"row_number":2,"item_type":"simple","base_number":500,"barcode":"M-1"},
  {"row_number":3,"item_type":"simple","base_number":500,"barcode":"M-2"},
  {"row_number":4,"item_type":"simple","base_number":129,"barcode":"M-3"},
  {"row_number":5,"item_type":"simple","base_number":5000,"barcode":"M-4"},
  {"row_number":6,"item_type":"simple","base_number":100,"barcode":"M-5"},
  {"row_number":7,"item_type":"simple","base_number":700,"barcode":"M-6"}
]$$::jsonb);
select is(pg_temp.item('s-manual', 2, 'error_code'), 'duplicate_number', 'the first row of a repeated base number is a duplicate_number');
select is(pg_temp.item('s-manual', 3, 'error_code'), 'duplicate_number', 'the second row of a repeated base number is a duplicate_number');
select is(pg_temp.item('s-manual', 3, 'error_message'), 'Base number 0500 is repeated in the import.', 'duplicate_number says which number');
select is(pg_temp.item('s-manual', 4, 'error_code'), 'number_conflict', 'a base meeting another row''s associated number stays a number_conflict');
select is(pg_temp.item('s-manual', 5, 'error_code'), 'number_conflict', 'the other side of the associated-number clash is a number_conflict');
select is(pg_temp.item('s-manual', 6, 'error_code'), 'number_in_use', 'a number held by a bond is number_in_use, not duplicate_number');
select is(pg_temp.item('s-manual', 7, 'status'), 'valid', 'a distinct number is valid');
select is(
  (public.import_session_summary(pg_temp.id('s-manual')) ->> 'duplicates')::int, 5,
  'the summary counts duplicate_number, number_conflict and number_in_use as duplicates'
);

select * from finish();
rollback;
