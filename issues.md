# Critical issues and considerations

This document summarizes the points that need to be clarified or resolved based on the business model defined in `README.md`.

## Overall verdict

The system is viable as an administrative web application. It does not seem unfeasible, but it has medium-high complexity due to three main areas:

- Bond, pata, and draw numbering.
- Payments, installments, advances, and settlements.
- Collector current account and commissions.

The `README.md` is fine as a business document, but it still needs to be converted into functional and technical design.

## Critical issues

### 1. Define main platform

The document states that the application will be web-based and accessible from different devices.

If that is the goal, the main platform should be a web app or PWA with a centralized backend and shared database.

Tauri could serve as an administrative desktop app, but it should not be the main platform if access from phones, tablets, and different devices is required.

Pending decision:

- Web app as the main product.
- Tauri only as a complementary option.
- Or discard Tauri for this project.

### 2. Close the associated number rule `+4871`

The associated number rule is central to the entire system:

```text
associated_number = base_number + 4871
```

It must be confirmed what happens when the result exceeds `9999`.

Possible options:

1. Base numbers that generate associated numbers greater than `9999` are not allowed.
2. The last 4 digits are taken.
3. The campaign accepts numbers with more than 4 digits.
4. There is another rule inherited from the previous system.

This blocks database decisions, validations, winner searches, bond imports, and duplicate control.

### 3. Define uniqueness of participating numbers

It must be formally defined that a participating number cannot point to more than one bond within the same campaign.

Participating number includes:

- Base number.
- Calculated associated number.
- Numbers included in patas.
- Extra numbers from extraordinary draws, if applicable.

The system behavior for duplicates must be defined:

- Block entry.
- Allow with warning.
- Require administrative resolution.
- Mark pending conflict.

Recommendation: block by default and allow exceptions only with admin role and audit.

### 4. Model the collector current account as movements

The collector current account is a central component. It should not be modeled only with calculated balances or editable fields.

It must be modeled as an auditable movement ledger.

Possible movements:

- Commission generated.
- Commission settled.
- Payment received by transfer.
- Cash settled.
- Manual adjustment.
- Payment voided.
- Commission voided.
- Balance in favor of the collector.
- Balance in favor of Firefighters.

This is critical to avoid discrepancies between cash, transfers, commissions, and settlements.

### 5. Define states and transitions

The README proposes commercial and financial states, but a formal state machine is missing.

Allowed transitions must be defined, for example:

- `Available in administration` -> `Delivered to collector`.
- `Delivered to collector` -> `Sold`.
- `Delivered to collector` -> `Returned`.
- `Sold` -> `Voided`.
- `Sold` -> `Closed`.
- `Available in administration` -> `Lost`.

Reversions must also be defined:

- Sale entered by mistake.
- Payment incorrectly recorded.
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
5. Bond entry/import.
6. Bond assignment to collectors.
7. Bond sales.
8. Installment plan.
9. Payment recording.
10. Basic settlements.
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
2. Whether the associated number is always calculated the same way across all campaigns.
3. Whether the `+4871` rule should be configurable per campaign.
4. Whether numbers with leading zeros must keep a fixed format, e.g. `0068`.
5. Whether 3, 4, or more digit numbers are allowed within the same campaign.
6. How to resolve a historical number that now belongs to a pata.

### Patas

1. Whether a pata always equals `simple_bond_value x number_of_base_numbers`.
2. Whether a pata assembled from simple bonds can be disassembled after being sold.
3. Whether a pata can be disassembled after payments have been recorded.
4. Whether a pata can be disassembled after participating in draws.
5. How manually assembled patas are printed or documented.

### Payments and settlements

1. How to void an incorrectly entered payment.
2. How to correct an incorrect payment method.
3. Whether a transfer requires an attached receipt.
4. Whether transfer payments must be reconciled against bank movements.
5. Whether a closed settlement can be reopened.
6. What happens if a collector settles less cash than expected.
7. What happens if a collector deducts a different commission than calculated.

### Commissions

1. Exact commission percentage for cash payment.
2. Exact percentage for the first installment.
3. Exact percentage for intermediate installments.
4. Exact percentage for the last installment.
5. Whether the commission is generated when recording the payment or when closing the settlement.
6. Whether the commission can be modified manually.
7. Whether there are collectors with special rules.

### Draws

1. Exact eligibility rule for the final draw.
2. Exact eligibility rule for consolation draws.
3. How extra numbers for the extraordinary draw are calculated.
4. Whether extra numbers should be generated by the system or entered manually.
5. What formal procedure exists for unawarded prizes due to lack of payment.
6. Whether the frozen roster should also include non-enabled entries or only enabled ones.

### Users and access

1. Whether collectors will have their own user accounts.
2. Whether collectors can enter payments directly.
3. Whether administration must approve payments reported by collectors.
4. Whether mobile phone access in the field is needed.
5. Whether it should support poor connectivity or offline mode.

### Data and migration

1. How data will be imported from Excel.
2. Whether an export from the previous system exists.
3. Which historical data is mandatory to start.
4. Whether full previous campaigns will be migrated or only regular numbers.
5. How duplicate buyers will be normalized.

### Documents and reports

1. Whether delivery notes should be PDF, printed A4, Excel, or all of the above.
2. Whether they should have fiscal numbering or only administrative numbering.
3. Whether payment receipts should be given to the buyer.
4. Whether they should be digitally signed or only printed.

## Recommended improvements before technical design

### 1. Create an MVP document

Clearly separate:

- What goes into the first version.
- What is deferred to the second version.
- What remains as nice-to-have only.

### 2. Create main functional flows

Before coding, it is advisable to define step-by-step flows for:

- Create campaign.
- Enter bonds.
- Deliver bonds to collector.
- Record sale.
- Record payment.
- Create settlement.
- Settle commission.
- Generate roster.
- Enter winner.
- Reject prize due to lack of payment.

### 3. Create state machine

Define states and transitions for:

- Bond.
- Installment.
- Payment.
- Settlement.
- Prize.
- Campaign.
- Draw.

### 4. Create preliminary ERD

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
- Import rollback or voiding.

### 6. Define security and permissions

Minimum permissions to define:

- Who can create campaigns.
- Who can change commission rules.
- Who can void payments.
- Who can close settlements.
- Who can generate rosters.
- Who can enter winners.
- Who can modify historical data.

### 7. Define mandatory audit

Actions that must be audited without exception:

- Campaign rule changes.
- Payment entry or voiding.
- Buyer changes.
- Bond assignment and return.
- Settlement closing or reopening.
- Commission settlement.
- Roster generation.
- Winner entry.
- Prize rejection.
- Manual balance adjustments.

## Main risks

### Risk 1: start coding without closing business rules

Impact: high.

It may force redoing the database, validations, and screens.

### Risk 2: mixing calculated balances with real money

Impact: high.

The current account must be reconstructable from auditable movements.

### Risk 3: not freezing draw rosters

Impact: high.

If the roster is dynamically recalculated, late payments could alter historical results.

### Risk 4: not separating commercial and financial state

Impact: medium-high.

A bond can be sold, overdue, delivered, voided, or closed in different dimensions.

### Risk 5: allowing physical deletion of historical information

Impact: high.

For payments, settlements, prizes, and audit, voiding/reversal must be used instead of deletion.

## Final recommendation

Before implementing backend or frontend, it is advisable to resolve in this order:

1. Close numbering and duplicate rules.
2. Define MVP.
3. Define state machine.
4. Define collector ledger and settlements.
5. Define main functional flows.
6. Build preliminary ERD.
7. Only then, define API, screens, and implementation.
