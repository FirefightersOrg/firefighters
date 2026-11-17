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

## Bond loading (SAN-23)

Bonds are written only through the audited SQL functions `bond_create`, `bond_group_into_pata`, `bond_ungroup_pata` and `bond_annul` (see `docs/data-model.md`, "Bond write functions"). The flow for each write:

```txt
form data
  -> Zod schema (src/lib/schemas/bond.ts): parses numbers with the campaign config, checks range,
     overflow and numbers repeated inside the bond (src/lib/domain/bonds.ts)
  -> service (src/lib/server/services/bonds.ts): optional up-front permission check against
     locals.permissions, then one RPC with the user-scoped client
  -> SQL function: actor + permission, campaign locked FOR SHARE, validation, derived values
     (associated numbers, total value) computed from the campaign, write, one audit_log row
  -> SQLSTATE mapped to BondServiceError (validation 400, permission 403, not_found 404,
     conflict 409, internal 500)
```

The database is the authority: the app never sends associated numbers or values, and duplicates against other bonds are only detected by the database (the unique index on live numbers), which names the number and the bond that already uses it. Duplicate details arrive as JSON in the error `details` and are exposed as `BondServiceError.conflicts` so the UI can link to that bond.

### Manual simple bond entry (SAN-24)

`/campaigns/[id]/bonds/new` (requires `campaign.view` and `bond.create`; linked from the campaign page while the campaign is draft or active):

- One base number per bond, typed with or without leading zeros, plus optional internal code and barcode. A live preview (`previewBaseNumber`, `src/lib/domain/bond-preview.ts`) shows the padded base and associated numbers, or the same range/overflow message the server would return.
- "Save & add another" (the default button, so Enter uses it) keeps the operator on the form: the fields are cleared, the base number keeps focus and the bond just saved is confirmed and listed. "Save" opens the new bond's record (`/campaigns/[id]/bonds/[bondId]`).
- Duplicates are shown on the field with the formatted numbers and a link to the bond that already uses them (`BondFormResult.conflicts`, `src/lib/server/bonds/route-helpers.ts`); the bond id is never shown as text.
- Outside draft/active the page explains why instead of showing the form; the action refuses with 409 before calling the database.
- Once a campaign has any bond (`campaignHasBonds`), the campaign page shows its rules frozen, even in draft, and hides the rules form; `campaign_update_rules` refuses the change anyway (55000).

### Pata entry (SAN-25)

`/campaigns/[id]/bonds/pata/new` (requires `campaign.view` and `bond.create`; linked from the campaign page and from the simple bond entry page while the campaign is draft or active). Two modes (`?mode=printed|grouping`):

- **Printed pata** (`?/printed`): N >= 2 base numbers typed at once (commas, semicolons, spaces or new lines). A live preview (`previewPata`, `src/lib/domain/pata-preview.ts`) shows every base → associated pair (2N numbers), range/overflow problems, numbers repeated inside the pata, N and the total (`simple_bond_value * N`, es-AR). `bond_create` stores it; campaign-wide duplicates are shown with links to the bonds that use them.
- **Manual grouping** (`?/group`): search available simple bonds that are not in an active group, by base number (`searchGroupableBonds`: one PostgREST query with an anti-join on active `bond_groups` rows, first 20 from the typed number). Picked bonds live in the URL (`?selected=<id>&selected=<id>`), so the page also works without JavaScript; each picked bond is re-checked (`listGroupingMembers`) and flagged when it cannot be grouped. The action checks again with friendly messages (linking to the pata a bond already belongs to) before `bond_group_into_pata`, which is the authority.
- Both open the new pata's record when saved.

### Bond record (SAN-25, actions)

`/campaigns/[id]/bonds/[bondId]` (requires `campaign.view` and `bond.view`). For now: general data, participating numbers padded with the campaign's digits (a manual pata shows its members' numbers), manual pata members with their ungroup history, or "In pata X" with a link for an active member (no individual actions). One component per section (`src/lib/components/bonds/record/`), with the view model built by `buildBondRecord` (`src/lib/server/bonds/record.ts`), so the remaining sections of docs/screens.md "Bond record" can be added one by one.

- `?/ungroup`: available manual pata, `bond.create` (operators included), reason required. The pata is annulled, its memberships get `ungrouped_at/by/reason` (never deleted) and its members are free again.
- `?/annul`: available simple bond or printed pata not in an active group, `bond.annul` (admin only; hidden otherwise, 403 from the action), reason required. Its numbers are released and can be entered again.
- An annulled bond shows the status it was annulled from (`annulled_from_status`): from `available` (loaded by mistake) its numbers and codes were freed; from `sold` (annulled sale, Phase 10) they stay held.
- Database messages never show bond ids (`withoutBondIds`, `src/lib/server/bonds/route-helpers.ts`).
- Both actions are scoped to the URL's campaign: they validate `params.id` and `bondId`, read the bond's campaign (`getBondCampaignId`) and answer the same 404 (without calling the SQL function) for a malformed id, a missing bond or a bond of another campaign.

### Bonds list (SAN-26)

`/campaigns/[id]/bonds` (requires `campaign.view` and `bond.view`; linked from the campaign page):

- Filters live in the query string (`base`, `associated`, `code`, `type`, `status`, `financial`, `page`), submitted with a GET form, so the list works without JavaScript and can be bookmarked. Numbers are parsed with the campaign's numbering (padded or not); invalid values are shown on the field and the list is not queried. `code` is an exact match on the barcode or the internal code. Collector and buyer filters are shown disabled until Phase 5.
- Reads go through the view `public.bond_list` (migration `20261121000000_bond_list_view.sql`, `security_invoker`, so the `bond.view` RLS of the bond tables applies). It exposes each bond's participating base and associated numbers as sorted arrays: its own numbers, or for a manual pata its members' (every membership, so an ungrouped pata is still found by the numbers it had); released numbers are included. The number filters are `cs` (array contains) filters, so a number finds the simple bond and the manual pata it is in.
- One query per page (`listBonds`): filters, `count=exact`, stable order (`sort_number` = lowest base number, then `created_at`, then `id`) and `range`. A second small query names the manual patas of grouped members ("In pata 0001 + 0002").
- Quick actions: create bond / create pata (with `bond.create` while the campaign is draft or active), load by barcode (disabled, Phase 4), assign to collector (disabled, Phase 6), and a "View record" link per row.

### Bond record sections (SAN-26)

`/campaigns/[id]/bonds/[bondId]` renders the 13 sections of docs/screens.md "Bond record", one component each in `src/lib/components/bonds/record/` (numbered cards with anchors and an index at the top), from the view model built by `buildBondRecord`:

1. General data, including the manual pata composition and ungroup history, or for a simple bond the pata it is in and the patas it was in before they were ungrouped (`listMembershipsOfMember`, named through `bond_list`).
2. Participating numbers (base, associated, extraordinary), padded.
3. Barcode: barcode, internal code and the campaign's barcode mode.
4. / 5. Current collector / buyer, and 6. to 12. (sale, installments, payments, settlements, commissions, draws and rosters, prizes): empty states naming the phase that adds their data.
5. Audit (`audit.view`, else a note; the log is not queried): the `audit_log` rows with `entity_type = 'bond'` and `entity_id` = the bond, plus the `bond.group` / `bond.ungroup` rows of manual patas whose snapshot lists the bond as a member, newest first (at most 200). The actor's name is shown when the caller can see the profile (`user.manage`), else "A user".

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
