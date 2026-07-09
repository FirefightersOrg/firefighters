# Screens and Functional Experience

## Objective

Define MVP priority screens and provide an adaptable foundation for future functionality.

## UI Principles

- Design around operational flows, not only CRUD.
- Show actions according to permissions.
- Prioritize fast search by number, buyer, collector, and barcode.
- Keep single records to resolve claims quickly.
- All key screens must work on desktop and mobile.

## Main Navigation

Suggested sections:

- Dashboard.
- Campaigns.
- Bonds.
- Collectors.
- Buyers.
- Sales.
- Collector settlements.
- Draws.
- Reports.
- Administration.

## MVP Screens

### Campaign Dashboard

Objective: show the overall status of the active campaign.

Must show:

- Total, sold, available, and delivered bonds.
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
- Type: simple or pata (multi-number bond/package).
- Commercial state.
- Financial state.
- Collector.
- Buyer.

Actions:

- Create bond.
- Create pata.
- Load by barcode.
- Assign to collector.
- View record.

### Bond Record

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
- Collector settlements.
- Commissions.
- Draws and draw rosters.
- Prizes.
- Audit.

### Barcode Loading

Objective: speed up loading or searching physical bonds.

Flow:

```txt
Select campaign
↓
Choose reading mode
↓
Scan code
↓
System interprets value
↓
System shows result
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

Must show:

- Contact details.
- Assigned bonds.
- Sold bonds.
- Portfolio debt.
- Collector settlements.
- Commissions.
- Current balance.

### Collector Record

Objective: comprehensive collector view.

Sections:

- General data.
- Assigned bonds.
- Associated buyers.
- Pending installments.
- Collector settlements.
- Collector ledger.
- Monthly report.
- Audit.

### Buyers

Objective: manage buyers and history.

Must allow:

- Creation/editing.
- Search by name, phone, document, or CUIT.
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
Choose payment mode
↓
Generate installments
↓
Register initial payment if applicable
```

### Assisted Collector Settlement

Objective: replace the operational Excel.

Must show in real time:

- Total cash.
- Total transfer.
- Grand total.
- Preliminary commission.
- Commission settled now.
- Net amount for Firefighters.
- Balance in favor of the collector.

Actions:

- Add payment.
- Remove payment from open collector settlement.
- Adjust commission with permission.
- Close collector settlement.
- Print settlement note.

### Collector Ledger

Objective: explain the administrative balance.

Must show:

- Entries.
- Type.
- Source.
- Linked collector settlement.
- Linked payment.
- Debit/credit or credit/debit.
- Running balance.
- Adjustments and annulments.

### Draws

Objective: manage campaign draws.

Must allow:

- Create monthly, extraordinary, final, or consolation draw.
- Configure date and cutoff.
- Configure eligibility rule.
- Generate draw roster.
- Freeze draw roster.
- Load winners.

### Draw Roster

Objective: justify participants and non-participants.

Must show:

- Participating number.
- Bond.
- Buyer.
- Collector.
- Eligible or ineligible.
- Reason for ineligibility.
- Generation and freeze date.

### Winner Loading

Objective: resolve draw result.

Flow:

```txt
Enter winning number
↓
Search in frozen draw roster
↓
Show bond, buyer, and collector
↓
Show eligibility state
↓
Register prize awarded or not awarded
```

### Reports

MVP reports:

- Bonds by state.
- Bonds by collector.
- Pending installments.
- Payments by date.
- Collector settlements by collector.
- Collector ledger.
- Draw roster.
- Winners and prizes.
