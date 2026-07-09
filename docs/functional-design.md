# Functional Design

## Objective

Define modules, roles, screens, and main flows for the bond management system. This document describes expected behavior from an operational point of view.

## Roles

The system must use granular permissions grouped into roles. The detailed definition is in `docs/permissions.md`.

### Administrator

Can manage general configuration, campaigns, users, rules, bonds, payments, collector settlements, draws, prizes, and reports.

### Administrative Operator

Can load buyers, sales, payments, collector settlements, delivery notes, and operational queries. Must not modify critical campaign rules.

### Treasurer

Can query and manage financial information, collector settlements, commissions, collector ledger, transfers, reports, and closings.

### Collector

Initially may not have direct access. The model must allow a collector to query their portfolio, payments, pending installments, and balance in the future.

### Read-Only

Read-only, with access to defined reports and queries.

## Functional Modules

### Campaigns

Allows creating and configuring the annual bond period.

Suggested screens:

- Campaign list.
- Create/edit campaign.
- Number configuration.
- Installment configuration.
- Commission configuration.
- Draw configuration.

### Bonds and patas (multi-number bond/packages)

Allows managing simple bonds and patas.

Suggested screens:

- Bond list.
- Single bond record.
- Manual bond loading.
- Pata loading.
- Barcode loading/search.
- Number validation.
- Search by visible number, associated number, barcode, or internal identifier.

### Collectors

Allows managing sellers/collectors and querying their status.

Suggested screens:

- Collector list.
- Single collector record.
- Assigned bonds.
- Collector settlements.
- Collector ledger.
- Monthly summary.

### Buyers

Allows managing buyers and their history.

Suggested screens:

- Buyer list.
- Single buyer record.
- Purchased bonds.
- Payments.
- Prizes.

### Bond Deliveries

Allows registering physical delivery of bonds to collectors.

Suggested screens:

- New delivery.
- Delivery detail.
- Printable delivery note.
- Return or reassignment.

### Sales

Allows registering that a bond was sold to a buyer.

Suggested screens:

- New sale.
- Bond selection.
- Buyer selection or creation.
- Payment mode.
- Installment generation.

### Payments

Allows registering cash payments, installments, and early payments.

Suggested screens:

- Register payment.
- Bond and installment selection.
- Payment method.
- Installment status.
- Payment history.

### Collector Settlements

Allows registering the process where a collector submits sales and payments to administration.

Suggested screens:

- Create collector settlement.
- Assisted payment loading.
- Real-time summary.
- Collector settlement closing.
- Printable settlement note.
- Audited corrections.
- Manual commission adjustments with permission.

### Draws

Allows managing draws and validating winners.

Suggested screens:

- Draw list.
- Create draw.
- Generate draw roster.
- View frozen draw roster.
- Load winner.
- Validation result.
- Prizes.

Specific draw rules are in `docs/draw-rules.md`.

### Imports

Allows loading data by barcode, file, or export from the old system.

Suggested screens:

- New import session.
- Scan loading.
- Batch preview.
- Error report.
- Import confirmation.

### Documents

Allows issuing printable HTML for delivery notes and receipts.

Initial documents:

- Delivery note.
- Collector settlement note.
- Payment receipt.
- Delivered prize receipt.
- Not-awarded prize receipt.

## Main Flows

### Create Campaign

```txt
Administrator creates campaign
↓
Configures simple bond value
↓
Configures installments
↓
Configures numbering
↓
Configures commissions
↓
Configures expected draws
↓
Campaign becomes active for bond loading
```

### Load Simple Bond

```txt
User enters base number
↓
System calculates associated number
↓
System validates range according to campaign
↓
System validates duplicate participating numbers
↓
System creates bond
↓
Bond becomes available in administration
```

### Load Pata

```txt
User creates pata
↓
Enters several base numbers
↓
System calculates associated numbers
↓
System validates range and duplicates
↓
System calculates provisional pata value
↓
Pata becomes available in administration
```

### Deliver Bonds to Collector

```txt
User creates delivery
↓
Selects collector
↓
Selects available bonds
↓
Confirms delivery
↓
Bonds move to delivered to collector
↓
System generates delivery note
```

### Register Sale

```txt
User searches for bond
↓
System verifies that it is assigned or available according to operational rule
↓
User selects or creates buyer
↓
User defines payment mode
↓
System generates installment plan
↓
Bond becomes sold
```

### Register Payment Inside Collector Settlement

```txt
User opens or creates collector settlement for the collector
↓
Searches for sold bond
↓
Selects installments or full payment
↓
Indicates payment method
↓
System adds payment to open collector settlement
↓
System recalculates totals and preliminary commission
```

### Close Collector Settlement

```txt
User reviews summary
↓
System shows cash, transfer, total, commission, and net amount
↓
User confirms closing
↓
System confirms payments
↓
System consolidates commissions
↓
System generates collector ledger entries
↓
System blocks direct editing of the collector settlement
↓
System issues settlement note
```

### Correct Closed Collector Settlement

```txt
User detects error
↓
Requests correction with reason
↓
System generates audited annulment or adjustment
↓
System updates balances from new entries
↓
The original collector settlement remains closed as history
```

### Generate Draw Roster

```txt
User selects draw
↓
System evaluates eligibility rule
↓
System uses confirmed payments before the cutoff
↓
System generates eligible and ineligible participants
↓
User reviews
↓
System freezes draw roster
```

### Load Winning Number

```txt
User enters winning number
↓
System searches for match in frozen draw roster
↓
System identifies bond, buyer, and collector
↓
System reports whether it was eligible
↓
User records prize result
```

## MVP Priority Screens

- Campaign dashboard.
- Campaigns.
- Bonds.
- Bond record.
- Collectors.
- Collector record.
- Buyers.
- Bond delivery.
- Sale.
- Assisted collector settlement.
- Collector ledger.
- Draws.
- Draw roster.
- Winner loading.
- Basic reports.

Expanded screen details: `docs/screens.md`.

## Corrections

Annulment and correction flows are defined in `docs/corrections.md`.

Main rule:

```txt
Sensitive history is not deleted. It is annulled, adjusted, or offset with audit.
```
