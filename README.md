# Business Model — Firefighters Raffle / Bond Management System

## 1. System objective

The objective of the system is to replace the current obsolete system and manual Excel controls with a modern, efficient, and intuitive web application to comprehensively manage the Volunteer Firefighters raffles/bonds.

The system must allow managing the full life cycle of an annual bond campaign:

1. Create a new annual campaign.
2. Load simple bonds and “pata” bonds.
3. Assign bonds to sellers/collectors.
4. Record sales to buyers.
5. Record cash payments, installment payments, and advance payments.
6. Control collections and collector settlements.
7. Calculate commissions.
8. Control balances in favor of collectors or Firefighters.
9. Manage monthly, extraordinary, consolation, and final draws.
10. Determine whether a bond is eligible to participate/claim a prize.
11. Record winners and prizes.
12. Issue delivery notes, receipts, reports, and backups.

The application will be web-based and must be designed to be accessible from different devices.

---

## 2. Business terminology

To avoid confusion, these terms should be standardized within the system.

| Term | Meaning |
|---|---|
| Campaign | Annual period of the bond/raffle. Example: “Contribution Bond 2025-2026”. |
| Draw | Specific event within a campaign. It can be monthly, final, consolation, or extraordinary. |
| Bond | Physical ticket/card sold to a buyer. It can be simple or pata. |
| Simple bond | Individual bond with one visible base number and one calculated associated number. |
| Pata | Pata (multi-number bond/package) with several base numbers. It is sold as a larger commercial unit, usually to companies or businesses. |
| Base number | Main number printed on the bond. |
| Associated number | Number calculated from the base number by adding 4871. |
| Participant number | Any number that participates in draws: base number or associated number. |
| Buyer | Person, business, or company that buys a bond. |
| Collector / Seller | Person who receives bonds, sells them, collects installments, and settles with Firefighters. |
| Bond delivery | Administrative act through which Firefighters deliver physical bonds to a collector. |
| Sale | Act through which a bond becomes associated with a buyer. |
| Payment | Record of money paid by a buyer. It can be cash or transfer. |
| Collector settlement | Act through which a collector reports payments, hands over money, and their commission is calculated. |
| Commission | Percentage or amount owed to the collector for the sale/collection. |
| Commission payout | Effective payment of accumulated commissions in favor of the collector. |
| Draw roster | Frozen list of bonds/numbers eligible to participate in a draw. |

---

## 3. Campaigns

A campaign represents the full annual period of a bond edition.

Example:

```text
Campaign: Contribution Bond 2025-2026
Simple bond value: $60,000
Number of installments: 10
Value of each installment: $6,000
```

A campaign contains:

- Simple bonds.
- Pata bonds.
- Buyers.
- Collectors.
- Bond deliveries.
- Sales.
- Payments.
- Collector settlements.
- Monthly draws.
- Extraordinary draw for full payment.
- Consolation draws.
- Final draw.
- Prizes.
- Commission rules.
- Eligibility rules.

### 3.1. Annual campaign cycle

The general flow is:

```text
1. The previous campaign ends.
2. The new campaign is created.
3. The printed bonds arrive.
4. Simple bonds and patas are loaded into the system.
5. Historical buyer numbers from the previous year are reviewed.
6. Bonds are assigned to collectors.
7. Collectors take the physical bonds.
8. Collectors sell the bonds.
9. Collectors settle sales and payments with administration.
10. Administration records buyers, payments, installments, and payment methods.
11. The system calculates commissions and balances.
12. Draw rosters are generated monthly.
13. Winning numbers are loaded.
14. The system validates whether the winning bond was eligible.
15. Prizes are recorded.
16. At the end of the period, the campaign is closed.
```

---

## 4. Bonds

The bond is the sellable unit of the system.

A bond can be:

1. Simple bond.
2. Pata bond.

Both are bonds. The difference is the number of base numbers they contain and, consequently, their value.

---

## 5. Simple bond

