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

## Implemented in SAN-72

Migration `20261220000000_sale_settlement_corrections.sql` and service
`src/lib/server/services/sale-corrections.ts` implement the four sale/bond/settlement
correction flows, without changing any earlier migration.

- **Buyer:** `sale_correct_buyer` requires `sale.correct`, an active sale with a sold
  bond, a different existing buyer, and a trimmed reason of 1–1000 Unicode code
  points. It changes the sale and bond's current buyer while the sale stays active.
  Both complete buyer
  snapshots (including names and document) and the sale snapshots are in the audit.
  Payments retain their historical `buyer_id`; they are not silently reassociated.
- **Collector:** `sale_correct_collector` also requires `sale.correct`. Only the
  destination collector must be active; an inactive original collector does not
  prevent correction. Sale, sold bond and active custody move together. Original
  custody is closed as `reassigned`, never rewritten or deleted, and the new custody
  receives a reassignment delivery note.
- **Open payments:** live payments in an open settlement cause a `55000` asking to
  remove them first. Draft payments must also be resolved before moving the
  collector: their immutable party snapshot must not later enter a settlement of
  the wrong collector. Historical annulled/adjusted payments do not block a move.
- **Collector compensation:** confirmed payments in historical closed (including
  subsequently corrected) settlements retain their collector and settlement
  snapshots. Each payment produces the old collector's commission debit, plus a
  cash-retained commission credit for cash; the new collector receives commission
  credit using **his** rules, plus cash-retained commission debit for cash. Every
  positive movement uses `annulment`; zeros write no row. Positive balance still
  means Firefighters owes the collector. Original settlements remain byte-for-byte
  unchanged, including status, timestamps and totals. Manual commission adjustments
  are not moved: they remain separately attributable historical differences.
- **Attribution and linkage:** the first move reuses SAN-71's
  `payment_correction_commission`; subsequent moves compute the outgoing collector's
  current rule, rather than charging the immutable payment collector again. All
  calculations use each original payment date, SAN-68 precedence and per-application
  rounding. The inherited limitation remains: current rule definitions cannot
  reconstruct a subsequently edited/annulled applied rule. Persisting applied rules
  remains a follow-up, not a new rule snapshot invented by this migration.
  New compensation links through immutable `collector_ledger_entries.corrects_sale_id`
  and actual movement UUIDs in the sale correction audit. Its payment/settlement
  columns are null on **both** sides: the existing cross-collector FK-reference
  guards deliberately remain intact, so the new collector cannot falsely claim
  ownership of the original payment/settlement. These entries cannot be annulled;
  a further correction compensates them.
- **Bond entry point:** `bond_correct_collector` delegates sold bonds to the sale
  correction in the same transaction and produces that single sale audit, requiring
  `sale.correct` (not an additional `bond.assign`). Unsold means
  `delivered_to_collector`, not available/lost/annulled: it requires `bond.assign`
  and an active campaign, reuses `delivery_lock_bonds`, `delivery_require_collector`
  and `delivery_issue_note` plus the existing reassignment custody transitions.
  It intentionally does not call the public `bond_reassign`, which emits two normal
  audits; it writes one nine-field correction audit instead. A bond sold concurrently
  after the initial discovery is refused with `55000`; retry selects the sale path.
  The TS `sold` flag is a required caller state hint for fail-closed permission checks;
  SQL independently chooses the actual path and checks its permission.
- **Settlement design:** `settlement_correct` requires `settlement.correct`. We chose
  a separate immutable `settlement_corrections` record with a unique FK to the
  original settlement, rather than overloading ordinary settlement numbering,
  payment admission and closing with a new kind. The original changes only
  `closed → corrected` and its `updated_at`; the complete row except those two
  fields is compared in pgTAP. Corrected settlements are terminal. Neither direct
  status changes nor updates/deletes of the linked record are permitted. The linked
  record can only be inserted through the closed-settlement correction flag, and a
  deferred constraint requires its original to finish in `corrected` status.
- **Adjustment contract:** `p_adjustments` is an object containing exactly
  `commission_delta` and `cash_retained_delta`, each a signed `numeric(12,2)` amount;
  at least one must be nonzero. Although the SQL parameter has a null default for
  named-call ergonomics, null is rejected: a reason alone cannot invent a monetary
  difference. Deltas are not replacement totals. Corrected commission and retention
  must be nonnegative, and retention must not exceed corrected commission or original
  cash received. Positive commission delta credits the collector; positive retained
  commission delta debits him (negative deltas reverse those directions). Thus cash
  here means **retained commission**, not cash principal; SAN-68 intentionally keeps
  principal amounts out of the commission-balance ledger. Gross cash/transfer totals
  are never edited. Adjustment records are readable under the original settlement's
  RLS, and the linked ledger entries already appear in the current-account report.
  Closed or corrected settlement ledger history cannot be annulled through SAN-69.
