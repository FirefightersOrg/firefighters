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
| `collector` | Own portfolio only, through the collector portal (`/portal`, SAN-143).           |
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

| Permission                | Description                                     |
| ------------------------- | ----------------------------------------------- |
| `sale.view`               | View sales (RLS also accepts `bond.view`).      |
| `sale.create`             | Register sales.                                 |
| `sale.correct`            | Correct sales with audit.                       |
| `sale.mark_uncollectible` | Mark an active sale uncollectible (SAN-106).    |
| `payment.view`            | View payments.                                  |
| `payment.create`          | Register payments.                              |
| `payment.annul`           | Annul confirmed payments.                       |
| `settlement.view`         | View settlements.                               |
| `settlement.create`       | Create settlements.                             |
| `settlement.update_open`  | Edit open settlements.                          |
| `settlement.close`        | Close settlements.                              |
| `settlement.correct`      | Correct closed settlements through adjustments. |

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

| Permission                  | admin | operator | treasurer | collector | read-only |
| --------------------------- | ----: | -------: | --------: | --------: | --------: |
| `campaign.view`             |   yes |      yes |       yes |       yes |       yes |
| `campaign.create`           |   yes |       no |        no |        no |        no |
| `campaign.update_rules`     |   yes |       no |        no |        no |        no |
| `bond.view`                 |   yes |      yes |       yes |        no |       yes |
| `bond.create`               |   yes |      yes |        no |        no |        no |
| `bond.import`               |   yes |      yes |        no |        no |        no |
| `bond.scan`                 |   yes |      yes |        no |        no |        no |
| `bond.assign`               |   yes |      yes |        no |        no |        no |
| `bond.return`               |   yes |      yes |        no |        no |        no |
| `buyer.view`                |   yes |      yes |        no |        no |        no |
| `buyer.manage`              |   yes |      yes |        no |        no |        no |
| `collector.view`            |   yes |      yes |        no |        no |        no |
| `collector.manage`          |   yes |       no |        no |        no |        no |
| `collector.ledger.view`     |   yes |       no |       yes |        no |        no |
| `sale.view`                 |   yes |      yes |       yes |        no |        no |
| `sale.create`               |   yes |      yes |        no |        no |        no |
| `sale.mark_uncollectible`   |   yes |       no |       yes |        no |        no |
| `payment.view`              |   yes |      yes |       yes |        no |        no |
| `payment.create`            |   yes |      yes |       yes |    future |        no |
| `payment.annul`             |   yes |       no |       yes |        no |        no |
| `settlement.view`           |   yes |      yes |       yes |        no |        no |
| `settlement.create`         |   yes |      yes |       yes |        no |        no |
| `settlement.update_open`    |   yes |      yes |        no |        no |        no |
| `settlement.close`          |   yes |       no |       yes |        no |        no |
| `settlement.correct`        |   yes |       no |       yes |        no |        no |
| `commission.view`           |   yes |       no |       yes |        no |       yes |
| `commission.rule_manage`    |   yes |       no |        no |        no |        no |
| `commission.adjust`         |   yes |       no |       yes |        no |        no |
| `draw.view`                 |   yes |      yes |       yes |        no |        no |
| `draw.annul`                |   yes |       no |        no |        no |        no |
| `draw.complete`             |   yes |       no |        no |        no |        no |
| `draw.freeze_roster`        |   yes |       no |       yes |        no |        no |
| `draw.load_winner`          |   yes |      yes |       yes |        no |        no |
| `prize.annul`               |   yes |       no |        no |        no |        no |
| `prize.reverse_delivery`    |   yes |       no |        no |        no |        no |
| `report.view_operational`   |   yes |      yes |       yes |        no |       yes |
| `report.view_financial`     |   yes |       no |       yes |        no |       yes |
| `report.export`             |   yes |      yes |       yes |        no |       yes |
| `audit.view`                |   yes |       no |       yes |        no |        no |
| `user.manage`               |   yes |       no |        no |        no |        no |
| `bond.view_own`             |   yes |       no |        no |       yes |        no |
| `sale.view_own`             |   yes |       no |        no |       yes |        no |
| `collector.ledger.view_own` |   yes |       no |        no |       yes |        no |
| `payment.create_own`        |   yes |       no |        no |       yes |        no |

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

