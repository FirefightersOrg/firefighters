# Features and Value-Added Flows — Firefighters Bonds / Raffle Management System

## 1. Document Objective

This document records features, processes, and proposed improvements so that the new raffle system is not merely a replacement of the current system, but a comprehensive improvement of the operational, administrative, and financial workflow of the Firefighters.

The idea is for this document to serve as a basis for:

1. Designing functional modules.
2. Designing screens and user flows.
3. Defining the MVP scope.
4. Prioritizing features.
5. Building a technical implementation task list.
6. Improving current processes that are currently done manually or in Excel.

---

## 2. General Approach

The system should not be limited to loading bonds, buyers, and payments.

The real value lies in enabling the Firefighters to know at all times:

```text
Who holds each bond.
Who bought it.
Which numbers are participating.
What was paid.
What is owed.
Which collector was involved.
What commission is due.
What money came in.
What money is missing.
Who can participate in the next draw.
Who cannot participate due to debt.
What prizes were delivered.
What settlements are pending.
What transfers are unidentified.
```

The system should become a management and control tool, not just a database.

---

# 3. Pre-Sale Flow with Historical Reservations

Currently, the attempt is made to assign each collector the same numbers as the previous year, because many buyers want to keep their usual number.

This should be transformed into a formal system flow.

## 3.1. Proposed Flow

```text
Previous campaign closed
↓
System detects historical buyers
↓
System proposes reserving the same numbers
↓
Administrator reviews availability and conflicts
↓
System assigns numbers/bonds to the corresponding collector
```

## 3.2. Successful Case

```text
Buyer: Diego Fernández
Usual number: 0068
Usual collector: Juan Pérez

New campaign:
Number 0068 available

Action:
Reserve/assign number to the same collector
```

## 3.3. Case with Conflict

```text
Buyer: Diego Fernández
Usual number: 0068
Usual collector: Juan Pérez

New campaign:
Number 0068 belongs to a pata

Action:
Flag conflict and suggest alternative number
```

## 3.4. Added Value

- Reduces manual work.
- Reduces assignment errors.
- Improves commercial continuity.
- Prevents disputes with buyers.
- Gives the collector an initial portfolio of expected buyers.
- Allows measuring buyer renewal year over year.

---

# 4. Number Conflict Management

When a historical number is no longer available, the system should formally register the conflict.

## 4.1. Conflict Example

```text
Conflict No. 00034

Historical buyer: Diego Fernández
Requested number: 0068
Reason: the number is included in a pata
Usual collector: Juan Pérez
Campaign: 2025-2026
```

## 4.2. Possible Actions

- Assign alternative number.
- Keep buyer on waiting list.
- Offer to buy the complete pata.
- Mark buyer as not renewed.
- Register administrative observation.

## 4.3. Added Value

- Enables traceability.
- Prevents informal decisions without records.
- Allows measuring how many sales are lost or changed due to conflicts.
- Helps better plan bond/pata printing for future campaigns.

---

# 5. Buyer Renewal List

Each collector should have a list of historical buyers to contact.

## 5.1. Example

```text
Collector: Juan Pérez

Buyers to renew:
1. Diego Fernández - Number 0068 - Pending contact
2. María López - Number 0120 - Confirmed renewal
3. Ferretería Mitre - Pata 1200 - Pending
```

## 5.2. Suggested States

```text
Pending contact
Contacted
Accepts renewal
Does not renew
Requested number change
Requested cash payment
Pending payment
Sold
```

## 5.3. Added Value

- Organizes the pre-sale.
- Allows measuring renewal rate.
- Allows knowing which collector is managing their portfolio best.
- Reduces loss of regular buyers.
- Allows anticipating demand before all bonds are distributed.

---

# 6. Collector Panel

Although initially everything could be operated by administration, in the future each collector could have access to their own panel.

## 6.1. Information Available to the Collector

