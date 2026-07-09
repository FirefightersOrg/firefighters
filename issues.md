# Issues and critical considerations

This document summarizes the points that must be clarified or resolved based on the business model defined in `README.md`.

## General verdict

The system is viable as an administrative web application. It does not seem infeasible, but it has medium-high complexity due to three main areas:

- Bond, pata, and draw numbering.
- Payments, installments, advance payments, and collector settlements.
- Collector current account and commissions.

The `README.md` works well as a business document, but it still needs to be converted into functional and technical design.

## Critical issues

### 1. Define the main platform

The document states that the application will be web-based and accessible from different devices.

If that is the objective, the main platform should be a web app or PWA with a centralized backend and shared database.

Tauri can work for an administrative desktop app, but it should not be the main platform if access is required from phones, tablets, and different devices.

Pending decision:

- Web app as the main product.
- Tauri only as a complementary option.
- Or discard Tauri for this project.

### 2. Finalize the `+4871` associated-number rule

The associated-number rule is central to the entire system:

```text
associated_number = base_number + 4871
```

It must be confirmed what happens when the result exceeds `9999`.

Possible options:

1. Base numbers that generate associated numbers greater than `9999` are not allowed.
2. The last 4 digits are taken.
3. The campaign supports numbers with more than 4 digits.
4. There is another rule inherited from the previous system.

This blocks database decisions, validations, winner lookup, bond import, and duplicate control.

### 3. Define uniqueness of participant numbers

It must be formally defined that a participant number cannot point to more than one bond within the same campaign.

Participant number includes:

- Base number.
- Calculated associated number.
- Numbers included in patas.
- Extra numbers for extraordinary draws, if applicable.

The system behavior for duplicates must be defined:

- Block loading.
- Allow with warning.
- Require administrative resolution.
- Mark pending conflict.

Recommendation: block by default and allow exceptions only with administrator role and audit.

### 4. Model the collector current account as movements

The collector current account is a central component. It should not be modeled only with calculated balances or editable fields.

It must be modeled as a ledger of auditable movements.

Possible movements:

- Generated commission.
- Paid commission.
- Payment received by transfer.
- Settled cash.
- Manual adjustment.
- Payment void.
- Commission void.
- Balance in favor of the collector.
- Balance in favor of Firefighters.

This is critical to avoid mismatches between cash, transfers, commissions, and collector settlements.

### 5. Define statuses and transitions

The README proposes commercial and financial statuses, but a formal state machine is still missing.

Allowed transitions must be defined, for example:

- `Available in administration` -> `Delivered to collector`.
- `Delivered to collector` -> `Sold`.
- `Delivered to collector` -> `Returned`.
- `Sold` -> `Voided`.
- `Sold` -> `Closed`.
- `Available in administration` -> `Lost`.

Reversals must also be defined:

- Sale loaded by mistake.
- Incorrectly recorded payment.
- Bond assigned to the wrong collector.
- Buyer change.
- Return of an already delivered bond.

Recommendation: do not delete data; void or reverse through audited movements.

### 6. Reduce MVP scope

The full scope is large. Trying to implement everything at once greatly increases risk.

Recommended MVP:

1. Campaigns.
2. Collectors.
3. Buyers.
4. Simple bonds.
5. Bond loading/import.
6. Assignment of bonds to collectors.
7. Bond sale.
8. Installment plan.
9. Payment recording.
10. Basic collector settlements.
11. Basic commissions.
12. Collector current account.
13. Basic operational reports.

Later phase:

1. Advanced patas.
2. Pata assembly/disassembly.
3. Monthly draws.
4. Frozen roster.
5. Prizes.
6. Extraordinary draw.
7. Consolation draws.
8. Direct collector access.
9. Barcode.
10. Production AWS infrastructure.

## Important open questions

### Numbering and bonds

1. What happens if `base_number + 4871 > 9999`.
2. Whether the associated number is always calculated the same way in all campaigns.
3. Whether the `+4871` rule must be configurable by campaign.
4. Whether numbers with leading zeros must keep a fixed format, for example `0068`.
5. Whether numbers with 3, 4, or more digits are allowed in the same campaign.
6. How to resolve a historical number that now belongs to a pata.

### Patas

1. Whether a pata is always worth `simple_bond_value x base_number_count`.
2. Whether a pata assembled from simple bonds can be disassembled after being sold.
3. Whether a pata can be disassembled after having recorded payments.
4. Whether a pata can be disassembled after participating in draws.
5. How manually assembled patas are printed or documented.

### Payments and collector settlements

