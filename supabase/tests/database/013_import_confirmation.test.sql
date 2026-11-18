-- SAN-47: confirmation and functional rollback of import sessions.
begin;
select plan(59);

-- ---------------------------------------------------------------------------
-- Fixtures (created as the test owner)
-- ---------------------------------------------------------------------------
-- auth ids / profiles: ...01 admin, ...02 operator, ...03 treasurer, ...04 second admin
insert into auth.users (id, email)
select ('a5700000-0000-0000-0000-00000000000' || n)::uuid, 'confirm-' || n || '@example.com'
from generate_series(1, 4) as n;

insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b5700000-0000-0000-0000-00000000000' || n)::uuid,
  ('a5700000-0000-0000-0000-00000000000' || n)::uuid,
  'Confirm user ' || n, 'confirm-' || n || '@example.com', 'active'
from generate_series(1, 4) as n;

insert into public.user_roles (user_id, role_id)
select v.profile_id::uuid, r.id
from (values
  ('b5700000-0000-0000-0000-000000000001', 'admin'),
  ('b5700000-0000-0000-0000-000000000002', 'operator'),
  ('b5700000-0000-0000-0000-000000000003', 'treasurer'),
  ('b5700000-0000-0000-0000-000000000004', 'admin')
) as v (profile_id, role_name)
join public.roles r on r.name = v.role_name;

create function pg_temp.act_as(p_n int) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    format('{"sub":"a5700000-0000-0000-0000-00000000000%s","role":"authenticated"}', p_n),
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
    (name, simple_bond_value, installment_count, installment_value, barcode_mode,
     starts_at, ends_at)
  select v.name, 60000, 10, 6000, 'base_number', '2026-03-01 00:00-03', '2026-12-31 23:59:59-03'
  from (values ('Confirm'), ('Closing')) as v (name)
  returning id, name
)
insert into ids select 'c-' || lower(c.name), c.id from c;

-- ---------------------------------------------------------------------------
-- Function surface and privileges
-- ---------------------------------------------------------------------------
select has_function('public', 'import_session_confirm', array['uuid', 'text'],
  'import_session_confirm exists');
select has_function('public', 'import_session_rollback', array['uuid', 'text', 'text'],
  'import_session_rollback exists');
select ok(
  has_function_privilege('authenticated', 'public.import_session_confirm(uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'public.import_session_rollback(uuid,text,text)', 'execute'),
  'authenticated can execute confirm and rollback'
);
select ok(
  not has_function_privilege('anon', 'public.import_session_confirm(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.import_session_rollback(uuid,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.import_session_confirm(uuid,text)', 'execute')
  and not has_function_privilege('service_role', 'public.import_session_rollback(uuid,text,text)', 'execute'),
  'anon and service_role cannot execute confirm or rollback'
);
select ok(
  not exists (
    select 1 from (values ('anon'), ('authenticated'), ('service_role')) as r (role_name)
    where has_function_privilege(r.role_name,
      'public.import_audit_bond_create(uuid,public.bonds,uuid,text)', 'execute')
  ),
  'the bond audit helper is not callable by API roles'
);
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('import_session_confirm', 'import_session_rollback')),
  'confirm and rollback are SECURITY DEFINER with an empty search_path'
);

-- ---------------------------------------------------------------------------
-- Stage a clean batch: one simple bond and one printed pata of two units
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(2);

insert into ids select 's1', public.import_session_create(pg_temp.id('c-confirm'), 'csv_file', 'bonds.csv');
select public.import_session_add_items(pg_temp.id('s1'), $$[
  {"row_number":2,"item_type":"simple","base_number":10,"barcode":"B-10"},
  {"row_number":3,"item_type":"pata","group_key":"P1","base_number":20,"barcode":"P1-20"},
  {"row_number":4,"item_type":"pata","group_key":"P1","base_number":21,"barcode":"P1-21"}
]$$::jsonb);

