# Permissions and roles

## Objective

Define an adaptable permission model for the MVP and future stages. The system must not depend solely on fixed role names; it must use roles as groupers of granular permissions.

## Guiding principle

```txt
Role = set of permissions
Permission = concrete system action
```

This allows changing permissions of a role without rewriting business logic, screens, or RLS policies.

## Initial roles

| Role | Purpose |
|---|---|
| `admin` | Full configuration, users, rules, and critical corrections. |
| `operator` | Daily operations for bonds, buyers, sales, payments, and open settlements. |
| `treasurer` | Settlements, commissions, current account, cash register, and financial reports. |
| `collector` | Future limited access to own portfolio. |
| `read-only` | Read-only within defined scope. |

## Granular permissions

### Campaigns

| Permission | Description |
|---|---|
| `campaign.view` | View campaigns. |
| `campaign.create` | Create campaigns. |
| `campaign.update` | Edit general data. |
| `campaign.update_rules` | Modify critical rules for numbering, installments, commissions, and draws. |
| `campaign.close` | Close campaign. |

### Bonds

| Permission | Description |
|---|---|
| `bond.view` | View bonds. |
| `bond.create` | Create bonds manually. |
| `bond.import` | Import or load bonds in batch. |
| `bond.scan` | Load or search bonds by barcode. |
| `bond.assign` | Assign bonds to collectors. |
| `bond.return` | Record returns. |
| `bond.mark_lost` | Record loss. |
| `bond.annul` | Annul bonds. |

### Buyers and collectors

| Permission | Description |
|---|---|
| `buyer.view` | View buyers. |
| `buyer.manage` | Create and edit buyers. |
| `collector.view` | View collectors. |
| `collector.manage` | Create and edit collectors. |
| `collector.ledger.view` | View current account. |
| `collector.ledger.adjust` | Record manual adjustments. |

### Sales, payments, and settlements

| Permission | Description |
|---|---|
| `sale.create` | Register sales. |
| `sale.correct` | Correct sales with audit. |
| `payment.create` | Register payments. |
| `payment.annul` | Annul confirmed payments. |
| `settlement.create` | Create settlements. |
| `settlement.update_open` | Edit open settlements. |
| `settlement.close` | Close settlements. |
| `settlement.correct` | Correct closed settlements through adjustments. |

### Commissions

| Permission | Description |
|---|---|
| `commission.view` | View commissions. |
| `commission.rule_manage` | Manage commission rules. |
| `commission.adjust` | Manually adjust commission with reason. |
| `commission.settle` | Settle/pay commissions. |

### Draws and prizes

| Permission | Description |
|---|---|
| `draw.view` | View draws. |
| `draw.create` | Create draws. |
| `draw.update` | Edit scheduled draws. |
| `draw.generate_roster` | Generate roster. |
| `draw.freeze_roster` | Freeze roster. |
| `draw.load_winner` | Load winning number. |
| `prize.resolve` | Resolve award or non-award. |
| `prize.deliver` | Record prize delivery. |

### Reports, audit, and users

| Permission | Description |
|---|---|
| `report.view_operational` | View operational reports. |
| `report.view_financial` | View financial reports. |
| `report.export` | Export reports. |
| `audit.view` | View audit log. |
| `user.manage` | Manage users and roles. |

## Initial suggested matrix

| Permission | admin | operator | treasurer | collector | read-only |
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
| `settlement.create` | yes | yes | yes | no | no |
| `settlement.close` | yes | no | yes | no | no |
| `settlement.correct` | yes | no | yes | no | no |
| `commission.rule_manage` | yes | no | no | no | no |
| `commission.adjust` | yes | no | yes | no | no |
| `draw.freeze_roster` | yes | no | yes | no | no |
| `draw.load_winner` | yes | yes | yes | no | no |
| `report.view_financial` | yes | no | yes | no | yes |
| `audit.view` | yes | no | yes | no | no |
| `user.manage` | yes | no | no | no | no |

## Technical rules

- The UI may hide actions, but the real security must be on the server-side and RLS.
- Every sensitive action must validate permissions explicitly.
- Permissions must be versioned in the database or initial migrations.
- If collector access is enabled, their queries must be limited to their own portfolio.
