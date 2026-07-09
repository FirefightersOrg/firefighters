# Value-Added Features and Flows - Firefighters Raffle / Bond Management System

## 1. Document Objective

This document records features, processes, and proposed improvements so the new raffle system is not only a replacement for the current system, but a comprehensive improvement to the Firefighters' operational, administrative, and financial flow.

The idea is for this document to serve as a basis to:

1. Design functional modules.
2. Design screens and user flows.
3. Define the MVP scope.
4. Prioritize features.
5. Build a technical implementation task list.
6. Improve current processes that are now done manually or in Excel.

---

## 2. General Approach

The system should not be limited to loading bonds, buyers, and payments.

The real value is allowing Firefighters to know at all times:

```text
Who has each bond.
Who bought it.
Which numbers participate.
What was paid.
What is owed.
Which collector was involved.
Which commission applies.
What money came in.
What money is still missing.
Who can participate in the next draw.
Who cannot participate because of debt.
Which prizes were delivered.
Which collector settlements are pending.
Which transfers are unidentified.
```

The system should become a management and control tool, not just a database.

---

# 3. Presale Flow with Historical Reservations

Currently, the goal is to assign each collector the same numbers as the previous year, because many buyers want to keep their usual number.

This should become a formal system flow.

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
Buyer: Diego Fernandez
Usual number: 0068
Usual collector: Juan Perez

New campaign:
Number 0068 available

Action:
Reserve/assign number to the same collector
```

## 3.3. Case with Conflict

```text
Buyer: Diego Fernandez
Usual number: 0068
Usual collector: Juan Perez

New campaign:
Number 0068 belongs to a pata (multi-number bond/package)

Action:
Mark conflict and suggest alternative number
```

## 3.4. Added Value

- Reduces manual work.
- Reduces assignment errors.
- Improves commercial continuity.
- Avoids discussions with buyers.
- Gives the collector an initial portfolio of expected buyers.
- Allows measuring buyer renewal year over year.

---

# 4. Number Conflict Management

When a historical number is no longer available, the system should formally record the conflict.

## 4.1. Conflict Example

```text
Conflict No. 00034

Historical buyer: Diego Fernandez
Requested number: 0068
Reason: the number is included in a pata
Usual collector: Juan Perez
Campaign: 2025-2026
```

## 4.2. Possible Actions

- Assign alternative number.
- Keep buyer on waiting list.
- Offer to buy the full pata.
- Mark buyer as not renewed.
- Record administrative note.

## 4.3. Added Value

- Enables traceability.
- Avoids informal decisions without records.
- Allows measuring how many sales are lost or changed because of conflicts.
- Helps better plan bond/pata printing in future campaigns.

---

# 5. Buyer Renewal List

Each collector should have a list of historical buyers to contact.

## 5.1. Example

```text
Collector: Juan Perez

