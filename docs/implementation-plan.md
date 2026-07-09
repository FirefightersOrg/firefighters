# Implementation Plan

## Objective

Organize MVP construction into verifiable technical stages.

## Phase 0: Repository Preparation

Deliverables:

- Initialize SvelteKit with TypeScript.
- Configure pnpm.
- Configure lint, format, and check.
- Configure the `src/lib` structure.
- Add `.env.example`.
- Add local Supabase.

Acceptance criteria:

- `pnpm check` runs successfully.
- Local Supabase can start.

## Phase 1: Auth, Roles, and Permissions

Deliverables:

- Supabase Auth.
- `profiles`, `roles`, `permissions`, `role_permissions`, and `user_roles` tables.
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

## Phase 3: Bonds, patas (multi-number bond/package), and numbers

Deliverables:

- `bonds` and `bond_numbers` tables.
- Associated number calculation.
- Visual format by campaign.
- Duplicate validation.
- Manual loading of a simple bond.
- Basic pata loading.

Acceptance criteria:

- Participant numbers cannot be duplicated within a campaign.
- The system supports future 5-digit configuration.

## Phase 4: Barcode Loading and Imports

Deliverables:

- Import sessions.
- Loading by scanning.
- `barcode_mode` configuration.
- Error preview.
- Batch confirmation.

Acceptance criteria:

- A scanned batch can be loaded without impacting data until confirmation.

## Phase 5: Collectors and Buyers

Deliverables:

- Collector CRUD.
- Buyer CRUD.
- Collector profile.
- Buyer profile.

Acceptance criteria:

- A buyer and collector can be associated with a sale.

## Phase 6: Bond Delivery

Deliverables:

- Assign bonds to collectors.
- Record returns.
- Printable HTML delivery note.
- Assignment history.

Acceptance criteria:

- A delivered bond changes state and remains in history.

## Phase 7: Sales, Plans, and Installments

Deliverables:

- Record sale.
- Generate payment plan.
- Generate installments.
- Record cash/installment modality.

Acceptance criteria:

- A sold bond is associated with a buyer, collector, and installments.

## Phase 8: Payments and Assisted Collector Settlement

Deliverables:

- Create collector settlement.
- Add payments.
- Select installments.
- Differentiate cash and bank transfer.
- Real-time summary.
- Collector settlement closing.
- HTML delivery note.

Acceptance criteria:

- When a collector settlement is closed, payments are confirmed and direct editing is blocked.

## Phase 9: Commissions and Ledger

Deliverables:

- General commission rules.
- Special rules by collector.
- Audited manual adjustments.
- `collector_ledger_entries`.
- Current account view.

Acceptance criteria:

- The collector balance is rebuilt from movements.

## Phase 10: Corrections and Cancellations

Deliverables:

- Cancel payments.
- Correct payment method.
- Correct sales with audit.
- Adjust a closed collector settlement without reopening it.
- Audit changes.

Acceptance criteria:

- A closed collector settlement is not modified directly.

## Phase 11: Draws and Draw Rosters

Deliverables:

- Create draws.
- Configure rules.
- Generate draw roster.
- Freeze draw roster.
- Extra numbers for extraordinary draw.

Acceptance criteria:

- The frozen draw roster does not change even if later payments are loaded.

## Phase 12: Winners and Prizes

Deliverables:

- Load winning number.
- Search in frozen draw roster.
- Validate eligibility.
- Record awarded, delivered, or not-awarded prize.

Acceptance criteria:

- The system explains why a winner is paid or not paid.

## Phase 13: Reports

Deliverables:

- Bonds by state.
- Payments by date.
- Collector settlements by collector.
- Current account.
- Draw rosters.
- Winners and prizes.

Acceptance criteria:

- Administration can operate without Excel as the source of truth.

## Phase 14: Migration from Legacy System

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
- Operation documentation.

Acceptance criteria:

- The system can be used in production with defined recovery procedures.
