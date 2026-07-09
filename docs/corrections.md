# Voiding and Corrections

## Objective

Define safe flows to correct errors without deleting history.

## General Principle

```txt
Do not delete sensitive historical information.
Void, adjust, or compensate with audit.
```

## Incorrectly Loaded Payment

```txt
Confirmed payment
↓
User requests voiding
↓
System requires reason
↓
System voids payment
↓
System reverts status of affected installments
↓
System generates compensating commission movement if applicable
↓
System records audit
```

Rules:

- If the payment was in a closed collector settlement, the original collector settlement is not modified.
- A correction linked to the collector settlement is created.

## Incorrect Payment Method

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
System generates compensating movements
```

Example:

- If it was cash and should have been transfer, the cash impact changes and the collector's credit balance may change.

## Sale with Wrong Buyer

```txt
Registered sale
↓
System verifies whether it has confirmed payments
↓
If it has no confirmed payments, allows authorized correction
↓
If it has confirmed payments, requires audited correction with reason
↓
System preserves historical snapshot
```

Rules:

- If there have already been collector settlements or prizes, the correction must require an authorized role.
- The originally registered buyer must not be lost.

## Bond Sold by Wrong Collector

```txt
Detect incorrect collector
↓
System verifies associated collector settlements
↓
If there are no closed collector settlements, allows authorized correction
↓
If there are closed collector settlements, generates adjustment between collectors
↓
System records audit
```

Rules:

- Do not move historical commissions without a compensating movement.
- If the error affects the current account, create movements for both collectors.

## Closed Collector Settlement with Difference

```txt
Closed collector settlement
↓
User records correction with reason
↓
System creates adjustment linked to original collector settlement
↓
System generates compensating movements
↓
System updates calculated balances
```

Rules:

- Do not reopen collector settlement.
- Do not edit original totals.
- The adjustment must appear in the current account and reports.

## Incorrectly Calculated Commission

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

## Incorrectly Loaded Prize

```txt
Prize registered
↓
Authorized user requests voiding
↓
System requires reason
↓
System marks previous result as voided
↓
User loads correct result if applicable
↓
System preserves both events in audit
```

## Bond Assigned to Wrong Collector

```txt
Assignment registered
↓
If bond was not sold, allow audited reassignment
↓
If bond was sold, correct sale and assignment with authorized role
↓
If there were payments/collector settlements, generate necessary adjustments
```

## Incorrectly Associated Transfer

```txt
Transfer associated to incorrect payment
↓
User requests correction
↓
System voids previous association
↓
System associates transfer to correct payment
↓
System adjusts installments, commissions, and current account
↓
Audit
```

## Minimum Fields for a Correction

- Correction type.
- Affected entity.
- Related entity.
- Reason.
- User.
- Date.
- Previous value.
- New value.
- Generated compensating movements.