Clients to renew:
1. Diego Fernandez - Number 0068 - Pending contact
2. Maria Lopez - Number 0120 - Confirmed renewal
3. Ferreteria Mitre - Pata 1200 - Pending
```

## 5.2. Suggested Statuses

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

- Organizes the presale.
- Allows measuring renewal rate.
- Allows knowing which collector is managing their portfolio better.
- Reduces loss of usual buyers.
- Allows anticipating demand before delivering all bonds.

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
- Installments due soon.
- Registered transfer payments.
- Completed collector settlements.
- Generated commission.
- Settled commission.
- Credit or debit balance.

## 6.2. Added Value

- Reduces questions to administration.
- Organizes the collector's work.
- Improves debt follow-up.
- Allows detecting overdue installments before draws.
- Improves commission transparency.

---

# 7. Quick Loading by Scan

The system should use barcode or QR scanning to speed up operations.

The barcode currently exists on the bond, but it is not confirmed what data it contains or whether it works correctly in the old system.

## 7.1. Ideal Flow

```text
Administrator scans bond
↓
System opens the bond record
↓
Allows recording sale, payment, or collector settlement
```

## 7.2. Flow for Collector Settlement

```text
Create collector settlement
↓
Scan bond
↓
Select paid installment
↓
Choose payment method
↓
Add payment to the collector settlement
```

## 7.3. Recommendation

The new system should store:

- base number,
- calculated associated number,
- printed barcode, if it exists,
- the system's own internal identifier.

For future campaigns, generating the system's own QR code is recommended.

## 7.4. Added Value

- Less typing.
- Fewer loading errors.
- Greater speed in collector settlements.
- Better experience for administration.
- Basis for automating future campaigns.

---

# 8. Assisted Collector Settlement

The collector settlement should be a central flow of the system, not a simple payment load.

## 8.1. Proposed Flow

```text
Create collector settlement
↓
Select collector
↓
Scan or search bonds
↓
Add installments/payments
↓
Separate cash and transfer
↓
Calculate commission automatically
↓
Calculate net amount for Firefighters
↓
Calculate collector credit balance
↓
Confirm collector settlement
↓
Print receipt
```

## 8.2. Real-Time Summary

During loading, the screen should show:

```text
Total cash: $...
Total transfer: $...
Total collected: $...
Generated commission: $...
Commission settled now: $...
Collector credit balance: $...
Net amount for Firefighters: $...
```

## 8.3. Added Value

- Replaces the current Excel.
- Reduces calculation errors.
- Organizes the relationship with the collector.
- Allows issuing clear receipts.
- Allows closing cash with greater accuracy.

---

# 9. Collector Current Account

Each collector should have an internal administrative current account.

It does not necessarily represent a bank account. It represents the balance between Firefighters and the collector.

## 9.1. Possible Movements

- Commission generated by cash payment.
- Commission generated by transfer.
- Commission settled/paid.
- Cash delivered by the collector.
- Authorized manual adjustments.
- Voids.
- Audited corrections.
- Collector credit balance.
- Firefighters credit balance.

## 9.2. Example with Transfer

```text
Buyer pays by transfer: $6,000
Firefighters receives: $6,000
Commission generated for collector: $1,500

Movement:
Collector credit balance +$1,500
```

## 9.3. Example with Cash

```text
Buyer pays in cash: $6,000
Generated commission: $1,500
Net Firefighters: $4,500
```

## 9.4. Added Value

- Avoids discussions about commissions.
- Allows accumulating commissions.
- Allows settling them later.
- Allows controlling transfers.
- Gives transparency to the collector and administration.

---

# 10. Transfer Payment Control

Because transfer payments go directly to Firefighters, the system must have a specific flow.

## 10.1. Proposed Flow

```text
Buyer transfers to Firefighters
↓
Administration records the transfer
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

## 10.3. Unidentified Transfers Inbox

The system should have a specific section for pending transfers.

The system could suggest matches:

```text
Suggestions:
1. Diego Fernandez - Bond 0068 - Installment 2
2. Diego Fernandez - Bond 1658 - Installment 2
```

## 10.4. Added Value

- Avoids lost payments.
- Improves reconciliation.
- Organizes collector balances.
- Reduces errors when marking installments as paid.
- Allows preparing future bank reconciliation.

---

# 11. Semi-Automatic Bank Reconciliation

Advanced feature, not necessarily for the initial MVP.

## 11.1. Proposed Flow

```text
Administration downloads bank movements
↓
Imports file into the system
↓
System detects possible matches
↓
Administrator confirms or corrects
↓
Payments remain associated to installments
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
- Allows scaling if transfer use increases.

---

# 12. Overdue Installment Alerts

The system should automatically detect overdue installments.

## 12.1. Example

```text
Bond: 1658
Buyer: Diego Fernandez
Collector: Juan Perez
Overdue installment: installment 3
Days overdue: 12
```

## 12.2. Useful Views

- Overdue installments by collector.
- Overdue installments by buyer.
- Bonds at risk of not participating in the next draw.
- Bonds with several overdue installments.
- Repeat overdue buyers.

## 12.3. Added Value

- Allows taking action before the draw.
- Reduces delinquency.
- Improves collection.
- Helps the collector prioritize visits/contacts.

---

# 13. Alerts Before Each Draw

Before each monthly draw, the system should show an operational alert.

## 13.1. Example

```text
Draw: December 2025
Required installment: 3
Cutoff date: 26/12/2025

