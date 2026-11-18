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
draft -> annulled
active -> closing
closing -> closed
active -> annulled
```

Rules:

- A closed campaign does not allow normal operations.
- A draft created by mistake is annulled, not deleted.
- A campaign can only be activated with both start and end dates set.
- Activating requires `campaign.update_rules` (it freezes the rules); starting to close, closing and annulling require `campaign.close`. Annulling requires a reason.
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
available -> annulled
sold -> annulled
sold -> closed
```

Rules:

- Manually entered simple bonds and printed patas start as `available`. Imported bonds are created only when their import session is confirmed, also directly as `available` (SAN-44 decision); `created` is currently unused.
- A bond loaded by mistake is annulled (`available -> annulled`: only while available, not while delivered to a collector) with a reason and audit; annulling requires `bond.annul`. Its participating numbers are released so they can be entered again, and the annulled bond and its numbers stay as history. The database records the status a bond was annulled from (`annulled_from_status`); only bonds annulled from `available` release their numbers.
- `sold -> annulled` (annulling a sale) is Phase 10: the bond's numbers stay held (never released), so no other bond can take them.
- `annulled`, `lost` and `closed` have no outgoing transitions; annulled and closed bonds are immutable (except the recalculated financial status).
- Annulling a bond loaded by mistake (`bond_annul`, SAN-23) only applies to `available` simple bonds and printed patas that are not grouped into a manual pata, and only while the campaign is `draft` or `active`. Annulling a sold bond is a Phase 10 correction.
- A simple bond grouped into a manual pata keeps its commercial status but cannot be operated on its own while grouped (there is no `grouped` status).
- A manual pata is not annulled directly: ungrouping it (`bond_ungroup_pata`, `bond.create`, reason required, only while the pata is `available`) marks every membership as ungrouped and moves the pata `available -> annulled` with the same reason. Its members are free again (they never changed status).
- A manual pata leaves `available` (other than by annulment) only with all its members, and can only be ungrouped while `available`.
- A sold bond cannot be reassigned directly.
- A bond with confirmed payments can only be corrected with audited annulment.
- Loss must record responsible party, date, and reason.

## Import session

Implemented in SAN-44 (`import_sessions`, see `docs/data-model.md` and `docs/imports.md`).

States:

```txt
draft
validated
confirmed
cancelled
failed
```

Transitions:

```txt
draft -> validated
validated -> draft
validated -> confirmed
draft -> cancelled
validated -> cancelled
draft -> failed
validated -> failed
```

Rules:

- A session is created in `draft`, only for a `draft` or `active` campaign.
- Validating requires at least one live item and no item `pending` or in `error` (erroneous rows are fixed or soft-removed first). Adding or editing items of a `validated` session returns it to `draft`.
- Confirming requires a `draft`/`active` campaign and every live item linked to the bond it created; bonds are created (as `available`) only in the confirming transaction.
- `confirmed`, `cancelled` and `failed` are final. A confirmed import is never deleted: its functional rollback annuls its bonds (SAN-47) and then records `rolled_back_at`, `rolled_back_by` and a reason on the still-confirmed session.
- Cancelling records who cancelled (reason optional); failing records the failure reason.

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
