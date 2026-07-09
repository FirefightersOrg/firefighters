# Draw Rules

## Objective

Define functional eligibility rules for MVP draws.

## Draw Types

- Monthly.
- Extraordinary for full payment.
- Final.
- Consolation.

## Monthly Draw

Rule:

```txt
To participate, the required installment for the draw and all previous installments must be paid before the cutoff date.
```

Example:

```txt
December draw
Required installment: 3
Installments 1, 2, and 3 must be paid before the cutoff.
```

## Extraordinary Draw for Full Payment

Rule:

```txt
Participants are those who have paid the full bond before the cutoff date.
```

Extra numbers:

```txt
Simple bond = 1 extra number
Pata (multi-number bond/package) = N extra numbers based on the number of base numbers
```

Example:

```txt
Pata with 5 base numbers
Normal participation: 5 base + 5 associated = 10 numbers
Additional extraordinary participation: 5 extra numbers
```

The extra numbers must remain persisted or frozen in the extraordinary draw roster to justify historical results.

## Final Draw

Defined rule:

```txt
To win the final draw, the bond must be fully paid.
```

Validation must be done against payments confirmed before the cutoff defined for the final draw.

## Consolation Draws

Defined rule:

```txt
Only non-winning bonds that are up to date participate.
```

Conditions:

- Must not have won in previous draws that exclude the bond from consolation.
- Must be up to date according to the required installment or configured consolation rule.
- Must appear as enabled in the frozen draw roster.

## Frozen Draw Roster

All draws must have a frozen draw roster before winners are loaded.

The draw roster must include:

- Enabled entries.
- Disabled entries.
- Reason for being disabled.
- Participant number.
- Bond.
- Buyer.
- Collector.
- Generation date/time.
- Freeze date/time.

## Winner Loading

```txt
Enter winning number
↓
Search in frozen draw roster
↓
Determine associated bond
↓
Verify eligibility
↓
Record result
```

Possible results:

- Eligible winner.
- Prize not awarded due to lack of payment.
- Prize not awarded due to not meeting the draw rule.
- Number with no match.
- Pending review.
