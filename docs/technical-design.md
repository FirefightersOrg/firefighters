# Technical Design

## Objective

Define the MVP technical architecture using SvelteKit, TypeScript, and Supabase, while keeping a structure that allows migration to a custom API and AWS in a later stage.

## MVP Architecture

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
- Critical rules must live in domain services or documented SQL constraints.
- RLS must be active on exposed tables.
- Do not use `service_role` on the client.
- Do not delete historical financial records without an audited annulment.
- Do not assume numbers always have 4 digits.
- Use granular permissions for sensitive actions.
- Keep imports and migrations in staging until confirmation.

## Suggested Structure

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
- Calculate pata (multi-number bond/package) value.
- Calculate preliminary commission.
- Evaluate draw eligibility.

### `src/lib/schemas`

Zod schemas for form and action inputs.

Examples:

- Create campaign.
- Create bond.
- Create sale.
- Register payment.
- Close collector settlement.
- Create draw.
- Load winner.

### `src/lib/server/repositories`

Data access layer.

Responsibilities:

- Queries to Supabase/Postgres.
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
- `addPaymentToRendition`
- `closeRendition`
- `generateDrawRoster`
- `loadWinningNumber`

### `src/lib/server/audit`

Functions for recording audits of sensitive actions.

### `src/lib/server/documents`

Generation of printable HTML for delivery notes and receipts.

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

## Barcode and Imports

Barcode scanning must be implemented as a configurable flow per campaign.

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

- Scanning must not affect final data until an import session is confirmed.
- Every bulk load must go through preview and validation.
- Imports from the old system must go through staging.

## Collector Settlements and Commissions

Closing a collector settlement is a critical operation.

It must run server-side.

Responsibilities of `closeRendition`:

- Verify that the collector settlement is open.
- Verify included payments.
- Calculate final totals.
- Calculate final commission.
- Confirm payments.
- Update covered installments.
- Create collector ledger entries.
- Save total snapshots.
- Mark the collector settlement as closed.
- Record audit.

Commissions may have special rules by collector and manual adjustments with `commission.adjust` permission.

Rule:

```txt
A closed collector settlement is not reopened or edited directly.
```

Later corrections:

- Annul payment.
- Generate adjustment.
- Generate compensating entry.
- Record reason and user.

Flow details: `docs/corrections.md`.

## Collector Ledger

The balance must not be stored as an editable value.

It is calculated from `collector_ledger_entries`.

Example:

```txt
balance = non_annulled_credits - non_annulled_debits
```

Expected entries:

- Commission generated.
- Commission settled.
- Cash submitted.
- Transfer received by Firefighters.
- Manual adjustment.
- Annulment.

## Draws and Draw Rosters

Draw roster generation must be server-side.

Responsibilities of `generateDrawRoster`:

- Take the draw and eligibility rule.
- Evaluate confirmed payments before the cutoff.
- Create entries for participating numbers.
- Mark eligible and ineligible entries.
- Save buyer and collector snapshots.

Responsibilities of `freezeDrawRoster`:

- Block normal modifications to the draw roster.
- Record user and date.
- Audit freeze.

Responsibilities of `loadWinningNumber`:

- Search for the winning number in the frozen draw roster.
- Determine bond, buyer, and collector.
- Determine whether a prize applies.
- Record result.

Confirmed rules:

- Final: requires full payment to win.
- Consolation: only non-winners who are up to date.
- Extraordinary: N extra numbers based on the number of base numbers.

## Supabase and RLS

Mandatory rules:

- RLS active on tables exposed to the client.
- Policies versioned in migrations.
- Sensitive operations through server actions or routes.
- `SUPABASE_SERVICE_ROLE_KEY` only in the server-side environment.
- Explicit application roles.

The permissions model is detailed in `docs/permissions.md`.

Suggested initial policies:

- `admin`: full functional access.
- `operador`: administrative operations without critical configuration.
- `tesorero`: collector settlements, financial reports, and collector ledger.
- `cobrador`: only own data when access is enabled.
- `consulta`: read-only.

## Audit

Actions that must be audited:

- Campaign configuration changes.
- Bond loading.
- Bond assignment and return.
- Sale.
- Payment loading, annulment, or adjustment.
- Collector settlement closing.
- Closed collector settlement correction.
- Commission settlement.
- Draw roster generation and freeze.
- Winner loading.
- Prize delivery or rejection.
- Manual collector ledger adjustments.

## PWA

MVP scope:

- Installation from browser when supported.
- Responsive desktop/mobile/tablet.
- Static asset cache.
- Friendly offline screen.

Outside the MVP:

- Offline payment registration.
- Offline synchronization of financial operations.
- Offline conflict resolution.

## Printable Documents

MVP:

- Printable HTML for delivery notes.
- Persist structured delivery note data.

Future:

- Generated and stored PDF.
- QR or validation code.

Document details: `docs/documents.md`.

## Backups and Operations

For the production MVP:

- Use automatic backups from the contracted Supabase plan.
- Export critical data before imports or bulk corrections.
- Keep a documented restore procedure.
- Periodically validate that a restore works.

Initial objectives:

```txt
RPO: maximum 24 hours
RTO: restore during the same day
```

Operational details: `docs/backup-operations.md`.

## Implementation Plan

The build order is defined in `docs/implementation-plan.md`.

Implementation must progress through verifiable phases, starting with tooling, auth, permissions, campaigns, bonds, imports, collectors/buyers, sales, collector settlements, ledger, draws, and reports.

## Minimum Testing

Domain unit tests:

- Associated number calculation.
- Number formatting per campaign.
- Range validation.
- Pata value calculation.
- Commission calculation.
- Draw eligibility.

Service tests:

- Collector settlement closing.
- Confirmed payment annulment.
- Draw roster generation.
- Winner loading.

Critical E2E:

- Create campaign, load bond, sell, pay, settle.
- Generate draw roster and validate winner.

## Future Migration to AWS

To ease a later migration:

- Keep domain independent from the Supabase SDK.
- Encapsulate repositories.
- Avoid Edge Functions unless truly needed.
- Avoid complex triggers without documentation.
- Use standard PostgreSQL whenever sufficient.
- Document RLS and permissions.
