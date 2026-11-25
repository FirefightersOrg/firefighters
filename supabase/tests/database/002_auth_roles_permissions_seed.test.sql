begin;
select plan(15);

select is((select count(*)::int from public.roles), 5, '5 roles seeded');
select is((select count(*)::int from public.permissions), 51, '51 permissions seeded');
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

select is((select count(*)::int from _rp where role_name = 'admin'), 51, 'admin has all 51 permissions');
select is((select count(*)::int from _rp where role_name = 'operator'), 20, 'operator has 20 permissions (bond.scan in SAN-44; SAN-93 view and matrix decisions)');
select is((select count(*)::int from _rp where role_name = 'treasurer'), 18, 'treasurer has 18 permissions (SAN-93 view and matrix decisions)');
select is((select count(*)::int from _rp where role_name = 'read-only'), 5, 'read-only has 5 permissions (commission.view in SAN-93)');
select is(
  (select array_agg(code order by code) from _rp where role_name = 'collector'),
  array['campaign.view'], 'collector grants match the matrix'
);
select is((select count(*)::int from _rp where role_name = 'collector'), 1, 'collector has 1 permission (campaign.view in SAN-93)');

select ok(exists (select 1 from _rp where role_name = 'treasurer' and code = 'payment.annul'), 'treasurer has payment.annul');
select ok(not exists (select 1 from _rp where role_name = 'operator' and code = 'payment.annul'), 'operator lacks payment.annul');
select is(
  (select array_agg(code order by code) from _rp where role_name = 'read-only'),
  array['bond.view', 'campaign.view', 'commission.view', 'report.view_financial', 'report.view_operational'],
  'read-only grants match the matrix'
);
select is(
  (select array_agg(code order by code) from _rp where role_name = 'operator'),
  array['bond.assign', 'bond.create', 'bond.import', 'bond.return', 'bond.scan', 'bond.view', 'buyer.manage', 'buyer.view',
        'campaign.view', 'collector.view', 'draw.load_winner', 'draw.view', 'payment.create', 'payment.view',
        'report.view_operational', 'sale.create', 'sale.view', 'settlement.create', 'settlement.update_open', 'settlement.view'],
  'operator grants match the matrix (bond.return, not bond.mark_lost)'
);
select is(
  (select array_agg(code order by code) from _rp where role_name = 'treasurer'),
  array['audit.view', 'bond.view', 'campaign.view', 'collector.ledger.view', 'commission.adjust',
        'commission.view', 'draw.freeze_roster', 'draw.load_winner', 'draw.view', 'payment.annul',
        'payment.create', 'payment.view', 'report.view_financial', 'report.view_operational', 'settlement.close', 'settlement.correct',
        'settlement.create', 'settlement.view'],
  'treasurer grants match the matrix'
);

select * from finish();
rollback;
