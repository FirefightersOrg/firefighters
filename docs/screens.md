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

Objective: say, on the first screen, what the bond is, who has it, who bought it, what is owed and what to do next (UX plan PR 8).

Order:

- **Summary.** The bond's stub (base and associated numbers); one or two sentences built from data («Vendido a … en 6 cuotas. Lo cobra …. Pagó 1 cuota y debe $ 50.000, de los cuales $ 40.000 están vencidos.»), with the buyer and the collector as links when the role can open them; the commercial and financial states; the one next step of the state (deliver, register the sale, register a payment) when the role may take it; the buyer's phone as a call link. The table of state to sentence is in `src/lib/domain/bond-summary.test.ts`.
- **Installments** (sold bonds). What is still owed on each, with the amount to collect as the lead figure. A payment counts once its settlement is closed; one that is still in an open settlement, or sent by the collector and not processed, is shown on its installment as waiting.
- **Draws.** One line per draw: the numbers it takes part with and whether it is eligible, with the reason when it is not. Prizes under it.
- **History and corrections**, collapsed: payments and certificates; deliveries and returns (with Return, Reassign and Mark lost); the bond's data (general data, participating numbers, barcode, pata members); recorded movements (with `audit.view`); correct or annul (correct the collector, ungroup, annul). A group opens by itself when the server answered about something inside it.

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

### Buyers (SAN-51)

Routes: `/campaigns/[id]/buyers` lists buyers, `/new` creates one, and
`/[buyerId]` shows and edits its record. The directory searches name, phone, document number,
or tax ID and can filter by buyer type. Creation and updates warn about matching document or
tax ID records before allowing confirmation. If an existing usual collector is not visible to
the editor, the form keeps it selected rather than silently clearing it; an editor who cannot
see collectors is told to ask an admin to set a new one.

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

Collector-submitted payments (SAN-156): the "Cobros enviados por el cobrador" section lists the drafts the collector registered from the portal, with the pending count in its title and a warning at the top of the screen. While any is pending, "Cerrar rendición" is disabled with the reason (include or reject each one); the server check (`settlement_close`, errcode `FF156`) is authoritative and its message is shown if the close is attempted anyway. The campaign dashboard shows a "Cobros enviados sin procesar" card (count, amount, per collector, link to the collector's open settlement) while there are any.

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