A simple bond has:

- One base number.
- One calculated associated number.
- One buyer, if it was sold.
- One assigned collector.
- One payment plan.
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

### 5.1. Main simple bond rule

Although visually it may look like the bond has two independent numbers, it actually has:

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
If 1658 is drawn -> Bond 1658 wins
If 6529 is drawn -> Bond 1658 wins
```

The system must avoid interpreting those numbers as two different bonds.

---

## 6. Associated number +4871

All bonds use associated-number logic.

Rule:

```text
associated number = base number + 4871
```

This rule must be configured in the system, ideally at campaign level, so it is not hardcoded.

### 6.1. Operational objective

The associated number is tied to the same bond. The objective is for the same bond to have more than one chance of being drawn without generating double prize assignment to two different bonds.

### 6.2. Duplicate validation

The system must validate that a participant number is not repeated within the same campaign.

Participant number means:

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

In this case, number 6529 would be tied to two different bonds. The system should prevent it, warn about it, or require an administrative resolution.

### 6.3. Open question about 4-digit limit

It still must be confirmed what happens when:

```text
base_number + 4871 > 9999
```

Example:

```text
7000 + 4871 = 11871
```

Possible rules to confirm:

1. Such high base numbers are never used.
2. The last 4 digits are taken.
3. There is a maximum allowed range for base numbers.
4. The campaign can work with more than 4 digits in certain cases.

Until this rule is confirmed, the system must treat it as a pending validation.

---

## 7. “Pata” bonds

A pata is a printed bond that has several base numbers.

It must not be modeled as many separate bonds, but as:

```text
1 pata bond
+
several base numbers
+
several calculated associated numbers
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

### 7.1. Pata sale

Patas are sold as one unit.

They are usually sold to companies, businesses, or large buyers because they have more numbers and therefore higher value.

### 7.2. Pata value

The value of a pata must depend on the number of numbers/commercial units it contains.

Likely rule, pending exact confirmation:

```text
Simple bond = 1 commercial unit = 1 base number + 1 associated number
Pata = N commercial units
Pata value = simple bond value x N
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
Likely value: $300,000
```

This rule must be confirmed with administration or with the previous system before being implemented definitively.

---

## 8. Creating new patas

In addition to printed patas, it may be necessary to assemble a new pata by grouping several simple bonds.

This happens when:

- no printed patas remain available,
- a buyer wants to buy several numbers,
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

### 8.2. Selling an assembled pata

Even if it is assembled from simple bonds, commercially it must be sellable as a single pata/package.

---

## 9. Number history and reservation

An important business feature is that many buyers want to keep the same number every year.

Therefore, when starting a new campaign, the system attempts to assign each collector the same numbers they sold the previous year to the same buyers.

### 9.1. Historical reservation

The system should record number history by buyer.

Example:

```text
Buyer: Diego Fernandez
Usual number: 0068
Usual collector: Juan Perez
Last campaign: 2024-2025
```

When loading the new campaign, the system should help detect:

```text
Number 0068 is available.
It can be assigned again to the historical buyer.
```

Or:

```text
Number 0068 belongs to a pata this year.
It is not available as a simple bond.
An alternative number must be offered.
```

### 9.2. Conflict with patas

It may happen that a number historically bought by a person now belongs to a pata.

In that case:

1. The number is not assigned to the historical buyer.
2. Another number is assigned to the collector.
3. The collector informs the buyer that their usual number is not available.
4. The reassignment is recorded to maintain traceability.

---

## 10. Assigning bonds to collectors

Before starting the campaign, Firefighters deliver physical bonds to collectors.

This delivery must be formally recorded in the system.

### 10.1. Bond delivery

A delivery must contain:

- delivery note number,
- date,
- collector,
- administrator user who recorded it,
- list of delivered bonds,
- notes,
- status,
- printing capability.

Example:

