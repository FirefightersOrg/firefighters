# Business Model — Firefighters Bond/Raffle Management System

## 1. System objective

The system's objective is to replace the current obsolete system and manual Excel controls with a modern, efficient, and intuitive web application to comprehensively manage the raffles/bonds of the Volunteer Firefighters.

The system must allow managing the entire lifecycle of an annual bond campaign:

1. Create a new annual campaign.
2. Load simple bonds and "pata" type bonds.
3. Assign bonds to sellers/collectors.
4. Register sales to buyers.
5. Register full payments, installment payments, and advance payments.
6. Monitor collections and collector settlements.
7. Calculate commissions.
8. Monitor balances in favor of collectors or Firefighters.
9. Manage monthly draws, extraordinary draws, consolation draws, and final draw.
10. Determine whether a bond is eligible to participate/collect a prize.
11. Register winners and prizes.
12. Issue delivery notes, certificates, reports, and backups.

The application will be web-based and should be designed to be accessible from different devices.

---

## 2. Business terminology

To avoid confusion, these terms should be standardized within the system.

| Term | Meaning |
|---|---|
| Campaign | Annual period of the bond/raffle. Example: "Contribution Bond 2025-2026". |
| Draw | Specific event within a campaign. It can be monthly, final, consolation, or extraordinary. |
| Bond | Physical card sold to a buyer. It can be simple or pata. |
| Simple bond | Individual bond with one visible base number and one calculated associated number. |
| Pata | Bond with multiple base numbers. Sold as a larger commercial unit, usually to companies or businesses. |
| Base number | Main number printed on the bond. |
| Associated number | Number calculated from the base number by adding 4871. |
| Participating number | Any number that participates in draws: base number or associated number. |
| Buyer | Person, business, or company that purchases a bond. |
| Collector / Seller | Person who receives bonds, sells them, collects installments, and settles with Firefighters. |
| Bond delivery | Administrative act by which Firefighters delivers physical bonds to a collector. |
| Sale | Act by which a bond becomes associated with a buyer. |
| Payment | Record of money paid by a buyer. It can be cash or transfer. |
| Settlement | Act by which a collector reports payments, delivers money, and their commission is calculated. |
| Commission | Percentage or amount corresponding to the collector for the sale/collection. |
| Commission settlement | Actual payment of accumulated commissions in favor of the collector. |
| Draw roster | Frozen list of bonds/numbers eligible to participate in a draw. |

---

## 3. Campaigns

A campaign represents the complete annual period of a bond edition.

Example:

```text
Campaign: Contribution Bond 2025-2026
Simple bond value: $60,000
Number of installments: 10
Value of each installment: $6,000
```

A campaign contains:

- Simple bonds.
- Pata type bonds.
- Buyers.
- Collectors.
- Bond deliveries.
- Sales.
- Payments.
- Settlements.
- Monthly draws.
- Extraordinary draw for full payment.
- Consolation draws.
- Final draw.
- Prizes.
- Commission rules.
- Eligibility rules.

### 3.1. Annual cycle of a campaign

The general flow is:

```text
1. The previous campaign ends.
2. The new campaign is created.
3. Printed bonds arrive.
4. Simple bonds and patas are loaded into the system.
5. Historical buyer numbers from the previous year are reviewed.
6. Bonds are assigned to collectors.
7. Collectors take the physical bonds.
8. Collectors sell the bonds.
9. Collectors settle sales and payments with administration.
10. Administration registers buyers, payments, installments, and payment methods.
11. The system calculates commissions and balances.
12. Monthly draw rosters are generated.
13. Winning numbers are loaded.
14. The system validates whether the winning bond was eligible.
15. Prizes are registered.
16. At the end of the period, the campaign is closed.
```

---

## 4. Bonds

The bond is the sellable unit of the system.

A bond can be:

1. Simple bond.
2. Pata type bond.

Both are bonds. The difference lies in the quantity of base numbers they contain and, consequently, in their value.

---

## 5. Simple bond

A simple bond has:

- A base number.
- A calculated associated number.
- A buyer, if it was sold.
- An assigned collector.
- A payment plan.
- Installments.
- Payments.
- Commercial status.
- Financial status.

Real observed example:

```text
Base number: 1658
Associated number: 6529
```

