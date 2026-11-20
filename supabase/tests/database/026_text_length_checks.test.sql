-- SAN-97: max text lengths enforced at the database for RPC-exposed free-text columns.
begin;
select plan(28);

-- auth id / profile: ...01 admin
insert into auth.users (id, email)
values ('a9700000-0000-0000-0000-000000000001', 'len-1@example.com');

insert into public.profiles (id, auth_user_id, full_name, email, status)
values ('b9700000-0000-0000-0000-000000000001', 'a9700000-0000-0000-0000-000000000001',
  'Length admin', 'len-1@example.com', 'active');

insert into public.user_roles (user_id, role_id)
select 'b9700000-0000-0000-0000-000000000001', r.id from public.roles r where r.name = 'admin';

create temporary table ids (k text primary key, id uuid not null);
grant select, insert on ids to authenticated, anon, service_role;
create function pg_temp.id(p_k text) returns uuid language sql stable as $$
  select id from ids where k = p_k;
$$;
grant execute on function pg_temp.id(text) to authenticated, anon, service_role;

select set_config('request.jwt.claims',
  '{"sub":"a9700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

-- ---------------------------------------------------------------------------
-- campaigns.name (200)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.campaign_create(repeat('n', 201), 60000, 10, 4, 9999, 4871, 'reject', 'base_number')$$,
  '23514', null, 'campaigns.name: 201 characters is rejected'
);
select lives_ok(
  $$select public.campaign_create(repeat('n', 200), 60000, 10, 4, 9999, 4871, 'reject', 'base_number')$$,
  'campaigns.name: 200 characters is accepted'
);

insert into ids
select 'c1', public.campaign_create('Length campaign', 60000, 10, 4, 9999, 4871, 'reject', 'base_number');
insert into ids
select 'c2', public.campaign_create('Length campaign 2', 60000, 10, 4, 9999, 4871, 'reject', 'base_number');

-- audit_log.reason (1000) and audit_log.request_id (100), through campaign_update
select throws_ok(
  format($$select public.campaign_update(%L, 'Length r1', null, null, %L, null, %L)$$,
    pg_temp.id('c1'), (select updated_at from public.campaigns where id = pg_temp.id('c1')), repeat('r', 1001)),
  '23514', null, 'audit_log.reason: 1001 characters is rejected'
);
select lives_ok(
  format($$select public.campaign_update(%L, 'Length r1', null, null, %L, null, %L)$$,
    pg_temp.id('c1'), (select updated_at from public.campaigns where id = pg_temp.id('c1')), repeat('r', 1000)),
  'audit_log.reason: 1000 characters is accepted'
);
select throws_ok(
  format($$select public.campaign_update(%L, 'Length q1', null, null, %L, %L, null)$$,
    pg_temp.id('c1'), (select updated_at from public.campaigns where id = pg_temp.id('c1')), repeat('q', 101)),
  '23514', null, 'audit_log.request_id: 101 characters is rejected'
);
select lives_ok(
  format($$select public.campaign_update(%L, 'Length q1', null, null, %L, %L, null)$$,
    pg_temp.id('c1'), (select updated_at from public.campaigns where id = pg_temp.id('c1')), repeat('q', 100)),
  'audit_log.request_id: 100 characters is accepted'
);

-- ---------------------------------------------------------------------------
-- bonds.internal_code / barcode, bond_numbers.barcode (200)
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$select public.bond_create(%L, array[1], %L, null)$$, pg_temp.id('c1'), repeat('i', 201)),
  '23514', null, 'bonds.internal_code: 201 characters is rejected'
);
select throws_ok(
  format($$select public.bond_create(%L, array[1], null, %L)$$, pg_temp.id('c1'), repeat('b', 201)),
  '23514', null, 'bonds.barcode: 201 characters is rejected'
);
insert into ids
select 'b1', public.bond_create(pg_temp.id('c1'), array[1], repeat('i', 200), repeat('b', 200));
select is(
  (select char_length(internal_code) || '/' || char_length(barcode) from public.bonds where id = pg_temp.id('b1')),
  '200/200', 'bonds.internal_code and barcode: 200 characters are accepted'
);
-- bond_numbers.barcode is only written by import confirmation behind guard triggers: as the
-- owner, switch the user triggers off inside this transaction and update the column directly.
reset role;
alter table public.bond_numbers disable trigger user;
select throws_ok(
  format($$update public.bond_numbers set barcode = %L where bond_id = %L and number_kind = 'base'$$,
    repeat('b', 201), pg_temp.id('b1')),
  '23514', 'new row for relation "bond_numbers" violates check constraint "bond_numbers_barcode_max_length"',
  'bond_numbers.barcode: 201 characters is rejected'
);
select lives_ok(
  format($$update public.bond_numbers set barcode = %L where bond_id = %L and number_kind = 'base'$$,
    repeat('c', 200), pg_temp.id('b1')),
  'bond_numbers.barcode: 200 characters is accepted'
);
alter table public.bond_numbers enable trigger user;
set local role authenticated;

-- ---------------------------------------------------------------------------
-- bonds.annul_reason (1000)
-- ---------------------------------------------------------------------------
insert into ids select 'b2', public.bond_create(pg_temp.id('c1'), array[2]);
insert into ids select 'b3', public.bond_create(pg_temp.id('c1'), array[3]);
insert into ids select 'b4', public.bond_create(pg_temp.id('c1'), array[4]);
select throws_ok(
  format($$select public.bond_annul(%L, %L)$$, pg_temp.id('b2'), repeat('r', 1001)),
  '23514', null, 'bonds.annul_reason: 1001 characters is rejected'
);
select lives_ok(
  format($$select public.bond_annul(%L, %L)$$, pg_temp.id('b2'), repeat('r', 1000)),
  'bonds.annul_reason: 1000 characters is accepted'
);

