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

| Role        | Purpose                                                                          |
| ----------- | -------------------------------------------------------------------------------- |
| `admin`     | Full configuration, users, rules, and critical corrections.                      |
| `operator`  | Daily operations for bonds, buyers, sales, payments, and open settlements.       |
| `treasurer` | Settlements, commissions, current account, cash register, and financial reports. |
| `collector` | Future limited access to own portfolio.                                          |
| `read-only` | Read-only within defined scope.                                                  |

## Granular permissions

### Campaigns

| Permission              | Description                                                                |
| ----------------------- | -------------------------------------------------------------------------- |
| `campaign.view`         | View campaigns.                                                            |
| `campaign.create`       | Create campaigns.                                                          |
| `campaign.update`       | Edit general data.                                                         |
| `campaign.update_rules` | Modify critical rules for numbering, installments, commissions, and draws. |
| `campaign.close`        | Close campaign.                                                            |

Campaign actions and the permission each one requires (enforced by the `campaign_*` SQL functions, see `docs/data-model.md`):

| Action                                                                  | Permission              |
| ----------------------------------------------------------------------- | ----------------------- |
| View list and detail                                                    | `campaign.view`         |
| Create (as draft)                                                       | `campaign.create`       |
| Edit name and dates                                                     | `campaign.update`       |
| Edit rules (numbering, installments, values, overflow, barcode); draft  | `campaign.update_rules` |
| Activate (`draft -> active`); activation freezes the rules              | `campaign.update_rules` |
| Start closing, close (`active -> closing`, `closing -> closed`)         | `campaign.close`        |
| Annul (`draft -> annulled`, `active -> annulled`); a reason is required | `campaign.close`        |

### Bonds

| Permission       | Description                      |
| ---------------- | -------------------------------- |
| `bond.view`      | View bonds.                      |
| `bond.create`    | Create bonds manually.           |
| `bond.import`    | Import or load bonds in batch.   |
| `bond.scan`      | Load or search bonds by barcode. |
| `bond.assign`    | Assign bonds to collectors.      |
| `bond.return`    | Record returns.                  |
| `bond.mark_lost` | Record loss.                     |
| `bond.annul`     | Annul bonds.                     |

Import sessions and their items (Phase 4) are readable with `bond.import` or `bond.scan`. The operator received `bond.scan` in SAN-44 (`20261125000000_operator_bond_scan.sql`).

### Buyers and collectors

| Permission                | Description                 |
| ------------------------- | --------------------------- |
| `buyer.view`              | View buyers.                |
| `buyer.manage`            | Create and edit buyers.     |
| `collector.view`          | View collectors.            |
| `collector.manage`        | Create and edit collectors. |
| `collector.ledger.view`   | View current account.       |
| `collector.ledger.adjust` | Record manual adjustments.  |

### Sales, payments, and settlements

| Permission               | Description                                     |
| ------------------------ | ----------------------------------------------- |
| `sale.view`              | View sales.                                     |
| `sale.create`            | Register sales.                                 |
| `sale.correct`           | Correct sales with audit.                       |
| `payment.view`           | View payments.                                  |
| `payment.create`         | Register payments.                              |
| `payment.annul`          | Annul confirmed payments.                       |
| `settlement.view`        | View settlements.                               |
| `settlement.create`      | Create settlements.                             |
| `settlement.update_open` | Edit open settlements.                          |
| `settlement.close`       | Close settlements.                              |
| `settlement.correct`     | Correct closed settlements through adjustments. |

### Commissions

| Permission               | Description                             |
| ------------------------ | --------------------------------------- |
| `commission.view`        | View commissions.                       |
| `commission.rule_manage` | Manage commission rules.                |
| `commission.adjust`      | Manually adjust commission with reason. |
| `commission.settle`      | Settle/pay commissions.                 |

### Draws and prizes

| Permission               | Description                                                            |
| ------------------------ | ---------------------------------------------------------------------- |
| `draw.view`              | View draws.                                                            |
| `draw.create`            | Create draws.                                                          |
| `draw.update`            | Edit scheduled draws.                                                  |
| `draw.annul`             | Annul scheduled draws, and generated extraordinary draws (admin only). |
| `draw.complete`          | Complete frozen draws (admin only).                                    |
| `draw.generate_roster`   | Generate roster.                                                       |
| `draw.freeze_roster`     | Freeze roster.                                                         |
| `draw.load_winner`       | Load winning number.                                                   |
| `prize.resolve`          | Resolve award or non-award.                                            |
| `prize.deliver`          | Record prize delivery.                                                 |
| `prize.annul`            | Annul an undelivered prize (admin only).                               |
| `prize.reverse_delivery` | Reverse a mistaken delivery with a mandatory reason (admin only).      |

