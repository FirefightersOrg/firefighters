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
1. Active special collector rule
2. General campaign rule
3. Authorized manual adjustment
```

The manual adjustment does not replace the original rule; it must be recorded as a difference.

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
  installment number. Which rule wins when several match a payment (for example `custom` #1 vs
  `installment_first`) is decided by the calculation in Phase 9.
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
  was already applied should probably be blocked in favor of ending it and creating a new one.
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
