# Functional Design

## Objective

Define modules, roles, screens, and main flows of the bond management system. This document describes expected behavior from an operational point of view.

## Roles

The system must use granular permissions grouped into roles. The detailed definition is in `docs/permissions.md`.

### Administrator

Can manage general configuration, campaigns, users, rules, bonds, payments, settlements, draws, prizes, and reports.

### Administrative Operator

Can enter buyers, sales, payments, settlements, delivery notes, and operational queries. Must not modify critical campaign rules.

### Treasurer

Can view and manage financial information, settlements, commissions, current account, transfers, reports, and closings.

### Collector

May not have direct access initially. The model should allow them in the future to view their portfolio, payments, pending installments, and balance.

### Read-only

Read-only access, with access to defined reports and queries.

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

### Bonds and Patas

Allows managing simple bonds and patas.

Suggested screens:

- Bond list.
- Single bond record.
- Manual bond entry.
- Pata entry.
- Barcode entry/search.
- Number validation.
- Search by visible number, associated number, barcode, or internal identifier.

### Collectors

Allows managing sellers/collectors and viewing their status.

Suggested screens:

- Collector list.
- Single collector record.
- Assigned bonds.
- Settlements.
- Current account.
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

Allows recording physical delivery of bonds to collectors.

Suggested screens:

- New delivery.
- Delivery detail.
- Printable delivery note.
- Return or reassignment.

### Sales

Allows recording that a bond was sold to a buyer.

Suggested screens:

- New sale.
- Bond selection.
- Buyer selection or creation.
- Payment modality.
- Installment generation.

### Payments

Allows recording cash payments, installments, and advance payments.

Suggested screens:

- Record payment.
- Bond and installment selection.
- Payment method.
- Installment status.
- Payment history.

### Settlements

Allows recording the process where a collector reports sales and payments to administration.

Suggested screens:

- Create settlement.
- Assisted payment entry.
- Real-time summary.
- Settlement closing.
- Printable delivery note.
- Audited corrections.
- Manual commission adjustments with permission.

### Draws

Allows managing draws and validating winners.

Suggested screens:

- Draw list.
- Create draw.
- Generate roster.
- View frozen roster.
- Enter winner.
- Validation result.
- Prizes.

Specific draw rules are in `docs/draw-rules.md`.

### Imports

Allows loading data by barcode, file, or export from the old system.

Suggested screens:

- New import session.
- Scan entry.
- Batch preview.
- Error report.
- Import confirmation.

### Documents

Allows issuing printable HTML for delivery notes and certificates.

Initial documents:

- Delivery note.
- Settlement delivery note.
- Payment certificate.
- Prize delivery certificate.
- Unawarded prize certificate.

## Main Flows

### Create campaign

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
Campaign becomes active for bond entry
```

### Enter simple bond

```txt
User enters base number
↓
System calculates associated number
↓
System validates range per campaign
↓
System validates duplicate participating numbers
↓
System creates bond
↓
Bond becomes available in administration
```

### Enter pata

```txt
User creates pata
↓
Enters multiple base numbers
↓
System calculates associated numbers
↓
System validates range and duplicates
↓
System calculates provisional pata value
↓
Pata becomes available in administration
```

### Deliver bonds to collector

```txt
User creates delivery
↓
Selects collector
↓
Selects available bonds
↓
Confirms delivery
↓
Bonds change to delivered to collector
↓
System generates delivery note
```

### Record sale

```txt
User searches for bond
↓
System verifies it is assigned or available per operational rule
↓
User selects or creates buyer
↓
User defines payment modality
↓
System generates installment plan
↓
Bond is marked as sold
```

### Record payment within settlement

```txt
User opens or creates collector settlement
↓
Searches for sold bond
↓
Selects installments or full payment
↓
Indicates payment method
↓
System adds payment to open settlement
↓
System recalculates totals and preliminary commission
```

### Close settlement

```txt
User reviews summary
↓
System shows cash, transfer, total, commission, and net
↓
User confirms closing
↓
System confirms payments
↓
System consolidates commissions
↓
System generates current account entries
↓
System blocks direct editing of the settlement
↓
System issues delivery note
```

### Correct closed settlement

```txt
User detects error
↓
Requests correction with reason
↓
System generates voided or audited adjustment
↓
System updates balances from new entries
↓
Original settlement remains closed as history
```

### Generate draw roster

```txt
User selects draw
↓
System evaluates eligibility rule
↓
System uses confirmed payments before cutoff
↓
System generates enabled and disabled participants
↓
User reviews
↓
System freezes roster
```

### Enter winning number

```txt
User enters winning number
↓
System searches for match in frozen roster
↓
System identifies bond, buyer, and collector
↓
System reports whether it was enabled
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
- Assisted settlement.
- Collector current account.
- Draws.
- Draw roster.
- Winner entry.
- Basic reports.

Expanded screen detail: `docs/screens.md`.

## Corrections

Voiding and correction flows are defined in `docs/corrections.md`.

Main rule:

```txt
Sensitive history is never deleted. It is voided, adjusted, or compensated with audit.
```
