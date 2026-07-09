# Commissions

## Objective

Define how to calculate, confirm, adjust, and audit collector commissions.

## Main Rule

The commission is calculated preliminarily during the open collector settlement and is consolidated when the collector settlement is closed.

## Rule Types

### General Campaign Rule

Applies to all collectors unless a special rule exists.

Examples:

- Cash payment.
- First installment.
- Intermediate installments.
- Last installment.

### Special Rule by Collector

Allows a collector to have different conditions.

Examples:

- Higher percentage by specific agreement.
- Lower percentage.
- Fixed amount.
- Rule valid only for a date or campaign.

### Manual Adjustment

Allows correcting or modifying a calculated commission.

Requirements:

- `commission.adjust` permission.
- Mandatory reason.
- Mandatory audit.
- Associated current account movement.

## Calculation Priority

```txt
1. Active special rule for the collector
2. General campaign rule
3. Authorized manual adjustment
```

The manual adjustment does not replace the original rule; it must be recorded as a difference.

## Normal Flow

```txt
Open collector settlement
↓
User adds payments
↓
System calculates preliminary commission
↓
User reviews
↓
Collector settlement closing
↓
System confirms commission
↓
System creates current account movement
```

## Manual Adjustment Flow in an Open Collector Settlement

```txt
User with permission reviews commission
↓
Enters adjustment
↓
System requires reason
↓
System recalculates summary
↓
When the collector settlement closes, the adjustment is confirmed
```

## Adjustment Flow After a Closed Collector Settlement

```txt
Closed collector settlement
↓
User detects difference
↓
Records commission adjustment with reason
↓
System creates compensating movement
↓
System audits action
```

## Current Account

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

## Minimum Data for a Rule

- Campaign.
- Rule type.
- Percentage or fixed amount.
- Specific collector if applicable.
- Validity period.
- User who created it.
- Status.

## Minimum Data for an Adjustment

- Collector.
- Collector settlement if applicable.
- Payment if applicable.
- Adjustment amount.
- Adjustment direction.
- Reason.
- User.
- Date.
