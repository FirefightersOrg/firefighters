# Printable Documents

## Objective

Define MVP operational documents. The first version will use printable HTML. Persistent PDF remains a future improvement.

## MVP Decision

```txt
Initial format: printable HTML
```

Reasons:

- Lower technical complexity.
- Easy to print from the browser.
- Sufficient for administrative receipts.
- Can evolve to PDF without changing the base data.

## General Rule

Structured data must be stored in the database. The HTML is only a printable representation.

## Bond Delivery Receipt

Must include:

- Institution name.
- Campaign.
- Receipt number.
- Date.
- Collector.
- User who records it.
- Delivered bonds.
- Bond type.
- Base and associated numbers.
- Barcode if it exists.
- Notes.
- Collector signature.
- Administration signature.

## Collector Settlement Receipt

Must include:

- Campaign.
- Collector settlement number.
- Opening and closing date.
- Collector.
- User who closes it.
- Included payments.
- Bond.
- Buyer.
- Paid installments.
- Payment method.
- Total cash.
- Total transfer.
- Grand total.
- Generated commission.
- Settled commission.
- Manual adjustments.
- Net amount for Firefighters.
- Collector resulting balance.
- Notes.
- Signatures.

## Payment Receipt

Must include:

- Campaign.
- Bond.
- Main participant numbers.
- Buyer.
- Collector.
- Covered installments.
- Amount.
- Payment method.
- Payment date.
- Registration date.
- User who recorded it.
- Internal receipt number.

## Delivered Prize Receipt

Must include:

- Draw.
- Date.
- Prize.
- Winning number.
- Associated bond.
- Buyer.
- Collector.
- Status in draw roster.
- Delivery date.
- User who records it.
- Notes.
- Recipient signature.

## Prize Not Awarded Receipt

Must include:

- Draw.
- Prize.
- Winning number.
- Associated bond if it exists.
- Buyer if it exists.
- Reason for not awarding.
- Status in draw roster.
- User who records it.
- Date.
- Notes.

## Future Versioning

In the future, the following can be added:

- PDF generation.
- PDF persistence in storage.
- Validation QR code.
- Digital signature or institutional seal.
