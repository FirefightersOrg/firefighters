-- SAN-49: collectors and buyers tables, links, RLS and audited write functions.
begin;
select plan(60);

-- auth ids / profiles: ...01 admin, ...02 operator, ...03 treasurer, ...04 collector, ...05 read-only
insert into auth.users (id, email)
select ('a6100000-0000-0000-0000-00000000000' || n)::uuid, 'party-' || n || '@example.com'
from generate_series(1, 5) as n;

insert into public.profiles (id, auth_user_id, full_name, email, status)
select ('b6100000-0000-0000-0000-00000000000' || n)::uuid,
  ('a6100000-0000-0000-0000-00000000000' || n)::uuid,
  'Party user ' || n, 'party-' || n || '@example.com', 'active'
from generate_series(1, 5) as n;

insert into public.user_roles (user_id, role_id)
select v.profile_id::uuid, r.id
from (values
  ('b6100000-0000-0000-0000-000000000001', 'admin'),
  ('b6100000-0000-0000-0000-000000000002', 'operator'),
  ('b6100000-0000-0000-0000-000000000003', 'treasurer'),
  ('b6100000-0000-0000-0000-000000000004', 'collector'),
  ('b6100000-0000-0000-0000-000000000005', 'read-only')
) as v (profile_id, role_name)
join public.roles r on r.name = v.role_name;

create function pg_temp.act_as(p_n int) returns void language sql as $$
  select set_config('request.jwt.claims',
    format('{"sub":"a6100000-0000-0000-0000-00000000000%s","role":"authenticated"}', p_n), true);
$$;
grant execute on function pg_temp.act_as(int) to authenticated, anon;

create temporary table ids (k text primary key, id uuid not null);
grant select, insert on ids to authenticated, anon, service_role;
create function pg_temp.id(p_k text) returns uuid language sql stable as $$
  select id from ids where k = p_k;
$$;
grant execute on function pg_temp.id(text) to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
select has_table('public', 'collectors', 'collectors exists');
select has_table('public', 'buyers', 'buyers exists');
select columns_are('public', 'collectors', array['id', 'display_name', 'phone', 'email', 'address',
  'user_profile_id', 'status', 'created_by', 'created_at', 'updated_at'], 'collectors columns');
select columns_are('public', 'buyers', array['id', 'type', 'first_name', 'last_name',
  'business_name', 'document_number', 'tax_id', 'phone', 'address', 'usual_collector_id', 'notes',
  'created_by', 'created_at', 'updated_at', 'document_number_normalized', 'tax_id_normalized'],
  'buyers columns');
select fk_ok('public', 'bonds', 'current_collector_id', 'public', 'collectors', 'id',
  'bonds.current_collector_id references collectors');
select fk_ok('public', 'bonds', 'current_buyer_id', 'public', 'buyers', 'id',
  'bonds.current_buyer_id references buyers');
select fk_ok('public', 'commission_rules', 'applies_to_collector_id', 'public', 'collectors', 'id',
  'commission_rules.applies_to_collector_id references collectors');
select fk_ok('public', 'buyers', 'usual_collector_id', 'public', 'collectors', 'id',
  'buyers.usual_collector_id references collectors');