select throws_ok(
  $$select public.import_session_confirm(pg_temp.id('s1'))$$,
  '55000', null, 'a draft session cannot be confirmed'
);

select is(
  public.import_session_validate(pg_temp.id('s1')) ->> 'status', 'validated',
  'the clean batch validates'
);

select pg_temp.act_as(3);
select throws_ok(
  $$select public.import_session_confirm(pg_temp.id('s1'))$$,
  '42501', null, 'a treasurer without bond.import cannot confirm a file session'
);
select throws_ok(
  $$select public.import_session_confirm('00000000-0000-0000-0000-000000000000')$$,
  'P0002', null, 'an unknown session is rejected'
);

-- ---------------------------------------------------------------------------
-- Confirm
-- ---------------------------------------------------------------------------
select pg_temp.act_as(2);
select is(
  (select r ->> 'status' || ':' || (r ->> 'confirmed') || ':' || (r ->> 'bonds_created') || ':'
     || (r ->> 'numbers_created')
   from (select public.import_session_confirm(pg_temp.id('s1'), 'req-confirm') as r) x),
  'confirmed:true:2:6',
  'the operator confirms the validated session and gets the bonds and numbers created'
);
select is(
  (select status || ':' || (confirmed_at is not null) || ':' || confirmed_by
   from public.import_sessions where id = pg_temp.id('s1')),
  'confirmed:true:b5700000-0000-0000-0000-000000000002',
  'the session records who confirmed it and when'
);
select is(
  (select count(*)::int from public.bonds where import_session_id = pg_temp.id('s1')),
  2, 'one simple bond and one pata are created'
);
select is(
  (select kind || ':' || origin || ':' || commercial_status || ':' || commercial_unit_count || ':'
     || total_value || ':' || barcode
   from public.bonds where import_session_id = pg_temp.id('s1') and kind = 'simple'),
  'simple:printed:available:1:60000.00:B-10',
  'the simple bond is printed, available, one unit at the campaign value, with its barcode'
);
select is(
  (select kind || ':' || origin || ':' || commercial_status || ':' || commercial_unit_count || ':'
     || total_value || ':' || barcode
   from public.bonds where import_session_id = pg_temp.id('s1') and kind = 'pata'),
  'pata:printed:available:2:120000.00:P1',
  'the pata is printed, available, one unit per row, and its barcode is the grupo_pata'
);
select is(
  (select created_by from public.bonds where import_session_id = pg_temp.id('s1') and kind = 'simple'),
  'b5700000-0000-0000-0000-000000000002'::uuid, 'imported bonds are created by the confirming user'
);
select is(
  (select array_agg(n.number_value || ':' || n.number_kind order by n.number_value)
   from public.bond_numbers n join public.bonds b on b.id = n.bond_id
   where b.import_session_id = pg_temp.id('s1') and b.kind = 'simple'),
  array['10:base', '4881:associated'],
  'the simple bond holds its base and associated numbers'
);
select is(
  (select array_agg(n.number_value || ':' || n.number_kind || ':' || coalesce(n.barcode, '-')
     order by n.number_value)
   from public.bond_numbers n join public.bonds b on b.id = n.bond_id
   where b.import_session_id = pg_temp.id('s1') and b.kind = 'pata'),
  array['20:base:P1-20', '21:base:P1-21', '4891:associated:-', '4892:associated:-'],
  'the pata holds every unit, and each row barcode lives on its base number'
);
select is(
  (select count(*)::int from public.import_session_items
   where import_session_id = pg_temp.id('s1') and created_bond_id is null),
  0, 'every item points to the bond it created'
);
select is(
  (select count(distinct created_bond_id)::int from public.import_session_items
   where import_session_id = pg_temp.id('s1') and item_type = 'pata'),
  1, 'both pata rows point to the same pata'
);
-- audit_log is only readable with audit.view: check it as the test owner.
reset role;
select is(
  (select count(*)::int from public.audit_log
   where action = 'import.confirm' and entity_id = pg_temp.id('s1')::text
     and request_id = 'req-confirm'),
  1, 'the confirmation is audited with its request id'
);
select is(
  (select new_value ->> 'source_type' || ':' || (new_value ->> 'file_name') || ':'
     || (new_value ->> 'bonds_created') || ':' || (new_value ->> 'numbers_created')
   from public.audit_log where action = 'import.confirm' and entity_id = pg_temp.id('s1')::text),
  'csv_file:bonds.csv:2:6', 'the confirmation audit keeps the source and what was created'
);
select is(
  (select count(*)::int from public.audit_log a
   join public.bonds b on a.entity_type = 'bond' and a.entity_id = b.id::text
   where b.import_session_id = pg_temp.id('s1') and a.action = 'bond.create'
     and a.new_value ->> 'import_session_id' = pg_temp.id('s1')::text
     and a.request_id = 'req-confirm'),
  2, 'each imported bond gets a bond.create entry linked to its import'
);
select is(
  (select jsonb_array_length(a.new_value -> 'numbers') from public.audit_log a
   join public.bonds b on a.entity_id = b.id::text
   where b.import_session_id = pg_temp.id('s1') and b.kind = 'pata' and a.action = 'bond.create'),
  4, 'the bond.create snapshot lists the numbers of the bond'
);
set local role authenticated;
select throws_ok(
  $$select public.import_session_confirm(pg_temp.id('s1'))$$,
  '55000', null, 'a confirmed session cannot be confirmed again'
);

