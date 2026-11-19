# Commissions

## Objective

Define how to calculate, confirm, adjust, and audit collector commissions.

## Main rule

The commission is calculated provisionally during an open settlement and consolidated when the settlement is closed.

## Rule types

### General campaign rule

Applies to all collectors unless a special rule exists.

Examples:

- Cash payment.
- First installment.
- Intermediate installments.
- Last installment.

### Special collector rule

Allows a collector to have different conditions.

Examples:

- Higher percentage by specific agreement.
- Lower percentage.
- Fixed amount.
- Rule valid only for a specific date or campaign.

### Manual adjustment

Allows correcting or modifying a calculated commission.

Requirements:

- Permission `commission.adjust`.
- Mandatory reason.
- Mandatory audit.
- Associated current account movement.

## Calculation priority

```txt
1. Active collector-specific rule beats a general rule.
2. At equal specificity, custom for the exact installment beats the type rule.
3. Remaining ties use newest valid_from, then greatest rule id.
```

One-installment plans use `installment_first`. The manual adjustment does not replace the
original rule; it is a difference row in `commission_adjustments`, never a rule or a change to
the calculated commission.

## Normal flow

```txt
Open settlement
↓
User adds payments
↓
System calculates provisional commission
↓
User reviews
↓
Settlement closure
↓
System confirms commission
↓
System creates current account movement
```

## Manual adjustment flow during open settlement

```txt
User with permission reviews commission
↓
Enters adjustment
↓
System requires reason
↓
System recalculates summary
↓
Adjustment is confirmed upon settlement closure
```

## Adjustment flow after closed settlement

```txt
Closed settlement
↓
User detects difference
↓
Records commission adjustment with reason
↓
System creates compensatory movement
↓
System audits action
```

## Current account

Every confirmed commission generates a movement:

```txt
entry_type = commission_generated
direction = collector_credit
```

Every settled or paid commission generates:

```txt
entry_type = commission_settled
direction = collector_debit
```

## Minimum rule data

- Campaign.
- Rule type.
- Percentage or fixed amount.
- Specific collector if applicable.
- Validity period.
- User who created it.
- Status.

## Commission rules (SAN-20)

Implemented in `supabase/migrations/20261118000000_commission_rules.sql` (table
`commission_rules`) and the `/campaigns/[id]/commissions` screen. Only **general** rules
(`applies_to_collector_id` null) can be managed for now; special collector rules arrive with
collectors.

Decisions:

