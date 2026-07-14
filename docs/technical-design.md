# Technical design

## Objective

Define the technical architecture of the MVP using SvelteKit, TypeScript, and Supabase, maintaining a structure that allows migration to a custom API and AWS in a later stage.

## MVP architecture

```txt
Browser / PWA
  |
  v
SvelteKit + TypeScript
  |
  v
SvelteKit server actions / server routes
  |
  v
Supabase Auth + Postgres + Storage
```

## Principles

- Business logic must not live in UI components.
- Supabase access must be encapsulated.
- Critical rules must be in domain services or documented SQL constraints.
- RLS must be active on exposed tables.
- Do not use `service_role` on the client.
- Do not delete financial history without audited annulment.
- Do not assume numbers always have 4 digits.
- Use granular permissions for sensitive actions.
- Keep imports and migrations in staging until confirmation.

## Suggested structure

```txt
src/
  routes/
  lib/
    components/
    domain/
    schemas/
    supabase/
    server/
      auth/
      repositories/
      services/
      audit/
      documents/
```

### `src/lib/domain`

Pure rules with no Supabase dependency.

Examples:

- Calculate associated number.
- Format visible number.
- Validate number range.
- Calculate pata value.
- Calculate preliminary commission.
- Evaluate draw eligibility.

### `src/lib/schemas`

Zod schemas for form inputs and actions.

Examples:

- Create campaign.
- Create bond.
- Create sale.
- Register payment.
- Close settlement.
- Create draw.
- Load winner.

### `src/lib/server/repositories`

Data access layer.

Responsibilities:

- Supabase/Postgres queries.
- Entity persistence.
- Mapping raw data to application types.
- Avoid scattered queries in components.

### `src/lib/server/services`

Transactional use cases.

Examples:

- `createCampaign`
- `createBond`
- `assignBondsToCollector`
- `registerSale`
- `addPaymentToSettlement`
- `closeSettlement`
- `generateDrawRoster`
- `loadWinningNumber`

### `src/lib/server/audit`

Functions to record audit of sensitive actions.

### `src/lib/server/documents`

Generation of printable HTML for delivery notes and certificates.

## Numbering

Numbering configuration lives in `campaigns`.

Key fields:

```txt
number_digits
max_number
associated_number_offset
overflow_policy
```

Expected domain function:

```ts
type CampaignNumbering = {
  numberDigits: number;
  maxNumber: number;
  associatedNumberOffset: number;
};

function calculateAssociatedNumber(baseNumber: number, config: CampaignNumbering): number {
  return baseNumber + config.associatedNumberOffset;
}

function formatCampaignNumber(value: number, config: CampaignNumbering): string {
  return String(value).padStart(config.numberDigits, '0');
}
```

Rule:

- Do not use `padStart(4)` outside a centralized function.
- Do not use `char(4)` columns.
- Validate range against `campaign.max_number`.

## Barcode and imports

Barcode reading must be implemented as a configurable flow per campaign.

Key field:

```txt
barcode_mode
```

Initial values:

- `base_number`
- `internal_code`
- `external_legacy_code`
- `manual_mapping`

Rule:

- Scanning must not impact definitive data until an import session is confirmed.
- All bulk loading must go through preview and validation.
- Imports from the old system must go through staging.

## Settlements and commissions

Settlement closing is a critical operation.

It must run server-side.

Responsibilities of `closeSettlement`:

- Verify the settlement is open.
- Verify included payments.
- Calculate definitive totals.
- Calculate definitive commission.
- Confirm payments.
- Update covered installments.
- Create current account entries.
- Save totals snapshots.
- Mark settlement as closed.
- Record audit.

Commissions may have special rules per collector and manual adjustments with the `commission.adjust` permission.

Rule:

```txt
A closed settlement is not reopened or edited directly.
```

Subsequent corrections:

- Annul payment.
- Generate adjustment.
- Generate compensating entry.
- Record reason and user.