-- ---------------------------------------------------------------------------
-- Confirmation revalidates: a number taken after validation sends it back to draft
-- ---------------------------------------------------------------------------
insert into ids select 's2', public.import_session_create(pg_temp.id('c-confirm'), 'csv_file', 'late.csv');
select public.import_session_add_items(pg_temp.id('s2'),
  '[{"row_number":2,"item_type":"simple","base_number":30,"barcode":"B-30"}]'::jsonb);
select public.import_session_validate(pg_temp.id('s2'));

insert into ids select 's3', public.import_session_create(pg_temp.id('c-confirm'), 'csv_file', 'first.csv');
select public.import_session_add_items(pg_temp.id('s3'),
  '[{"row_number":2,"item_type":"simple","base_number":30,"barcode":"B-30-OTHER"}]'::jsonb);
select public.import_session_validate(pg_temp.id('s3'));
select public.import_session_confirm(pg_temp.id('s3'));

select is(
  public.import_session_confirm(pg_temp.id('s2')) ->> 'confirmed', 'false',
  'confirming a session whose number was taken meanwhile reports it as not confirmed'
);
select is(
  (select status from public.import_sessions where id = pg_temp.id('s2')),
  'draft', 'the stale session goes back to draft'
);
select is(
  (select error_code from public.import_session_items where import_session_id = pg_temp.id('s2')),
  'number_in_use', 'the stale row shows the conflict'
);
select is(
  (select count(*)::int from public.bonds where import_session_id = pg_temp.id('s2')),
  0, 'a stale session creates no bonds'
);
reset role;
select is(
  (select count(*)::int from public.audit_log
   where action = 'import.confirm_rejected' and entity_id = pg_temp.id('s2')::text
     and new_value ->> 'status' = 'draft'),
  1, 'the rejected confirmation is audited (the session went back to draft)'
);
set local role authenticated;
select pg_temp.act_as(2);

-- ---------------------------------------------------------------------------
-- Confirmation needs a campaign that still accepts bonds
-- ---------------------------------------------------------------------------
insert into ids select 's4', public.import_session_create(pg_temp.id('c-closing'), 'csv_file', 'c.csv');
select public.import_session_add_items(pg_temp.id('s4'),
  '[{"row_number":2,"item_type":"simple","base_number":40,"barcode":"B-40"}]'::jsonb);
select public.import_session_validate(pg_temp.id('s4'));

