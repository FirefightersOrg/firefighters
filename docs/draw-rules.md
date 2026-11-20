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

## Implemented in SAN-76

- `src/lib/domain/draw-eligibility.ts` evaluates the four draw types from plain snapshots. It
  only counts `confirmed` payments and sums applications in integer cents.
- Payments have a Buenos Aires calendar `payment_date` but no confirmation timestamp. Eligibility
  therefore compares that date (not `created_at`) with the Buenos Aires calendar day containing
  `payment_cutoff_at`; the cutoff day is inclusive.
- Monthly eligibility covers every installment from 1 through the required number. Extraordinary
  and final eligibility require every plan installment to be fully covered; this treats a
  `full_payment` plan's single installment and a fully covered installment plan consistently.
- Consolation uses its configured required installment when present, otherwise the draw's required
  installment, and excludes any previous win marked as excluding from consolation.
- Ineligibility is returned as a stable code; English and Spanish label maps are separate from the
  frozen value.
- Extraordinary numbers are deterministic: eligible bonds are ordered by lowest base number and
  then bond id, each pata's bases by value and id, and the lowest free campaign values are assigned
  first. Simple bonds receive one; patas receive one per base. Capacity is checked first, so
  exhaustion raises a typed error and returns no partial assignment.
- SAN-76 does not persist these assignments or generate/freeze rosters; SAN-77 owns both operations.