### Reports, audit, and users

| Permission                | Description               |
| ------------------------- | ------------------------- |
| `report.view_operational` | View operational reports. |
| `report.view_financial`   | View financial reports.   |
| `report.export`           | Export reports.           |
| `audit.view`              | View audit log.           |
| `user.manage`             | Manage users and roles.   |

## Initial suggested matrix

| Permission                | admin | operator | treasurer | collector | read-only |
| ------------------------- | ----: | -------: | --------: | --------: | --------: |
| `campaign.view`           |   yes |      yes |       yes |       yes |       yes |
| `campaign.create`         |   yes |       no |        no |        no |        no |
| `campaign.update_rules`   |   yes |       no |        no |        no |        no |
| `bond.view`               |   yes |      yes |       yes |       own |       yes |
| `bond.create`             |   yes |      yes |        no |        no |        no |
| `bond.import`             |   yes |      yes |        no |        no |        no |
| `bond.scan`               |   yes |      yes |        no |        no |        no |
| `bond.assign`             |   yes |      yes |        no |        no |        no |
| `bond.return`             |   yes |      yes |        no |        no |        no |
| `buyer.view`              |   yes |      yes |        no |        no |        no |
| `buyer.manage`            |   yes |      yes |        no |        no |        no |
| `collector.view`          |   yes |      yes |        no |        no |        no |
| `collector.manage`        |   yes |       no |        no |        no |        no |
| `collector.ledger.view`   |   yes |       no |       yes |        no |        no |
| `sale.view`               |   yes |      yes |        no |        no |        no |
| `sale.create`             |   yes |      yes |        no |        no |        no |
| `payment.view`            |   yes |      yes |       yes |        no |        no |
| `payment.create`          |   yes |      yes |       yes |    future |        no |
| `payment.annul`           |   yes |       no |       yes |        no |        no |
| `settlement.view`         |   yes |      yes |       yes |        no |        no |
| `settlement.create`       |   yes |      yes |       yes |        no |        no |
| `settlement.update_open`  |   yes |      yes |        no |        no |        no |
| `settlement.close`        |   yes |       no |       yes |        no |        no |
| `settlement.correct`      |   yes |       no |       yes |        no |        no |
| `commission.view`         |   yes |       no |       yes |        no |       yes |
| `commission.rule_manage`  |   yes |       no |        no |        no |        no |
| `commission.adjust`       |   yes |       no |       yes |        no |        no |
| `draw.view`               |   yes |      yes |       yes |        no |        no |
| `draw.annul`              |   yes |       no |        no |        no |        no |
| `draw.complete`           |   yes |       no |        no |        no |        no |
| `draw.freeze_roster`      |   yes |       no |       yes |        no |        no |
| `draw.load_winner`        |   yes |      yes |       yes |        no |        no |
| `prize.annul`             |   yes |       no |        no |        no |        no |
| `prize.reverse_delivery`  |   yes |       no |        no |        no |        no |
| `report.view_operational` |   yes |      yes |       yes |        no |       yes |
| `report.view_financial`   |   yes |       no |       yes |        no |       yes |
| `report.export`           |   yes |      yes |       yes |        no |       yes |
| `audit.view`              |   yes |       no |       yes |        no |        no |
| `user.manage`             |   yes |       no |        no |        no |        no |

### Action implies view (SAN-93)

A role that holds an action permission on a domain also holds that domain's `<domain>.view` permission, when that permission exists. The domain is the code without its last segment (`buyer.manage` -> `buyer`, `collector.ledger.adjust` -> `collector.ledger`). Codes whose last segment is `view` or `view_*` are views, not actions.

`20261201000000_role_matching_view_permissions.sql` creates `sale.view`, `payment.view` and `settlement.view` (so the rule now applies to every domain) and adds these grants:

| Role        | Added                    | Because of                                                    |
| ----------- | ------------------------ | ------------------------------------------------------------- |
| `operator`  | `buyer.view`             | `buyer.manage`                                                |
| `operator`  | `draw.view`              | `draw.load_winner`                                            |
| `operator`  | `sale.view`              | `sale.create`                                                 |
| `operator`  | `payment.view`           | `payment.create`                                              |
| `operator`  | `settlement.view`        | `settlement.create`, `settlement.update_open`                 |
| `operator`  | `collector.view`         | decision                                                      |
| `operator`  | `settlement.update_open` | decision                                                      |
| `operator`  | `bond.return`            | decision (`bond.mark_lost` stays admin-only)                  |
| `treasurer` | `commission.view`        | `commission.adjust`                                           |
| `treasurer` | `draw.view`              | `draw.freeze_roster`, `draw.load_winner`                      |
| `treasurer` | `payment.view`           | `payment.create`, `payment.annul`                             |
| `treasurer` | `settlement.view`        | `settlement.create`, `settlement.close`, `settlement.correct` |
| `treasurer` | `collector.ledger.view`  | decision                                                      |
| `read-only` | `commission.view`        | decision                                                      |
| `collector` | `campaign.view`          | decision                                                      |