reset role;
update public.campaigns set status = 'active' where id = pg_temp.id('c-closing');
update public.campaigns set status = 'closing' where id = pg_temp.id('c-closing');
set local role authenticated;
select pg_temp.act_as(2);

select throws_ok(
  $$select public.import_session_confirm(pg_temp.id('s4'))$$,
  '55000', null, 'a session of a closing campaign cannot be confirmed'
);

-- ---------------------------------------------------------------------------
-- Rollback: argument, permission and state checks
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.import_session_rollback(pg_temp.id('s1'), 'wrong batch')$$,
  '42501', null, 'an operator without bond.annul cannot roll back'
);

select pg_temp.act_as(1);
select throws_ok(
  $$select public.import_session_rollback(pg_temp.id('s1'), '   ')$$,
  '22023', 'a rollback reason is required', 'a blank reason is rejected'
);
select throws_ok(
  $$select public.import_session_rollback(pg_temp.id('s2'), 'not confirmed')$$,
  '55000', null, 'an unconfirmed session cannot be rolled back'
);
select throws_ok(
  $$select public.import_session_rollback('00000000-0000-0000-0000-000000000000', 'x')$$,
  'P0002', null, 'an unknown session is rejected on rollback'
);

-- A bond that left `available` for any status but `annulled` blocks the rollback of its import.
reset role;
update public.bonds set commercial_status = 'delivered_to_collector'
where import_session_id = pg_temp.id('s3');
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok(
  $$select public.import_session_rollback(pg_temp.id('s3'), 'wrong batch')$$,
  '55000', null, 'an import with a delivered bond cannot be rolled back'
);
select is(
  (select rolled_back_at from public.import_sessions where id = pg_temp.id('s3')),
  null, 'a refused rollback leaves the session untouched'
);

-- A bond already annulled by hand is skipped: the rollback annuls the rest and leaves it as it was.
select pg_temp.act_as(2);
insert into ids select 's7', public.import_session_create(pg_temp.id('c-confirm'), 'csv_file', 'skip.csv');
select public.import_session_add_items(pg_temp.id('s7'), $$[
  {"row_number":2,"item_type":"simple","base_number":70,"barcode":"K-70"},
  {"row_number":3,"item_type":"simple","base_number":71,"barcode":"K-71"}
]$$::jsonb);
select public.import_session_validate(pg_temp.id('s7'));
select public.import_session_confirm(pg_temp.id('s7'));
insert into ids select 'b70', id from public.bonds where import_session_id = pg_temp.id('s7') and barcode = 'K-70';
insert into ids select 'b71', id from public.bonds where import_session_id = pg_temp.id('s7') and barcode = 'K-71';
-- Annulled by hand by ANOTHER admin, so the author check below would catch an overwrite.
select pg_temp.act_as(4);
select public.bond_annul(pg_temp.id('b70'), 'damaged card');
select pg_temp.act_as(1);
select lives_ok(
  $$select public.import_session_rollback(pg_temp.id('s7'), 'wrong batch 7', 'req-skip')$$,
  'an import with a bond annulled by hand can be rolled back'
);
select is(
  (select annul_reason || ':' || annulled_by from public.bonds where id = pg_temp.id('b70')),
  'damaged card:b5700000-0000-0000-0000-000000000004',
  'the bond annulled by hand keeps its own reason and author'
);
select is(
  (select commercial_status || ':' || annul_reason from public.bonds where id = pg_temp.id('b71')),
  'annulled:wrong batch 7', 'the other bond of the import is annulled by the rollback'
);
reset role;
select is(
  (select count(*)::int from public.audit_log
   where action = 'bond.annul' and entity_id = pg_temp.id('b70')::text),
  1, 'the skipped bond gets no second bond.annul entry'
);
select is(
  (select (new_value ->> 'bonds_annulled') || ':' || (new_value ->> 'bonds_skipped')
   from public.audit_log where action = 'import.rollback' and request_id = 'req-skip'),
  '1:1', 'the rollback audit counts annulled and skipped bonds'
);
set local role authenticated;
select pg_temp.act_as(1);