Enabled bonds: 1340
Disabled bonds: 210
Bonds with recoverable debt: 95
```

## 13.2. Recoverable Debt Concept

Bonds that are not currently enabled, but could become enabled if they pay before the cutoff.

Example:

```text
Bond 1658
Owes installment 3
If paid before the cutoff, participates in the draw.
```

## 13.3. Added Value

- Allows notifying buyers.
- Allows prioritizing collections.
- Reduces later complaints.
- Improves collection before draws.

---

# 14. Frozen Draw Roster

The roster of enabled participants must be generated before each draw and remain frozen.

## 14.1. Proposed Flow

```text
Generate draw roster
↓
System calculates enabled/disabled entries
↓
Administrator reviews
↓
Draw roster is frozen
↓
Draw is performed
↓
Winners are loaded
```

## 14.2. Why It Must Be Frozen

It must not be dynamically recalculated after the draw, because someone could pay late and appear enabled in the system even though they were not enabled at the time of the draw.

## 14.3. Added Value

- Transparency.
- Traceability.
- Avoids complaints.
- Allows justifying prizes not awarded.
- Improves legal/administrative control.

---

# 15. Winner Simulator / Validator

When a winning number is loaded, the system should clearly explain the result.

## 15.1. Example

```text
Winning number: 6529

Matches:
Bond: 1658
Winning number: associated
Base number: 1658
Buyer: Diego Fernandez
Collector: Juan Perez

Status in draw roster:
Disabled

Reason:
Installment 3 unpaid at cutoff time

Result:
Prize not awarded
```

## 15.2. Added Value

- Avoids manual interpretations.
- Reduces errors when assigning prizes.
- Makes decisions easier to explain.
- Allows auditing results.

---

# 16. Delivered Prize Control

It is not enough to record the winning number. The full prize cycle must be recorded.

## 16.1. Delivered Prize Flow

```text
Prize drawn
↓
Winner identified
↓
Winner eligible
↓
Prize pending delivery
↓
Prize delivered
```

## 16.2. Prize Not Awarded Flow

```text
Prize drawn
↓
Winner identified
↓
Winner not eligible
↓
Prize not awarded
↓
Administrative note
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
- user who records it,
- proof or receipt,
- notes.

## 16.4. Added Value

- Controls pending prizes.
- Avoids omissions.
- Enables reports on delivered/not delivered prizes.
- Improves institutional transparency.

---

# 17. Single Bond Record

Each bond should have a central record, like a complete case file.

## 17.1. Suggested Information

```text
Bond 1658

Campaign: 2025-2026
Type: Simple
Base number: 1658
Associated number: 6529
Commercial status: Sold
Financial status: Up to date
Collector: Juan Perez
Buyer: Diego Fernandez
```

## 17.2. Record Sections

- General data.
- Participant numbers.
- Assigned collector.
- Buyer.
- Installments.
- Payments.
- Collector settlements.
- Generated commissions.
- Draws in which it participated.
- Eligibility status by draw.
- Prizes.
- History/audit.

## 17.3. Added Value

- Saves search time.
- Centralizes all information.
- Allows resolving complaints quickly.
- Facilitates auditing.

---

# 18. Single Buyer Record

The buyer should have a complete history.

## 18.1. Suggested Information

```text
Buyer: Diego Fernandez

Campaigns:
2023-2024: Bond 0068
2024-2025: Bond 0068
2025-2026: Bond 1658

Usual collector:
Juan Perez

Current status:
Installment 1 paid
Installment 2 paid
Installment 3 pending
```

## 18.2. Added Value

- Allows knowing whether they are a recurring buyer.
- Allows viewing usual numbers.
- Allows detecting debts.
- Allows improving service.
- Helps with annual renewal.

---

# 19. Single Collector Record

The collector should have an integral view.

## 19.1. Suggested Information

