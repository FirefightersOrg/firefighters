-- SAN-151: circular associated number mode.
--   N2 = B + ((base + offset) mod B), B = (max_number + 1) / 2, 0 <= offset < B
-- Covers: the one SQL formula (public.bond_associated_number), the mode column and its CHECKs, the
-- property "all B bases give unique associated numbers covering B..2B-1" (B = 5000 / offset 4871
-- and a small B), the guard, bond_create validation, linear mode unchanged, the mode frozen outside
-- draft and with bonds, and the audit diff of a rules change.
begin;
select plan(53);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values ('a7000000-0000-0000-0000-000000000001', 'circular-1@example.com');
insert into public.profiles (id, auth_user_id, full_name, email, status)
values ('b7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001',
  'Circular admin', 'circular-1@example.com', 'active');
insert into public.user_roles (user_id, role_id)
select 'b7000000-0000-0000-0000-000000000001', r.id from public.roles r where r.name = 'admin';

create function pg_temp.act_as_admin() returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    '{"sub":"a7000000-0000-0000-0000-000000000001","role":"authenticated"}',
    true
  );
$$;
grant execute on function pg_temp.act_as_admin() to authenticated, anon;

create temporary table ids (k text primary key, id uuid not null);
grant select, insert on ids to authenticated, anon, service_role;
create function pg_temp.id(p_k text) returns uuid language sql stable as $$
  select id from ids where k = p_k;
$$;
grant execute on function pg_temp.id(text) to authenticated, anon;

-- Campaigns (as the owner). 60000 in 10 installments.
--   big       circular, 4 digits, max 9999 (B = 5000), offset 4871: the real case
--   small     circular, 1 digit,  max 9    (B = 5),    offset 3
--   small0    circular, 1 digit,  max 9    (B = 5),    offset 0
--   lin       linear (default), 4 digits, max 9999, offset 4871
--   guard     circular, 1 digit,  max 9    (B = 5),    offset 3 (direct inserts into the guard)
--   frozen    circular, draft without bonds (mode editable)
--   act       circular, active without bonds (mode frozen by status)
with c as (
  insert into public.campaigns
    (name, simple_bond_value, installment_count, installment_value, number_digits, max_number,
     associated_number_offset, associated_number_mode, overflow_policy, barcode_mode, starts_at, ends_at)
  select v.name, 60000, 10, 6000, v.digits, v.max, v.off, v.mode, 'reject', 'base_number',
    '2026-03-01 00:00-03', '2026-12-31 23:59:59-03'
  from (values
    ('big', 4, 9999, 4871, 'circular'),
    ('small', 1, 9, 3, 'circular'),
    ('small0', 1, 9, 0, 'circular'),
    ('lin', 4, 9999, 4871, 'linear'),
    ('guard', 1, 9, 3, 'circular'),
    ('frozen', 4, 9999, 4871, 'circular'),
    ('act', 4, 9999, 4871, 'circular')
  ) as v (name, digits, max, off, mode)
  returning id, name
)
insert into ids select c.name, c.id from c;
update public.campaigns set status = 'active' where id = pg_temp.id('act');

-- ---------------------------------------------------------------------------
-- Column, helper and privileges
-- ---------------------------------------------------------------------------
select has_column('public', 'campaigns', 'associated_number_mode', 'campaigns.associated_number_mode exists');
select col_default_is('public', 'campaigns', 'associated_number_mode', 'linear', 'the default mode is linear');
select is(
  (select associated_number_mode from public.campaigns where name = 'lin'),
  'linear', 'a campaign created without a mode is linear'
);
select ok(
  (select p.provolatile = 'i' and p.proconfig @> array['search_path=""']
     from pg_proc p where p.oid = 'public.bond_associated_number(bigint, integer, integer, text)'::regprocedure),
  'bond_associated_number is immutable with an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.bond_associated_number(bigint, integer, integer, text)', 'execute')
  and not has_function_privilege('anon', 'public.bond_associated_number(bigint, integer, integer, text)', 'execute')
  and not has_function_privilege('service_role', 'public.bond_associated_number(bigint, integer, integer, text)', 'execute'),
  'bond_associated_number: signed-in users only, explicit revokes'
);

