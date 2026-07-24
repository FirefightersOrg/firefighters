# MVP Scope

## Objective

The MVP must replace the main operational control of bonds, payments, settlements, and draws. It should not attempt to cover all future improvements, but it must resolve the central administrative cycle without depending on Excel as the source of truth.

## Included scope

### Campaigns

- Create annual campaign.
- Configure simple bond value.
- Configure installment count.
- Configure number of digits for numbers.
- Configure maximum allowed number.
- Configure associated number offset.
- Configure basic commission rules.
- Configure campaign draw types.

### Bonds and patas

- Load simple bonds.
- Load basic patas.
- Load or search bonds by barcode.
- Calculate associated number.
- Display numbers with leading zeros according to campaign configuration.
- Validate duplicate participating numbers.
- Validate that base number and associated number do not exceed `max_number`.
- View single bond record.

### Collectors

- Create and edit collectors.
- View assigned bonds.
- View sales, payments, settlements, and balance.
- Generate operational report per collector.

### Buyers

- Create and edit buyers.
- Associate buyer to a sale.
- View history of bonds, installments, payments, and prizes within available information.

### Bond delivery

- Assign bonds to collectors.
- Record date, user, and observations.
- Issue printable delivery note.
- Record returns and basic reassignments.

### Sales

- Register sale of simple bond or pata.
- Associate buyer, collector, and payment method.
- Generate installment plan.
- Record initial payment if applicable.

### Payments and installments

- Register cash payments.
- Register installment payments.
- Register advance payments.
- Differentiate cash and transfer.
- Associate payments to a settlement when applicable.
- View pending, paid, advance, and overdue installments.

### Settlements

- Create settlement per collector.
- Add payments to the settlement.
- Display real-time totals.
- Calculate preliminary commission.
- Close settlement.
- Confirm commissions at closing.
- Generate current account entries.
- Issue printable settlement delivery note.
- Correct subsequent errors through annulled or audited adjustments.

### Commissions

- Configure basic rules per campaign.
- Configure special rules per collector.
- Calculate preliminary commission during open settlement.
- Confirm commission when closing settlement.
- Manually adjust commission with permission and mandatory reason.
- Record generated commission in collector's current account.
- Record settled commission if paid in the settlement.

### Collector current account

- Record auditable entries.
- Calculate balance from entries.
- Differentiate generated commissions, settled commissions, cash settled, transfers, and adjustments.

### Draws

- Create monthly draws.
- Create extraordinary draw for full payment.
- Create final draw.
- Create consolation draws.
- Configure draw date and cutoff date/time.
- Generate frozen roster.
- Load winning numbers.
- Validate if the winning number corresponds to an enabled bond.
- Record awarded, pending, or unawarded prizes.

Included rules:

- Monthly draw: must be up to date through the required installment.
- Extraordinary draw: must be fully paid before cutoff and adds N extra numbers based on the count of base numbers.
- Final draw: must be fully paid to win.
- Consolation draw: only non-winners that are up to date participate.

### Reports and delivery notes

- Bond delivery note.
- Settlement delivery note.
- Payment receipt.
- Prize delivery or unawarded certificate.
- Monthly summary per collector.
- Report of sold, available, and delivered bonds.
- Report of paid, pending, and overdue installments.
- Report of draw roster.
- Report of winners and prizes.

### Audit

- Audit sensitive actions.
- Record user, date, action, entity, previous data, and new data when applicable.

### Initial migration

- Import collectors from old system if export is available.
- Import buyers from old system if export is available.
- Import historical numbers to generate reservations and conflicts.
- Validate data in staging before confirming.

## Out of MVP scope

- Public buyer portal.
- Full collector portal.
- Notifications via WhatsApp, email, or SMS.
- Automatic bank reconciliation.
- Proprietary QR for new prints.
- Advanced daily cash register.
- Comparative analytics between campaigns.
- Native AWS integration.

## MVP acceptance criteria

- Administration can create a campaign and load bonds.
- The system prevents duplicate participating numbers within a campaign.
- The system respects digit count per campaign.
- Bonds can be assigned to collectors and delivery notes issued.
- A bond can be sold to a buyer.
- Cash, installment, and advance payments can be recorded.
- A settlement can be created and closed.
- Settlement closing generates commissions and current account entries.
- A closed settlement cannot be edited directly.
- Special rules or manual commission adjustments can be applied with audit.
- A frozen roster can be generated for draws.
- A winner can be loaded and eligibility validated against the roster.
- Collector balance can be viewed from entries.
- Bonds can be loaded or searched by barcode according to campaign configuration.
- Main printable HTML documents can be issued.

## Main risks

- Incomplete pata rules.
- Exact commissions pending.
- Possible complexity if attempting to digitize all future processes in the first version.

## Related documents

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

## Scope control strategy

The MVP must prioritize traceability and consistency over advanced automations. If a rule is not confirmed, it should be left configurable or documented as a temporary decision, not hardcoded as permanent truth.