```text
Delivery note No. 000123
Date: 09/01/2025
Collector: Juan Perez

Delivered bonds:
- Bond 0068
- Bond 0100
- Pata 1200
- Pata 1300
```

### 10.2. Bond status after delivery

When delivered to a collector:

```text
Available in administration
-> Delivered to collector
```

This does not mean the bond has been sold.

It only means the collector physically has the bond.

### 10.3. Return or unassignment

It must be possible to:

- return bonds to administration,
- unassign bonds from a collector,
- reassign bonds to another collector,
- record loss/misplacement,
- void an erroneous assignment.

All these actions must be audited.

---

## 11. Bond sales

The sale occurs when the collector reports that a bond was sold to a buyer.

The sale must record:

- sold bond,
- collector who sold it,
- buyer,
- sale date,
- payment mode,
- number of installments if applicable,
- initial payment if applicable,
- payment method,
- notes.

### 11.1. Sale modes

The buyer can pay:

1. In full.
2. In installments.
3. In installments with later advance payments.
4. In installments but completing the total before the extraordinary draw.

### 11.2. Bond status after sale

Example:

```text
Delivered to collector
-> Sold
```

The financial status will depend on payments:

```text
No payments
With partial payments
Up to date
Overdue
Fully paid
```

It is not advisable to mix commercial status with financial status.

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
- last name or legal/business name,
- address,
- phone,
- document or tax ID if registration is decided,
- notes,
- usual collector,
- history of purchased bonds,
- history of numbers.

### 12.1. Buyer history

The system should allow viewing:

- campaigns in which they participated,
- purchased bonds,
- purchased numbers,
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
- associated collector settlement,
- generated commission.

### 13.1. Possible installment statuses

```text
Pending
Paid
Paid in advance
Overdue
Voided
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
- covered installments,
- payment method,
- collector settlement,
- commission generated by each installment or by the total payment, depending on the campaign rule.

---

## 14. Full payment

When a buyer pays the full bond amount, the bond becomes fully paid.

```text
Financial status:
Fully paid
```

In addition, if they pay under the established conditions, they participate in the extraordinary draw for full payment.

### 14.1. Extraordinary draw for full payment

The buyer who pays in full participates with extra numbers.

Discussed rule:

- If they buy a simple bond, they get 1 extra number for the extraordinary draw.
- If they buy a pata, they get N extra numbers according to the number of numbers/commercial units purchased.

### 14.2. Later full payment

If a buyer starts paying in installments and later completes the full payment before the extraordinary draw deadline, they should participate in the extraordinary draw.

If they complete the payment after that deadline, they only have advance/paid installments, but they do not participate in the extraordinary draw that already took place.

Example:

```text
Extraordinary draw date: 12/27/2025
Full payment deadline: 12/26/2025

Bond A:
Fully paid on 12/20/2025 -> participates

Bond B:
Fully paid on 12/28/2025 -> does not participate
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
Buyer -> pays the collector
Collector -> settles with Firefighters
```

The collector can hand over to Firefighters the net money after deducting their commission, or they can settle the full amount and collect commission afterward, depending on the administrative process.

The system must allow recording:

- total collected in cash,
- generated commission,
- commission deducted in the collector settlement,
- cash delivered to Firefighters,
- outstanding balance.

---

## 17. Transfer payments

Confirmed rule:

```text
Buyer -> transfers directly to Firefighters
```

In this case, Firefighters receive the full payment.

But the collector still generates commission.

Therefore:

```text
Transfer payment: $6,000
Firefighters received: $6,000
Collector commission: $1,500
Balance in favor of collector: $1,500
```

This requires managing a collector current account.

---

## 18. Commissions

The system must calculate collector commissions.

Known general rule:

```text
General commission: 25%
```

But there is an additional rule:

- If the bond is paid in installments, the collector earns commission for each installment.
- The first installment and the last installment may have a higher commission percentage.
- Intermediate installments may have another percentage.

Therefore, commission must not be hardcoded.

It must be configurable by campaign.

### 18.1. Commission configuration by campaign

Conceptual example:

```text
Campaign 2025-2026