1. How an incorrectly loaded payment is voided.
2. How an incorrect payment method is corrected.
3. Whether a transfer requires an attached receipt.
4. Whether transfer payments must be reconciled against bank movements.
5. Whether a closed collector settlement can be reopened.
6. What happens if a collector settles less cash than expected.
7. What happens if a collector deducts a commission different from the calculated one.

### Commissions

1. Exact commission percentage for full payment.
2. Exact percentage for first installment.
3. Exact percentage for intermediate installments.
4. Exact percentage for last installment.
5. Whether commission is generated when recording the payment or when closing the collector settlement.
6. Whether commission can be modified manually.
7. Whether some collectors have special rules.

### Draws

1. Exact eligibility rule for the final draw.
2. Exact eligibility rule for consolation draws.
3. How extra numbers for the extraordinary draw are calculated.
4. Whether extra numbers must be generated by the system or loaded manually.
5. What formal procedure exists for prizes not awarded due to non-payment.
6. Whether the frozen roster must include not eligible entries too, or only eligible entries.

### Users and access

1. Whether collectors will have their own user.
2. Whether collectors will be able to load payments directly.
3. Whether administration must approve payments reported by collectors.
4. Whether field access from phones is needed.
5. Whether poor connectivity or offline mode must be supported.

### Data and migration

1. How data will be imported from Excel.
2. Whether an export from the previous system exists.
3. What historical data is mandatory to start.
4. Whether complete previous campaigns will be migrated or only usual numbers.
5. How duplicate buyers will be normalized.

### Documents and reports

1. Whether delivery notes must be PDF, printed A4, Excel, or all of them.
2. Whether they must have tax numbering or only administrative numbering.
3. Whether payment receipts must be delivered to the buyer.
4. Whether they must be digitally signed or only printed.

## Recommended improvements before technical design

### 1. Create an MVP document

Clearly separate:

- What goes into the first version.
- What remains for the second version.
- What remains only as desirable.

### 2. Create main functional flows

Before programming, it is advisable to define step-by-step flows for:

- Create campaign.
- Load bonds.
- Deliver bonds to collector.
- Record sale.
- Record payment.
- Create collector settlement.
- Pay commission.
- Generate roster.
- Load winner.
- Reject prize due to non-payment.

### 3. Create state machine

Define statuses and transitions for:

- Bond.
- Installment.
- Payment.
- Collector settlement.
- Prize.
- Campaign.
- Draw.

### 4. Create preliminary ERD model

Likely entities:

- `campaigns`
- `collectors`
- `buyers`
- `bonds`
- `bond_numbers`
- `bond_assignments`
- `sales`
- `payment_plans`
- `installments`
- `payments`
- `collector_ledger_entries`
- `settlements`
- `draws`
- `draw_rosters`
- `draw_roster_entries`
- `winning_numbers`
- `prizes`
- `audit_log`
- `users`
- `roles`

### 5. Define imports

The system will likely need to import data from Excel.

The following should be defined:

- Expected Excel format.
- Validations.
- Preview before importing.
- Error report.
- Duplicate detection.
- Rollback or import voiding.

### 6. Define security and permissions

Minimum permissions to define:

- Who can create campaigns.
- Who can change commission rules.
- Who can void payments.
- Who can close collector settlements.
- Who can generate rosters.
- Who can load winners.
- Who can modify historical data.

### 7. Define mandatory audit

Actions that must always be audited:

- Campaign rule changes.
- Payment loading or voiding.
- Buyer changes.
- Bond assignment and return.
- Closing or reopening collector settlements.
- Commission payout.
- Roster generation.
- Winner loading.
- Prize rejection.
- Manual balance adjustments.

## Main risks

### Risk 1: starting to program before finalizing business rules

Impact: high.

It may force rework of the database, validations, and screens.

### Risk 2: mixing calculated balances with real money

Impact: high.

The current account must be reconstructable from auditable movements.

### Risk 3: not freezing draw rosters

Impact: high.

If the roster is recalculated dynamically, late payments can alter historical results.

### Risk 4: not separating commercial and financial status

Impact: medium-high.

A bond can be sold, overdue, delivered, voided, or closed in different dimensions.

### Risk 5: allowing physical deletion of historical information

Impact: high.

For payments, collector settlements, prizes, and audit, void/reversal must be used, not deletion.

## Final recommendation

Before implementing backend or frontend, it is advisable to resolve in this order:

1. Finalize numbering and duplicate rules.
2. Define MVP.
3. Define state machine.
4. Define collector ledger and collector settlements.
5. Define main functional flows.
6. Build preliminary ERD.
7. Only then define API, screens, and implementation.