### Sales are readable through `bond.view`

`sale_can_read()` (the SELECT policy of `sales` and its lines) accepts `sale.view`, `sale.create`, `sale.correct` or `bond.view`, because a bond's commercial state is derived from its sale. Product decision: `read-only` MAY read sales. It holds `bond.view` but not `sale.view`, so the matrix above keeps `no` in the `sale.view` row for `read-only` (the matrix lists permission codes, not what RLS lets through), while RLS lets it read sales. The `treasurer` reads sales through its own `sale.view` since SAN-105 (`20270114000000_treasurer_sale_view.sql`, decided on 2026-11-19: it reconciles payments against sales). Writing sales still needs `sale.create` (or the own-collector rule). The pgTAP test `058_rls_audit` asserts this: read-only sees bonds, delivery notes, assignments, commission rules and sales, and nothing else.

### Operational reports (SAN-86)

`20270101000000_operational_reports.sql` grants `report.view_operational` to `operator` (operations), `treasurer` and `read-only` (auditor); `admin` holds every permission. The catalog has no collector-coordinator role, so reports are not scoped per coordinator yet: a future coordinator role needs its own scope rule in the `report_*` functions (known gap, SAN-140).

Overdue warning (SAN-142, `20270116000000_overdue_warning.sql`): `report_overdue_sales` follows the same rule (`report.view_operational` + `campaign.view`, definer, no buyer data) and lists active, unmarked sales with at least the campaign's N overdue installments. It only informs and never marks a sale `uncollectible`. N (`campaigns.overdue_warning_threshold`, default 3, 1..120) is changed with `campaign_set_overdue_warning_threshold`, which needs `campaign.update_rules`, is audited as `campaign.update_overdue_warning`, and is refused on closed or annulled campaigns.

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
- Collector queries are limited to their own portfolio (see "Collector portal own scope (SAN-143)").

## Collector portal own scope (SAN-143)

The collector never receives the global `bond.view`, `sale.view`, `collector.ledger.view` or `payment.create`: those are grants used by many policies and functions and would open every collector's data. The role gets four dedicated own-scope codes instead (`20270112000000_collector_portal_scope.sql`; admin holds them too):

| Permission                  | Opens, only for the caller's own collector                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `bond.view_own`             | Bonds, bond numbers, bond groups (through their bonds), delivery notes, assignments. Also gates `/portal`. |
| `sale.view_own`             | Sales, payment plans, installments, payments, and the narrow buyer read.                                   |
| `collector.ledger.view_own` | Current account, commission adjustments, settlements.                                                      |
| `payment.create_own`        | `portal_payment_submit` (SAN-147): register a collection of an own sale; it stays a `draft` until settled. |