- **Rule types**: `cash_full_payment`, `installment_first`, `installment_middle`,
  `installment_last` and `custom`. `custom` targets one specific installment
  (`installment_number`, 1..the campaign's `installment_count`, required); every other type has no
  installment number. Rule precedence is defined in "Calculation priority" above.
- **Value**: exactly one of `percentage` (0 < p <= 100, 2 decimals, typed `25`, `12,5`, `12,50`
  and shown `25 %`, `12,5 %`) or `fixed_amount` (> 0, Argentine money format, shown
  `$ 1.500,00`). Values with more decimals are rejected, never rounded.
- **Validity**: `valid_from` (required) and `valid_to` (optional) are calendar days, both
  inclusive; no `valid_to` = open-ended.
- **No overlaps**: active general rules of the same campaign and type (and same installment
  number for `custom`) cannot have overlapping validity. Enforced by the database
  (`commission_rules_no_overlap`, a `btree_gist` EXCLUDE constraint). Adjacent ranges are fine
  (one ends on March 31, the next starts on April 1). To change a rule from a date on, set an
  end date on the current rule and add a new one.
- **Status**: `active` or `annulled`. Rules are never deleted: they are annulled with a mandatory
  reason, and annulled rules are immutable and no longer block their dates.
- **Campaign status**: rules can be created, edited and annulled while the campaign is `draft` or
  `active`; once it is `closing`, `closed` or `annulled` they are read-only. A draft campaign's
  `installment_count` cannot drop below an active `custom` rule's installment number.
- **Editing**: active rules can be edited (type, installment, value, dates). Every change is
  audited with old and new values. The edit form carries the rule's `updated_at` as loaded
  (hidden `expectedUpdatedAt`): if someone else changed the rule meanwhile, nothing is saved and
  the user is asked to reload (409). Once settlements consume rules (Phase 9), editing a rule that
  was already applied must be blocked in favor of ending it and creating a new one. This requires
  persisting the selected rule with a closed application; until that attribution is added, the
  database cannot reliably distinguish a historical use from a rule which merely matches today,
  so enforcement is a follow-up.
- **Permissions**: viewing requires `commission.view` (RLS); create, edit and annul require
  `commission.rule_manage` and run through `commission_rule_create`, `commission_rule_update`
  and `commission_rule_annul`, which write the change and its `audit_log` row
  (`commission_rule.create|update|annul`, entity type `commission_rule`) in one transaction. Per
  the current matrix only `admin` holds either permission.

## Minimum adjustment data

- Collector.
- Settlement if applicable.
- Payment if applicable.
- Adjustment amount.
- Adjustment direction.
- Reason.
- User.
- Date.

## Collector ledger and settlement close (SAN-68)

The balance is reconstructed as non-annulled `collector_credit` less non-annulled
`collector_debit`; a positive balance is owed by Firefighters to the collector. Closing records
one `commission_generated` credit for the calculated commission and, only when positive, one
`commission_settled` debit for commission retained from cash applications. Transfer commission
remains credit until an explicit `commission_settle`.

`cash_settled` and `transfer_received_by_firefighters` are intentionally not created at close:
their positive amount cannot be represented by one directed ledger row without changing the
commission balance. Payments and closed-settlement snapshots remain the authoritative
cash/transfer trace. `commission_paid_amount` is cash-retained commission,
`net_to_firefighters` is total payment amount less that value, and preliminary
`settlement_totals.collector_credit_balance` is the current reconstructed campaign balance with
this settlement's generated and cash-settled commission applied.

Campaign dates are not currently enforced as a rule-validity boundary; that validation is a
follow-up.

Applied rules: editing a commission rule already used by a closed settlement is not blocked yet,
because settlements do not store which rule was applied to each payment application. Follow-up:
persist the applied rule id per application and block edits/annulments of applied rules (end-date
the rule and create a new one instead). Manual adjustments must be written as difference rows and their matching ledger
entries by the adjustment service; they never modify a rule or computed commission.

## Special collector rules, adjustments and current account (SAN-69)

Migration `20261218000000_collector_commissions_adjustments.sql`.

- **Special rules:** `commission_rule_create` has a 10-argument overload with
  `p_applies_to_collector_id`; the nine-argument general-rule call is unchanged. The collector must
  be active, a rule's collector cannot be changed afterwards, and active special rules of the same
  campaign + type (+ installment) + collector cannot overlap in validity (same rule as general
  rules). Precedence is the SAN-68 order: collector-specific first.
- **`commission_adjust`** (`commission.adjust`): tier-3 manual adjustment. It writes a
  `commission_adjustments` difference row and the matching ledger entry
  (`adjustment_in_favor_of_collector` → credit, `adjustment_in_favor_of_firefighters` → debit) and
  never touches rules or computed commissions.
- **`collector_ledger_adjust`** (`collector.ledger.adjust`): manual current-account credit or debit.
- **`collector_ledger_annul_entry`** (`collector.ledger.adjust`): annuls a `recorded` entry (the
  balance ignores it). Entries created by a closed settlement cannot be annulled; per
  `docs/corrections.md` they are corrected with a compensating adjustment linked to the settlement.
- Every write that can lower the balance takes the same advisory lock as `commission_settle`.
- **`collector_ledger_entries_with_balance`**: entries in order with the running balance, gated like
  the ledger RLS.
- UI: special rules on `/campaigns/[id]/commissions` (and listed on the Collector Record), and the
  Collector Current Account at `/campaigns/[id]/collectors/[collectorId]/ledger` with the manual
  adjustment and annulment forms.
