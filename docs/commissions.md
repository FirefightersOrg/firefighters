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

## Minimum adjustment data

- Collector.
- Settlement if applicable.
- Payment if applicable.
- Adjustment amount.
- Adjustment direction.
- Reason.
- User.
- Date.