The relationship is:

```text
1658 + 4871 = 6529
```

Therefore:

```text
associated_number = base_number + 4871
```

### 5.1. Main rule of the simple bond

Although it may visually appear that the bond has two independent numbers, it actually has:

```text
1 base number
+
1 automatically calculated associated number
```

The bond buyer participates with both numbers.

Example:

```text
Bond 1658

Participates with:
- 1658
- 6529
```

If either of those two numbers is drawn, the winner is the same bond.

```text
If 1658 is drawn → Bond 1658 wins
If 6529 is drawn → Bond 1658 wins
```

The system must avoid interpreting those numbers as two distinct bonds.

---

## 6. Associated number +4871

All bonds use an associated number logic.

Rule:

```text
associated number = base number + 4871
```

This rule must be configurable in the system, ideally at the campaign level, so it is not hardcoded.

### 6.1. Operational objective

The associated number is linked to the same bond. The objective is for the same bond to have more than one chance of being drawn without generating a double prize assignment to two different bonds.

### 6.2. Duplicate validation

The system must validate that a participating number is not repeated within the same campaign.

Participating number means:

- base number,
- calculated associated number.

Example of a problematic situation:

```text
Bond A:
base 1658
associated 6529

Bond B:
base 6529
associated 11400
```

In this case, the number 6529 would be linked to two different bonds. The system should prevent this, warn about it, or require an administrative resolution.

### 6.3. Pending question about the 4-digit limit

It still needs to be confirmed what happens when:

```text
base_number + 4871 > 9999
```

Example:

```text
7000 + 4871 = 11871
```

Possible rules to confirm:

1. Base numbers that high are never used.
2. The last 4 digits are taken.
3. There is a maximum allowed range for base numbers.
4. The campaign can work with more than 4 digits in certain cases.

Until this rule is confirmed, the system must treat it as a pending validation.

---

## 7. "Pata" type bonds

A pata is a printed bond that has multiple base numbers.

It should not be modeled as many separate bonds, but as:

```text
1 pata type bond
+
multiple base numbers
+
multiple calculated associated numbers
```

Conceptual example:

```text
Pata 1200

Base numbers:
- 1200
- 1315
- 2200
- 3100
- 4500

Associated numbers:
- 6071
- 6186
- 7071
- 7971
- 9371
```

If a pata has 5 base numbers, it participates with 10 total numbers.

### 7.1. Sale of patas

Patass are sold as a single unit.

They are usually sold to companies, businesses, or large buyers because they have more numbers and, therefore, greater value.

### 7.2. Value of a pata

The value of a pata must depend on the quantity of commercial units/numbers it contains.

Probable rule, pending exact confirmation:

```text
Simple bond = 1 commercial unit = 1 base number + 1 associated number
Pata = N commercial units
Pata value = simple bond value × N
```

Example:

```text
Simple bond:
1 base number
1 associated number
Value: $60,000

Pata with 5 base numbers:
5 base numbers
5 associated numbers
Probable value: $300,000
```

This rule must be confirmed with administration or the previous system before being definitively implemented.

---

## 8. Creation of new patas

In addition to printed patas, it may be necessary to assemble a new pata by grouping several simple bonds.

This happens when:

- no printed patas are available,
- a buyer wishes to purchase multiple numbers,
- a company or business requests a pata.

In that case, the system must allow grouping simple bonds.

### 8.1. Traceability rule

When a pata is assembled from simple bonds, the original identity of those bonds must not be lost.

The system must record:

- which simple bonds were grouped,
- when they were grouped,
- who performed the grouping,
- for which collector or buyer they were grouped,
- whether they were later ungrouped,
- reason for grouping or ungrouping.

### 8.2. Sale of an assembled pata

Even if assembled from simple bonds, it must be commercially sellable as a single pata/package.

---

## 9. History and number reservation

An important business characteristic is that many buyers want to keep the same number every year.

Therefore, when starting a new campaign, the system should attempt to assign each collector the same numbers they sold the previous year to the same buyers.

### 9.1. Historical reservation

The system should record the number history per buyer.

Example:

```text
Buyer: Diego Fernández
Usual number: 0068
Usual collector: Juan Pérez
Last campaign: 2024-2025
```