- Assigned bonds.
- Sold bonds.
- Bonds pending sale.
- Historical buyers.
- Buyers with overdue installments.
- Pending installments.
- Installments about to expire.
- Registered transfer payments.
- Completed settlements.
- Generated commission.
- Settled commission.
- Balance in favor or against.

## 6.2. Added Value

- Reduces inquiries to administration.
- Organizes the collector's work.
- Improves debt tracking.
- Allows detecting overdue installments before draws.
- Improves commission transparency.

---

# 7. Quick Entry by Scanning

The system should leverage barcodes or QR codes to speed up operations.

Currently the barcode exists on the bond, but it is not confirmed what data it contains or whether it works correctly in the old system.

## 7.1. Ideal Flow

```text
Administrator scans bond
↓
System opens the bond record
↓
Allows registering sale, payment, or settlement
```

## 7.2. Settlement Flow

```text
Create settlement
↓
Scan bond
↓
Select paid installment
↓
Choose payment method
↓
Add payment to settlement
```

## 7.3. Recommendation

The new system should store:

- base number,
- calculated associated number,
- printed barcode, if it exists,
- system's own internal identifier.

For future campaigns, it is recommended to generate a system-specific QR code.

## 7.4. Added Value

- Less typing.
- Fewer data entry errors.
- Faster settlements.
- Better experience for administration.
- Foundation for automating future campaigns.

---

# 8. Assisted Settlement

The collector's settlement should be a central flow of the system, not a simple payment entry.

## 8.1. Proposed Flow

```text
Create settlement
↓
Select collector
↓
Scan or search bonds
↓
Add installments/payments
↓
Separate cash and transfers
↓
Calculate commission automatically
↓
Calculate net amount for Firefighters
↓
Calculate balance in favor of collector
↓
Confirm settlement
↓
Print delivery note
```

## 8.2. Real-Time Summary

During data entry, the screen should display:

```text
Total cash: $...
Total transfers: $...
Total collected: $...
Generated commission: $...
Commission settled now: $...
Balance in favor of collector: $...
Net for Firefighters: $...
```

## 8.3. Added Value

- Replaces the current Excel.
- Reduces calculation errors.
- Organizes the relationship with the collector.
- Allows issuing clear delivery notes.
- Allows closing the daily cash register with greater precision.

---

# 9. Collector Current Account

Each collector should have an internal administrative current account.

It does not necessarily represent a bank account. It represents the balance between the Firefighters and the collector.

## 9.1. Possible Movements

- Commission generated by cash payment.
- Commission generated by transfer.
- Settled/paid commission.
- Cash delivered by the collector.
- Authorized manual adjustments.
- Annulments.
- Audited corrections.
- Balance in favor of the collector.
- Balance in favor of the Firefighters.

## 9.2. Transfer Example

```text
Buyer pays by transfer: $6,000
Firefighters receive: $6,000
Commission generated for collector: $1,500

Movement:
Balance in favor of collector +$1,500
```

## 9.3. Cash Example

```text
Buyer pays in cash: $6,000
Commission generated: $1,500
Net for Firefighters: $4,500
```

## 9.4. Added Value

- Prevents disputes over commissions.
- Allows accumulating commissions.
- Allows settling them later.
- Allows controlling transfers.
- Provides transparency to the collector and administration.

---

# 10. Transfer Payment Control

Since transfer payments go directly to the Firefighters, the system must have a specific flow for them.

## 10.1. Proposed Flow

```text
Buyer transfers to Firefighters
↓
Administration registers the transfer
↓
System associates it to buyer, bond, and installment
↓
System marks the installment as paid
↓
System generates commission in favor of the collector
```

## 10.2. Common Problem

A transfer may arrive without clear information.

Example:

```text
Date: 10/11/2025
Amount: $6,000
Reference: Diego F.
Status: unidentified
```

## 10.3. Unidentified Transfers Tray

The system should have a specific section for pending transfers.

The system could suggest matches:

```text
Suggestions:
1. Diego Fernández - Bond 0068 - Installment 2
2. Diego Fernández - Bond 1658 - Installment 2
```

## 10.4. Added Value

- Prevents lost payments.
- Improves reconciliation.
- Organizes collector balances.
- Reduces errors when marking installments as paid.
- Allows preparing for future bank reconciliation.

---

# 11. Semi-Automatic Bank Reconciliation

Advanced functionality, not necessarily for the initial MVP.

## 11.1. Proposed Flow

```text
Administration downloads bank statements
↓
Imports file into the system
↓
System detects possible matches
↓
Administrator confirms or corrects
↓
Payments are associated with installments
```

## 11.2. Matching Criteria

- Exact amount.
- Name or reference.
- Date.
- Buyer.
- Phone.
- Associated bond.
- Expected installment.
- Assigned collector.

## 11.3. Added Value

- Saves administrative time.
- Reduces unidentified transfers.
- Improves financial control.
- Allows scaling if transfer usage increases.

---

# 12. Overdue Installment Alerts

The system should automatically detect overdue installments.

## 12.1. Example

```text
Bond: 1658
Buyer: Diego Fernández
Collector: Juan Pérez
Overdue installment: installment 3
Days overdue: 12
```

## 12.2. Useful Views

- Overdue installments by collector.
- Overdue installments by buyer.
- Bonds at risk of not participating in the next draw.
- Bonds with multiple overdue installments.
- Repeat offenders.

## 12.3. Added Value

- Allows action before the draw.
- Reduces delinquency.
- Improves revenue collection.
- Helps the collector prioritize visits/contacts.

---

# 13. Pre-Draw Alerts

Before each monthly draw, the system should display an operational alert.

## 13.1. Example

```text
Draw: December 2025
Required installment: 3
Cutoff date: 12/26/2025

Enabled bonds: 1340
Disabled bonds: 210
Bonds with recoverable debt: 95
```

## 13.2. Concept of Recoverable Debt

Bonds that are not currently enabled but could become enabled if paid before the cutoff.

Example:

```text
Bond 1658
Owes installment 3
If paid before the cutoff, participates in the draw.
```

## 13.3. Added Value

- Allows notifying buyers.
- Allows prioritizing collections.
- Reduces subsequent complaints.
- Improves revenue collection before draws.

---

# 14. Frozen Draw Roster

The roster of eligible participants must be generated before each draw and frozen.

## 14.1. Proposed Flow

```text
Generate roster
↓
System calculates enabled/disabled
↓
Administrator reviews
↓
Roster is frozen
↓
Draw is conducted
↓
Winners are entered
```

## 14.2. Why It Must Be Frozen

It should not be dynamically recalculated after the draw, because someone could pay late and appear enabled in the system even though they were not at the time of the draw.

## 14.3. Added Value

- Transparency.
- Traceability.
- Prevents complaints.
- Allows justifying unawarded prizes.
- Improves legal/administrative control.

---

# 15. Winner Simulator / Validator

When a winning number is entered, the system should clearly explain the result.

## 15.1. Example

```text
Winning number: 6529

Matches:
Bond: 1658
Winning number: associated
Base number: 1658
Buyer: Diego Fernández
Collector: Juan Pérez

Roster status:
Not enabled

Reason:
Installment 3 unpaid at time of cutoff

Result:
Prize not awarded
```

## 15.2. Added Value

- Prevents manual interpretations.
- Reduces errors when assigning prizes.
- Makes it easier to explain decisions.
- Allows auditing results.

---

# 16. Prize Delivery Control

Recording the winning number is not enough. The complete prize cycle must be recorded.

## 16.1. Prize Delivered Flow

```text
Prize drawn
↓
Winner identified
↓
Winner enabled
↓
Prize pending delivery
↓
Prize delivered
```

## 16.2. Unawarded Prize Flow

```text
Prize drawn
↓
Winner identified
↓
Winner not enabled
↓
Prize not awarded
↓
Administrative observation
```

