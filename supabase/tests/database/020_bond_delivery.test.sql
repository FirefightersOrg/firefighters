-- SAN-53 / SAN-54: delivery, reassignment, return and loss of bonds.
begin;
select plan(68);

-- auth ids / profiles: ...01 admin, ...02 operator, ...03 treasurer, ...04 read-only
insert into auth.users (id, email)
select ('a6200000-0000-0000-0000-00000000000' || n)::uuid, 'deliv-' || n || '@example.com'
from generate_series(1, 4) as n;
insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b6200000-0000-0000-0000-00000000000' || n)::uuid,
  ('a6200000-0000-0000-0000-00000000000' || n)::uuid, 'Delivery user ' || n,
  'deliv-' || n || '@example.com', 'active'
from generate_series(1, 4) as n;
insert into public.user_roles (user_id, role_id)
select v.profile_id::uuid, r.id
from (values
  ('b6200000-0000-0000-0000-000000000001', 'admin'),
  ('b6200000-0000-0000-0000-000000000002', 'operator'),
  ('b6200000-0000-0000-0000-000000000003', 'treasurer'),
  ('b6200000-0000-0000-0000-000000000004', 'read-only')
) as v (profile_id, role_name)
join public.roles r on r.name = v.role_name;

create function pg_temp.act_as(p_n int) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"a6200000-0000-0000-0000-00000000000%s","role":"authenticated"}', p_n), true);
$$;
grant execute on function pg_temp.act_as(int) to authenticated, anon;
create temporary table ids (k text primary key, id uuid not null);
grant select, insert on ids to authenticated, anon, service_role;
create function pg_temp.id(p_k text) returns uuid language sql stable as $$
  select id from ids where k = p_k;
$$;
grant execute on function pg_temp.id(text) to authenticated, anon, service_role;