```text
Collector: Juan Perez

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

- Allows managing collectors better.
- Reduces uncertainty about balances.
- Allows detecting low performance or operational problems.
- Improves collection planning.

---

# 20. Collector Ranking and Tracking

The system could generate operational rankings.

## 20.1. Possible Indicators

- Collectors with the highest sales.
- Collectors with the highest up-to-date collection.
- Collectors with the most overdue debt.
- Collectors with the most unsold bonds.
- Collectors with the highest number of transfers.
- Collectors with pending commission balance.

## 20.2. Recommended Use

It should not be used as a punitive tool, but as operational control and management support.

## 20.3. Added Value

- Detects collectors who need help.
- Identifies zones or portfolios with low collection.
- Allows making decisions before campaign closing.

---

# 21. Bond Return Workflow

Not all assigned bonds are sold. A clear return flow must exist.

## 21.1. Simple Flow

```text
Collector returns bond
↓
Administration receives it
↓
Bond becomes available again
```

## 21.2. Flow with Reassignment

```text
Collector returns bond
↓
Administration receives it
↓
Bond is reassigned to another collector
```

## 21.3. Possible Statuses

```text
Available
Assigned to collector
Sold
Returned
Reassigned
Lost
Voided
```

## 21.4. Added Value

- Physical control of bonds.
- Avoids losing printed cards.
- Allows quickly reassigning unsold bonds.
- Maintains traceability.

---

# 22. Lost Bond Control

A process for lost or misplaced bonds must exist.

## 22.1. Data to Record

- bond,
- responsible collector,
- date,
- reason,
- note,
- user who records it,
- subsequent status,
- whether it is voided,
- whether it is replaced,
- whether it is formally reported.

## 22.2. Added Value

- Improves physical control.
- Prevents lost bonds from continuing to circulate without control.
- Leaves responsibility and traceability.
- Helps with complaints.

---

# 23. Smart Pata Assembly

When there are no printed patas left and simple bonds need to be grouped, the system should assist creation.

## 23.1. Proposed Flow

```text
Create new pata
↓
Define number of units
↓
System searches available bonds
↓
System warns about conflicts
↓
Administrator confirms grouping
```

## 23.2. Suggestion Criteria

The system should suggest bonds that:

- are available,
- are not sold,
- are not assigned,
- do not have active historical reservation,
- are not committed to a collector,
- do not have number conflicts.

## 23.3. Added Value

- Avoids breaking historical reservations.
- Avoids grouping committed bonds.
- Reduces administrative errors.
- Facilitates large sales to companies.

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
Juan Perez
```

## 24.2. If It Was Assembled Manually

```text
Origin:
Manually assembled

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
- Less confusion when selling several numbers.

---

# 25. General Campaign Dashboard

Administration should have a main screen with indicators.

## 25.1. Suggested Indicators

```text
Campaign 2025-2026

Total bonds: 3000
Sold bonds: 1850
Available bonds: 600
Bonds with collectors unsold: 550

Expected collection: $...
Actual collected: $...
Pending: $...

Cash: $...
Transfer: $...

Generated commissions: $...
Settled commissions: $...
Collectors pending balance: $...

Next draw:
December 2025
Enabled bonds: 1430
Bonds at risk: 220
```

## 25.2. Added Value

- Allows having a global view.
- Helps make decisions.
- Shows problems before they become serious.
- Turns the system into a management tool.

---

# 26. Monthly Closing Flow

Each month should be operationally closable.

## 26.1. Proposed Flow

```text
Monthly closing
↓
Validate pending collector settlements
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

- open collector settlements,
- unidentified transfers,
- unassociated payments,
- overdue installments,
- sold bonds without complete buyer,
- collectors with inconsistent balance,
- prizes pending registration.

## 26.3. Added Value

- Administrative order.
- Avoids reaching the draw with incomplete information.
- Allows auditing each month.
- Improves operational discipline.

---

# 27. Risk Report Before the Draw

Before each draw, the system should generate a report of bonds at risk.

## 27.1. Criterion

Sold bonds that have pending installments required to participate in the next draw.

## 27.2. Example

```text
Next draw: December 2025
Required installment: 3

Collector Juan Perez:
- Diego Fernandez - Bond 1658 - owes installment 3
- Maria Lopez - Bond 0100 - owes installments 2 and 3
```

## 27.3. Added Value

- Allows taking action before the cutoff.
- Helps the collector prioritize.
- Reduces prizes not awarded due to lack of payment.
- Improves collection.

---

# 28. Notifications

Future feature with high value.

## 28.1. Notifications to Buyers

Example:

```text
Hi Diego, we remind you that installment 3 of Bond 1658 is due on 25/12.
To participate in the December draw, you must have your installments up to date.
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
Enter bond number + phone or DNI
```

## 29.2. Visible Information

- bond data,
- participant numbers,
- paid installments,
- pending installments,
- upcoming draws,
- participation status,
- receipts,
- payment methods.

## 29.3. Added Value

- Reduces questions to administration.
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
- operation number,
- user who recorded it,
- validation code or QR.

## 30.2. Added Value

- Reduces complaints.
- Allows resending receipts.
- Leaves a clear history.
- Modernizes operations.

---

# 31. QR on Future Bonds

For future campaigns, printing system-generated QR codes is recommended.

## 31.1. Content Example

```text
BOND-2025-2026-1658
```

Or a secure internal identifier.

## 31.2. QR Uses

- open bond record,
- record sale,
- record payment,
- include in collector settlement,
- allow buyer inquiry,
- validate digital receipts.

