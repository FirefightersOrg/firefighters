# Backups and production operations

## Objective

Define an adequate initial policy for operating the MVP with sensitive economic and administrative data.

## Principles

- The database is the source of truth.
- Every economic operation must be reconstructable from movements.
- Backups must be tested, not just configured.
- Before bulk loads or migrations, a prior export must exist.

## Initial objectives

```txt
RPO: maximum 24 hours of acceptable data loss
RTO: operational restoration within the same day
```

These objectives can be tightened when the system enters intensive use.

## Supabase MVP

Recommended policy:

- Use a plan with automatic database backups.
- Confirm available retention of the contracted plan.
- Manually export before bulk imports.
- Manually export before major rule changes or migrations.
- Maintain periodic copies of critical reports.

## Recommended retention

- Automatic backups: per Supabase plan, ideally a minimum of 7 days.
- Weekly export of critical data: 30 days.
- Monthly export: 6 to 12 months.
- Final campaign report: indefinite retention.

## Critical data to back up

- Campaigns.
- Bonds and numbers.
- Buyers.
- Collectors.
- Sales.
- Payments.
- Settlements.
- Current account.
- Draws and rosters.
- Winners and prizes.
- Audit.

## Storage

If receipts or documents are stored:

- Use private buckets.
- Define access policies.
- Back up or export important files.
- Do not rely solely on temporary links.

## Procedure before risky operations

Risky operations:

- Bulk import.
- Migration from legacy system.
- Campaign rule changes.
- Bulk correction.
- Campaign closure.

Procedure (the app shows this checklist, with a link to the exports, before confirming a bulk
import, changing campaign rules and closing a campaign; see "Checklist in the app" below):

```txt
1. Export critical data.
2. Record the reason for the operation.
3. Execute in a test environment if possible.
4. Execute in production.
5. Validate main reports.
6. Record the result.
```

## Restoration

A documented procedure must exist for:

- Identifying a valid backup.
- Restoring in a separate environment.
- Validating integrity.
- Deciding whether to replace production.
- Communicating interruption if applicable.

## Minimum monitoring

- Application errors.
- Login failures.
- Settlement closure failures.
- Roster generation failures.
- Import failures.
- Use of critical permissions.

## Operational exports

Even if backups exist, the system must allow exporting administrative reports:

- Bonds per campaign.
- Payments by period.
- Settlements.
- Collector current accounts.
- Frozen rosters.
- Winners and prizes.

### Implemented exports (SAN-90)

Generated on demand as CSV (UTF-8 with BOM, CRLF, formula-safe text cells) at
`/campaigns/[id]/backups` (page) and `/campaigns/[id]/backups/export/[kind]` (download):

