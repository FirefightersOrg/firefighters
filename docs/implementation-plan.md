# Implementation Plan

## Objective

Organize the MVP construction into verifiable technical stages.

## Phase 0: Repository Setup

Deliverables:

- Initialize SvelteKit with TypeScript.
- Configure pnpm.
- Configure lint, format, and check.
- Set up `src/lib` structure.
- Add `.env.example`.
- Add local Supabase.

Acceptance criteria:

- `pnpm check` runs successfully.
- Local Supabase can start.

## Phase 1: Auth, Roles, and Permissions

Deliverables:

- Supabase Auth.
- Tables `profiles`, `roles`, `permissions`, `role_permissions`, `user_roles`.
- Base RLS.
- Server-side permission helpers.
- Basic login and session screens.

Acceptance criteria:

- An authenticated user has roles.
- A sensitive action validates permission server-side.

## Phase 2: Campaigns and Configuration

Deliverables:

- Campaign CRUD.
- Numbering configuration.
- Installment configuration.
- Base commission rule configuration.

Acceptance criteria:

- A campaign can be created with `number_digits`, `max_number`, and `associated_number_offset`.

## Phase 3: Bonds, Patas, and Numbers

Deliverables:

- Tables `bonds` and `bond_numbers`.
- Associated number calculation.
- Visual format per campaign.
- Duplicate validation.
- Manual simple bond entry.
- Basic pata entry.

Acceptance criteria:

- Participating numbers cannot be duplicated within a campaign.
- The system supports future 5-digit configuration.

## Phase 4: Barcode Entry and Imports

Deliverables:

- Import sessions.
- Scan entry.
- `barcode_mode` configuration.
- Error preview.
- Batch confirmation.

Acceptance criteria:

- A scanned batch can be loaded without affecting data until confirmed.

## Phase 5: Collectors and Buyers

Deliverables:

- Collector CRUD.
- Buyer CRUD.
- Collector record.
- Buyer record.

Acceptance criteria:

- A buyer and collector can be associated with a sale.

## Phase 6: Bond Delivery

Deliverables:

- Assign bonds to collectors.
- Record returns.
- Printable HTML delivery note.
- Assignment history.

Acceptance criteria:

- A delivered bond changes status and is recorded in history.

## Phase 7: Sales, Plans, and Installments

Deliverables:

- Record sale.
- Generate payment plan.
- Generate installments.
- Record cash/installment modality.

Acceptance criteria:

- A sold bond is associated with buyer, collector, and installments.

## Phase 8: Payments and Assisted Settlement

Deliverables:

- Create settlement.
- Add payments.
- Select installments.
- Differentiate cash and transfer.
- Real-time summary.
- Settlement closing.
- HTML delivery note.

Acceptance criteria:

- When closing a settlement, payments are confirmed and direct editing is blocked.

## Phase 9: Commissions and Ledger

Deliverables:

- General commission rules.
- Special per-collector rules.
- Audited manual adjustments.
- `collector_ledger_entries`.
- Current account view.

Acceptance criteria:

- The collector balance is reconstructed from ledger entries.

## Phase 10: Corrections and Voiding

Deliverables:

- Void payments.
- Correct payment method.
- Correct sales with audit.
- Adjust closed settlement without reopening.
- Audit changes.

Acceptance criteria:

- A closed settlement cannot be modified directly.

## Phase 11: Draws and Rosters

Deliverables:

- Create draws.
- Configure rules.
- Generate roster.
- Freeze roster.
- Extra numbers for extraordinary draws.

Acceptance criteria:

- The frozen roster does not change even if subsequent payments are entered.

## Phase 12: Winners and Prizes

Deliverables:

- Enter winning number.
- Search in frozen roster.
- Validate eligibility.
- Record awarded, delivered, or unawarded prize.

Acceptance criteria:

- The system explains why a winner collects or does not collect.

## Phase 13: Reports

Deliverables:

- Bonds by status.
- Payments by date.
- Settlements by collector.
- Current account.
- Rosters.
- Winners and prizes.

Acceptance criteria:

- Administration can operate without Excel as the source of truth.

## Phase 14: Migration from Old System

Deliverables:

- Migration staging.
- Import collectors.
- Import buyers.
- Import historical numbers.
- Generate reservations/conflicts.

Acceptance criteria:

- Historical data is imported with preview and conflict resolution.

## Phase 15: Production Hardening

Deliverables:

- Verified backups.
- Operational exports.
- RLS review.
- Critical tests.
- Operations documentation.

Acceptance criteria:

- The system can be used in production with defined recovery procedures.