## 16.3. Data to Record

- draw,
- prize,
- winning number,
- associated bond,
- buyer,
- collector,
- eligibility status,
- delivery date,
- registering user,
- receipt or proof,
- observations.

## 16.4. Added Value

- Controls pending prizes.
- Prevents oversights.
- Allows reports of delivered/not delivered prizes.
- Improves institutional transparency.

---

# 17. Single Bond Record

Each bond should have a central record, like a complete file.

## 17.1. Suggested Information

```text
Bond 1658

Campaign: 2025-2026
Type: Simple
Base number: 1658
Associated number: 6529
Commercial status: Sold
Financial status: Up to date
Collector: Juan Pérez
Buyer: Diego Fernández
```

## 17.2. Record Sections

- General data.
- Participating numbers.
- Assigned collector.
- Buyer.
- Installments.
- Payments.
- Settlements.
- Generated commissions.
- Draws participated in.
- Eligibility status per draw.
- Prizes.
- History/audit log.

## 17.3. Added Value

- Saves search time.
- Centralizes all information.
- Allows quickly resolving complaints.
- Facilitates auditing.

---

# 18. Single Buyer Record

The buyer should have a complete history.

## 18.1. Suggested Information

```text
Buyer: Diego Fernández

Campaigns:
2023-2024: Bond 0068
2024-2025: Bond 0068
2025-2026: Bond 1658

Usual collector:
Juan Pérez

Current status:
Installment 1 paid
Installment 2 paid
Installment 3 pending
```

## 18.2. Added Value

- Allows knowing if they are a recurring buyer.
- Allows seeing usual numbers.
- Allows detecting debts.
- Allows improving service.
- Helps with annual renewal.

---

# 19. Single Collector Record

The collector should have a comprehensive view.

## 19.1. Suggested Information

```text
Collector: Juan Pérez

Assigned bonds: 120
Sold: 85
Pending sale: 35
Installments up to date: 60
Overdue installments: 25
Total collected: $...
Total settled: $...
Generated commission: $...
Settled commission: $...
Current balance: $...
```

## 19.2. Useful Indicators

- sales percentage,
- collection percentage,
- total debt in their portfolio,
- number of overdue buyers,
- unsold bonds,
- pending commissions,
- associated transfers.

## 19.3. Added Value

- Allows better collector management.
- Reduces uncertainty about balances.
- Allows detecting underperformance or operational issues.
- Improves collection planning.

---

# 20. Collector Ranking and Tracking

The system could generate operational rankings.

## 20.1. Possible Indicators

- Collectors with highest sales.
- Collectors with highest up-to-date collection.
- Collectors with the most overdue debt.
- Collectors with the most unsold bonds.
- Collectors with the highest number of transfers.
- Collectors with pending commission balance.

## 20.2. Recommended Use

It should not be used as a punitive tool, but as operational control and management support.

## 20.3. Added Value

- Detects collectors who need help.
- Identifies areas or portfolios with low collection.
- Allows making decisions before campaign close.

---

# 21. Bond Return Workflow

Not all assigned bonds are sold. There must be a clear flow for returns.

## 21.1. Simple Flow

```text
Collector returns bond
↓
Administration receives
↓
Bond becomes available again
```

## 21.2. Flow with Reassignment

```text
Collector returns bond
↓
Administration receives
↓
Bond is reassigned to another collector
```

## 21.3. Possible States

```text
Available
Assigned to collector
Sold
Returned
Reassigned
Lost
Annulled
```

## 21.4. Added Value

- Physical bond control.
- Prevents losing cards.
- Allows quickly reassigning unsold bonds.
- Maintains traceability.

---

# 22. Lost Bond Control

There must be a process for lost or missing bonds.

## 22.1. Data to Record

- bond,
- responsible collector,
- date,
- reason,
- observation,
- registering user,
- subsequent status,
- if it is annulled,
- if it is replaced,
- if it is formally reported.