select is(
  (select pg_get_indexdef(indexrelid) like '%WHERE (document_number IS NOT NULL)%'
   from pg_index where indexrelid = 'public.buyers_document_number_idx'::regclass),
  true, 'buyers(document_number) has a partial index'
);
select is(
  (select pg_get_indexdef(indexrelid) like '%WHERE (tax_id IS NOT NULL)%'
   from pg_index where indexrelid = 'public.buyers_tax_id_idx'::regclass),
  true, 'buyers(tax_id) has a partial index'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.collectors'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.buyers'::regclass),
  'RLS is enabled on both tables'
);
select ok(
  has_table_privilege('authenticated', 'public.collectors', 'select')
  and not has_table_privilege('authenticated', 'public.collectors', 'insert')
  and not has_table_privilege('authenticated', 'public.collectors', 'update')
  and not has_table_privilege('authenticated', 'public.buyers', 'insert')
  and not has_table_privilege('authenticated', 'public.buyers', 'update')
  and not has_table_privilege('anon', 'public.buyers', 'select'),
  'authenticated can only read; anon cannot read'
);
select ok(
  has_function_privilege('authenticated', 'public.collector_create(text,text,text,text,uuid,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.buyer_create(text,text,text,text,text,text,text,text,uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.collector_create(text,text,text,text,uuid,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.buyer_create(text,text,text,text,text,text,text,text,uuid,text,text)', 'execute'),
  'the write functions are for authenticated only'
);
select ok(
  not exists (
    select 1 from pg_proc p cross join (values ('anon'), ('authenticated'), ('service_role')) r (role_name)
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('collectors_buyers_guard_write', 'collectors_buyers_forbid_delete',
        'party_text', 'party_require_actor', 'party_audit_diff', 'collector_audit_snapshot',
        'buyer_audit_snapshot', 'collector_validate', 'buyer_validate')
      and has_function_privilege(r.role_name, p.oid, 'execute')),
  'internal helpers are not callable by API roles'
);

-- ---------------------------------------------------------------------------
-- Collectors: permissions and validation
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(2);
select throws_ok($$select public.collector_create('Ana')$$, '42501', null,
  'an operator without collector.manage cannot create a collector');

select pg_temp.act_as(1);
select throws_ok($$select public.collector_create('   ')$$, '22023', 'a display name is required',
  'a blank display name is rejected');
select throws_ok($$select public.collector_create('Ana', null, 'not-an-email')$$, '22023',
  'email is not valid', 'an invalid email is rejected');
select throws_ok($$select public.collector_create('Ana', null, null, null, null, 'retired')$$, '22023',
  'invalid collector status: retired', 'an unknown status is rejected');
select throws_ok($$select public.collector_create('Ana', null, null, null, '00000000-0000-0000-0000-000000000000')$$,
  '22023', null, 'an unknown profile is rejected');

insert into ids select 'ana', public.collector_create('  Ana Pérez ', ' 11 2233 ', ' ANA@Example.com ',
  null, 'b6100000-0000-0000-0000-000000000004', null, 'req-col');
select is(
  (select display_name || '|' || phone || '|' || email || '|' || status || '|' || created_by
   from public.collectors where id = pg_temp.id('ana')),
  'Ana Pérez|11 2233|ana@example.com|active|b6100000-0000-0000-0000-000000000001',
  'the collector is stored trimmed, with a lowercase email, active, created by the caller'
);
select throws_ok($$select public.collector_create('Other', null, null, null, 'b6100000-0000-0000-0000-000000000004')$$,
  '23505', null, 'a profile can be linked to only one collector');
insert into ids select 'beto', public.collector_create('Beto');

-- Update with optimistic concurrency.
select throws_ok(
  $$select public.collector_update(pg_temp.id('ana'), 'Ana', null, null, null, null, 'active', '2000-01-01')$$,
  'PT409', null, 'a stale version is rejected'
);
select is(
  public.collector_update(pg_temp.id('ana'), 'Ana Pérez', '11 2233', 'ana@example.com', null,
    'b6100000-0000-0000-0000-000000000004', 'active',
    (select updated_at from public.collectors where id = pg_temp.id('ana'))),
  false, 'an update that changes nothing is a no-op'
);
select is(
  public.collector_update(pg_temp.id('ana'), 'Ana Pérez', '11 9999', 'ana@example.com', null,
    'b6100000-0000-0000-0000-000000000004', 'inactive',
    (select updated_at from public.collectors where id = pg_temp.id('ana')), 'req-col-upd'),
  true, 'the admin updates the collector'
);
select is(
  (select phone || ':' || status from public.collectors where id = pg_temp.id('ana')),
  '11 9999:inactive', 'the update is stored (deactivation included)'
);
select public.collector_update(pg_temp.id('ana'), 'Ana Pérez', '11 9998', 'ana@example.com', null,
  'b6100000-0000-0000-0000-000000000004', null,
  (select updated_at from public.collectors where id = pg_temp.id('ana')));
select is(
  (select phone || ':' || status from public.collectors where id = pg_temp.id('ana')),
  '11 9998:inactive', 'an update without a status keeps it (no reactivation by omission)'
);

