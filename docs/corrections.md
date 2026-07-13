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
