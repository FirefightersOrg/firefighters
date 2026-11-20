# Annulments and corrections

## Objective

Define secure flows for correcting errors without deleting history.

## General principle

```txt
Do not delete sensitive historical information.
Annul, adjust, or compensate with audit.
```

## Incorrectly loaded payment

```txt
Confirmed payment
↓
User requests annulment
↓
System requires reason
↓
System annuls payment
↓
System reverts state of affected installments
↓
System generates compensatory commission movement if applicable
↓
System records audit
```

Rules:

- If the payment was in a closed settlement, the original settlement is not modified.
- A correction linked to the settlement is created.

## Incorrect payment method

```txt
Payment confirmed with incorrect method
↓
User requests correction
↓
System requires reason
↓
System records payment method adjustment
↓
System recalculates impact on cash, transfer, and current account
↓
System generates compensatory movements
```

Example:

- If it was cash and should have been a transfer, it changes the cash impact and may change the collector's balance.

## Sale with wrong buyer

```txt
Registered sale
↓
System checks if it has confirmed payments
↓
If no confirmed payments, allows authorized correction
↓
If it has confirmed payments, requires audited correction with reason
↓
System preserves historical snapshot
```

Rules:

- If there have already been settlements or prizes, the correction must require an authorized role.
- The originally registered buyer must not be lost.

## Bond sold by wrong collector

```txt
Detect incorrect collector
↓
System checks associated settlements
↓
If no closed settlements, allows authorized correction
↓
If there are closed settlements, generates adjustment between collectors
↓
System records audit
```

Rules:

- Do not move historical commissions without a compensatory movement.
- If the error affects the current account, create movements for both collectors.

## Closed settlement with difference

```txt
Closed settlement
↓
User records correction with reason
↓
System creates adjustment linked to the original settlement
↓
System generates compensatory movements
↓
System updates calculated balances
```

Rules:

- Do not reopen the settlement.
- Do not edit original totals.
- The adjustment must appear in the current account and reports.

## Incorrectly calculated commission

```txt
Detect difference
↓
User with permission records commission adjustment
↓
System requires reason
↓
System creates current account movement
↓
System audits action
```

## Incorrectly loaded prize

```txt
Registered prize
↓
Authorized user requests annulment
↓
System requires reason
↓
System marks previous result as voided
↓
User loads correct result if applicable
↓
System preserves both events in audit
```

## Bond assigned to wrong collector

```txt
Assignment registered
↓
If bond was not sold, allow audited reassignment
↓
If bond was sold, correct sale and assignment with authorized role
↓
If there were payments/settlements, generate necessary adjustments
```

## Incorrectly associated transfer

```txt
Transfer associated with incorrect payment
↓
User requests correction
↓
System annuls previous association
↓
System associates transfer with correct payment
↓
System adjusts installments, commissions, and current account
↓
Audit
```

## Minimum correction fields

- Correction type.
- Affected entity.
- Related entity.
- Reason.
- User.
- Date.
- Previous value.
- New value.
- Generated compensatory movements.

## Implemented in SAN-71

Migration `20261219000000_payment_corrections.sql` exposes `payment_annul`,
`payment_correct_method` and `payment_reassociate_transfer`. All three require
`payment.annul`: there is no separate payment-method or association permission in the
permission catalog. Open-settlement annulment uses that permission, not
`settlement.update_open`, and writes its own single correction audit rather than calling
the older removal RPC and duplicating its audit.

- **History:** confirmed annulment transitions to `annulled`; method correction and
  reassociation transition the original to `adjusted` and create a new `confirmed` payment.
  Nullable, immutable, unique `replaces_payment_id` links each replacement to its original;
  replacement chains are allowed, but correcting an already adjusted/annulled original is
  rejected. Original applications remain immutable. Both annulled and adjusted payments are
  excluded from reservation/coverage checks; only confirmed payments count for paid status.
- **Settlements:** a replacement retains the original settlement link, amount and payment
  date; closed settlement rows are never updated, not even their status or `updated_at`.
  Historical cash/transfer totals remain snapshots, not corrected live totals.
- **Methods:** a replacement keeps sale, buyer, collector, campaign and applications.
  Installments and bond snapshots are untouched because coverage is unchanged.
  Cash → transfer credits back cash-retained commission; transfer → cash debits that commission.
- **Reassociation:** only a confirmed transfer can move to a different active sale of the
  same campaign and collector. The new buyer comes from that sale. Applications must be a
  nonempty, duplicate-free array, sum exactly to the payment amount, belong to the active
  destination plan and fit each installment's remaining amount, including pending/draft
  reservations. Destination annulled installments are rejected.