Full payment commission: 25%

Installment commissions:
- Installment 1: special percentage
- Intermediate installments: normal percentage
- Last installment: special percentage
```

The real percentages must be loaded according to Firefighters administrative rules.

### 18.2. Generated commission vs paid commission

The system must separate:

```text
Generated commission
```

from:

```text
Paid/settled commission
```

Example:

```text
Generated commissions: $50,000
Paid commissions: $20,000
Outstanding balance in favor of collector: $30,000
```

This allows accumulating commissions and paying them later.

---

## 19. Collector current account

Each collector must have an internal current account.

It does not necessarily represent a bank account. It represents the administrative balance between Firefighters and the collector.

It must record movements such as:

- generated commissions,
- paid commissions,
- settled cash,
- transfers received by Firefighters,
- balances in favor of the collector,
- balances in favor of Firefighters,
- adjustments,
- voids.

### 19.1. Example with transfer payment

```text
Buyer pays by transfer: $6,000
Firefighters receive: $6,000
Generated commission: $1,500
Balance in favor of collector: $1,500
```

### 19.2. Example with cash payment

```text
Buyer pays in cash: $6,000
Generated commission: $1,500
Net for Firefighters: $4,500
```

---

## 20. Collector settlements

The collector settlement is one of the system's core processes.

Today, part of this information is controlled in Excel. The new system must replace that Excel file.

### 20.1. What a collector settlement is

A collector settlement is the moment when the collector reports to administration:

- which bonds they sold,
- which installments they collected,
- which payments they received,
- which payments were in cash,
- which payments were by transfer,
- how much commission is owed,
- how much money remains for Firefighters,
- how much balance remains in favor of the collector.

### 20.2. Collector settlement data

A collector settlement must contain:

- settlement number,
- date,
- collector,
- administrator user,
- included payments,
- total collected,
- total cash,
- total transfer,
- generated commission,
- commission paid in that settlement,
- balance in favor of the collector,
- net for Firefighters,
- notes,
- status,
- printable delivery note.

### 20.3. Collector settlement summary

Example:

```text
Collector settlement No. 00045
Date: 10/10/2025
Collector: Juan Perez

Payments:
- Bond 0068 - Installment 1 - $6,000 - cash
- Bond 0100 - Installment 1 - $6,000 - transfer
- Pata 1200 - Full payment - $300,000 - cash

Total cash: $306,000
Total transfer: $6,000
Grand total: $312,000

Generated commission: $78,000
Paid commission: $50,000
Balance in favor of collector: $28,000
Net Firefighters: $234,000
```

### 20.4. Collector settlement delivery note

The system must print a collector settlement delivery note for the collector and administration.

It must include:

- collector,
- date,
- list of bonds/installments/payments,
- payment method,
- amounts,
- commissions,
- total cash,
- total transfer,
- net Firefighters,
- collector balance,
- signatures.

---

## 21. Monthly summary by collector

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
- total pending,
- generated commission,
- balance in favor or against.

This summary is key for monthly operational follow-up.

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
- cutoff date/time for payments,
- prizes,
- winning numbers,
- eligible draw roster,
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

If a previous installment or the month's installment is missing:

```text
The bond is not eligible to claim a prize.
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

The roster must remain frozen.

It must not be recalculated dynamically afterward, because someone could pay late and alter the historical situation.

### 24.1. Roster data

The roster must record:

- draw,
- bond,
- participant numbers,
- buyer,
- collector,
- whether it is eligible,
- reason if it is not eligible,
- generation date/time.

Example:

```text
December 2025 monthly draw

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

It must support numbers with different digit counts, for example:

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
5. Whether the prize should be awarded.
6. Whether the prize is rejected/not awarded due to non-payment.
7. Whether it remains pending review.

---

## 26. Prize rule for non-payment

Confirmed rule:

If someone does not pay the corresponding installment and the draw has taken place, they will not receive the prize.

Therefore:

```text
Winning number
-> Search bond
-> Check frozen roster
-> If it was eligible, it can claim
-> If it was not eligible, prize does not apply
```

The system must keep a record of the result.

Example:

```text
Winning number: 6529
Associated bond: 1658
Buyer: Diego Fernandez
Roster status: not eligible
Reason: installment 3 unpaid

Result: prize not awarded due to non-payment
```

---

## 27. Extraordinary draw for full payment

This draw is exclusive to buyers who paid the full bond within the defined deadline.

Participants are those who:

- paid in full at the beginning,
- or completed all installments before the extraordinary draw deadline.

Those who completed payment after the draw or after the cutoff date do not participate.

### 27.1. Extra numbers

When paying in full or completing payment on time, the buyer participates with extra numbers.

Discussed rule:

- Simple bond: 1 extra number.
- Pata: N extra numbers, according to the number of commercial units/base numbers it includes.

This exact rule must be confirmed with administration before implementation.

---

## 28. Final draw

The final draw occurs at the end of the campaign.

It must have its own prizes and eligibility rules.

Based on the available information, it should require the bond to be up to date or fully paid, but this rule must be explicitly confirmed.

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

It was previously attempted for scanning bonds and recording faster, but it does not work correctly.

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
BONO-2025-2026-000068
```

And also store, if it exists:

- printed barcode,
- base number,
- campaign,
- bond type.

Scanning should allow:

1. Search bond.
2. Open bond record.
3. Record sale.
4. Record payment.
5. Include bond/installment in a collector settlement.