## 22.2. Added Value

- Improves physical control.
- Prevents lost bonds from continuing to circulate uncontrolled.
- Establishes responsibility and traceability.
- Helps with complaints.

---

# 23. Smart Pata Assembly

When there are no printed patas left and simple bonds need to be grouped, the system should assist in creation.

## 23.1. Proposed Flow

```text
Create new pata
↓
Define number of units
↓
System searches for available bonds
↓
System warns of conflicts
↓
Administrator confirms grouping
```

## 23.2. Suggestion Criteria

The system should suggest bonds that:

- are available,
- are not sold,
- are not assigned,
- do not have an active historical reservation,
- are not committed to a collector,
- do not have number conflicts.

## 23.3. Added Value

- Prevents breaking historical reservations.
- Prevents grouping committed bonds.
- Reduces administrative errors.
- Facilitates large sales to businesses.

---

# 24. Pata Traceability

Each pata should clearly show its composition.

## 24.1. Example

```text
Pata 1200

Base numbers:
1200, 1315, 2200, 3100, 4500

Associated numbers:
6071, 6186, 7071, 7971, 9371

Origin:
Printed

Buyer:
Company X

Collector:
Juan Pérez
```

## 24.2. If Assembled Manually

```text
Origin:
Assembled manually

Simple bonds that compose it:
- Bond 1200
- Bond 1315
- Bond 2200
- Bond 3100
- Bond 4500
```

## 24.3. Added Value

- Commercial clarity.
- Clarity in draws.
- Better traceability.
- Less confusion when selling multiple numbers.

---

# 25. General Campaign Dashboard

Administration should have a main screen with indicators.

## 25.1. Suggested Indicators

```text
Campaign 2025-2026

Total bonds: 3000
Bonds sold: 1850
Bonds available: 600
Bonds with collectors unsold: 550

Expected revenue: $...
Actual revenue: $...
Pending: $...

Cash: $...
Transfers: $...

Generated commissions: $...
Settled commissions: $...
Pending collector balances: $...

Next draw:
December 2025
Enabled bonds: 1430
At-risk bonds: 220
```

## 25.2. Added Value

- Provides a global overview.
- Helps make decisions.
- Shows problems before they become serious.
- Turns the system into a management tool.

---

# 26. Monthly Close Flow

Each month should be closable operationally.

## 26.1. Proposed Flow

```text
Monthly close
↓
Validate pending settlements
↓
Validate unassociated transfers
↓
Validate overdue installments
↓
Generate draw roster
↓
Issue reports
↓
Close month
```

## 26.2. Prior Validations

Before closing the month, the system should warn about:

- open settlements,
- unidentified transfers,
- unassociated payments,
- overdue installments,
- sold bonds without complete buyer information,
- collectors with inconsistent balances,
- prizes pending registration.

## 26.3. Added Value

- Administrative order.
- Prevents reaching the draw with incomplete information.
- Allows auditing each month.
- Improves operational discipline.

---

# 27. Pre-Draw Risk Report

Before each draw, the system should generate a report of at-risk bonds.

## 27.1. Criteria

Sold bonds that have pending installments required to participate in the next draw.

## 27.2. Example

```text
Next draw: December 2025
Required installment: 3

Collector Juan Pérez:
- Diego Fernández - Bond 1658 - owes installment 3
- María López - Bond 0100 - owes installments 2 and 3
```

## 27.3. Added Value

- Allows action before the cutoff.
- Helps the collector prioritize.
- Reduces unawarded prizes due to non-payment.
- Improves revenue collection.

---

# 28. Notifications

Future functionality with high value.

## 28.1. Notifications to Buyers

Example:

```text
Hi Diego, we remind you that installment 3 of Bond 1658 is due on 12/25.
To participate in the December draw you need to have your installments up to date.
```

## 28.2. Notifications to Collectors

Example:

```text
You have 18 buyers with pending installments before the December draw.
```

## 28.3. Notifications to Administration

Example:

```text
There are 12 unidentified transfers.
```

## 28.4. Possible Channels

- WhatsApp.
- Email.
- SMS.
- Internal system notification.

## 28.5. Added Value

- Reduces delinquency.
- Automates reminders.
- Improves communication.
- Helps prevent complaints.

---

# 29. Buyer Portal or Inquiry

In the future, the buyer could check their bond.

## 29.1. Simple Option

```text
Check bond
Enter bond number + phone or ID
```

## 29.2. Visible Information

- bond details,
- participating numbers,
- paid installments,
- pending installments,
- upcoming draws,
- participation status,
- receipts,
- payment methods.

## 29.3. Added Value

- Reduces inquiries to administration.
- Increases transparency.
- Improves buyer experience.
- Allows verifying payments.

---

# 30. Digital Receipts

In addition to the physical receipt, the system should be able to issue digital receipts.

## 30.1. Minimum Data

- campaign,
- bond,
- base number,
- associated number,
- buyer,
- collector,
- installment,
- amount,
- date,
- payment method,
- transaction number,
- registering user,
- validation code or QR.

## 30.2. Added Value

- Reduces complaints.
- Allows resending receipts.
- Leaves a clear history.
- Modernizes operations.

---

# 31. QR on Future Bonds

For future campaigns, it is recommended to print system-generated QR codes.

## 31.1. Example Content

```text
BOND-2025-2026-1658
```

Or a secure internal identifier.

## 31.2. QR Uses

- open bond record,
- register sale,
- register payment,
- include in settlement,
- allow buyer inquiry,
- validate digital receipts.

## 31.3. Added Value

- Independence from the old barcode.
- Better integration with the app.
- Greater operational speed.
- Foundation for buyer/collector portals.

---

# 32. Annulment and Correction Management

The system must assume there will be errors, but it should not allow deleting historical information without a record.

## 32.1. Payment Annulment Example

```text
Payment registered by mistake
↓
User requests annulment
↓
System requires a reason
↓
System reverses installment, commission, and settlement
↓
Everything is audited
```

## 32.2. Cases to Cover

- incorrectly entered payment,
- incorrectly entered sale,
- incorrect buyer,
- incorrect collector,
- bond assigned by mistake,
- incorrectly associated transfer,
- incorrectly entered prize,
- incorrectly grouped pata.

## 32.3. Added Value

- Prevents loss of history.
- Improves auditing.
- Allows corrections without breaking data.
- Builds trust in the system.

---

# 33. "Settlement Day" Mode

When multiple collectors are settling on the same day, administration could open a settlement day session.

## 33.1. Proposed Flow

```text
New settlement day
Date: 10/10/2025
↓
Settlement Juan Pérez
Settlement María Gómez
Settlement Carlos Díaz
↓
Day close
```

## 33.2. Day Summary

```text
Total cash received
Total transfers registered
Generated commissions
Settled commissions
Net for Firefighters
Cash register discrepancies
Number of settlements
```

## 33.3. Added Value

- Organizes high administrative workload days.
- Allows daily close.
- Facilitates reconciliation with the daily cash register.
- Replaces manual controls.

---

# 34. Firefighters Daily Cash Register

In addition to individual settlements, it is advisable to manage a daily cash register.

## 34.1. Income

- cash from settlements,
- transfers,
- other related income.

## 34.2. Expenses

- paid commissions,
- adjustments,
- other authorized expenses.

## 34.3. Cash Register Close

```text
Expected balance
Counted balance
Difference
Observations
Responsible user
```

## 34.4. Added Value

- Greater financial control.
- Better cash traceability.
- Allows detecting discrepancies.
- Facilitates administrative reports.

---

# 35. Campaign Indicators

The system should generate management indicators.

## 35.1. Suggested Indicators