## 31.3. Added Value

- Independence from the old barcode.
- Better integration with the app.
- Greater operational speed.
- Basis for buyer/collector portals.

---

# 32. Voiding and Correction Management

The system must assume there will be errors, but must not allow deleting historical information without a record.

## 32.1. Payment Voiding Example

```text
Payment recorded by mistake
↓
User requests voiding
↓
System requires reason
↓
System reverts installment, commission, and collector settlement
↓
Everything remains audited
```

## 32.2. Cases to Consider

- incorrectly loaded payment,
- incorrectly loaded sale,
- incorrect buyer,
- incorrect collector,
- bond assigned by mistake,
- incorrectly associated transfer,
- incorrectly loaded prize,
- incorrectly grouped pata.

## 32.3. Added Value

- Avoids history loss.
- Improves auditing.
- Allows correcting without breaking data.
- Gives confidence in the system.

---

# 33. "Collector Settlement Day" Mode

When several collectors settle on the same day, administration could open a collector settlement day.

## 33.1. Proposed Flow

```text
New collector settlement day
Date: 10/10/2025
↓
Juan Perez collector settlement
Maria Gomez collector settlement
Carlos Diaz collector settlement
↓
Day closing
```

## 33.2. Day Summary

```text
Total cash received
Total transfers registered
Generated commissions
Settled commissions
Net Firefighters
Cash differences
Number of collector settlements
```

## 33.3. Added Value

- Organizes high administrative workload days.
- Allows daily closing.
- Facilitates reconciliation with cash.
- Replaces manual controls.

---

# 34. Firefighters Daily Cash

In addition to individual collector settlements, managing daily cash is convenient.

## 34.1. Income

- cash from collector settlements,
- transfers,
- other related income.

## 34.2. Expenses

- paid commissions,
- adjustments,
- other authorized expenses.

## 34.3. Cash Closing

```text
Expected balance
Counted balance
Difference
Notes
Responsible user
```

## 34.4. Added Value

- Greater financial control.
- Better cash traceability.
- Allows detecting differences.
- Facilitates administrative reports.

---

# 35. Campaign Indicators

The system should generate indicators for management.

## 35.1. Suggested Indicators

```text
% of bonds sold
% of actual vs expected collection
% delinquency
% buyer renewal
% transfer payments
% cash payments
Total generated commission
Total settled commission
Pending commission balance
Bonds at risk for next draw
Collectors with highest pending debt
Patas sold
Unsold bonds
Buyers lost compared to previous year
```

## 35.2. Added Value

- Allows making data-driven decisions.
- Helps improve future campaigns.
- Allows reporting to the board of directors.
- Improves planning.

---

# 36. Campaign Closing Flow

At the end of the campaign, a formal closing should exist.

## 36.1. Proposed Flow

```text
Close campaign
↓
Validate completed draws
↓
Validate pending prizes
↓
Validate open collector settlements
↓
Validate unreturned bonds
↓
Validate collector balances
↓
Generate final report
↓
Block modifications
```

## 36.2. Rules After Closing

After closing:

- normal changes should not be allowed,
- only administrators could make audited corrections,
- data should remain available as historical records,
- it should serve as a basis for the new campaign.

## 36.3. Added Value

- Organizes the end of the period.
- Avoids late modifications without control.
- Allows starting the next campaign better.
- Generates institutional traceability.

---

# 37. Final Campaign Report

When closing the campaign, the system should generate a final report.

## 37.1. Suggested Content

```text
Campaign 2025-2026

Bonds issued
Bonds sold
Unsold bonds
Patas sold
Gross collection
Net collection
Generated commissions
Settled commissions
Pending balances
Delivered prizes
Prizes not awarded
Pending debt
Renewed buyers
Lost buyers
Highlighted collectors
```

## 37.2. Added Value

- Useful for administration.
- Useful for the board of directors.
- Useful for future planning.
- Allows comparing campaigns.

---

# 38. Bulk Bond Import

When printed bonds arrive, they should not be loaded one by one.

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
- numbers outside range,
- incomplete patas,
- repeated barcodes,
- conflicts with historical reservations,
- invalid format.

## 38.3. Preview Before Confirming

```text
Simple bonds to create: 3000
Patas to create: 120
Conflicts detected: 8
Duplicates detected: 2
```

## 38.4. Added Value