The system must not depend exclusively on the old barcode if its meaning is not confirmed.

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
Voided
Lost
Closed
```

### 31.2. Financial status

Possible statuses:

```text
No payments
With partial payments
Up to date
Overdue
Fully paid
Uncollectible
Voided
```

It is not advisable to use a single status for everything, because a bond can be sold and overdue at the same time.

---

## 32. Audit and traceability

The system must be designed not to lose history.

Recommended rule:

```text
Do not delete historical information.
Void, correct, or reverse through audited movements.
```

Actions such as the following must be audited:

- campaign creation,
- bond loading,
- bond assignment,
- bond return,
- sale,
- buyer change,
- payment recording,
- payment voiding,
- collector settlement creation,
- commission payout,
- roster generation,
- winner loading,
- prize delivery or rejection,
- pata assembly/disassembly,
- configuration changes.

Each audit record should include:

- user,
- date/time,
- action,
- affected entity,
- previous value,
- new value,
- reason or note.

---

## 33. Users and permissions

The system must have users with roles.

Suggested initial roles:

### 33.1. Administrator

Can:

- create campaigns,
- configure rules,
- load bonds,
- assign bonds,
- record sales,
- record payments,
- create collector settlements,
- pay commissions,
- manage draws,
- load winners,
- issue reports,
- administer users.

### 33.2. Administrative operator

Can:

- record sales,
- record payments,
- generate collector settlements,
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

Initially, they might not have access and everything could be operated from administration.

### 33.4. Viewer / Auditor

Can:

- query information,
- view reports,
- not modify data.

---

## 34. Required reports

The system must allow generating reports at least for:

### 34.1. Bonds

- available bonds,
- delivered bonds,
- sold bonds,
- returned bonds,
- voided bonds,
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

- monthly summary by collector,
- assigned bonds,
- sold bonds,
- outstanding debt,
- settled cash,
- registered transfers,
- generated commissions,
- paid commissions,
- balance in favor of the collector,
- balance in favor of Firefighters.

### 34.4. Collector settlements

- settlements by date,
- settlements by collector,
- detail of included payments,
- total cash,
- total transfer,
- commission,
- net Firefighters.

### 34.5. Draws

- eligible roster,
- not eligible roster,
- winning numbers,
- eligible winners,
- winners rejected due to debt,
- delivered prizes,
- pending prizes.

### 34.6. Buyers

- history by buyer,
- usual numbers,
- debt by buyer,
- purchased bonds,
- prizes won.

---

## 35. Receipts and delivery notes

The system must issue printable documents.

### 35.1. Bond delivery note to collector

It must include:

- delivery note number,
- date,
- collector,
- list of delivered bonds,
- base and associated numbers,
- bond type,
- notes,
- collector signature,
- administration signature.

It must be printed at least in duplicate:

- copy for collector,
- copy for administration.

### 35.2. Collector settlement receipt/delivery note

It must include:

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
- net Firefighters,
- collector balance,
- signatures.

### 35.3. Payment receipt

It must include:

- bond,
- base number,
- associated number,
- buyer,
- collector,
- paid installment,
- sale date,
- total bond amount,
- paid amount,
- payment method,
- associated commission,
- payment date.

---

## 36. Backups

The system must include backup mechanisms.

Recommended backup types:

1. Automatic database backup.
2. Periodic exports.
3. Manual report download.
4. Backup of generated documents.

Since the application will be deployed on AWS, the following are recommended:

- PostgreSQL database on Amazon RDS,
- automatic RDS backups,
- snapshots,
- exports to S3,
- file versioning in S3,
- retention policies.

---

## 37. Consolidated business rules

1. A campaign contains all bonds, draws, sales, payments, and collector settlements for an annual period.
2. A bond can be simple or pata.
3. A simple bond has one base number and one calculated associated number.
4. The associated number is calculated by adding 4871 to the base number.
5. A pata is a bond with several base numbers.
6. Each base number in a pata generates its associated number.
7. A buyer participates with all participant numbers of the purchased bond.
8. If the base number or associated number is drawn, the winner is the same bond.
9. There must be no duplicate participant numbers within a campaign.
10. Buyers usually try to keep their historical number.
11. If a historical number becomes part of a pata, another alternative number is assigned.
12. Bonds are first delivered to collectors before being sold.
13. Delivery to the collector must generate a delivery note.
14. A sale associates bond, buyer, and collector.
15. Payments can be full, by installment, or in advance.
16. Payments can be in cash or by transfer.
17. Transfers go directly to Firefighters.
18. Transfers generate commission in favor of the collector.
19. Commissions can accumulate and be paid later.
20. Commission rules must be configurable by campaign.
21. To participate in a monthly draw, the installment for the month and all previous installments must be paid.
22. Eligibility must be calculated with a cutoff date.
23. The draw roster must remain frozen.
24. If a bond was not eligible at the time of the draw, the prize must not be awarded.
25. The extraordinary draw requires full payment before the deadline.
26. The barcode must be used as an aid, but not as the system's only key until its meaning is confirmed.
27. History must not be deleted; it must be voided or corrected with audit.
28. The system must replace the current manual Excel control.

---

## 38. Open questions to confirm

Before moving to the final technical design, these definitions remain pending:

1. What happens if `base_number + 4871` exceeds 9999?
2. Is the value of a pata always proportional to the value of a simple bond?
3. Are the extra numbers for the extraordinary draw calculated by number of base numbers or by another rule?
4. Does the final draw require full payment or only being up to date?
5. Do consolation draws have the same eligibility rule as monthly draws?
6. What exact information does the barcode contain?
7. Will direct access for collectors be allowed, or will everything be operated by administration?
8. What legal/tax data should be recorded for company buyers?
9. What happens to unsold bonds at campaign close?
10. What formal procedure exists for prizes not awarded due to non-payment?

---

## 39. Recommended next step

Based on this business model, the next step should be to prepare the system's functional design.

Recommended order:

1. Define system modules.
2. Define main screens.
3. Define user flows.
4. Define statuses and transitions.
5. Build the ERD model.
6. Define endpoints/API.
7. Build implementation task list.
8. Prioritize MVP.
9. Design AWS infrastructure.
10. Implement backend, frontend, and database.