When loading the new campaign, the system should help detect:

```text
Number 0068 is available.
It can be reassigned to the historical buyer.
```

Or:

```text
Number 0068 this year belongs to a pata.
It is not available as a simple bond.
An alternative number must be offered.
```

### 9.2. Conflict with patas

It may happen that a number historically purchased by a person now belongs to a pata.

In that case:

1. The number is not assigned to the historical buyer.
2. Another number is assigned to the collector.
3. The collector informs the buyer that their usual number is not available.
4. The reassignment is recorded to maintain traceability.

---

## 10. Bond assignment to collectors

Before the campaign begins, Firefighters delivers physical bonds to collectors.

This delivery must be formally recorded in the system.

### 10.1. Bond delivery

A delivery must contain:

- delivery/delivery note number,
- date,
- collector,
- admin user who recorded it,
- list of delivered bonds,
- observations,
- status,
- printing capability.

Example:

```text
Delivery Note N° 000123
Date: 01/09/2025
Collector: Juan Pérez

Bonds delivered:
- Bond 0068
- Bond 0100
- Pata 1200
- Pata 1300
```

### 10.2. Bond status after delivery

When delivered to a collector:

```text
Available in administration
→ Delivered to collector
```

This does not mean the bond is sold.

It only means the collector physically has the bond.

### 10.3. Return or unassignment

There must be the ability to:

- return bonds to administration,
- unassign bonds from a collector,
- reassign bonds to another collector,
- record loss/lost status,
- annul an erroneous assignment.

All these actions must be audited.

---

## 11. Bond sales

A sale occurs when the collector reports that a bond was sold to a buyer.

The sale must record:

- bond sold,
- collector who sold it,
- buyer,
- sale date,
- payment method,
- number of installments if applicable,
- initial payment if applicable,
- payment method,
- observations.

### 11.1. Sale modalities

The buyer can pay:

1. Full payment.
2. In installments.
3. In installments with subsequent advances.
4. In installments but completing the total before the extraordinary draw.

### 11.2. Bond status after sale

Example:

```text
Delivered to collector
→ Sold
```

The financial status will depend on payments:

```text
No payments
Partial payments
Up to date
Overdue
Fully paid
```

Commercial status and financial status should not be mixed.

A bond can be:

```text
Commercial status: sold
Financial status: overdue
```

---

## 12. Buyers

Buyers can be:

- individuals,
- businesses,
- companies,
- institutions.

Minimum data:

- first name,
- last name or business name,
- address,
- phone,
- ID or tax ID if decided to register it,
- observations,
- usual collector,
- history of purchased bonds,
- number history.

### 12.1. Buyer history

The system should allow viewing:

- campaigns they participated in,
- bonds purchased,
- numbers purchased,
- payments made,
- outstanding debt,
- prizes won,
- associated collectors.

---

## 13. Payment plan and installments

Each sold bond must have a payment plan.

Example from the observed campaign:

```text
Total simple bond value: $60,000
Number of installments: 10
Installment value: $6,000
```

Each installment must record:

- installment number,
- corresponding month,
- due date,
- amount,
- status,
- payment date,
- payment method,
- associated collector,
- associated settlement,
- generated commission.

### 13.1. Possible installment statuses

```text
Pending
Paid
Paid in advance
Overdue
Annulled
```

### 13.2. Advance payment

A buyer can pay installments before their due date.

The system must allow selecting multiple installments and paying them in a single operation.

Example:

```text
The buyer pays installments 3, 4, and 5 together.
```

The system must record:

- actual payment date,
- installments covered,
- payment method,
- settlement,
- commission generated per installment or for the total payment, according to the campaign rule.

---

## 14. Full payment

When a buyer pays the full bond amount, the bond is marked as fully paid.

```text
Financial status:
Fully paid
```

Additionally, if they pay within the established conditions, they participate in the extraordinary draw for full payment.

### 14.1. Extraordinary draw for full payment

The buyer who pays in full participates with extra numbers.

Discussed rule:

- If they buy a simple bond, they get 1 extra number for the extraordinary draw.
- If they buy a pata, they get N extra numbers according to the quantity of commercial units/base numbers purchased.

### 14.2. Subsequent full payment