-- The real example: B = 5000, offset 4871.
select is(public.bond_associated_number(129, 4871, 9999, 'circular'), 5000::bigint, 'circular: 0129 -> 5000');
select is(public.bond_associated_number(436, 4871, 9999, 'circular'), 5307::bigint, 'circular: 0436 -> 5307');
select is(public.bond_associated_number(68, 4871, 9999, 'circular'), 9939::bigint, 'circular: 0068 -> 9939');
select is(public.bond_associated_number(0, 4871, 9999, 'circular'), 9871::bigint, 'circular: 0000 -> 9871');
select is(public.bond_associated_number(128, 4871, 9999, 'circular'), 9999::bigint, 'circular: 0128 -> 9999');
select is(public.bond_associated_number(4999, 4871, 9999, 'circular'), 9870::bigint, 'circular: 4999 -> 9870');
select is(public.bond_associated_number(5000, 4871, 9999, 'circular'), null::bigint, 'circular: a base >= B has no associated number');
select is(public.bond_associated_number(-1, 4871, 9999, 'circular'), null::bigint, 'circular: a negative base has no associated number');
select is(public.bond_associated_number(68, 4871, 9999, 'linear'), 4939::bigint, 'linear: base + offset');
select is(public.bond_associated_number(5129, 4871, 9999, 'linear'), 10000::bigint, 'linear: may exceed max_number (the caller rejects)');

-- ---------------------------------------------------------------------------
-- CHECK constraints
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.campaigns set associated_number_mode = 'spiral' where id = pg_temp.id('frozen')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_associated_number_mode_check"',
  'CHECK: the mode is linear or circular'
);
select throws_ok(
  $$update public.campaigns set max_number = 9998 where id = pg_temp.id('frozen')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_circular_max_number_even_range"',
  'CHECK: circular needs max_number + 1 even'
);
select throws_ok(
  $$update public.campaigns set associated_number_offset = 5000 where id = pg_temp.id('frozen')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_circular_offset_below_block"',
  'CHECK: circular needs offset < B'
);
select lives_ok(
  $$update public.campaigns set associated_number_offset = 4999 where id = pg_temp.id('frozen')$$,
  'CHECK: offset B - 1 is the highest valid circular offset'
);
select lives_ok(
  $$update public.campaigns set associated_number_mode = 'linear', max_number = 9998, associated_number_offset = 5000 where id = pg_temp.id('frozen')$$,
  'CHECK: the circular limits do not apply to linear'
);
-- Back to the original rules (linear, 9999 / 4871) for the draft-edit tests below.
update public.campaigns set max_number = 9999, associated_number_offset = 4871
where id = pg_temp.id('frozen');

-- ---------------------------------------------------------------------------
-- Property: B = 5000, offset 4871. Bases 0..4999 (direct inserts; the formula is written out
-- here on purpose, the guard checks it against bond_associated_number).
-- ---------------------------------------------------------------------------
insert into public.bonds
  (campaign_id, kind, origin, commercial_unit_count, total_value, internal_code, commercial_status, created_by)
select pg_temp.id('big'), 'simple', 'printed', 1, 60000, lpad(n::text, 4, '0'), 'available',
  'b7000000-0000-0000-0000-000000000001'
from generate_series(0, 4999) n;
insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind)
select b.campaign_id, b.id, b.internal_code::int, 'base'
from public.bonds b where b.campaign_id = pg_temp.id('big');
insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind, source_base_number_id)
select n.campaign_id, n.bond_id, 5000 + ((n.number_value + 4871) % 5000), 'associated', n.id
from public.bond_numbers n where n.campaign_id = pg_temp.id('big') and n.number_kind = 'base';

select is(
  (select count(*) from public.bond_numbers where campaign_id = pg_temp.id('big')),
  10000::bigint, 'property B=5000: 5000 bonds hold 10000 numbers'
);
select is(
  (select count(distinct number_value) from public.bond_numbers where campaign_id = pg_temp.id('big')),
  10000::bigint, 'property B=5000: every number is different (no collisions)'
);
select is(
  (select count(*) from generate_series(0, 9999) g
    where exists (select 1 from public.bond_numbers n
      where n.campaign_id = pg_temp.id('big') and n.number_value = g)),
  10000::bigint, 'property B=5000: the numbers cover 0000..9999 with no gaps'
);
select is(
  (select array[min(number_value), max(number_value), count(distinct number_value)]
     from public.bond_numbers where campaign_id = pg_temp.id('big') and number_kind = 'associated'),
  array[5000, 9999, 5000]::bigint[], 'property B=5000: the associated numbers are exactly 5000..9999 once each'
);
select is(
  (select count(*) from public.bond_numbers a
    join public.bond_numbers b on b.campaign_id = a.campaign_id and b.number_value = a.number_value
      and b.number_kind = 'base'
    where a.campaign_id = pg_temp.id('big') and a.number_kind = 'associated'),
  0::bigint, 'property B=5000: no associated number equals any base number'
);
select is(
  (select array_agg(n.number_value order by s.number_value)
     from public.bond_numbers n
     join public.bond_numbers s on s.id = n.source_base_number_id
     where n.campaign_id = pg_temp.id('big') and s.number_value between 0 and 128)
  = (select array_agg(9871 + g order by g) from generate_series(0, 128) g),
  true, 'property B=5000: the critical strip (bases 0..128) maps to 9871..9999'
);
select is(
  (select array_agg(n.number_value order by s.number_value)
     from public.bond_numbers n
     join public.bond_numbers s on s.id = n.source_base_number_id
     where n.campaign_id = pg_temp.id('big') and s.number_value in (0, 68, 128, 129, 436)),
  array[9871, 9939, 9999, 5000, 5307]::int[], 'property B=5000: the example pairs are stored'
);
select is(
  (select count(*) from public.bond_numbers n
     join public.bond_numbers s on s.id = n.source_base_number_id
     where n.campaign_id = pg_temp.id('big')
       and n.number_value <> public.bond_associated_number(s.number_value, 4871, 9999, 'circular')),
  0::bigint, 'property B=5000: the stored numbers equal the helper'
);