-- Campaign, collectors and bonds (owner).
with c as (
  insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('Delivery', 60000, 10, 6000, 'base_number') returning id
)
insert into ids select 'c', id from c;
with c as (
  insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('Other', 60000, 10, 6000, 'base_number') returning id
)
insert into ids select 'c2', id from c;
-- Deliveries happen only while the campaign is active (product decision on #47).
update public.campaigns set status = 'active', starts_at = date '2026-01-01', ends_at = date '2027-12-31'
  where id in (pg_temp.id('c'), pg_temp.id('c2'));
with c as (insert into public.collectors (display_name) values ('Ana') returning id)
insert into ids select 'ana', id from c;
with c as (insert into public.collectors (display_name) values ('Beto') returning id)
insert into ids select 'beto', id from c;
with c as (insert into public.collectors (display_name, status) values ('Old', 'inactive') returning id)
insert into ids select 'old', id from c;
with b as (
  insert into public.bonds (campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
  select pg_temp.id('c'), 'simple', 'printed', 1, 60000, 'available' from generate_series(1, 6)
  returning id
)
insert into ids select 'b' || row_number() over (order by id), id from b;
with b as (
  insert into public.bonds (campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
  values (pg_temp.id('c2'), 'simple', 'printed', 1, 60000, 'available') returning id
)
insert into ids select 'other', id from b;

-- ---------------------------------------------------------------------------
-- Schema and privileges
-- ---------------------------------------------------------------------------
select has_table('public', 'bond_assignments', 'bond_assignments exists');
select has_table('public', 'delivery_notes', 'delivery_notes exists');
select has_table('public', 'delivery_note_items', 'delivery_note_items exists');
select throws_ok(
  $$insert into public.bond_assignments (campaign_id, bond_id, collector_id, assignment_type, status, created_by, delivery_note_id)
    values (pg_temp.id('c'), pg_temp.id('b1'), pg_temp.id('ana'), 'loan', 'active', 'b6200000-0000-0000-0000-000000000001', null)$$,
  '23514', null, 'assignment_type only allows delivery, return, reassignment and lost'
);
select ok(
  has_table_privilege('authenticated', 'public.bond_assignments', 'select')
  and not has_table_privilege('authenticated', 'public.bond_assignments', 'insert')
  and not has_table_privilege('authenticated', 'public.delivery_notes', 'insert')
  and not has_table_privilege('anon', 'public.delivery_notes', 'select'),
  'authenticated only reads; anon reads nothing'
);
select ok(
  has_function_privilege('authenticated', 'public.bond_deliver(uuid,uuid,uuid[],text,text)', 'execute')
  and not has_function_privilege('anon', 'public.bond_deliver(uuid,uuid,uuid[],text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.bond_return(uuid,uuid[],text,text,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.delivery_issue_note(uuid,uuid,uuid,text,text)', 'execute'),
  'write functions are for authenticated; helpers are internal'
);

-- ---------------------------------------------------------------------------
-- Deliver
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(3);
select throws_ok($$select public.bond_deliver(pg_temp.id('c'), pg_temp.id('ana'), array[pg_temp.id('b1')])$$,
  '42501', null, 'a treasurer without bond.assign cannot deliver');
select pg_temp.act_as(2);
select throws_ok($$select public.bond_deliver(pg_temp.id('c'), pg_temp.id('old'), array[pg_temp.id('b1')])$$,
  '55000', null, 'an inactive collector cannot receive bonds');
select throws_ok($$select public.bond_deliver(pg_temp.id('c'), pg_temp.id('ana'), array[pg_temp.id('b1'), pg_temp.id('b1')])$$,
  '22023', null, 'a repeated bond is rejected');
select throws_ok($$select public.bond_deliver(pg_temp.id('c'), pg_temp.id('ana'), array[pg_temp.id('other')])$$,
  '22023', 'a bond belongs to another campaign', 'a bond of another campaign is rejected');
select throws_ok($$select public.bond_deliver(pg_temp.id('c'), pg_temp.id('ana'), array[]::uuid[])$$,
  '22023', 'at least one bond is required', 'an empty delivery is rejected');

insert into ids select 'n1', public.bond_deliver(pg_temp.id('c'), pg_temp.id('ana'),
  array[pg_temp.id('b1'), pg_temp.id('b2'), pg_temp.id('b3')], ' first batch ', 'req-deliver');
select is(
  (select note_number || ':' || collector_id || ':' || notes || ':' || reason from public.delivery_notes where id = pg_temp.id('n1')),
  '1:' || pg_temp.id('ana') || ':first batch:delivery', 'the operator issues delivery note #1 for Ana'
);
select is(
  (select count(*)::int from public.bonds where id in (pg_temp.id('b1'), pg_temp.id('b2'), pg_temp.id('b3'))
     and commercial_status = 'delivered_to_collector' and current_collector_id = pg_temp.id('ana')),
  3, 'the three bonds are delivered to Ana'
);
select is((select count(*)::int from public.delivery_note_items where delivery_note_id = pg_temp.id('n1')),
  3, 'the note lists the three bonds');
select is(
  (select count(*)::int from public.bond_assignments where delivery_note_id = pg_temp.id('n1')
     and assignment_type = 'delivery' and status = 'active' and returned_at is null),
  3, 'each bond has an active delivery assignment'
);
select throws_ok($$select public.bond_deliver(pg_temp.id('c'), pg_temp.id('beto'), array[pg_temp.id('b1')])$$,
  '55000', null, 'a delivered bond cannot be delivered again');
insert into ids select 'n2', public.bond_deliver(pg_temp.id('c'), pg_temp.id('beto'), array[pg_temp.id('b4')]);
select is((select note_number from public.delivery_notes where id = pg_temp.id('n2')), 2,
  'notes are numbered sequentially per campaign');

-- ---------------------------------------------------------------------------
-- Reassign
-- ---------------------------------------------------------------------------
select throws_ok($$select public.bond_reassign(pg_temp.id('c'), pg_temp.id('ana'), array[pg_temp.id('b1')])$$,
  '22023', null, 'reassigning to the same collector is rejected');
select throws_ok($$select public.bond_reassign(pg_temp.id('c'), pg_temp.id('ana'), array[pg_temp.id('b5')])$$,
  '55000', null, 'an available bond cannot be reassigned (deliver it instead)');
insert into ids select 'n3', public.bond_reassign(pg_temp.id('c'), pg_temp.id('beto'), array[pg_temp.id('b2')], null, 'req-reassign');
select is(
  (select commercial_status || ':' || current_collector_id from public.bonds where id = pg_temp.id('b2')),
  'delivered_to_collector:' || pg_temp.id('beto'), 'the reassigned bond is now Beto''s, still delivered'
);
select is(
  (select array_agg(assignment_type || '/' || status order by assigned_at, assignment_type) from public.bond_assignments where bond_id = pg_temp.id('b2')),
  array['delivery/reassigned', 'reassignment/active'], 'the old custody is closed as reassigned and a new one is active'
);
select is((select reason || ':' || note_number from public.delivery_notes where id = pg_temp.id('n3')),
  'reassignment:3', 'the reassignment issues a note for the new collector');

-- ---------------------------------------------------------------------------
-- Return
-- ---------------------------------------------------------------------------
-- Current matrix: bond.return and bond.mark_lost are admin-only (the operator only assigns).
select throws_ok($$select public.bond_return(pg_temp.id('c'), array[pg_temp.id('b1')])$$,
  '42501', null, 'the operator without bond.return cannot return bonds');
select pg_temp.act_as(1);
select throws_ok($$select public.bond_return(pg_temp.id('c'), array[pg_temp.id('b5')])$$,
  '55000', null, 'an available bond cannot be returned');
select pg_temp.act_as(4);
select throws_ok($$select public.bond_return(pg_temp.id('c'), array[pg_temp.id('b1')])$$,
  '42501', null, 'read-only cannot return bonds');
select pg_temp.act_as(1);
with r as (select public.bond_return(pg_temp.id('c'), array[pg_temp.id('b1')], 'unsold', 'req-return') as id)
insert into ids select 'rn', id from r;
select is(
  (select reason || ':' || collector_id::text from public.delivery_notes where id = pg_temp.id('rn')),
  'return:' || pg_temp.id('ana')::text, 'the admin returns a bond and gets a return note for the collector'
);
select is(
  (select delivery_note_id from public.bond_assignments where bond_id = pg_temp.id('b1') and assignment_type = 'return'),
  pg_temp.id('rn'), 'the return row points to its return note'
);
select is(
  (select commercial_status || ':' || coalesce(current_collector_id::text, 'none') from public.bonds where id = pg_temp.id('b1')),
  'available:none', 'the returned bond is available again, without collector'
);
select is(
  (select array_agg(assignment_type || '/' || status order by assigned_at, assignment_type) from public.bond_assignments where bond_id = pg_temp.id('b1')),
  array['delivery/returned', 'return/returned'], 'the custody is closed and the return is recorded'
);
select is(
  (select collector_id from public.bond_assignments where bond_id = pg_temp.id('b1') and assignment_type = 'return'),
  pg_temp.id('ana'), 'the return records who gave the bond back'
);

-- A sold bond is never returned, reassigned or marked lost here.
reset role;
update public.bonds set commercial_status = 'sold' where id = pg_temp.id('b3');
set local role authenticated;
select pg_temp.act_as(1);
select throws_ok($$select public.bond_return(pg_temp.id('c'), array[pg_temp.id('b3')])$$,
  '55000', null, 'a sold bond cannot be returned');
select throws_ok($$select public.bond_reassign(pg_temp.id('c'), pg_temp.id('beto'), array[pg_temp.id('b3')])$$,
  '55000', null, 'a sold bond cannot be reassigned');
select throws_ok($$select public.bond_mark_lost(pg_temp.id('c'), pg_temp.id('b3'), 'Ana', current_date, 'gone')$$,
  '55000', null, 'a sold bond cannot be marked lost');

-- ---------------------------------------------------------------------------
-- Lost
-- ---------------------------------------------------------------------------
select pg_temp.act_as(2);
select throws_ok($$select public.bond_mark_lost(pg_temp.id('c'), pg_temp.id('b4'), 'Beto', current_date, 'gone')$$,
  '42501', null, 'the operator without bond.mark_lost cannot mark a bond lost');
select pg_temp.act_as(1);
select throws_ok($$select public.bond_mark_lost(pg_temp.id('c'), pg_temp.id('b4'), ' ', current_date, 'gone')$$,
  '22023', 'the responsible party is required', 'the responsible party is required');
select throws_ok($$select public.bond_mark_lost(pg_temp.id('c'), pg_temp.id('b4'), 'Beto', null, 'gone')$$,
  '22023', 'the date of the loss is required', 'the date is required');
select throws_ok($$select public.bond_mark_lost(pg_temp.id('c'), pg_temp.id('b4'), 'Beto', current_date + 1, 'gone')$$,
  '22023', 'the date of the loss cannot be in the future', 'a future date is rejected');
select throws_ok($$select public.bond_mark_lost(pg_temp.id('c'), pg_temp.id('b4'), 'Beto', current_date, '')$$,
  '22023', 'a reason is required', 'the reason is required');
select lives_ok($$select public.bond_mark_lost(pg_temp.id('c'), pg_temp.id('b4'), 'Beto', current_date - 2, 'lost in the street', 'req-lost')$$,
  'a delivered bond is marked lost');
select is(
  (select commercial_status || ':' || coalesce(current_collector_id::text, 'none') from public.bonds where id = pg_temp.id('b4')),
  'lost:none', 'the lost bond leaves the collector''s portfolio'
);
select is(
  (select responsible_party || ':' || (lost_on = current_date - 2) || ':' || notes || ':' || collector_id
   from public.bond_assignments where bond_id = pg_temp.id('b4') and assignment_type = 'lost'),
  'Beto:true:lost in the street:' || pg_temp.id('beto'), 'the loss records responsible party, date, reason and collector'
);
select lives_ok($$select public.bond_mark_lost(pg_temp.id('c'), pg_temp.id('b6'), 'Office', current_date, 'never found')$$,
  'an available bond can be marked lost too');
select is((select collector_id from public.bond_assignments where bond_id = pg_temp.id('b6') and assignment_type = 'lost'),
  null, 'a loss before delivery has no collector');
select pg_temp.act_as(2);
select throws_ok($$select public.bond_deliver(pg_temp.id('c'), pg_temp.id('ana'), array[pg_temp.id('b4')])$$,
  '55000', null, 'a lost bond cannot be delivered again');

-- ---------------------------------------------------------------------------
-- History is immutable; reads follow bond.view
-- ---------------------------------------------------------------------------
select throws_ok($$update public.delivery_notes set notes = 'x'$$, '42501', null,
  'users cannot change delivery notes directly');
reset role;
select throws_ok($$delete from public.bond_assignments where bond_id = pg_temp.id('b1')$$, '23001', null,
  'assignments are never deleted, even by the owner');
select throws_ok($$update public.delivery_notes set notes = 'x' where id = pg_temp.id('n1')$$, '23001', null,
  'delivery notes are immutable');
select throws_ok($$update public.bond_assignments set notes = 'x' where bond_id = pg_temp.id('b1') and assignment_type = 'return'$$,
  '23001', null, 'closed assignments are immutable');

set local role authenticated;
select pg_temp.act_as(4);
select is((select count(*)::int from public.delivery_notes where campaign_id = pg_temp.id('c')), 4,
  'read-only (bond.view) reads the delivery notes');

-- Audit
reset role;
select is(
  (select count(*)::int from public.audit_log where action = 'bond.deliver' and request_id = 'req-deliver'),
  3, 'each delivered bond is audited'
);
select is(
  (select (new_value ->> 'note_number') || ':' || jsonb_array_length(new_value -> 'bond_ids')
   from public.audit_log where action = 'delivery_note.issue' and request_id = 'req-deliver'),
  '1:3', 'the delivery note issue is audited with its bonds'
);
select is(
  (select string_agg(action, ',' order by action) from public.audit_log
   where request_id in ('req-reassign', 'req-return', 'req-lost') and entity_type = 'bond'),
  'bond.mark_lost,bond.reassign,bond.return', 'reassignment, return and loss are audited per bond'
);

-- ---------------------------------------------------------------------------
-- Campaign window, stale source collector, one collector per return (#47 review)
-- ---------------------------------------------------------------------------
with c as (
  insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('Draft', 60000, 10, 6000, 'base_number') returning id
)
insert into ids select 'c3', id from c;
with b as (
  insert into public.bonds (campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
  values (pg_temp.id('c3'), 'simple', 'printed', 1, 60000, 'available') returning id
)
insert into ids select 'draft_bond', id from b;
with b as (
  insert into public.bonds (campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
  select pg_temp.id('c'), 'simple', 'printed', 1, 60000, 'available' from generate_series(1, 4)
  returning id
)
insert into ids select 'x' || row_number() over (order by id), id from b;

set local role authenticated;
select pg_temp.act_as(1);
select throws_ok($$select public.bond_deliver(pg_temp.id('c3'), pg_temp.id('ana'), array[pg_temp.id('draft_bond')])$$,
  '55000', 'bonds are delivered to collectors only while the campaign is active',
  'no delivery while the campaign is a draft');
select lives_ok($$select public.bond_deliver(pg_temp.id('c'), pg_temp.id('ana'), array[pg_temp.id('x1'), pg_temp.id('x2'), pg_temp.id('x3')])$$,
  'x1..x3 delivered to Ana');
select lives_ok($$select public.bond_deliver(pg_temp.id('c'), pg_temp.id('beto'), array[pg_temp.id('x4')])$$,
  'x4 delivered to Beto');
select throws_ok($$select public.bond_return(pg_temp.id('c'), array[pg_temp.id('x1')], null, null, pg_temp.id('beto'))$$,
  '55000', null, 'a stale screen cannot return a bond that is with another collector');
select throws_ok($$select public.bond_reassign(pg_temp.id('c'), pg_temp.id('old'), array[pg_temp.id('x1')], null, null, pg_temp.id('beto'))$$,
  '55000', null, 'a stale screen cannot reassign a bond that is with another collector');
select throws_ok($$select public.bond_return(pg_temp.id('c'), array[pg_temp.id('x3'), pg_temp.id('x4')])$$,
  '22023', null, 'one return covers the bonds of one collector only');
select lives_ok($$select public.bond_return(pg_temp.id('c'), array[pg_temp.id('x1')], null, null, pg_temp.id('ana'))$$,
  'the return succeeds when the bond is still with the expected collector');
select lives_ok($$select public.bond_reassign(pg_temp.id('c'), pg_temp.id('beto'), array[pg_temp.id('x2')], null, null, pg_temp.id('ana'))$$,
  'the reassignment succeeds when the bond is still with the expected collector');

-- ---------------------------------------------------------------------------
-- Manual patas (#47 review): delivered whole; members stay blocked
-- ---------------------------------------------------------------------------
with b as (select public.bond_create(pg_temp.id('c'), array[101]) as id) insert into ids select 'm1', id from b;
with b as (select public.bond_create(pg_temp.id('c'), array[102]) as id) insert into ids select 'm2', id from b;
with b as (select public.bond_group_into_pata(pg_temp.id('c'), array[pg_temp.id('m1'), pg_temp.id('m2')]) as id)
insert into ids select 'pata', id from b;
select throws_ok($$select public.bond_deliver(pg_temp.id('c'), pg_temp.id('ana'), array[pg_temp.id('m1')])$$,
  '55000', null, 'a member of a manual pata cannot be delivered alone');
select lives_ok($$select public.bond_deliver(pg_temp.id('c'), pg_temp.id('ana'), array[pg_temp.id('pata')])$$,
  'the manual pata is delivered whole');
select throws_ok($$select public.bond_deliver(pg_temp.id('c'), pg_temp.id('beto'), array[pg_temp.id('m2')])$$,
  '55000', null, 'its members stay blocked while the pata is delivered');
select lives_ok($$select public.bond_return(pg_temp.id('c'), array[pg_temp.id('pata')])$$,
  'the manual pata is returned whole');
select lives_ok($$select public.bond_mark_lost(pg_temp.id('c'), pg_temp.id('pata'), 'Ana', current_date, 'wet')$$,
  'the manual pata can be marked lost');
select throws_ok($$select public.bond_deliver(pg_temp.id('c'), pg_temp.id('ana'), array[pg_temp.id('m1')])$$,
  '55000', null, 'members of a lost pata stay blocked');

-- ---------------------------------------------------------------------------
-- A collector's own login reads only its own notes and custody (own scope)
-- ---------------------------------------------------------------------------
reset role;
insert into auth.users (id, email) values ('a6200000-0000-0000-0000-000000000005', 'deliv-5@example.com');
insert into public.profiles (id, auth_user_id, full_name, email, status)
values ('b6200000-0000-0000-0000-000000000005', 'a6200000-0000-0000-0000-000000000005', 'Ana login',
  'deliv-5@example.com', 'active');
update public.collectors set user_profile_id = 'b6200000-0000-0000-0000-000000000005' where id = pg_temp.id('ana');
set local role authenticated;
select pg_temp.act_as(5);
select ok(
  (select count(*) > 0 and bool_and(collector_id = pg_temp.id('ana')) from public.delivery_notes),
  'a collector''s own login reads only its own delivery notes'
);
select ok(
  (select count(*) > 0 and bool_and(collector_id = pg_temp.id('ana')) from public.bond_assignments),
  'and only its own custody rows'
);
reset role;

select * from finish();
rollback;