Flow details: `docs/corrections.md`.

## Collector current account

Balance must not be stored as an editable value.

It is calculated from `collector_ledger_entries`.

Example:

```txt
balance = non_annulled_credits - non_annulled_debits
```

Expected entries:

- Commission generated.
- Commission settled.
- Cash settled.
- Transfer received by Firefighters.
- Manual adjustment.
- Annulment.

## Draws and rosters

Roster generation must be server-side.

Responsibilities of `generateDrawRoster`:

- Take draw and eligibility rule.
- Evaluate confirmed payments before cutoff.
- Create entries for participating numbers.
- Mark eligible and ineligible.
- Save buyer and collector snapshots.

Responsibilities of `freezeDrawRoster`:

- Block normal modifications to the roster.
- Record user and date.
- Audit freeze.

Responsibilities of `loadWinningNumber`:

- Search winning number in frozen roster.
- Determine bond, buyer, and collector.
- Determine if prize applies.
- Record result.

Confirmed rules:

- Final: requires full payment to win.
- Consolation: only non-winners that are up to date.
- Extraordinary: N extra numbers based on count of base numbers.

## Supabase and RLS

Mandatory rules:

- RLS active on tables exposed to the client.
- Policies versioned in migrations.
- Sensitive operations via server actions or routes.
- `SUPABASE_SERVICE_ROLE_KEY` only in server-side environment.
- Explicit application roles.

The permission model is detailed in `docs/permissions.md`.

Initial suggested policies:

- `admin`: full functional access.
- `operator`: administrative operations without critical configuration.
- `treasurer`: settlements, financial reports, and current account.
- `collector`: only own data when access is enabled.
- `read-only`: read-only.

## Audit

Mandatory actions to audit:

- Campaign configuration changes.
- Bond loading.
- Bond assignment and return.
- Sale.
- Payment loading, annulment, or adjustment.
- Settlement closing.
- Closed settlement correction.
- Commission settlement.
- Roster generation and freezing.
- Winner loading.
- Prize delivery or rejection.
- Manual current account adjustments.

## PWA

MVP scope:

- Installation from browser when compatible.
- Responsive desktop/mobile/tablet.
- Static asset caching.
- Friendly screen when offline.

Out of MVP scope:

- Offline payment recording.
- Offline synchronization of financial operations.
- Offline conflict resolution.

## Printable documents

MVP:

- Printable HTML for delivery notes.
- Persist structured delivery note data.

Future:

- Generated and stored PDF.
- QR or validation code.

Document details: `docs/documents.md`.

## Backups and operations

For the production MVP:

- Use automatic backups from the hired Supabase plan.
- Export critical data before imports or bulk corrections.
- Maintain a documented restoration procedure.
- Periodically validate that a restoration works.

Initial objectives:

```txt
RPO: maximum 24 hours
RTO: restoration within the same day
```

Operational details: `docs/backup-operations.md`.

## Implementation plan

The build order is defined in `docs/implementation-plan.md`.

Implementation must advance through verifiable phases, starting with tooling, auth, permissions, campaigns, bonds, imports, collectors/buyers, sales, settlements, ledger, draws, and reports.

## Minimum testing

Domain unit tests:

- Associated number calculation.
- Number formatting per campaign.
- Range validation.
- Pata value calculation.
- Commission calculation.
- Draw eligibility.

Service tests:

- Settlement closing.
- Confirmed payment annulment.
- Roster generation.
- Winner loading.

Critical E2E:

- Create campaign, load bond, sell, pay, settle.
- Generate roster and validate winner.

## Future migration to AWS

To facilitate later migration:

- Keep domain independent of the Supabase SDK.
- Encapsulate repositories.
- Avoid Edge Functions unless truly needed.
- Avoid complex triggers without documentation.
- Use standard PostgreSQL wherever sufficient.
- Document RLS and permissions.