- **Locks:** discovery reads are unlocked; sale corrections then lock all existing
  campaign settlements in UUID order, sale payments in UUID order, the sale,
  installments in UUID order, both campaign/collector advisory locks in sorted
  collector UUID order, then the bond and delivery-note sequence. This deliberately
  favors correctness over campaign-wide correction throughput. The sale lock
  serializes admission's sale SHARE lock; after acquiring it, the payment UUID set
  is rechecked to refuse a concurrent admission through a newly created settlement
  (`55000`, reload/retry). Parent/payment locks use `NO KEY UPDATE`: they still
  serialize admission/closing/corrections, but allow FK `KEY SHARE` from manual ledger
  services that already hold the ledger lock. This avoids an FK-induced reverse-lock
  deadlock. Settlement corrections lock their settlement before the same ledger
  advisory lock. pgTAP runs two real dblink sessions proving blocking on **each**
  collector ledger lock and on the settlement correction ledger lock; fixtures and
  audits stay in an uncommitted remote transaction and are rolled back.
- **Later payment corrections:** SAN-71 assumes the historical payment collector
  still owns its commission. After a sale collector move, its payment adjustment or
  annulment therefore fails safely with `55000` instead of debiting the wrong
  collector twice. Correct the sale collector back first, then correct the payment
  and reapply the sale move if needed. Attribution-aware payment corrections across
  collector moves are a documented follow-up. Buyer-only corrections do not impose
  this restriction.
- **Security/audit:** all new public RPCs are audited `SECURITY DEFINER` functions
  with empty `search_path`; only authenticated gets EXECUTE. Internal helpers and
  trigger functions have no API EXECUTE. Financial tables have no API-role DML or
  write RLS; legacy nonfinancial bond/delivery service-role grants are unchanged.
  Transaction-local sale/settlement UUID flags are restored before return and permit
  only their narrow guard paths; setting a GUC alone gives authenticated no DML.
  Each successful public call writes exactly one audit with the nine minimum fields,
  old/new snapshots, trimmed reason, actor and request ID. Request IDs correlate
  requests, not idempotency keys; same-target corrections fail validation and a
  second settlement correction fails state validation with no extra entries/audit.
- **TypeScript/testing:** explicit `{ requestId, permissions }` context fails closed
  before any RPC; Zod validates UUIDs, code-point reasons and signed decimal-cent
  deltas without doing money arithmetic in JS. SQLSTATEs use the existing settlement
  error mapper (400/403/404/409/500). No routes or UI were added. pgTAP `034` covers
  all flows, exact per-collector ledger effects/balances, full settlement equality,
  scoped denial atomicity, inactive targets/source, audit fields, table grants and
  real concurrency. Existing `008`/`021` truncate lists now include the linked
  adjustment table, `027` uses the audited closed-to-corrected transition, and `030`
  acknowledges the immutable sale-compensation reference; their plans are unchanged.

Validation on the local database after a fresh reset, with pgTAP **before**
integration: `supabase test db` passed **34 files / 2102 assertions** (`034` plan:
**103**, including two-session dblink cases); `pnpm test:integration` passed
**21 files / 181 tests** after `pnpm seed:admin`; `pnpm check` reported **0 errors /
0 warnings**; `pnpm lint` passed; `pnpm test` passed **99 files / 1379 tests**.

## Implemented in SAN-73

- Sale, bond, payment and closed-settlement record pages expose permission-gated, progressively
  enhanced HTML forms for the SAN-71/72 RPCs. Reasons are required and validated by the service
  at 1000 Unicode code points; no native `maxlength` is used because it counts UTF-16 code units.
- Correction panels include an explicitly **indicative** ledger preview. Closed-settlement deltas
  can be shown exactly from the entered signed amounts. Payment and cross-collector previews
  describe direction and rule effects where the loaded record does not contain enough immutable
  rule-attribution data to reproduce an amount. This is intentional: SAN-71/72 document that
  current rules cannot reconstruct rules edited after a historical payment, and PostgreSQL
  numeric calculation and the generated movement ids remain authoritative. No read-only SQL
  preview RPC or migration was added.
- `/campaigns/[id]/audit` requires `audit.view`, fails closed when permissions are unavailable,
  filters actor/action/entity/date using Buenos Aires day boundaries, and uses explicit 50-row
  ranges ordered by `created_at, id`. Detail renders an old/new field diff, correction movement
  ids, and affected-record links. Campaign scoping accepts the campaign entity itself and
  snapshots whose top-level old/new value contains `campaign_id`; legacy audit snapshots that
  omitted campaign identity cannot be safely attributed and are intentionally excluded.
- The reassociation form accepts one destination installment per submission. The SAN-71 service
  and RPC still accept multiple applications; expanding the no-JavaScript UI to add arbitrary
  application rows is a known follow-up.

### Known follow-up (SAN-71 review): cash/transfer totals of a corrected closed settlement

When a payment method is corrected (cash ↔ transfer) for a payment of a **closed** settlement, the
settlement's `total_cash` / `total_transfer` stay as the closing snapshot (closed totals are never
edited), and `settlement_correct` (SAN-72) only records `commission_delta` / `cash_retained_delta`.
So those two totals do **not** reflect the corrected method. Reports by payment method must not
read them as live data: derive cash/transfer from the payments (non-adjusted originals excluded,
replacements included). A way to record cash/transfer deltas on the settlement correction is a
follow-up.

### Known limitation (SAN-72 review): payment corrections after a collector move

After `sale_correct_collector` moves a sale, its historical payments still carry the original
collector. Annulling or correcting one of them would post compensation to the wrong collector, so
the `moved_payment_correction_guard` trigger refuses it (55000, shown as a 409 conflict with the
message "This payment's sale was moved to another collector. Correct the sale collector back
before annulling or correcting this payment."). Making payment corrections collector-aware is a
follow-up.
