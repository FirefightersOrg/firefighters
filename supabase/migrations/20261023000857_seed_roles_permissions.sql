-- SAN-10: reference data for roles, permissions and the initial role-permission matrix.
-- Source of truth: docs/permissions.md. Later changes must ship as follow-up migrations.

insert into public.roles (name, description) values
  ('admin', 'Full configuration, users, rules, and critical corrections.'),
  ('operator', 'Daily operations for bonds, buyers, sales, payments, and open settlements.'),
  ('treasurer', 'Settlements, commissions, current account, cash register, and financial reports.'),
  ('collector', 'Future limited access to own portfolio.'),
  ('read-only', 'Read-only within defined scope.')
on conflict (name) do nothing;

insert into public.permissions (code, description) values
  ('campaign.view', 'View campaigns.'),
  ('campaign.create', 'Create campaigns.'),
  ('campaign.update', 'Edit general data.'),
  ('campaign.update_rules', 'Modify critical rules for numbering, installments, commissions, and draws.'),
  ('campaign.close', 'Close campaign.'),
  ('bond.view', 'View bonds.'),
  ('bond.create', 'Create bonds manually.'),
  ('bond.import', 'Import or load bonds in batch.'),
  ('bond.scan', 'Load or search bonds by barcode.'),
  ('bond.assign', 'Assign bonds to collectors.'),
  ('bond.return', 'Record returns.'),
  ('bond.mark_lost', 'Record loss.'),
  ('bond.annul', 'Annul bonds.'),
  ('buyer.view', 'View buyers.'),
  ('buyer.manage', 'Create and edit buyers.'),
  ('collector.view', 'View collectors.'),
  ('collector.manage', 'Create and edit collectors.'),
  ('collector.ledger.view', 'View current account.'),
  ('collector.ledger.adjust', 'Record manual adjustments.'),
  ('sale.create', 'Register sales.'),
  ('sale.correct', 'Correct sales with audit.'),
  ('payment.create', 'Register payments.'),
  ('payment.annul', 'Annul confirmed payments.'),
  ('settlement.create', 'Create settlements.'),
  ('settlement.update_open', 'Edit open settlements.'),
  ('settlement.close', 'Close settlements.'),
  ('settlement.correct', 'Correct closed settlements through adjustments.'),
  ('commission.view', 'View commissions.'),
  ('commission.rule_manage', 'Manage commission rules.'),
  ('commission.adjust', 'Manually adjust commission with reason.'),
  ('commission.settle', 'Settle/pay commissions.'),
  ('draw.view', 'View draws.'),
  ('draw.create', 'Create draws.'),
  ('draw.update', 'Edit scheduled draws.'),
  ('draw.generate_roster', 'Generate roster.'),
  ('draw.freeze_roster', 'Freeze roster.'),
  ('draw.load_winner', 'Load winning number.'),
  ('prize.resolve', 'Resolve award or non-award.'),
  ('prize.deliver', 'Record prize delivery.'),
  ('report.view_operational', 'View operational reports.'),
  ('report.view_financial', 'View financial reports.'),
  ('report.export', 'Export reports.'),
  ('audit.view', 'View audit log.'),
  ('user.manage', 'Manage users and roles.')
on conflict (code) do update set description = excluded.description;

-- admin receives every permission.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name = 'admin'
on conflict do nothing;

-- Other roles: only the "yes" cells of the docs matrix. "own"/"future" cells are not granted
-- yet and the collector role has no permissions in Phase 1.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  ('operator', 'campaign.view'),
  ('treasurer', 'campaign.view'),
  ('read-only', 'campaign.view'),
  ('operator', 'bond.view'),
  ('treasurer', 'bond.view'),
  ('read-only', 'bond.view'),
  ('operator', 'bond.create'),
  ('operator', 'bond.import'),
  ('operator', 'bond.assign'),
  ('operator', 'buyer.manage'),
  ('operator', 'sale.create'),
  ('operator', 'payment.create'),
  ('treasurer', 'payment.create'),
  ('treasurer', 'payment.annul'),
  ('operator', 'settlement.create'),
  ('treasurer', 'settlement.create'),
  ('treasurer', 'settlement.close'),
  ('treasurer', 'settlement.correct'),
  ('treasurer', 'commission.adjust'),
  ('treasurer', 'draw.freeze_roster'),
  ('operator', 'draw.load_winner'),
  ('treasurer', 'draw.load_winner'),
  ('treasurer', 'report.view_financial'),
  ('read-only', 'report.view_financial'),
  ('treasurer', 'audit.view')
) as m (role_name, permission_code)
join public.roles r on r.name = m.role_name
join public.permissions p on p.code = m.permission_code
on conflict do nothing;