| Export                     | `kind`                   | Source                                                     | Extra permission        |
| -------------------------- | ------------------------ | ---------------------------------------------------------- | ----------------------- |
| Bonds per campaign         | `bonds`                  | `bonds` + active `bond_numbers`                            | `bond.view`             |
| Payments by period         | `payments`               | `payments` (`?from=&to=` on `payment_date`)                | `payment.view`          |
| Settlements                | `settlements`            | `settlements` + collector name                             | `settlement.view`       |
| Collector current accounts | `collector-ledger`       | `collector_ledger_entries` (`?from=&to=` on `occurred_at`) | `collector.ledger.view` |
| Settlement corrections     | `settlement-corrections` | `settlement_corrections` (via its settlement's campaign)   | `settlement.view`       |
| Frozen rosters             | `frozen-rosters`         | `draw_roster_entries` of `frozen` rosters + draw           | `draw.view`             |

Correction links (SAN-114): `payments` includes `replaces_payment_id` (links an `adjusted` payment to
its replacement), `collector-ledger` includes `corrects_sale_id` (links cross-collector
compensation to the corrected sale) and `settlement-corrections` carries `commission_delta` and
`withheld_commission_delta`.

Rules: `report.export` is required (only the administrator holds it today) together with the view
permission of the exported data; RLS still applies. Exports are read-only, paginated in 1000-row
pages with a total order (PostgREST `max_rows` is 1000) and streamed; a failure mid-stream aborts
the download instead of producing a file that looks complete. Each export is logged
(`[backups] export generated`).

Frozen rosters (SAN-113): one row per entry of every `frozen` roster of the campaign (generated and
superseded rosters are excluded), with draw id/name/type/date, roster id, `frozen_at` (Buenos Aires
time), entry number, bond id, eligibility and reason, and the buyer and collector snapshots taken
when the roster was generated. Ordered by (`draw_roster_id`, `number_value`), which is unique.

Pending (Phase 12 tables do not exist yet): **winners and prizes**. Hooks are marked
`TODO(SAN-113)` in `src/lib/domain/backup-exports.ts` and `scripts/reconcile-backup.sql`
(SAN-113 stays open for it).

### Checklist in the app

A collapsible 6-step checklist (`RiskyOperationChecklist`) is shown on: import preview (before
Confirm), campaign page (above the rules form and above closing/closure transitions). Bulk
corrections of the legacy migration and a dedicated bulk-correction flow do not exist yet: apply
the procedure by hand and add the checklist there when the flow is built. Steps 2, 3, 5 and 6 are
recorded outside the app (ticket/comment with the reason, test-environment run, report validation
and result).

## Supabase backup and restoration runbook (RPO <= 24h, RTO same day)

### Preconditions

- Plan with automatic daily backups (Pro or higher: 7 days of retention; Point in Time Recovery
  is optional and brings RPO to minutes). Confirm in Dashboard > Database > Backups. A daily
  backup gives RPO <= 24h by construction.
- Weekly manual export (`supabase db dump` or `pg_dump`) stored 30 days; monthly stored 6-12 months.
- At least two people with Supabase dashboard access and the production connection string in the
  password manager.

### Verifying backups (monthly, and after any plan change)

1. Restore the latest backup into a separate project (steps below, 1-4).
2. Run `scripts/reconcile-backup.sql` on both and compare.
3. Record date, backup used, elapsed time and result. Elapsed time must be well under one working
   day (RTO).

### Restoring

1. Declare the incident, freeze writes (put the app in maintenance or revoke access) and note the
   time of the last known good state.
2. Identify a valid backup: Dashboard > Database > Backups (or PITR timestamp). Pick the newest one
   taken before the damage; the data after it is the accepted loss (<= 24h) and is re-entered from
   the operational exports and paper records.
3. Restore into a NEW project first (Dashboard > Backups > Restore, or load a dump with
   `psql "$NEW_DATABASE_URL" -f dump.sql`). Do not restore over production yet.
4. Validate integrity on the restored project: run `scripts/reconcile-backup.sql` (see below),
   check that migrations match `supabase/migrations` (`supabase migration list`), sign in with the
   administrator and open the main reports.
5. Decide whether to replace production: if only a slice of data is lost, copy it from the
   restored project; if production is unusable, repoint the app (`PUBLIC_SUPABASE_URL`, keys,
   `DATABASE_URL`) to the restored project, or restore over production once step 4 passes.
6. Re-run `pnpm seed:admin` only if the administrator is missing; never in a way that overwrites
   existing users.
7. Re-enter the data between the backup and the incident, using the latest operational exports and
   the audit log as reference.
8. Communicate the interruption to the organization (what time range was affected, what must be
   re-entered), then lift the freeze.
9. Record the incident: cause, backup used, elapsed time, losses, follow-ups.

### Post-restoration reconciliation

Run `scripts/reconcile-backup.sql` read-only on the restored database and compare with the same
output taken from the last export/known-good database:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -A -F $'\t' -f scripts/reconcile-backup.sql > restored.txt
diff before.txt restored.txt
```

It reports: bonds per campaign and status (count and value), payments per campaign and status
(count and amount), correction link counts and deltas, settlements per campaign and status (totals), collector balances per campaign
(credits minus debits, annulled entries excluded) and integrity checks that must return no rows.
Frozen roster counts are pending (Phase 11). Differences must be explained by the accepted loss
window only; anything else blocks reopening.