```text
% of bonds sold
% of actual vs expected revenue
% delinquency rate
% buyer renewal rate
% payments by transfer
% payments in cash
Total generated commission
Total settled commission
Pending commission balance
Bonds at risk for next draw
Collectors with highest pending debt
Patass sold
Unsold bonds
Buyers lost compared to previous year
```

## 35.2. Added Value

- Allows data-driven decisions.
- Helps improve future campaigns.
- Allows reporting to the board of directors.
- Improves planning.

---

# 36. Campaign Close Flow

At the end of the campaign, there should be a formal close.

## 36.1. Proposed Flow

```text
Close campaign
↓
Validate completed draws
↓
Validate pending prizes
↓
Validate open settlements
↓
Validate unreturned bonds
↓
Validate collector balances
↓
Generate final report
↓
Block modifications
```

## 36.2. Post-Close Rules

After closing:

- normal changes should not be allowed,
- only administrators could make audited corrections,
- data should remain available as historical record,
- it should serve as a basis for the new campaign.

## 36.3. Added Value

- Organizes the end of the period.
- Prevents uncontrolled late modifications.
- Allows better start of the next campaign.
- Generates institutional traceability.

---

# 37. Final Campaign Report

Upon closing the campaign, the system should generate a final report.

## 37.1. Suggested Content

```text
Campaign 2025-2026

Bonds issued
Bonds sold
Unsold bonds
Patass sold
Gross revenue
Net revenue
Generated commissions
Settled commissions
Pending balances
Prizes delivered
Unawarded prizes
Pending debt
Renewed buyers
Lost buyers
Top collectors
```

## 37.2. Added Value

- Useful for administration.
- Useful for the board of directors.
- Useful for future planning.
- Allows comparing campaigns.

---

# 38. Bulk Bond Import

When printed bonds arrive, they should not be entered one by one.

## 38.1. Example File

```csv
bond_type,pata_group,base_number,barcode
simple,,1658,1658
simple,,0068,0068
pata,PATA1200,1200,PATA1200
pata,PATA1200,1315,PATA1200
pata,PATA1200,2200,PATA1200
```

## 38.2. Validations

The system must validate:

- duplicate numbers,
- duplicate associated numbers,
- out-of-range numbers,
- incomplete patas,
- repeated barcodes,
- conflicts with historical reservations,
- invalid format.

## 38.3. Preview Before Confirming

```text
Simple bonds to create: 3000
Patass to create: 120
Conflicts detected: 8
Duplicates detected: 2
```

## 38.4. Added Value

- Saves data entry time.
- Reduces errors.
- Allows validation before impacting data.
- Scales better with large campaigns.

---

# 39. Import from Previous Campaign

When creating a new campaign, the system should be able to use the previous one as a basis.

## 39.1. Data It Can Copy or Suggest

- collectors,
- historical buyers,
- usual numbers,
- installment configuration,
- commission configuration,
- draw types,
- prize structure,
- eligibility rules.

## 39.2. Proposed Flow

```text
Create campaign 2026-2027 from campaign 2025-2026
↓
Copy configuration
↓
Import new bonds
↓
Cross-reference numbers with history
↓
Generate reservations and conflicts
```

## 39.3. Added Value

- Speeds up annual startup.
- Reduces repetitive work.
- Improves commercial continuity.
- Allows automatic conflict detection.

---

# 40. Anti-Error Validations

The system should prevent dangerous or inconsistent actions.

## 40.1. Examples

```text
This bond has already been sold. It cannot be reassigned.
```

```text
This participating number already exists on another bond.
```

```text
You are trying to register installment 4, but installment 3 is still unpaid.
Do you want to register it as an advance payment or correct it?
```

```text
This buyer has previous debt.
```

```text
This transfer payment has not been reconciled yet.
```

```text
This bond does not enter the extraordinary draw because it was paid in full after the deadline.
```

## 40.2. Added Value

- Reduces human errors.
- Protects system consistency.
- Improves data trust.
- Prevents future complaints.

