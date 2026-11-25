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
- Bonds are delivered to collectors (and reassigned) only while the campaign is `active`, never in `draft` (product decision on #47).
- A return (`delivered_to_collector -> returned -> available`) covers the bonds of one collector at a time and issues a return note (a delivery note with reason `return`), the collector's receipt. Return and reassignment from a screen pass the collector the bonds were seen with; if one moved meanwhile, the database refuses (55000).
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
- Confirming requires a `draft`/`active` campaign and every live item linked to the bond it created: a `simple` item maps one-to-one to a simple bond, all rows of a `grupo_pata` map to one printed pata with one row per unit, and no bond of the session is left unlinked. Every bond must be `available` with a complete set of base and associated numbers (one per unit) and the base number (and pata barcode) announced by each row. Bonds are created (as `available`) only in the confirming transaction; an import bond cannot start in `created`.
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
- Financial status precedence is: annulled sale/plan, uncollectible mark, fully paid non-annulled
  installments, overdue unpaid installment, no applied payment, up to date, then partial payments.
- `uncollectible` is set only by hand (SAN-106): `sale_mark_uncollectible` (admin or treasurer,
  mandatory reason, audited as `sale.mark_uncollectible`) marks an active sale once and for good.
  Payments recorded afterwards keep the sale `uncollectible`.

## Sale

`sale_register` sells only a bond held by a collector (`delivered_to_collector -> sold`) in an
active campaign. The collector is the bond's current collector and custody remains open. A sale
creates one active payment plan: full payment has one installment; an installment sale uses the
campaign count and per-unit value. The first due date defaults to the Buenos Aires sale date and
each subsequent date is one calendar month later (end-of-month clamped).

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
draft -> annulled
pending_in_settlement -> confirmed
pending_in_settlement -> annulled
confirmed -> annulled
confirmed -> adjusted
```

Rules:

- A confirmed payment is not edited directly.
- If payment method, amount, or installment changes, an annulment or adjustment is recorded.
- Confirmed payments impact draw eligibility and reports.

Collector-submitted payments (SAN-147, `payments.submitted_by_collector`):

- The collector registers a collection from the portal (`portal_payment_submit`). It is born `draft`, without settlement, with `created_by` = the collector's profile. The collector is resolved from the session, never from the input.
- A `draft` changes no installment, financial snapshot, commission or ledger entry: `settlement_close` only confirms `pending_in_settlement`. It does reserve the installment balance (every payment that is not annulled or adjusted counts), so drafts cannot exceed the installment together.
- The operator/treasurer either includes it in an open settlement of the same collector and campaign (`settlement_attach_collector_payment`: `draft -> pending_in_settlement`, then the normal close confirms it) or rejects it with a mandatory reason (`settlement_reject_collector_payment`: `draft -> annulled`, the reason is stored in `annulment_reason` and shown to the collector).
- `draft -> annulled` is only reachable through that rejection RPC (payments have no direct DML grants). `submitted_by_collector` and `collector_note` are immutable after insert.
- The collector can neither confirm, edit after sending, nor annul. What the collector sees: `draft` is "Enviado", `pending_in_settlement` is "En rendición", `confirmed` is "Confirmado" and a rejected `annulled` one is "Rechazado" with its reason.
- Every submission, inclusion and rejection is written to `audit_log` (`payment.collector_submit`, `payment.collector_attach`, `payment.collector_reject`) with actor and `request_id`.

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

- Balance is calculated from non-annulled entries that affect the balance; `cash_settled` and
  `transfer_received_by_firefighters` are reference entries and never do (SAN-107).
- `recorded -> compensated` happens only when the entries that reference it (`original_entry_id`)
  add up to its amount (SAN-108). Compensated and compensating entries cannot be annulled.
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
roster_generated -> annulled (extraordinary_full_payment only, before freeze; SAN-117)
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
pending_validation -> annulled
awarded -> pending_delivery
pending_delivery -> delivered
delivered -> pending_delivery (audited delivery reversal, SAN-125)
pending_delivery -> annulled
awarded -> annulled
unawarded -> annulled
```

Rules:

- If the bond was not eligible in the frozen roster, the prize remains unawarded.
- Prize delivery must record date, user, and observations.
- Audited annulment requires `prize.annul` (admin only), a reason, and preserves
  original history. It is allowed only from pending validation, awarded, pending
  delivery, or unawarded. Delivered prizes cannot be annulled (decided in SAN-125);
  annulled prizes cannot be annulled again.
- Delivery reversal requires `prize.reverse_delivery` (seeded only for admin) and
  a trimmed 1–1000-code-point reason. It returns the prize to `pending_delivery`
  and the award from `delivered` to `awarded`, retaining its identity and original
  resolution notes. Each former delivery is archived in immutable
  `prize_delivery_reversals` with its original timestamp, actor, notes and full
  award snapshot, plus reversal timestamp/actor/reason. Redelivery starts a new
  current delivery without overwriting history; repeated reversal fails with 55000.