Product decisions (SAN-93): the three new `.view` permissions are implied by any sale, payment or settlement action; the operator gets `collector.view`, `settlement.update_open` and `bond.return` (not `bond.mark_lost`); the treasurer gets `collector.ledger.view`; read-only gets `commission.view`; the collector gets `campaign.view`. Other cross-domain needs are not covered by the rule. The pgTAP test `017_role_view_permissions` checks the rule for every role, so a later grant cannot break it silently.

### Operational reports (SAN-86)

`20270101000000_operational_reports.sql` grants `report.view_operational` to `operator` (operations), `treasurer` and `read-only` (auditor); `admin` holds every permission. The catalog has no collector-coordinator role, so reports are not scoped per coordinator yet: a future coordinator role needs its own scope rule in the `report_*` functions (known gap, SAN-140).

The four reports (`report_bonds_by_status`, `report_bonds_by_collector`, `report_installments`, `report_collector_monthly`) are read-only `SECURITY DEFINER` functions that check `report.view_operational` and `campaign.view` themselves and return aggregates only (no buyer data). They are definers on purpose: a read-only user holds `report.view_operational` but not `sale.view` or `payment.view`, whose RLS would otherwise hide the data. The functions and the helper are revoked from `public`, `anon` and `service_role` and granted to `authenticated` only.

### Financial and draw reports and exports (SAN-87)

`20270108000000_financial_draw_reports.sql` grants `report.export` to `operator` (operations), `treasurer` and `read-only` (auditor); it was admin-only (SAN-90 backups). `report.view_financial` was already granted to `treasurer` and `read-only`.

The seven financial and draw reports (`report_payments_by_date`, `report_settlements_by_collector`, `report_collector_accounts`, `report_collector_ledger`, `report_draw_rosters`, `report_draw_roster_entries`, `report_prizes`) are read-only `SECURITY DEFINER` functions that check `report.view_financial` and `campaign.view` themselves. They are revoked from `public`, `anon` and `service_role` and granted to `authenticated` only.

Exports (`/campaigns/[id]/reports/export/[report]?format=csv|xlsx`) need `report.export`, `campaign.view` and the view permission of the report: `report.view_operational` for the four operational reports, `report.view_financial` for the financial and draw ones. So an operator exports only the operational reports. The backup exports (SAN-90) share `report.export` but still require the view permission of the exported data.

## Technical rules

- The UI may hide actions, but the real security must be on the server-side and RLS.
- Every sensitive action must validate permissions explicitly.
- Permissions must be versioned in the database or initial migrations.
- The catalog (`roles`, `permissions`, `role_permissions`) is read-only at runtime; it changes only through migrations. `user.manage` covers profiles and role assignments (`user_roles`).
- At least one active profile must keep `user.manage`: the database rejects removing the last holder's role, deactivating them, or removing `user.manage` from their role.
- If collector access is enabled, their queries must be limited to their own portfolio.

## Campaign dashboard (SAN-85)

`/campaigns/[id]` shows a dashboard to users who may read the reports. Each group depends on one permission, so a user sees only what the report functions already allow:

| Group                                                   | Permission                |
| ------------------------------------------------------- | ------------------------- |
| Bonds, revenue (installments), next draw, bonds at risk | `report.view_operational` |
| Cash and transfers, commissions, collector balances     | `report.view_financial`   |

Users with `campaign.view` only (for example collectors) see the campaign summary without the dashboard. `20270110000000_campaign_dashboard.sql` adds two read-only `SECURITY DEFINER` functions, `dashboard_next_draw` and `dashboard_at_risk_bonds`, that check `report.view_operational` and `campaign.view` themselves; they are revoked from `public`, `anon` and `service_role` and granted to `authenticated` only. A bond is at risk when it is sold, has an active sale and its required installments (monthly: 1..N; consolation: 1..N; final and extraordinary: all) are not covered by confirmed payments dated on or before the cutoff day (the same payment-before-cutoff test as `draw_generate_roster`). It is an estimate of who may miss the draw, not the roster: it does not apply the roster's other exclusions (for example a consolation bond that already won an excluding prize), a consolation draw without a required installment shows no bonds at risk, and a sold bond with no active payment plan is not listed. Once the roster is frozen, the dashboard labels the same figure "not enabled".
