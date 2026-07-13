# Screens and functional experience

## Objective

Define MVP priority screens and provide an adaptable foundation for future functionality.

## UI principles

- Design by operational flows, not just CRUD.
- Show actions based on permissions.
- Prioritize quick search by number, buyer, collector, and barcode.
- Maintain single records to resolve claims quickly.
- All key screens must work on desktop and mobile.

## Main navigation

Suggested sections:

- Dashboard.
- Campaigns.
- Bonds.
- Collectors.
- Buyers.
- Sales.
- Settlements.
- Draws.
- Reports.
- Administration.

## MVP screens

### Campaign dashboard

Objective: show overall status of the active campaign.

Must display:

- Total bonds, sold, available, and delivered.
- Expected, collected, and pending revenue.
- Cash and transfers.
- Generated and settled commissions.
- Collector balances.
- Next draw.
- Bonds at risk for the next draw.

### Bonds

Objective: search and filter bonds.

Filters:

- Campaign.
- Base number.
- Associated number.
- Barcode.
- Type: simple or pata.
- Commercial status.
- Financial status.
- Collector.
- Buyer.

Actions:

- Create bond.
- Create pata.
- Load by barcode.
- Assign to collector.
- View record.

### Bond record

Objective: complete bond file.

Sections:

- General data.
- Participating numbers.
- Barcode.
- Current collector.
- Current buyer.
- Sale.
- Installments.
- Payments.
- Settlements.
- Commissions.
- Draws and rosters.
- Prizes.
- Audit.

### Barcode loading

Objective: speed up loading or searching for physical bonds.

Flow:

```txt
Select campaign
↓
Choose read mode
↓
Scan code
↓
System interprets value
↓
System displays result
↓
User confirms or corrects
```

Possible modes:

- Code represents base number.
- Code represents internal identifier.
- Code represents external legacy code.
- Code requires manual mapping.

### Collectors

Objective: manage sellers/collectors.

Must display:

- Contact information.
- Assigned bonds.
- Sold bonds.
- Portfolio debt.
- Settlements.
- Commissions.
- Current balance.

### Collector record

Objective: comprehensive collector view.

Sections:

- General data.
- Assigned bonds.
- Associated buyers.
- Pending installments.
- Settlements.
- Current account.
- Monthly report.
- Audit.

### Buyers

Objective: manage buyers and history.

Must allow:

- Create/edit.
- Search by name, phone, document, or tax ID.
- View purchased bonds.
- View debt.
- View prizes.
- View historical numbers if migrated.

### Sale

Objective: register sale of bond or pata.

Flow:

```txt
Search bond
↓
Validate availability
↓
Select or create buyer
↓
Confirm collector
↓
Choose payment method
↓
Generate installments
↓
Record initial payment if applicable
```

### Assisted settlement

Objective: replace the operational spreadsheet.

Must display in real time:

- Total cash.
- Total transfer.
- Grand total.
- Preliminary commission.
- Commission settled now.
- Net to Firefighters.
- Collector credit balance.

Actions:

- Add payment.
- Remove payment from open settlement.
- Adjust commission with permission.
- Close settlement.
- Print delivery note.

### Collector current account

Objective: explain the administrative balance.

Must display:

- Entries.
- Type.
- Source.
- Linked settlement.
- Linked payment.
- Debit/credit.
- Accumulated balance.
- Adjustments and annulments.

### Draws

Objective: manage campaign draws.

Must allow:

- Create monthly, extraordinary, final, or consolation draw.
- Configure date and cutoff.
- Configure eligibility rule.
- Generate roster.
- Freeze roster.
- Load winners.

### Draw roster

Objective: justify participants and non-participants.

Must display:

- Participating number.
- Bond.
- Buyer.
- Collector.
- Eligible or not eligible.
- Reason for ineligibility.
- Generation and freeze date.

### Winner loading

Objective: resolve draw result.

Flow:

```txt
Enter winning number
↓
Search in frozen roster
↓
Display bond, buyer, and collector
↓
Display eligibility status
↓
Record awarded or unawarded prize
```

### Reports

MVP reports:

- Bonds by status.
- Bonds by collector.
- Pending installments.
- Payments by date.
- Settlements by collector.
- Collector current account.
- Draw roster.
- Winners and prizes.