- Registering a collection (SAN-147, `20270119000000_collector_payment_submit.sql`): `portal_payment_submit` checks `payment.create_own` inside, resolves the active collector from the session and only accepts an own, active sale of an active campaign (anything else answers "not found"). The payment is a `draft` that does not count until an operator with `payment.create` + `settlement.update_open` includes it in an open settlement of that collector (`settlement_attach_collector_payment`) and closes it, or rejects it with a reason (`settlement_reject_collector_payment`). The collector holds neither `payment.create`, `payment.annul` nor `settlement.*`, and has no DML on `payments`. Future dates are rejected using the Buenos Aires day; the amount cannot exceed the installment balance minus other drafts. Reads for the portal: `portal_my_sale_submissions`, `portal_my_sale_reserved` (`sale.view_own`). All five functions are `SECURITY DEFINER`, `search_path = ''`, executable by `authenticated` only.
- Route map (SAN-148): `/portal` lists the campaigns (with exactly one it redirects to it); every other page lives under `/portal/[campaignId]/` and shares one sub-navigation: `bonos` (+ `bonos/[bondId]`, `bond.view_own`), `ventas` (+ `ventas/[saleId]` with "Registrar cobro"), `compradores` (+ `compradores/[buyerId]`), `por-cobrar` (`sale.view_own`) and `cuenta` (`collector.ledger.view_own`). The campaign id only filters; the collector always comes from the session. A sale or buyer that does not belong to the campaign of the URL answers 404. `portal_my_campaign_buyers` and `portal_my_campaign_due_installments` (`20270120000000`, pgTAP 068) add the optional campaign filter; the SAN-145 functions delegate to them with `NULL`.
- Identity: `collectors.user_profile_id` = `current_profile_id()`. One helper, `is_own_collector(uuid)` (`SECURITY DEFINER`, `stable`, `search_path = ''`), holds that logic; the four older per-domain helpers are thin wrappers over it.
- RLS rule: global permission OR (`*_own` permission AND `is_own_collector(collector_id)`). An unlinked profile, or another collector's rows, return zero rows. An inactive collector keeps read access to its own history.
- The four per-domain wrappers (`delivery_`, `sale_`, `payment_settlement_`, `collector_ledger_is_own_collector`) carry the matching `*_own` permission, because `SECURITY DEFINER` functions (ledger balance, settlement totals, `delivery_can_read`) skip RLS and only call them. Settlements use `collector.ledger.view_own`.
- `bonds_select` own-scope uses `current_collector_id`: a bond that was returned, or moved to another collector, leaves the portal, while its sale (`sales.collector_id`) and delivery note stay visible. "My bonds" means today's holdings; a history view (SAN-144) must read assignments/sales instead.
- Buyers: `buyers_select` stays closed. `portal_my_buyers(campaign)` is a read-only `SECURITY DEFINER` function (name, phone, address only, own sales only); `portal_my_collector()` resolves the caller's collector. Both are revoked from `public`, `anon` and `service_role` and granted to `authenticated`.
- Server: `requireOwnCollector(locals, returnTo, permission)` resolves the collector from the session, never from a URL or form value; permissions not loaded answer 500, a missing permission 403, no link returns `null` (empty state in the portal). `/` redirects collectors to `/portal`; the nav shows "Mi portal" for `bond.view_own`.
- The `*_own` codes are excluded from the "action implies view" rule (pgTAP 017 ignores codes ending in `_own`): they open own rows only and never imply a global view.

## Campaign dashboard (SAN-85)

`/campaigns/[id]` shows a dashboard to users who may read the reports. Each group depends on one permission, so a user sees only what the report functions already allow:

| Group                                                   | Permission                |
| ------------------------------------------------------- | ------------------------- |
| Bonds, revenue (installments), next draw, bonds at risk | `report.view_operational` |
| Cash and transfers, commissions, collector balances     | `report.view_financial`   |

Users with `campaign.view` only (for example collectors) see the campaign summary without the dashboard. `20270110000000_campaign_dashboard.sql` adds two read-only `SECURITY DEFINER` functions, `dashboard_next_draw` and `dashboard_at_risk_bonds`, that check `report.view_operational` and `campaign.view` themselves; they are revoked from `public`, `anon` and `service_role` and granted to `authenticated` only. A bond is at risk when it is sold, has an active sale and its required installments (monthly: 1..N; consolation: 1..N; final and extraordinary: all) are not covered by confirmed payments dated on or before the cutoff day (the same payment-before-cutoff test as `draw_generate_roster`). It is an estimate of who may miss the draw, not the roster: it does not apply the roster's other exclusions (for example a consolation bond that already won an excluding prize), a consolation draw without a required installment shows no bonds at risk, and a sold bond with no active payment plan is not listed. Once the roster is frozen, the dashboard labels the same figure "not enabled".