- Saves loading time.
- Reduces errors.
- Allows validating before affecting data.
- Scales better with large campaigns.

---

# 39. Import from Previous Campaign

When creating a new campaign, the system should be able to use the previous one as a base.

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
Cross-check numbers with history
↓
Generate reservations and conflicts
```

## 39.3. Added Value

- Speeds up the annual start.
- Reduces repetitive loading.
- Improves commercial continuity.
- Allows detecting conflicts automatically.

---

# 40. Anti-Error Validations

The system should prevent dangerous or inconsistent actions.

## 40.1. Examples

```text
This bond has already been sold. It cannot be reassigned.
```

```text
This participant number already exists in another bond.
```

```text
You are trying to record installment 4, but installment 3 is still unpaid.
Do you want to record it as an advance payment or correct it?
```

```text
This buyer has previous debt.
```

```text
This transfer payment has not been reconciled yet.
```

```text
This bond does not enter the extraordinary draw because it was fully paid after the deadline.
```

## 40.2. Added Value

- Reduces human errors.
- Protects system consistency.
- Improves trust in the data.
- Avoids future complaints.

---

# 41. Suggested Functional Modules

Based on the previous improvements, the functional modules could be:

1. Campaigns.
2. Bonds and patas.
3. Imports.
4. Buyers.
5. Collectors.
6. Historical reservations.
7. Bond deliveries.
8. Sales.
9. Payments.
10. Collector settlements.
11. Commissions.
12. Collector current account.
13. Transfers.
14. Daily cash.
15. Draws.
16. Draw rosters.
17. Prizes.
18. Reports.
19. Audit.
20. Users and permissions.
21. Notifications.
22. Collector portal.
23. Buyer portal.

---

# 42. MVP Prioritization

It is not convenient to implement everything from the beginning. Dividing it into stages is proposed.

---

## MVP 1 - Real Basic Operational Control

Objective: replace the current system and the main Excel.

Features:

- Campaigns.
- Simple bonds and patas.
- Base number + associated number.
- Collectors.
- Buyers.
- Bond assignment to collectors.
- Delivery receipt.
- Bond sale.
- Installments.
- Payments.
- Collector settlements.
- Basic commissions.
- Simple collector current account.
- Report by collector.
- Collector settlement receipt.
- Basic audit.

---

## MVP 2 - Draws and Eligibility

Objective: control participation and prizes.

Features:

- Monthly draws.
- Extraordinary draw.
- Consolation draws.
- Final draw.
- Frozen draw roster.
- Enabled entry validation.
- Winning number loading.
- Prize validation.
- Delivered/not awarded prize registration.
- Enabled/disabled report.

---

## MVP 3 - Operational Optimization

Objective: reduce manual loading and improve follow-up.

Features:

- Barcode scanning.
- Internal QR.
- Bulk bond import.
- Import from previous campaign.
- Historical reservations.
- Number conflict management.
- Due-date alerts.
- Campaign dashboard.
- Risk report before the draw.
- Unidentified transfers.

---

## MVP 4 - Advanced Digitalization

Objective: improve communication and self-service.

Features:

- Collector portal.
- Buyer portal.
- Digital receipts.
- Notifications by WhatsApp/email/SMS.
- Semi-automatic bank reconciliation.
- Advanced daily cash.
- Comparative indicators between campaigns.

---

# 43. Critical Flows to Start Design

Before designing CRUD screens, these full flows should be designed:

1. Create campaign.
2. Import/load bonds.
3. Calculate associated numbers.
4. Detect duplicates/conflicts.
5. Assign bonds to collectors.
6. Issue delivery receipt.
7. Record sale.
8. Record buyer.
9. Record payment.
10. Create collector settlement.
11. Calculate commission.
12. Update collector current account.
13. Issue collector settlement receipt.
14. Generate monthly summary by collector.
15. Generate draw roster.
16. Load winning number.
17. Validate prize.
18. Close month.
19. Close campaign.

---

# 44. Final Recommendation

The most important improvement is not digitalizing the old process exactly, but redesigning it to have traceability, control, and automation.

The system should avoid becoming a set of isolated screens.

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
Collector settlements
↓
Commissions
↓
Draws
↓
Prizes
```

Every relevant movement must be recorded.

Every important decision must be auditable.

Every draw must be justifiable with a frozen draw roster.

Every collector must have a clear current account.

Every bond must have a single record.

Every buyer must have history.

That is the main added value compared to the current system.