-- ---------------------------------------------------------------------------
-- bond_groups.reason (1000)
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$select public.bond_group_into_pata(%L, array[%L, %L]::uuid[], null, null, null, %L)$$,
    pg_temp.id('c1'), pg_temp.id('b3'), pg_temp.id('b4'), repeat('r', 1001)),
  '23514', null, 'bond_groups.reason: 1001 characters is rejected'
);
select lives_ok(
  format($$select public.bond_group_into_pata(%L, array[%L, %L]::uuid[], null, null, null, %L)$$,
    pg_temp.id('c1'), pg_temp.id('b3'), pg_temp.id('b4'), repeat('r', 1000)),
  'bond_groups.reason: 1000 characters is accepted'
);

-- ---------------------------------------------------------------------------
-- commission_rules.annul_reason (1000)
-- ---------------------------------------------------------------------------
insert into ids
select 'r1', public.commission_rule_create(pg_temp.id('c2'), 'installment_last', null, 10, null, '2026-01-01');
select throws_ok(
  format($$select public.commission_rule_annul(%L, %L)$$, pg_temp.id('r1'), repeat('r', 1001)),
  '23514', null, 'commission_rules.annul_reason: 1001 characters is rejected'
);
select lives_ok(
  format($$select public.commission_rule_annul(%L, %L)$$, pg_temp.id('r1'), repeat('r', 1000)),
  'commission_rules.annul_reason: 1000 characters is accepted'
);

-- ---------------------------------------------------------------------------
-- import_sessions.cancel_reason, import_session_items.remove_reason / error_message (500)
-- ---------------------------------------------------------------------------
insert into ids select 's1', public.import_session_create(pg_temp.id('c2'), 'csv_file', 'a.csv');
insert into ids select 's2', public.import_session_create(pg_temp.id('c2'), 'csv_file', 'b.csv');

select throws_ok(
  format($$select public.import_session_add_items(%L, %L::jsonb)$$, pg_temp.id('s1'),
    jsonb_build_array(jsonb_build_object('row_number', 1, 'raw_value', 'x',
      'error_code', 'parse_bad', 'error_message', repeat('e', 501)))),
  '23514', null, 'import_session_items.error_message: 501 characters is rejected'
);
select lives_ok(
  format($$select public.import_session_add_items(%L, %L::jsonb)$$, pg_temp.id('s1'),
    jsonb_build_array(
      jsonb_build_object('row_number', 1, 'raw_value', 'x',
        'error_code', 'parse_bad', 'error_message', repeat('e', 500)),
      jsonb_build_object('row_number', 2, 'raw_value', 'y',
        'error_code', 'parse_bad', 'error_message', 'short'))),
  'import_session_items.error_message: 500 characters is accepted'
);
insert into ids
select 'i2', id from public.import_session_items
where import_session_id = pg_temp.id('s1') and row_number = 2;

select throws_ok(
  format($$select public.import_session_remove_item(%L, %L)$$, pg_temp.id('i2'), repeat('r', 501)),
  '23514', null, 'import_session_items.remove_reason: 501 characters is rejected'
);
select lives_ok(
  format($$select public.import_session_remove_item(%L, %L)$$, pg_temp.id('i2'), repeat('r', 500)),
  'import_session_items.remove_reason: 500 characters is accepted'
);
select throws_ok(
  format($$select public.import_session_cancel(%L, %L)$$, pg_temp.id('s2'), repeat('r', 501)),
  '23514', null, 'import_sessions.cancel_reason: 501 characters is rejected'
);
select lives_ok(
  format($$select public.import_session_cancel(%L, %L)$$, pg_temp.id('s2'), repeat('r', 500)),
  'import_sessions.cancel_reason: 500 characters is accepted'
);

-- rollback_reason / failure_reason have no writer reachable from this fixture: assert the CHECKs.
reset role;
select is(
  (select count(*)::int from pg_constraint
   where conname in ('import_sessions_rollback_reason_max_length', 'import_sessions_failure_reason_max_length')
     and pg_get_constraintdef(oid) like '%<= 500%'),
  2, 'import_sessions.rollback_reason and failure_reason are limited to 500'
);

-- ---------------------------------------------------------------------------
-- profiles.full_name (200) / email (254), through admin_provision_profile (service_role only)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a9700000-0000-0000-0000-000000000011', 'len-11@example.com'),
  ('a9700000-0000-0000-0000-000000000012', 'len-12@example.com'),
  ('a9700000-0000-0000-0000-000000000013', repeat('e', 242) || '@example.com'),
  ('a9700000-0000-0000-0000-000000000014', repeat('e', 243) || '@example.com');
select throws_ok(
  $$select public.admin_provision_profile('a9700000-0000-0000-0000-000000000011', repeat('f', 201), array['operator'])$$,
  '23514', null, 'profiles.full_name: 201 characters is rejected'
);
select lives_ok(
  $$select public.admin_provision_profile('a9700000-0000-0000-0000-000000000012', repeat('f', 200), array['operator'])$$,
  'profiles.full_name: 200 characters is accepted'
);
select throws_ok(
  $$select public.admin_provision_profile('a9700000-0000-0000-0000-000000000014', 'Long mail', array['operator'])$$,
  '23514', null, 'profiles.email: 255 characters is rejected'
);
select lives_ok(
  $$select public.admin_provision_profile('a9700000-0000-0000-0000-000000000013', 'Long mail', array['operator'])$$,
  'profiles.email: 254 characters is accepted'
);

select * from finish();
rollback;