-- ---------------------------------------------------------------------------
-- Buyers: permissions and validation
-- ---------------------------------------------------------------------------
select pg_temp.act_as(3);
select throws_ok($$select public.buyer_create('individual', 'Juan')$$, '42501', null,
  'a treasurer without buyer.manage cannot create a buyer');

select pg_temp.act_as(2);
select throws_ok($$select public.buyer_create('person', 'Juan')$$, '22023',
  'buyer type must be individual or business', 'an unknown buyer type is rejected');
select throws_ok($$select public.buyer_create('individual')$$, '22023',
  'an individual buyer needs a first or last name', 'an individual needs a name');
select throws_ok($$select public.buyer_create('business', 'Juan')$$, '22023',
  'a business buyer needs a business name', 'a business needs a business name');
select throws_ok($$select public.buyer_create('individual', 'Juan', null, null, null, null, null, null, '00000000-0000-0000-0000-000000000000')$$,
  'P0002', null, 'an unknown usual collector is rejected');
select throws_ok($$select public.buyer_create('individual', repeat('x', 101))$$, '22023',
  'first name must be at most 100 characters', 'a too long name is rejected');

insert into ids select 'juan', public.buyer_create('individual', ' Juan ', 'Gómez', null, ' 30111222 ',
  null, '11 4444', null, pg_temp.id('ana'), null, 'req-buy');
insert into ids select 'ferre', public.buyer_create('business', null, null, 'Ferretería Sur',
  null, '30-12345678-9');
insert into ids select 'juan2', public.buyer_create('individual', 'Juan', 'Gómez', null, '30111222');
select is(
  (select type || '|' || first_name || '|' || document_number || '|' || usual_collector_id || '|' || created_by
   from public.buyers where id = pg_temp.id('juan')),
  'individual|Juan|30111222|' || pg_temp.id('ana') || '|b6100000-0000-0000-0000-000000000002',
  'the operator creates an individual buyer, trimmed, with an inactive usual collector'
);
select is(
  (select count(*)::int from public.buyers where document_number = '30111222'),
  2, 'the same document number may repeat (legacy duplicates are normalised by hand)'
);
select is(
  public.buyer_update(pg_temp.id('ferre'), 'business', null, null, 'Ferretería Sur SRL', null,
    '30-12345678-9', '11 5555', null, pg_temp.id('beto'), 'pays in cash',
    (select updated_at from public.buyers where id = pg_temp.id('ferre')), 'req-buy-upd'),
  true, 'the operator updates a business buyer'
);
select throws_ok(
  $$select public.buyer_update(pg_temp.id('ferre'), 'business', null, null, 'X', null, null, null, null, null, null, '2000-01-01')$$,
  'PT409', null, 'a stale buyer version is rejected'
);

-- ---------------------------------------------------------------------------
-- Direct writes and deletion
-- ---------------------------------------------------------------------------
select throws_ok($$insert into public.collectors (display_name) values ('X')$$, '42501', null,
  'users cannot insert collectors directly');
select throws_ok($$update public.buyers set notes = 'x'$$, '42501', null,
  'users cannot update buyers directly');
reset role;
select throws_ok($$delete from public.collectors where id = pg_temp.id('beto')$$, '23001', null,
  'collectors are never deleted, even by the owner');
select throws_ok($$delete from public.buyers where id = pg_temp.id('ferre')$$, '23001', null,
  'buyers are never deleted, even by the owner');
select throws_ok($$update public.buyers set created_by = null where id = pg_temp.id('ferre')$$, '23001', null,
  'created_by cannot be changed');
select throws_ok($$update public.buyers set type = 'business', business_name = null where id = pg_temp.id('ferre')$$,
  '23514', null, 'the name-by-type rule is enforced for every role');
select throws_ok($$update public.collectors set email = ' a@b.co' where id = pg_temp.id('beto')$$,
  '23514', null, 'untrimmed values are rejected for every role');

