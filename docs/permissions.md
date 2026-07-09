# Permissions and Roles

## Objective

Define an adaptable permissions model for the MVP and future stages. The system must not depend only on fixed role names; it must use roles as groupings of granular permissions.

## Guiding Principle

```txt
Role = set of permissions
Permission = concrete system action
```

This allows changing a role's permissions without rewriting business logic, screens, or RLS policies.

## Initial Roles

| Role | Purpose |
|---|---|
| `admin` | Full configuration, users, rules, and critical corrections. |
| `operador` | Daily operation of bonds, buyers, sales, payments, and open collector settlements. |
| `tesorero` | Collector settlements, commissions, collector ledger, cash, and financial reports. |
| `cobrador` | Future limited access to own portfolio. |
| `consulta` | Read-only according to defined scope. |

## Granular Permissions

### Campaigns

| Permission | Description |
|---|---|
| `campaign.view` | View campaigns. |
| `campaign.create` | Create campaigns. |
| `campaign.update` | Edit general data. |
| `campaign.update_rules` | Modify critical numbering, installment, commission, and draw rules. |
| `campaign.close` | Close campaign. |

### Bonds

| Permission | Description |
|---|---|
| `bond.view` | View bonds. |
| `bond.create` | Create bonds manually. |
| `bond.import` | Import or load bonds in batches. |
| `bond.scan` | Load or search bonds by barcode. |
| `bond.assign` | Assign bonds to collectors. |
| `bond.return` | Register returns. |
| `bond.mark_lost` | Register loss. |
| `bond.annul` | Annul bonds. |

### Buyers and Collectors

| Permission | Description |
|---|---|
| `buyer.view` | View buyers. |
| `buyer.manage` | Create and edit buyers. |
| `collector.view` | View collectors. |
| `collector.manage` | Create and edit collectors. |
| `collector.ledger.view` | View collector ledger. |
| `collector.ledger.adjust` | Register manual adjustments. |

### Sales, Payments, and Collector Settlements

| Permission | Description |
|---|---|
| `sale.create` | Register sales. |
| `sale.correct` | Correct sales with audit. |
| `payment.create` | Register payments. |
| `payment.annul` | Annul confirmed payments. |
| `rendition.create` | Create collector settlements. |
| `rendition.update_open` | Edit open collector settlements. |
| `rendition.close` | Close collector settlements. |
| `rendition.correct` | Correct closed collector settlements through adjustments. |

### Commissions

| Permission | Description |
|---|---|
| `commission.view` | View commissions. |
| `commission.rule_manage` | Manage commission rules. |
| `commission.adjust` | Manually adjust commission with reason. |
| `commission.settle` | Settle/pay commissions. |

### Draws and Prizes

| Permission | Description |
|---|---|
| `draw.view` | View draws. |
| `draw.create` | Create draws. |
| `draw.update` | Edit scheduled draws. |
| `draw.generate_roster` | Generate draw roster. |
| `draw.freeze_roster` | Freeze draw roster. |
| `draw.load_winner` | Load winning number. |
| `prize.resolve` | Resolve award or non-award. |
| `prize.deliver` | Register prize delivery. |

### Reports, Audit, and Users

| Permission | Description |
|---|---|
| `report.view_operational` | View operational reports. |
| `report.view_financial` | View financial reports. |
| `report.export` | Export reports. |
| `audit.view` | View audit. |
| `user.manage` | Manage users and roles. |

## Suggested Initial Matrix

| Permission | admin | operador | tesorero | cobrador | consulta |
|---|---:|---:|---:|---:|---:|
| `campaign.view` | yes | yes | yes | no | yes |
| `campaign.create` | yes | no | no | no | no |
| `campaign.update_rules` | yes | no | no | no | no |
| `bond.view` | yes | yes | yes | own | yes |
| `bond.create` | yes | yes | no | no | no |
| `bond.import` | yes | yes | no | no | no |
| `bond.assign` | yes | yes | no | no | no |
| `buyer.manage` | yes | yes | no | no | no |
| `collector.manage` | yes | no | no | no | no |
| `sale.create` | yes | yes | no | no | no |
| `payment.create` | yes | yes | yes | future | no |
| `payment.annul` | yes | no | yes | no | no |
| `rendition.create` | yes | yes | yes | no | no |
| `rendition.close` | yes | no | yes | no | no |
| `rendition.correct` | yes | no | yes | no | no |
| `commission.rule_manage` | yes | no | no | no | no |
| `commission.adjust` | yes | no | yes | no | no |
| `draw.freeze_roster` | yes | no | yes | no | no |
| `draw.load_winner` | yes | yes | yes | no | no |
| `report.view_financial` | yes | no | yes | no | yes |
| `audit.view` | yes | no | yes | no | no |
| `user.manage` | yes | no | no | no | no |

## Technical Rules

- The UI may hide actions, but real security must be server-side and in RLS.
- Every sensitive action must validate permissions explicitly.
- Permissions must be versioned in the database or initial migrations.
- If collector access is enabled, their queries must be limited to their own portfolio.