-- A bond sold and then annulled keeps its numbers held: the rollback skips it and must not try to
-- release them (the trigger forbids releasing the numbers of a bond annulled from sold).
select pg_temp.act_as(2);
insert into ids select 's8', public.import_session_create(pg_temp.id('c-confirm'), 'csv_file', 'sold.csv');
select public.import_session_add_items(pg_temp.id('s8'), '[
  {"row_number":2,"item_type":"simple","base_number":80,"barcode":"S-80"},
  {"row_number":3,"item_type":"simple","base_number":81,"barcode":"S-81"}
]'::jsonb);
select public.import_session_validate(pg_temp.id('s8'));
select public.import_session_confirm(pg_temp.id('s8'));
insert into ids select 'b80', id from public.bonds where import_session_id = pg_temp.id('s8') and barcode = 'S-80';
insert into ids select 'b81', id from public.bonds where import_session_id = pg_temp.id('s8') and barcode = 'S-81';
reset role;
update public.bonds set commercial_status = 'delivered_to_collector' where id = pg_temp.id('b80');
update public.bonds set commercial_status = 'sold' where id = pg_temp.id('b80');
update public.bonds set commercial_status = 'annulled', annulled_by = 'b5700000-0000-0000-0000-000000000004',
  annul_reason = 'sale cancelled' where id = pg_temp.id('b80');
set local role authenticated;
select pg_temp.act_as(1);
select lives_ok(
  'select public.import_session_rollback(pg_temp.id(''s8''), ''wrong batch 8'')',
  'an import with a bond annulled from sold can be rolled back'
);
reset role;
select is(
  (select count(*)::int || ':' || count(*) filter (where released_at is null)
   from public.bond_numbers where bond_id = pg_temp.id('b80')),
  '2:2', 'the numbers of the bond annulled from sold stay held'
);
select is(
  (select (select annulled_from_status from public.bonds where id = pg_temp.id('b80')) || ':'
     || (select commercial_status || '/' || annul_reason from public.bonds where id = pg_temp.id('b81'))),
  'sold:annulled/wrong batch 8', 'the sold-annulled bond is skipped and the other one is annulled'
);
set local role authenticated;
select pg_temp.act_as(1);

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.import_session_rollback(pg_temp.id('s1'), '  wrong batch  ', 'req-rollback')$$,
  'the admin rolls back the confirmed import'
);
select is(
  (select status || ':' || (rolled_back_at is not null) || ':' || rolled_back_by || ':' || rollback_reason
   from public.import_sessions where id = pg_temp.id('s1')),
  'confirmed:true:b5700000-0000-0000-0000-000000000001:wrong batch',
  'the session stays confirmed and records the trimmed rollback reason'
);
select is(
  (select array_agg(distinct commercial_status || ':' || annul_reason || ':' || annulled_by)
   from public.bonds where import_session_id = pg_temp.id('s1')),
  array['annulled:wrong batch:b5700000-0000-0000-0000-000000000001'],
  'every imported bond is annulled with the reason'
);
select is(
  (select count(*)::int from public.bond_numbers n join public.bonds b on b.id = n.bond_id
   where b.import_session_id = pg_temp.id('s1') and n.released_at is null),
  0, 'every number of the import is released'
);
select is(
  (select count(*)::int from public.audit_log
   where action = 'import.rollback' and entity_id = pg_temp.id('s1')::text
     and reason = 'wrong batch' and request_id = 'req-rollback'),
  1, 'the rollback is audited on the session'
);
select is(
  (select count(*)::int from public.audit_log a
   join public.bonds b on a.entity_type = 'bond' and a.entity_id = b.id::text
   where b.import_session_id = pg_temp.id('s1') and a.action = 'bond.annul'
     and a.reason = 'wrong batch' and a.request_id = 'req-rollback'
     and a.new_value ->> 'import_session_id' = pg_temp.id('s1')::text),
  2, 'each annulled bond gets a bond.annul entry linked to the import'
);
select is(
  (select jsonb_array_length(a.new_value -> 'released_numbers') || ':'
     || jsonb_array_length(a.old_value -> 'numbers')
   from public.audit_log a join public.bonds b on a.entity_id = b.id::text
   where b.import_session_id = pg_temp.id('s1') and b.kind = 'pata' and a.action = 'bond.annul'),
  '4:4', 'the bond.annul entry lists the numbers it released'
);
select throws_ok(
  $$select public.import_session_rollback(pg_temp.id('s1'), 'again')$$,
  '55000', null, 'an import can only be rolled back once'
);