---

# 41. Suggested Functional Modules

Based on the improvements above, the functional modules could be:

1. Campaigns.
2. Bonds and Patas.
3. Imports.
4. Buyers.
5. Collectors.
6. Historical Reservations.
7. Bond Deliveries.
8. Sales.
9. Payments.
10. Settlements.
11. Commissions.
12. Collector Current Accounts.
13. Transfers.
14. Daily Cash Register.
15. Draws.
16. Rosters.
17. Prizes.
18. Reports.
19. Audit.
20. Users and Permissions.
21. Notifications.
22. Collector Portal.
23. Buyer Portal.

---

# 42. Implementation Phases

The MVP scope is defined in `docs/mvp.md` as a single delivery. To avoid context overload and segment the work, implementation is divided into internal phases. These are NOT separate MVP deliveries — they are all part of the same MVP.

The authoritative MVP scope is `docs/mvp.md`. The implementation plan in `docs/implementation-plan.md` defines the detailed phase breakdown.

---

## Phase 1 — Core Operations

Objective: replace the current system and the main Excel.

Features:

- Campaigns.
- Simple bonds and patas.
- Base number + associated number.
- Collectors.
- Buyers.
- Bond assignment to collectors.
- Delivery note.
- Bond sales.
- Installments.
- Payments.
- Settlements.
- Basic commissions.
- Simple collector current account.
- Collector report.
- Settlement delivery note.
- Basic audit.

---

## Phase 2 — Draws and Eligibility

Objective: control participation and prizes.

Features:

- Monthly draws.
- Extraordinary draw.
- Consolation draws.
- Final draw.
- Frozen roster.
- Eligibility validation.
- Winning number entry.
- Prize validation.
- Registration of delivered/unawarded prizes.
- Enabled/disabled report.

---

## Phase 3 — Operational Optimization (Post-MVP)

Objective: reduce manual workload and improve tracking.

Features:

- Barcode scanning (included in MVP).
- Bulk bond import (included in MVP).
- Import from previous campaign (included in MVP).
- Internal QR (post-MVP).
- Historical reservations (post-MVP).
- Number conflict management (post-MVP).
- Expiry alerts (post-MVP).
- Campaign dashboard (post-MVP).
- Pre-draw risk report (post-MVP).
- Unidentified transfers (post-MVP).

---

## Phase 4 — Advanced Digitalization (Post-MVP)

Objective: improve communication and self-service.

Features:

- Collector portal.
- Buyer portal.
- Digital receipts.
- WhatsApp/email/SMS notifications.
- Semi-automatic bank reconciliation.
- Advanced daily cash register.
- Comparative indicators between campaigns.

---

# 43. Critical Flows to Start Design

Before designing CRUD screens, it is advisable to design these complete flows:

1. Create campaign.
2. Import/enter bonds.
3. Calculate associated numbers.
4. Detect duplicates/conflicts.
5. Assign bonds to collectors.
6. Issue delivery note.
7. Register sale.
8. Register buyer.
9. Register payment.
10. Create settlement.
11. Calculate commission.
12. Update collector current account.
13. Issue settlement delivery note.
14. Generate monthly summary per collector.
15. Generate draw roster.
16. Enter winning number.
17. Validate prize.
18. Close month.
19. Close campaign.

---

# 44. Final Recommendation

The most important improvement is not about digitizing the old process exactly, but about redesigning it to have traceability, control, and automation.

The system should avoid becoming a collection of isolated screens.

The heart of the system should be:

```text
Campaign
↓
Bonds
↓
Collectors
↓
Buyers
↓
Payments
↓
Settlements
↓
Commissions
↓
Draws
↓
Prizes
```

Every relevant movement must be recorded.

Every important decision must be auditable.

Every draw must be justifiable with a frozen roster.

Every collector must have a clear current account.

Every bond must have a single record.

Every buyer must have a history.

That is the main added value compared to the current system.