If a buyer starts paying in installments and then completes the full payment before the extraordinary draw deadline, they should participate in the extraordinary draw.

If they complete the payment after that deadline, they only have advance/paid installments, but do not participate in the already-held extraordinary draw.

Example:

```text
Extraordinary draw date: 12/27/2025
Full payment deadline: 12/26/2025

Bond A:
Fully paid on 12/20/2025 → participates

Bond B:
Fully paid on 12/28/2025 → does not participate
```

---

## 15. Payment methods

The system must clearly differentiate the payment method.

Minimum methods:

1. Cash.
2. Transfer.

Optionally in the future:

- debit card,
- credit card,
- digital wallet,
- check,
- other.

---

## 16. Cash payments

For cash payments:

```text
Buyer → pays the collector
Collector → settles with Firefighters
```

The collector can deliver to Firefighters the net amount after deducting their commission, or can settle the total and collect the commission later, depending on the administrative procedure.

The system must allow recording:

- total collected in cash,
- commission generated,
- commission deducted in the settlement,
- cash delivered to Firefighters,
- outstanding balance.

---

## 17. Transfer payments

Confirmed rule:

```text
Buyer → transfers directly to Firefighters
```

In this case, Firefighters receives the full payment amount.

But the collector still generates commission.

Therefore:

```text
Transfer payment: $6,000
Firefighters received: $6,000
Collector commission: $1,500
Collector credit balance: $1,500
```

This requires managing a current account for the collector.

---

## 18. Commissions

The system must calculate collector commissions.

Known general rule:

```text
General commission: 25%
```

But there is an additional rule:

- If the bond is paid in installments, the collector earns commission on each installment.
- The first installment and the last installment may have a higher commission percentage.
- Middle installments may have a different percentage.

Therefore, the commission must not be hardcoded.

It must be configurable per campaign.

### 18.1. Commission configuration per campaign

Conceptual example:

```text
Campaign 2025-2026

Full payment commission: 25%

Installment commissions:
- Installment 1: special percentage
- Middle installments: normal percentage
- Last installment: special percentage
```

The actual percentages must be loaded according to Firefighters' administrative rules.

### 18.2. Generated commission vs. paid commission

The system must separate:

```text
Generated commission
```

from:

```text
Settled/paid commission
```

Example:

```text
Generated commissions: $50,000
Paid commissions: $20,000
Outstanding balance in favor of collector: $30,000
```

This allows accumulating commissions and settling them later.

---

## 19. Collector current account

Each collector must have an internal current account.

It does not necessarily represent a bank account. It represents the administrative balance between Firefighters and the collector.

It must record movements such as:

- commissions generated,
- commissions paid,
- cash settled,
- transfers received by Firefighters,
- balances in favor of the collector,
- balances in favor of Firefighters,
- adjustments,
- annulments.

### 19.1. Example with transfer payment

```text
Buyer pays by transfer: $6,000
Firefighters receives: $6,000
Commission generated: $1,500
Balance in favor of collector: $1,500
```

### 19.2. Example with cash payment

```text
Buyer pays in cash: $6,000
Commission generated: $1,500
Net for Firefighters: $4,500
```

---

## 20. Collector settlements

Settlement is one of the central processes of the system.

Today, part of this information is tracked in Excel. The new system must replace that Excel.

### 20.1. What is a settlement

A settlement is the moment when the collector reports to administration:

- which bonds they sold,
- which installments they collected,
- which payments they received,
- which payments were in cash,
- which payments were by transfer,
- how much corresponds to commission,
- how much money is due to Firefighters,
- how much balance remains in favor of the collector.

### 20.2. Settlement data

A settlement must contain:

- settlement number,
- date,
- collector,
- admin user,
- included payments,
- total collected,
- total cash,
- total transfer,
- commission generated,
- commission settled in that settlement,
- balance in favor of the collector,
- net for Firefighters,
- observations,
- status,
- printable delivery note.

### 20.3. Settlement summary

Example:

```text
Settlement N° 00045
Date: 10/10/2025
Collector: Juan Pérez

Payments:
- Bond 0068 - Installment 1 - $6,000 - cash
- Bond 0100 - Installment 1 - $6,000 - transfer
- Pata 1200 - Full payment - $300,000 - cash

Total cash: $306,000
Total transfer: $6,000
Grand total: $312,000

Commission generated: $78,000
Commission settled: $50,000
Balance in favor of collector: $28,000
Net for Firefighters: $234,000
```

