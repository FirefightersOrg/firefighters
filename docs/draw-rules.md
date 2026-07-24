# Draw rules

## Objective

Define functional eligibility rules for MVP draws.

## Draw types

- Monthly.
- Extraordinary for full payment.
- Final.
- Consolation.

## Monthly draw

Rule:

```txt
To participate, the required installment for the draw and all previous ones must be paid before the cutoff date.
```

Example:

```txt
December draw
Required installment: 3
Installments 1, 2, and 3 must be paid before the cutoff.
```

## Extraordinary draw for full payment

Rule:

```txt
Those who have paid the full bond before the cutoff date participate.
```

Extra numbers:

```txt
Simple bond = 1 extra number
Pata = N extra numbers based on the quantity of base numbers
```

Example:

```txt
Pata with 5 base numbers
Normal participation: 5 base + 5 associated = 10 numbers
Additional extraordinary participation: 5 extra numbers
```

Extra numbers must be persisted or frozen in the extraordinary draw roster to justify historical results.

## Final draw

Defined rule:

```txt
To win the final draw, the bond must be fully paid.
```

Validation must be done against confirmed payments before the cutoff defined for the final draw.

## Consolation draws

Defined rule:

```txt
Only non-winning bonds that are up to date participate.
```

Conditions:

- Not having won in previous draws that exclude from consolation.
- Being up to date per required installment or configured consolation rule.
- Appearing as enabled in the frozen roster.

## Frozen roster

All draws must have a frozen roster before loading winners.

The roster must include:

- Enabled.
- Not enabled.
- Reason for non-enablement.
- Participating number.
- Bond.
- Buyer.
- Collector.
- Generation date/time.
- Freeze date/time.

## Winner loading

```txt
Enter winning number
↓
Search in frozen roster
↓
Determine associated bond
↓
Verify enablement
↓
Register result
```

Possible results:

- Enabled winner.
- Prize not awarded due to lack of payment.
- Prize not awarded for not meeting draw rule.
- No matching number.
- Pending review.
