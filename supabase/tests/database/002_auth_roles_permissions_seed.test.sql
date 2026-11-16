begin;
select plan(13);

select is((select count(*)::int from public.roles), 5, '5 roles seeded');
select is((select count(*)::int from public.permissions), 44, '44 permissions seeded');
select is(
  (select array_agg(name order by name) from public.roles),
  array['admin', 'collector', 'operator', 'read-only', 'treasurer'],
  'role names match'
);
select is(
  (select count(*)::int from public.permissions where code in ('role.manage')),
  0, 'no role.manage permission'
);

create temp table _rp on commit drop as
select r.name as role_name, p.code
from public.role_permissions rp
join public.roles r on r.id = rp.role_id
join public.permissions p on p.id = rp.permission_id;

select is((select count(*)::int from _rp where role_name = 'admin'), 44, 'admin has all 44 permissions');
select is((select count(*)::int from _rp where role_name = 'operator'), 10, 'operator has 10 permissions');
select is((select count(*)::int from _rp where role_name = 'treasurer'), 12, 'treasurer has 12 permissions');
select is((select count(*)::int from _rp where role_name = 'read-only'), 3, 'read-only has 3 permissions');
select is((select count(*)::int from _rp where role_name = 'collector'), 0, 'collector has no permissions');

select ok(exists (select 1 from _rp where role_name = 'treasurer' and code = 'payment.annul'), 'treasurer has payment.annul');
select ok(not exists (select 1 from _rp where role_name = 'operator' and code = 'payment.annul'), 'operator lacks payment.annul');
select is(
  (select array_agg(code order by code) from _rp where role_name = 'read-only'),
  array['bond.view', 'campaign.view', 'report.view_financial'],
  'read-only grants match the matrix'
);
select is(
  (select array_agg(code order by code) from _rp where role_name = 'operator'),
  array['bond.assign', 'bond.create', 'bond.import', 'bond.view', 'buyer.manage', 'campaign.view',
        'draw.load_winner', 'payment.create', 'sale.create', 'settlement.create'],
  'operator grants match the matrix'
);

select * from finish();
rollback;