-- FK: a bond cannot point to an unknown collector or buyer (own campaign and bond, so the check
-- does not depend on data left in the database).
with c as (
  insert into public.campaigns (name, simple_bond_value, installment_count, installment_value, barcode_mode)
  values ('Party FK', 60000, 10, 6000, 'base_number') returning id
)
insert into ids select 'fk-campaign', id from c;
with b as (
  insert into public.bonds (campaign_id, kind, origin, commercial_unit_count, total_value, commercial_status)
  values (pg_temp.id('fk-campaign'), 'simple', 'printed', 1, 60000, 'available') returning id
)
insert into ids select 'fk-bond', id from b;
select throws_ok(
  $$update public.bonds set current_buyer_id = '00000000-0000-0000-0000-000000000000'
    where id = pg_temp.id('fk-bond')$$,
  '23503', null, 'a bond cannot reference an unknown buyer'
);
select throws_ok(
  $$update public.bonds set current_collector_id = '00000000-0000-0000-0000-000000000000'
    where id = pg_temp.id('fk-bond')$$,
  '23503', null, 'a bond cannot reference an unknown collector'
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as(1);
select is((select count(*)::int from public.collectors where id in (pg_temp.id('ana'), pg_temp.id('beto'))),
  2, 'the admin reads collectors');
select is((select count(*)::int from public.buyers where id in (pg_temp.id('juan'), pg_temp.id('ferre'))),
  2, 'the admin reads buyers');

select pg_temp.act_as(2);
select is((select count(*)::int from public.buyers where id in (pg_temp.id('juan'), pg_temp.id('ferre'))),
  2, 'the operator reads buyers through buyer.manage');

select pg_temp.act_as(4);
select is((select array_agg(id) from public.collectors), array[pg_temp.id('ana')],
  'the collector login reads only its own collector row');
select is((select count(*)::int from public.buyers), 0, 'the collector login reads no buyers');

select pg_temp.act_as(5);
select is((select count(*)::int from public.collectors where id in (pg_temp.id('ana'), pg_temp.id('beto'))),
  0, 'read-only without collector.view reads no collectors (matrix pending SAN-93)');
select is((select count(*)::int from public.buyers where id in (pg_temp.id('juan'), pg_temp.id('ferre'))),
  0, 'read-only without buyer.view reads no buyers');
select pg_temp.act_as(3);
select is((select count(*)::int from public.buyers where id in (pg_temp.id('juan'), pg_temp.id('ferre'))),
  0, 'the treasurer without buyer.view reads no buyers');

-- An inactive profile cannot write, whatever its roles.
reset role;
update public.profiles set status = 'inactive' where id = 'b6100000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.act_as(2);
select throws_ok($$select public.buyer_create('individual', 'Late')$$, '42501', null,
  'an inactive profile cannot create a buyer');

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
reset role;
select is(
  (select new_value ->> 'display_name' from public.audit_log
   where action = 'collector.create' and request_id = 'req-col'),
  'Ana Pérez', 'collector creation is audited with the snapshot'
);
select is(
  (select (old_value ->> 'phone') || '>' || (new_value ->> 'phone') || ',' || (new_value ->> 'status')
   from public.audit_log where action = 'collector.update' and request_id = 'req-col-upd'),
  '11 2233>11 9999,inactive', 'collector updates audit only the changed keys'
);
select is(
  (select (new_value ? 'display_name')::text from public.audit_log
   where action = 'collector.update' and request_id = 'req-col-upd'),
  'false', 'unchanged keys are left out of the update audit'
);
select is(
  (select count(*)::int from public.audit_log where action = 'buyer.create'
     and entity_id in (pg_temp.id('juan')::text, pg_temp.id('ferre')::text, pg_temp.id('juan2')::text)),
  3, 'every buyer creation is audited'
);
select is(
  (select new_value ->> 'business_name' from public.audit_log
   where action = 'buyer.update' and request_id = 'req-buy-upd'),
  'Ferretería Sur SRL', 'buyer updates are audited'
);
select is(
  (select count(*)::int from public.audit_log where action = 'collector.update'
     and entity_id = pg_temp.id('ana')::text),
  -- Two real updates (phone + deactivation, then phone without status); the no-op wrote nothing.
  2, 'a no-op update writes no audit row'
);

select * from finish();
rollback;