### 20.4. Settlement delivery note

The system must print a settlement delivery note for the collector and administration.

It must include:

- collector,
- date,
- list of bonds/installments/payments,
- payment method,
- amounts,
- commissions,
- total cash,
- total transfer,
- net for Firefighters,
- collector balance,
- signatures.

---

## 21. Monthly summary per collector

The system must be able to generate a summary for each collector with:

- all assigned bonds,
- base and associated numbers,
- buyer of each bond,
- sale status,
- paid installments,
- pending installments,
- overdue installments,
- advance payments,
- total collected,
- total outstanding,
- commission generated,
- balance in favor or against.

This summary is key for monthly operational tracking.

---

## 22. Draws

A campaign has different draws.

Known types:

1. Monthly draws.
2. Final draw.
3. Consolation draws.
4. Extraordinary draw for full payment.

Each draw must record:

- campaign,
- type,
- date,
- description,
- required installment up to a certain month, if applicable,
- payment cutoff date/time,
- prizes,
- winning numbers,
- eligible roster,
- status.

---

## 23. Monthly draws

Monthly draws require the bond to be up to date.

Confirmed rule:

To participate, the following must be paid:

```text
the installment corresponding to the draw month
+
all previous installments
```

Example:

```text
December 2025 draw
Required installment: 3

Must have paid:
- installment 1
- installment 2
- installment 3
```

If a previous installment or the current month's installment is unpaid:

```text
The bond is not eligible to collect a prize.
```

### 23.1. Cutoff date

Each draw should have a cutoff date/time to determine valid payments.

Example:

```text
Draw: December 2025
Draw date: 12/27/2025
Payment cutoff: 12/26/2025 23:59
```

This avoids disputes if someone pays after the draw.

---

## 24. Draw roster

Before each draw, a roster of eligible participants must be generated.

The roster must be frozen.

It must not be recalculated dynamically afterwards, because someone could pay late and alter the historical situation.

### 24.1. Roster data

The roster must record:

- draw,
- bond,
- participating numbers,
- buyer,
- collector,
- whether eligible,
- reason if not eligible,
- generation date/time.

Example:

```text
Monthly draw December 2025

Bond 0068:
Installments 1, 2, and 3 paid before cutoff
Status: eligible

Bond 0090:
Installment 3 unpaid
Status: not eligible
Reason: installment 3 debt
```

---

## 25. Loading winning numbers

The system must allow loading benefited raffles/bonds or winning numbers.

It must support numbers of different digit lengths, for example:

- 3 digits,
- 4 digits.

When loading a winning number, the system must search for matches against:

- base numbers,
- calculated associated numbers,
- extraordinary numbers if applicable to the draw.

### 25.1. Winner validation

When a winning number is loaded, the system must determine:

1. Which bond corresponds to that number.
2. Who the buyer is.
3. Which collector sold it.
4. Whether it was eligible in the roster.
5. Whether a prize should be awarded.
6. Whether the prize is rejected/not awarded due to non-payment.
7. Whether it is pending review.

---

## 26. Prize rule for non-payment

Confirmed rule:

If someone does not pay the corresponding installment, and the draw has been held, they will not receive the prize.

Therefore:

```text
Winning number
→ Search for bond
→ Review frozen roster
→ If eligible, can collect prize
→ If not eligible, no prize is due
```

The system must record the result.

Example:

```text
Winning number: 6529
Associated bond: 1658
Buyer: Diego Fernández
Roster status: not eligible
Reason: installment 3 unpaid

Result: prize not awarded due to non-payment
```

---

## 27. Extraordinary draw for full payment

This draw is exclusively for buyers who have paid the full bond within the defined deadline.

Those who participate are:

- paid in full at the start,
- or completed all installments before the extraordinary draw deadline.

Those who completed payment after the draw or after the cutoff date do not participate.

### 27.1. Extra numbers

When paying in full or completing payment on time, the buyer participates with extra numbers.

Discussed rule:

- Simple bond: 1 extra number.
- Pata: N extra numbers, according to the quantity of commercial units/base numbers included.