-- The released numbers and barcodes can be imported again.
select pg_temp.act_as(2);
insert into ids select 's5', public.import_session_create(pg_temp.id('c-confirm'), 'csv_file', 'retry.csv');
select public.import_session_add_items(pg_temp.id('s5'), $$[
  {"row_number":2,"item_type":"simple","base_number":10,"barcode":"B-10"},
  {"row_number":3,"item_type":"pata","group_key":"P1","base_number":20,"barcode":"P1-20"},
  {"row_number":4,"item_type":"pata","group_key":"P1","base_number":21,"barcode":"P1-21"}
]$$::jsonb);
select is(
  public.import_session_validate(pg_temp.id('s5')) ->> 'status', 'validated',
  'the numbers and barcodes freed by the rollback validate again'
);

-- ---------------------------------------------------------------------------
-- A bond grouped into a manual pata blocks the rollback until it is ungrouped
-- ---------------------------------------------------------------------------
select pg_temp.act_as(2);
insert into ids select 's6', public.import_session_create(pg_temp.id('c-confirm'), 'csv_file', 'group.csv');
select public.import_session_add_items(pg_temp.id('s6'), $$[
  {"row_number":2,"item_type":"simple","base_number":60,"barcode":"G-60"},
  {"row_number":3,"item_type":"simple","base_number":61,"barcode":"G-61"}
]$$::jsonb);
select public.import_session_validate(pg_temp.id('s6'));
select public.import_session_confirm(pg_temp.id('s6'));
insert into ids select 'p6', public.bond_group_into_pata(pg_temp.id('c-confirm'),
  (select array_agg(id order by id) from public.bonds where import_session_id = pg_temp.id('s6')));

select pg_temp.act_as(1);
select throws_ok(
  $$select public.import_session_rollback(pg_temp.id('s6'), 'grouped')$$,
  '55000', null, 'an import with a bond grouped into a manual pata cannot be rolled back'
);
select public.bond_ungroup_pata(pg_temp.id('p6'), 'regroup later');
select lives_ok(
  $$select public.import_session_rollback(pg_temp.id('s6'), 'after ungrouping')$$,
  'once ungrouped, the import can be rolled back'
);
select is(
  (select commercial_status::text from public.bonds where id = pg_temp.id('p6')),
  'annulled', 'the manual pata is not part of the import (it was annulled by the ungroup, not the rollback)'
);

-- ---------------------------------------------------------------------------
-- Rollback needs a campaign that still accepts bond changes
-- ---------------------------------------------------------------------------
reset role;
update public.campaigns set status = 'active' where id = pg_temp.id('c-confirm');
set local role authenticated;
select public.import_session_confirm(pg_temp.id('s5'));
reset role;
update public.campaigns set status = 'closing' where id = pg_temp.id('c-confirm');
set local role authenticated;

select pg_temp.act_as(1);
select throws_ok(
  $$select public.import_session_rollback(pg_temp.id('s5'), 'closing')$$,
  '55000', null, 'an import of a closing campaign cannot be rolled back'
);
select is(
  (select array_agg(distinct commercial_status) from public.bonds where import_session_id = pg_temp.id('s5')),
  array['available'], 'a refused rollback leaves the bonds available'
);

select * from finish();
rollback;
