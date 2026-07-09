# State Machines

## Objective

Define allowed states and transitions for the main entities. Corrections must preserve traceability and avoid loss of history.

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
- Later corrections require an authorized role and audit.

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

- A sold bond cannot be directly reassigned.
- A bond with confirmed payments can only be corrected with an audited annulment.
- Loss or misplacement must record responsible party, date, and reason.

## Bond Financial State

Calculated states:

```txt
no_payments
with_partial_payments
up_to_date
overdue
fully_paid
uncollectible
annulled
```

Rules:

- Financial state is calculated from installments and confirmed payments.
- It must not replace commercial state.
- A bond may be `sold` and `overdue` at the same time.

## Installment

States:

```txt
pending
paid
paid_early
overdue
annulled
```

Transitions:

```txt
pending -> paid
pending -> paid_early
pending -> overdue
overdue -> paid
paid -> annulled
paid_early -> annulled
```

Rules:

- An installment paid by mistake is not deleted; the associated payment is annulled.
- The overdue state may be calculated based on due date and confirmed payments.

## Payment

States:

```txt
draft
pending_in_collector_settlement
confirmed
annulled
adjusted
```

Transitions:

```txt
draft -> pending_in_collector_settlement
pending_in_collector_settlement -> confirmed
pending_in_collector_settlement -> annulled
confirmed -> annulled
confirmed -> adjusted
```

Rules:

- A confirmed payment is not edited directly.
- If payment method, amount, or installment changes, an annulment or adjustment is recorded.
- Confirmed payments affect draw eligibility and reports.

## Collector Settlement

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

- An open collector settlement can be edited.
- A closed collector settlement is not reopened.
- A closed collector settlement is not edited directly.
- Every later error is corrected through an audited annulment or adjustment.
- Closing confirms payments, commissions, and collector ledger entries.

## Collector Ledger Entry

States:

```txt
registered
annulled
offset
```

Entry types:

```txt
commission_generated
commission_settled
cash_submitted
transfer_received_by_firefighters
adjustment_in_favor_of_collector
adjustment_in_favor_of_firefighters
annulment
```

Rules:

- The balance is calculated from non-annulled entries.
- Historical amounts must not be edited directly.

## Draw

States:

```txt
scheduled
draw_roster_generated
draw_roster_frozen
held
closed
annulled
```

Transitions:

```txt
scheduled -> draw_roster_generated
draw_roster_generated -> draw_roster_frozen
draw_roster_frozen -> held
held -> closed
scheduled -> annulled
```

Rules:

- Winners are not loaded without a frozen draw roster, except for an audited administrative exception.
- The frozen draw roster must not be recalculated dynamically.

## Prize

States:

```txt
pending_validation
awarded
pending_delivery
delivered
not_awarded
annulled
```

Transitions:

```txt
pending_validation -> awarded
pending_validation -> not_awarded
awarded -> pending_delivery
pending_delivery -> delivered
awarded -> annulled
```

Rules:

- If the bond was not eligible in the frozen draw roster, the prize remains not awarded.
- Prize delivery must record date, user, and note.