-- ---------------------------------------------------------------------------
-- bond_create: small B (5, offset 3): all five bases cover 0..9 exactly
-- ---------------------------------------------------------------------------
select pg_temp.act_as_admin();
set local role authenticated;
select lives_ok(
  $$select public.bond_create(pg_temp.id('small'), array[b]) from generate_series(0, 4) b$$,
  'small B: bond_create accepts every base 0..4'
);
reset role;
select is(
  (select array_agg(number_value order by number_value) from public.bond_numbers where campaign_id = pg_temp.id('small')),
  array[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'small B: bases and associated numbers cover 0..9 exactly'
);
select is(
  (select array_agg(n.number_value order by s.number_value)
     from public.bond_numbers n join public.bond_numbers s on s.id = n.source_base_number_id
     where n.campaign_id = pg_temp.id('small')),
  array[8, 9, 5, 6, 7], 'small B: 0->8, 1->9, 2->5, 3->6, 4->7'
);
set local role authenticated;
select throws_ok(
  $$select public.bond_create(pg_temp.id('small'), array[5])$$,
  '22023', 'base number 5 is outside the circular range: base numbers go from 0 to 4',
  'bond_create: in circular mode a base must be below B'
);
select lives_ok(
  $$select public.bond_create(pg_temp.id('small0'), array[0, 4])$$,
  'small B, offset 0: a pata with bases 0 and 4 is accepted (associated 5 and 9)'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('small0'), array[1, 6])$$,
  '22023', 'base number 6 is outside the circular range: base numbers go from 0 to 4',
  'bond_create: a pata base outside the circular range is rejected'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('small0'), array[4, 4])$$,
  '22023', null, 'bond_create: a repeated base is still rejected in circular mode'
);

-- Linear mode is unchanged: base + offset, overflow rejected.
select lives_ok(
  $$select public.bond_create(pg_temp.id('lin'), array[5128])$$,
  'linear: base 5128 is accepted (5128 + 4871 = 9999)'
);
select throws_ok(
  $$select public.bond_create(pg_temp.id('lin'), array[5129])$$,
  '22023', 'base number 5129 overflows: its associated number 10000 exceeds the campaign maximum number 9999',
  'linear: base 5129 overflows (unchanged)'
);
reset role;
select is(
  (select n.number_value from public.bond_numbers n join public.bond_numbers s on s.id = n.source_base_number_id
    where n.campaign_id = pg_temp.id('lin') and s.number_value = 5128),
  9999, 'linear: the stored associated number is base + offset'
);

-- ---------------------------------------------------------------------------
-- Guard: bond_numbers_guard_write checks the associated number by mode
-- ---------------------------------------------------------------------------
insert into public.bonds
  (campaign_id, kind, origin, commercial_unit_count, total_value, internal_code, commercial_status, created_by)
select pg_temp.id('guard'), 'simple', 'printed', 1, 60000, 'g' || n, 'available',
  'b7000000-0000-0000-0000-000000000001'
from generate_series(1, 3) n;
insert into ids select 'gb' || n, b.id from public.bonds b
  join generate_series(1, 3) n on b.internal_code = 'g' || n and b.campaign_id = pg_temp.id('guard');
insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind)
select pg_temp.id('guard'), pg_temp.id('gb1'), 0, 'base';
insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind)
select pg_temp.id('guard'), pg_temp.id('gb2'), 7, 'base';
insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind)
select pg_temp.id('guard'), pg_temp.id('gb3'), 1, 'base';
select throws_ok(
  $$insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind, source_base_number_id)
    select pg_temp.id('guard'), pg_temp.id('gb1'), 3, 'associated', n.id
    from public.bond_numbers n where n.bond_id = pg_temp.id('gb1') and n.number_kind = 'base'$$,
  '23514', 'associated number must be 8 (base 0 + offset 3), got 3',
  'guard: circular rejects the linear value (0 + 3) and expects 8'
);
select lives_ok(
  $$insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind, source_base_number_id)
    select pg_temp.id('guard'), pg_temp.id('gb1'), 8, 'associated', n.id
    from public.bond_numbers n where n.bond_id = pg_temp.id('gb1') and n.number_kind = 'base'$$,
  'guard: circular accepts B + ((base + offset) mod B)'
);
select throws_ok(
  $$insert into public.bond_numbers (campaign_id, bond_id, number_value, number_kind, source_base_number_id)
    select pg_temp.id('guard'), pg_temp.id('gb2'), 5, 'associated', n.id
    from public.bond_numbers n where n.bond_id = pg_temp.id('gb2') and n.number_kind = 'base'$$,
  '23514', 'base number 7 is outside the circular range 0..4 of this campaign',
  'guard: a circular base >= B has no associated number'
);

-- ---------------------------------------------------------------------------
-- Frozen: the mode is editable only in draft and without bonds
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.campaigns set associated_number_mode = 'linear' where id = pg_temp.id('act')$$,
  '55000', 'campaign rules can only be changed while the campaign is draft (status: active)',
  'frozen: the mode cannot change once the campaign is not draft'
);
select throws_ok(
  $$update public.campaigns set associated_number_mode = 'linear' where id = pg_temp.id('big')$$,
  '55000', 'campaign rules cannot be changed once the campaign has bonds',
  'frozen: the mode cannot change once the campaign has bonds (draft)'
);
select lives_ok(
  $$update public.campaigns set associated_number_mode = 'circular' where id = pg_temp.id('frozen')$$,
  'draft without bonds: the mode can be changed'
);
select is(
  (select associated_number_mode from public.campaigns where id = pg_temp.id('frozen')),
  'circular', 'draft without bonds: the new mode is stored'
);

-- ---------------------------------------------------------------------------
-- RPCs: campaign_create / campaign_update_rules carry the mode and audit it
-- ---------------------------------------------------------------------------
select pg_temp.act_as_admin();
set local role authenticated;
select ok(
  public.campaign_create('Circular RPC', 60000, 10, 4, 9999, 4871, 'reject', 'base_number',
    null, null, 'req-070-create', null, null, 'circular') is not null,
  'campaign_create: a circular campaign is created'
);
select throws_ok(
  $$select public.campaign_create('Bad circular', 60000, 10, 4, 9998, 100, 'reject', 'base_number',
    null, null, null, null, null, 'circular')$$,
  '23514', 'new row for relation "campaigns" violates check constraint "campaigns_circular_max_number_even_range"',
  'campaign_create: circular with an even max_number is rejected'
);
reset role;
select is(
  (select associated_number_mode from public.campaigns where name = 'Circular RPC'),
  'circular', 'campaign_create: the mode is stored'
);
select is(
  (select new_value ->> 'associated_number_mode' from public.audit_log
    where action = 'campaign.create' and request_id = 'req-070-create'),
  'circular', 'campaign_create: the audit snapshot has the mode'
);

select pg_temp.act_as_admin();
set local role authenticated;
select ok(
  public.campaign_update_rules(pg_temp.id('frozen'), 60000, 10, 4, 9999, 4871, 'reject', 'base_number',
    (select updated_at from public.campaigns where id = pg_temp.id('frozen')),
    'req-070-rules', null, null, 'linear'),
  'campaign_update_rules: the mode changes in draft without bonds'
);
reset role;
select is(
  (select array[old_value ->> 'associated_number_mode', new_value ->> 'associated_number_mode']
     from public.audit_log where action = 'campaign.update_rules' and request_id = 'req-070-rules'),
  array['circular', 'linear'], 'campaign_update_rules: the audit diff has the mode (old -> new)'
);
select is(
  (select array(select jsonb_object_keys(new_value)) from public.audit_log
    where action = 'campaign.update_rules' and request_id = 'req-070-rules'),
  array['associated_number_mode'], 'campaign_update_rules: the diff holds only the changed rule'
);
select pg_temp.act_as_admin();
set local role authenticated;
select throws_ok(
  $$select public.campaign_update_rules(pg_temp.id('big'), 60000, 10, 4, 9999, 4871, 'reject', 'base_number',
    (select updated_at from public.campaigns where id = pg_temp.id('big')),
    null, null, null, 'linear')$$,
  '55000', 'campaign rules cannot be changed once the campaign has bonds',
  'campaign_update_rules: the mode is frozen with bonds'
);
reset role;

select * from finish();
rollback;
