# State machines

## Objective

Define states and allowed transitions for the main entities. Corrections must preserve traceability and avoid loss of history.

## Campaign

States:

```txt
draft
active
closing
closed
annulled
```

Transitions:

```txt
draft -> active
active -> closing
closing -> closed
active -> annulled
```

Rules:

- A closed campaign does not allow normal operations.
- Subsequent corrections require an authorized role and audit.

## Bond

Commercial states:

```txt
created
available
delivered_to_collector
sold
returned
lost
annulled
closed
```

Main transitions:

```txt
created -> available
available -> delivered_to_collector
delivered_to_collector -> sold
delivered_to_collector -> returned
returned -> available
available -> lost
delivered_to_collector -> lost
sold -> annulled
sold -> closed
```

Rules:

- A sold bond cannot be reassigned directly.
- A bond with confirmed payments can only be corrected with audited annulment.
- Loss must record responsible party, date, and reason.

## Bond financial status

Calculated states:

```txt
no_payments
partial_payments
up_to_date
overdue
fully_paid
uncollectible
annulled
```

Rules:

- Financial status is calculated from installments and confirmed payments.
- It must not replace the commercial status.
- A bond can be `sold` and `overdue` at the same time.

## Installment

States:

```txt
pending
paid
paid_advance
overdue
annulled
```

Transitions:

```txt
pending -> paid
pending -> paid_advance
pending -> overdue
overdue -> paid
paid -> annulled
paid_advance -> annulled
```

Rules:

- An installment paid by mistake is not deleted; the associated payment is annulled.
- The overdue state can be calculated based on due date and confirmed payments.

## Payment

States:

```txt
draft
pending_in_settlement
confirmed
annulled
adjusted
```

Transitions:

```txt
draft -> pending_in_settlement
pending_in_settlement -> confirmed
pending_in_settlement -> annulled
confirmed -> annulled
confirmed -> adjusted
```

Rules:

- A confirmed payment is not edited directly.
- If payment method, amount, or installment changes, an annulment or adjustment is recorded.
- Confirmed payments impact draw eligibility and reports.

## Settlement

States:

```txt
open
closed
annulled
corrected
```

Transitions:

```txt
open -> closed
open -> annulled
closed -> corrected
```

Rules:

- An open settlement can be edited.
- A closed settlement is not reopened.
- A closed settlement is not edited directly.
- Any subsequent error is corrected through annulment or audited adjustment.
- Closing confirms payments, commissions, and current account entries.

## Current account entry

States:

```txt
recorded
annulled
compensated
```

Entry types:

```txt
commission_generated
commission_settled
cash_settled
transfer_received_by_firefighters
adjustment_in_favor_of_collector
adjustment_in_favor_of_firefighters
annulment
```

Rules:

- Balance is calculated from non-annulled entries.
- Historical amounts must not be edited directly.

## Draw

States:

```txt
scheduled
roster_generated
roster_frozen
completed
closed
annulled
```

Transitions:

```txt
scheduled -> roster_generated
roster_generated -> roster_frozen
roster_frozen -> completed
completed -> closed
scheduled -> annulled
```

Rules:

- Winners cannot be loaded without a frozen roster, except for audited administrative exception.
- The frozen roster must not be dynamically recalculated.

## Prize

States:

```txt
pending_validation
awarded
pending_delivery
delivered
unawarded
annulled
```

Transitions:

```txt
pending_validation -> awarded
pending_validation -> unawarded
awarded -> pending_delivery
pending_delivery -> delivered
awarded -> annulled
```

Rules:

- If the bond was not eligible in the frozen roster, the prize remains unawarded.
- Prize delivery must record date, user, and observations.
