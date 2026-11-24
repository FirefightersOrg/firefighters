# Printable documents

## Objective

Define MVP operational documents. The first version will use printable HTML. Persistent PDF is left as a future improvement.

## MVP decision

```txt
Initial format: printable HTML
```

Reasons:

- Lower technical complexity.
- Easy to print from the browser.
- Sufficient for administrative delivery notes.
- Can evolve to PDF without changing base data.

## General rule

Structured data must be stored in the database. HTML is only a printable representation.

## Bond delivery note

Must include:

- Institution name.
- Campaign.
- Delivery note number.
- Date.
- Collector.
- User who registers.
- Delivered bonds.
- Bond type.
- Base and associated numbers.
- Barcode if it exists.
- Notes.
- Collector signature.
- Administration signature.

## Settlement delivery note

Must include:

- Campaign.
- Settlement number.
- Opening and closing date.
- Collector.
- User who closes.
- Included payments.
- Bond.
- Buyer.
- Paid installments.
- Payment method.
- Cash total.
- Transfer total.
- Grand total.
- Generated commission.
- Settled commission.
- Manual adjustments.
- Net for Firefighters.
- Resulting collector balance.
- Notes.
- Signatures.

### Settlement print limitations (SAN-65)

- Open notes are marked PRELIMINARY / DRAFT. Annulled and corrected notes carry
  ANULADA / CORREGIDA and NOT VALID on both copies.
- Non-open notes list only currently confirmed payments, but use the stored
  closing totals. Payments annulled after closing can therefore make the printed
  row sum differ from the snapshot, especially on annulled/corrected notes.
  These are not historical reconciliation reports.
- New settlement closes store the resulting collector balance atomically and non-open notes
  show that immutable closing snapshot, never the later live ledger balance. Historical
  settlements without a snapshot show `—` and identify that the balance was not recorded.
- The payment query is not paginated and inherits PostgREST's default 1000-row
  cap. Notes above that size may omit rows even though snapshot totals are intact.

The latter three limitations were explicitly accepted for now in review comment 4635161885. Historical payment membership/balance snapshots and complete pagination
remain follow-up work; do not rely on these notes for historical reconciliation or
settlements exceeding the row cap.

## Payment certificate

Must include:

- Campaign.
- Bond.
- Main participating numbers.
- Buyer.
- Collector.
- Covered installments.
- Amount.
- Payment method.
- Payment date.
- Registration date.
- User who registered.
- Internal receipt number.

Confirmed replacement certificates are printable and identify the original payment. Adjusted
original certificates remain printable as historical documents and identify their replacement.
Annulled certificates remain printable with a prominent invalid legend containing the Buenos
Aires annulment date/time, actor and reason. Corrected certificates show the correction actor,
date, reason and related payment reference.

## Prize delivery certificate

Must include:

- Draw.
- Date.
- Prize.
- Winning number.
- Associated bond.
- Buyer.
- Collector.
- Roster status.
- Delivery date.
- User who registers.
- Notes.
- Recipient signature.

## Unawarded prize certificate

Must include:

- Draw.
- Prize.
- Winning number.
- Associated bond if it exists.
- Buyer if they exist.
- Reason for non-award.
- Roster status.
- User who registers.
- Date.
- Notes.

## Future versioning

In the future, the following can be added:

- PDF generation.
- PDF persistence in storage.
- QR validation code.
- Digital signature or institutional stamp.