This exact rule must be confirmed with administration before implementation.

---

## 28. Final draw

The final draw occurs at the end of the campaign.

It must have its own prizes and eligibility rules.

Based on available information, it should require the bond to be up to date or fully paid, but this rule must be explicitly confirmed.

---

## 29. Consolation draws

Consolation draws are part of the campaign and must be modeled as independent draws.

They must have:

- date,
- prizes,
- eligibility rules,
- roster,
- winning numbers,
- result.

The exact participation rule must be confirmed.

---

## 30. Barcode

The printed bond has a barcode.

Currently, an attempt was made to use it to scan bonds and register faster, but it does not work correctly.

### 30.1. Current unconfirmed rule

It is not confirmed whether the barcode represents:

1. the visible base number,
2. the bond number,
3. an internal identifier,
4. other data from the previous system.

The current hypothesis is that it represents the upper visible number.

### 30.2. Recommendation for the new system

The new system must have its own internal identifier for each bond.

Example:

```text
BOND-2025-2026-000068
```

And also store, if it exists:

- printed barcode,
- base number,
- campaign,
- bond type.

Scanning should allow:

1. Search for bond.
2. Open bond record.
3. Register sale.
4. Register payment.
5. Include bond/installment in a settlement.

The old barcode must not be exclusively relied upon if its meaning is not confirmed.

---

## 31. Bond statuses

The bond should have at least two status dimensions:

1. Operational/commercial status.
2. Financial status.

### 31.1. Operational/commercial status

Possible statuses:

```text
Created
Available in administration
Delivered to collector
Sold
Returned
Annulled
Lost
Closed
```

### 31.2. Financial status

Possible statuses:

```text
No payments
Partial payments
Up to date
Overdue
Fully paid
Uncollectible
Annulled
```

Using a single status for everything is not advisable, because a bond can be sold and overdue at the same time.

---

## 32. Audit and traceability

The system must be designed to not lose history.

Recommended rule:

```text
Do not delete historical information.
Annul, correct, or reverse through audited movements.
```

Actions that must be audited include:

- campaign creation,
- bond loading,
- bond assignment,
- bond return,
- sale,
- buyer change,
- payment registration,
- payment annulment,
- settlement creation,
- commission settlement,
- roster generation,
- winner loading,
- prize delivery or rejection,
- pata assembly/disassembly,
- configuration changes.

Each audit entry should record:

- user,
- date/time,
- action,
- affected entity,
- previous value,
- new value,
- reason or observation.

---

## 33. Users and permissions

The system must have users with roles.

Initial suggested roles:

### 33.1. Administrator

Can:

- create campaigns,
- configure rules,
- load bonds,
- assign bonds,
- register sales,
- register payments,
- create settlements,
- settle commissions,
- manage draws,
- load winners,
- generate reports,
- manage users.

### 33.2. Administrative operator

Can:

- register sales,
- register payments,
- generate settlements,
- query bonds,
- query buyers,
- print delivery notes,
- generate operational reports.

Should not be able to change critical campaign rules.

### 33.3. Collector

Can, if access is granted:

- view their assigned bonds,
- view associated buyers,
- view pending installments,
- report payments,
- check their commission balance.

Initially, they might not have access and everything would be operated from administration.

### 33.4. Viewer / Auditor

Can:

- query information,
- view reports,
- not modify data.

---

## 34. Required reports

The system must allow generating reports at minimum for:

### 34.1. Bonds

- available bonds,
- delivered bonds,
- sold bonds,
- returned bonds,
- annulled bonds,
- lost bonds,
- available patas,
- sold patas,
- bonds by collector,
- bonds by buyer.

### 34.2. Payments

- paid installments,
- pending installments,
- overdue installments,
- payments by date,
- payments by payment method,
- payments by collector,
- payments by buyer,
- advance payments.

### 34.3. Collectors

- monthly summary per collector,
- assigned bonds,
- sold bonds,
- outstanding debt,
- cash settled,
- transfers recorded,
- commissions generated,
- commissions settled,
- balance in favor of collector,
- balance in favor of Firefighters.

### 34.4. Settlements

- settlements by date,
- settlements by collector,
- detail of included payments,
- total cash,
- total transfer,
- commission,
- net for Firefighters.

