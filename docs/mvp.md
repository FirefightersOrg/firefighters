# MVP Scope

## Objective

The MVP must replace the main operational control of bonds, payments, collector settlements, and draws. It must not attempt to cover every future improvement, but it must solve the core administrative cycle without depending on Excel as the source of truth.

## Included Scope

### Campaigns

- Create annual campaign.
- Configure simple bond value.
- Configure number of installments.
- Configure number of number digits.
- Configure maximum allowed number.
- Configure associated number offset.
- Configure basic commission rules.
- Configure campaign draw types.

### Bonds and patas (multi-number bond/packages)

- Load simple bonds.
- Load basic patas.
- Load or search bonds by barcode.
- Calculate associated number.
- Display numbers with leading zeros according to campaign configuration.
- Validate duplicate participating numbers.
- Validate that base number and associated number do not exceed `max_number`.
- Query the single bond record.

### Collectors

- Create and edit collectors.
- Query assigned bonds.
- Query sales, payments, collector settlements, and balance.
- Generate operational report by collector.

### Buyers

- Create and edit buyers.
- Associate buyer with a sale.
- Query history of bonds, installments, payments, and prizes within the available information.

### Bond Delivery

- Assign bonds to collectors.
- Record date, user, and notes.
- Issue printable delivery note.
- Register basic returns and reassignments.

### Sales

- Register sale of a simple bond or pata.
- Associate buyer, collector, and payment mode.
- Generate installment plan.
- Register initial payment when applicable.

### Payments and Installments

- Register cash payments.
- Register installment payments.
- Register early payments.
- Differentiate cash and transfer.
- Associate payments with a collector settlement when applicable.
- Query pending, paid, early paid, and overdue installments.

### Collector Settlements

- Create collector settlement by collector.
- Add payments to the collector settlement.
- Show real-time totals.
- Calculate preliminary commission.
- Close collector settlement.
- Confirm commissions at closing.
- Generate collector ledger entries.
- Issue printable settlement note.
- Correct later errors through audited annulments or adjustments.

### Commissions

- Configure basic rules by campaign.
- Configure special rules by collector.
- Calculate preliminary commission during an open collector settlement.
- Confirm commission when closing collector settlement.
- Manually adjust commission with permission and mandatory reason.
- Record generated commission in the collector ledger.
- Record settled commission if paid in the collector settlement.

### Collector Ledger

- Record auditable entries.
- Calculate balance from entries.
- Differentiate generated commissions, settled commissions, submitted cash, transfers, and adjustments.

### Draws

- Create monthly draws.
- Create extraordinary draw for full payment.
- Create final draw.
- Create consolation draws.
- Configure draw date and cutoff date/time.
- Generate frozen draw roster.
- Load winning numbers.
- Validate whether the winning number belongs to an eligible bond.
- Record prizes as awarded, pending, or not awarded.

Included rules:

- Monthly draw: must be up to date through the required installment.
- Extraordinary draw: must be fully paid before the cutoff and adds N extra numbers based on the number of base numbers.
- Final draw: must be fully paid to win.
- Consolation draw: only non-winners who are up to date participate.

### Reports and Notes

- Bond delivery note.
- Collector settlement note.
- Payment receipt.
- Delivered or not-awarded prize receipt.
- Monthly summary by collector.
- Report of sold, available, and delivered bonds.
- Report of paid, pending, and overdue installments.
- Draw roster report.
- Winners and prizes report.

### Audit

- Audit sensitive actions.
- Record user, date, action, entity, previous data, and new data when applicable.

### Initial Migration

- Import collectors from the old system if an export is available.
- Import buyers from the old system if an export is available.
- Import historical numbers to generate reservations and conflicts.
- Validate data in staging before confirming.

## Outside the MVP

- Public buyer portal.
- Complete collector portal.
- Notifications by WhatsApp, email, or SMS.
- Automatic bank reconciliation.
- Own QR for new print runs.
- Advanced daily cash register.
- Comparative analytics between campaigns.
- Native AWS integration.

## MVP Acceptance Criteria

- Administration can create a campaign and load bonds.
- The system prevents duplicate participating numbers within a campaign.
- The system respects number digit count per campaign.
- Bonds can be assigned to collectors and a delivery note can be issued.
- A bond can be sold to a buyer.
- Cash, installment, and early payments can be registered.
- A collector settlement can be created and closed.
- Closing a collector settlement generates commissions and collector ledger entries.
- A closed collector settlement is not edited directly.
- A special rule or manual commission adjustment can be applied with audit.
- A frozen draw roster can be generated for a draw.
- A winner can be loaded and eligibility validated according to the draw roster.
- Collector balance can be queried from entries.
- Bonds can be loaded or searched by barcode according to campaign configuration.
- Main printable HTML documents can be issued.

## Main Risks

- Incomplete pata rules.
- Exact commissions pending.
- Possible complexity if every future process is digitized in the first version.

## Related Documents

- `docs/permissions.md`
- `docs/screens.md`
- `docs/imports.md`
- `docs/documents.md`
- `docs/commissions.md`
- `docs/draw-rules.md`
- `docs/corrections.md`
- `docs/migration.md`
- `docs/backup-operations.md`
- `docs/implementation-plan.md`

## Scope Control Strategy

The MVP must prioritize traceability and consistency over advanced automation. If a rule is not confirmed, it must remain configurable or documented as a temporary decision, not hardcoded as permanent truth.
