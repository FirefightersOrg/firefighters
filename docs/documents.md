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