### 34.5. Draws

- eligible roster,
- ineligible roster,
- winning numbers,
- eligible winners,
- winners rejected due to debt,
- prizes delivered,
- pending prizes.

### 34.6. Buyers

- history per buyer,
- usual numbers,
- debt per buyer,
- bonds purchased,
- prizes won.

---

## 35. Certificates and delivery notes

The system must issue printable documents.

### 35.1. Bond delivery note to collector

Must include:

- delivery note number,
- date,
- collector,
- list of delivered bonds,
- base and associated numbers,
- bond type,
- observations,
- collector signature,
- administration signature.

Must be printed at least in duplicate:

- copy for collector,
- copy for administration.

### 35.2. Settlement certificate/delivery note

Must include:

- settlement number,
- date,
- collector,
- settled payments,
- bonds,
- installments,
- buyers,
- payment methods,
- amounts,
- commissions,
- total cash,
- total transfer,
- net for Firefighters,
- collector balance,
- signatures.

### 35.3. Payment certificate

Must include:

- bond,
- base number,
- associated number,
- buyer,
- collector,
- paid installment,
- sale date,
- total bond amount,
- amount paid,
- payment method,
- associated commission,
- payment date.

---

## 36. Backups

The system must have backup mechanisms.

Recommended backup types:

1. Automatic database backup.
2. Periodic exports.
3. Manual report downloads.
4. Backup of generated documents.

Since the application will be hosted on AWS, the following is recommended:

- PostgreSQL database on Amazon RDS,
- automatic RDS backups,
- snapshots,
- exports to S3,
- file versioning in S3,
- retention policies.

---

## 37. Consolidated business rules

1. A campaign contains all bonds, draws, sales, payments, and settlements of an annual period.
2. A bond can be simple or pata.
3. A simple bond has a base number and a calculated associated number.
4. The associated number is calculated by adding 4871 to the base number.
5. A pata is a bond with multiple base numbers.
6. Each base number of a pata generates its associated number.
7. A buyer participates with all participating numbers of the purchased bond.
8. If either the base number or the associated number is drawn, the winner is the same bond.
9. There must be no duplicate participating numbers within a campaign.
10. Buyers usually try to keep their historical number.
11. If a historical number ends up within a pata, an alternative number is assigned.
12. Bonds are first delivered to collectors before being sold.
13. Delivery to the collector must generate a delivery note.
14. A sale associates a bond, buyer, and collector.
15. Payments can be full payment, by installment, or advance.
16. Payments can be in cash or by transfer.
17. Transfers go directly to Firefighters.
18. Transfers generate commission in favor of the collector.
19. Commissions can be accumulated and settled later.
20. Commission rules must be configurable per campaign.
21. To participate in a monthly draw, the current month's installment and all previous installments must be paid.
22. Eligibility must be calculated with a cutoff date.
23. The draw roster must be frozen.
24. If a bond was not eligible at the time of the draw, no prize is due.
25. The extraordinary draw requires full payment before the deadline.
26. The barcode should be used as an aid, but not as the sole system key until its meaning is confirmed.
27. History must not be deleted; it must be annulled or corrected with audit.
28. The system must replace the current manual Excel control.

---

## 38. Pending questions to confirm

Before moving to the definitive technical design, the following definitions are pending:

1. What happens if `base_number + 4871` exceeds 9999?
2. Is the value of a pata always proportional to the simple bond value?
3. Are the extraordinary draw extra numbers calculated by quantity of base numbers or by another rule?
4. Does the final draw require being fully paid or just up to date?
5. Do consolation draws have the same eligibility rule as monthly draws?
6. What exact information does the barcode contain?
7. Will collectors have direct access or will everything be operated by administration?
8. What legal/tax data should be recorded for company buyers?
9. What happens with unsold bonds at campaign close?
10. What formal procedure exists for prizes not awarded due to non-payment?

---

## 39. Recommended next step

Based on this business model, the next step should be to build the functional system design.

Recommended order:

1. Define system modules.
2. Define main screens.
3. Define user flows.
4. Define states and transitions.
5. Build the ERD model.
6. Define endpoints/API.
7. Build implementation task list.
8. Prioritize MVP.
9. Design AWS infrastructure.
10. Implement backend, frontend, and database.