- **Installments:** annulment/reassociation recompute affected old and new installments from
  remaining confirmed coverage. Insufficient coverage becomes `overdue` when due before
  Buenos Aires today, otherwise `pending`; sufficient coverage becomes `paid_advance` when
  due after today, otherwise `paid`. Annulled installments remain annulled. Both bonds use
  the existing `bond_financial_status_from_installments` helper, including its current
  `no_payments` precedence when no installment remains fully paid; revisiting that helper's
  precedence is outside this correction migration. Pending-payment annulment does not change
  installments or ledger.
- **Ledger:** positive balance means Firefighters owes the collector. All correction rows use
  `entry_type = annulment`, including credits for replacement commission. Confirmed annulment
  debits generated commission and, for cash only, credits retained commission. Reassociation
  debits old commission and credits new commission, which can differ by destination rule.
  Method changes post only the retained-commission difference. Zero amounts produce no
  ledger rows. Existing ledger rows and manual adjustments are not rewritten or annulled;
  no principal cash/transfer movements are posted (SAN-68).
- **Commission attribution:** each payment's commission is the sum of
  `settlement_application_commission` over its applications at its original payment date,
  using **current** rule definitions and the SAN-68 precedence/rounding. Persisting and
  locking the actually applied rule is the known follow-up; these RPCs cannot reconstruct
  rules that were subsequently edited or annulled.
- **Concurrency/security:** audited `SECURITY DEFINER`, empty `search_path`, API execute
  granted only to authenticated, explicitly revoked from public/anon/service_role. Private
  helpers are not executable by any API role. Lock order is settlement → original payment →
  union of old/new installments sorted by UUID → SAN-68 campaign+collector advisory lock.
  All validation and compensation are atomic, and repeated corrections fail by state
  rather than treating request ids as idempotency keys.
- **Narrow guard path:** only the private RPC sets transaction-local
  `app.payment_correction` to the original payment UUID. Replacement insert checks the
  adjusted original and matching immutable fields; confirmed application insert requires
  that replacement link; installment reversion is limited to that correction's applications.
  The flag is restored before returning. API roles retain no table DML grants, so a
  caller-set custom GUC grants no write access. Direct confirmed adjustment/annulment and
  replacement-link mutation are additionally guarded. No older migration is modified.
- **Audit:** exactly one `payment.annul`, `payment.correct_method` or
  `payment.reassociate_transfer` row per correction. `new_value` carries all nine fields:
  `correction_type`, `affected_entity` (type/id), `related_entity` (settlement for annulment,
  replacement payment otherwise), `reason`, `user`, `date`, `previous_value`, `new_value`
  and `generated_compensatory_movements` (actual ledger UUIDs, or an empty array).
  Previous payment/application snapshots also populate `old_value`; the trimmed reason
  populates the audit reason column, with request correlation in `request_id`.
- **TypeScript:** `src/lib/server/services/payment-corrections.ts` requires an explicit
  `{ requestId, permissions }` context, fails closed for unavailable permissions, validates
  UUIDs, methods, positive `numeric(12,2)` application amounts and reasons with Zod, and maps
  SQLSTATE errors consistently with settlement services. Reasons are trimmed, nonblank and
  limited to 1000 Unicode code points, not UTF-16 code units.
- **Regression coverage:** pgTAP `033_payment_corrections` covers exact compensation,
  balance, coverage, bond snapshots, full-row closed-settlement equality, permission/validation
  atomicity, audit fields and direct-DML guards. SAN-62 test `027` acknowledges the added
  column and uses the privileged correction flag only for its underlying state-machine
  fixture; API and unflagged writes are independently denied in `033`.
  Tests `027`, `031` and `033` use Buenos Aires transaction-local timezone for fixture
  dates, avoiding UTC-midnight mismatches with the payment-date default.

### Known follow-up (SAN-71 review): cash/transfer totals of a corrected closed settlement

When a payment method is corrected (cash ↔ transfer) for a payment of a **closed** settlement, the
settlement's `total_cash` / `total_transfer` stay as the closing snapshot (closed totals are never
edited), and `settlement_correct` (SAN-72) only records `commission_delta` / `cash_retained_delta`.
So those two totals do **not** reflect the corrected method. Reports by payment method must not
read them as live data: derive cash/transfer from the payments (non-adjusted originals excluded,
replacements included). A way to record cash/transfer deltas on the settlement correction is a
follow-up.
