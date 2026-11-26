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
| Winners and prizes         | `winners-prizes`         | `prizes` + draw, winning number, awards, reversals         | `draw.view`             |

Correction links (SAN-114): `payments` includes `replaces_payment_id` (links an `adjusted` payment to
its replacement), `collector-ledger` includes `corrects_sale_id` (links cross-collector
compensation to the corrected sale) and `settlement-corrections` carries `commission_delta` and
`cash_retained_delta`. Since SAN-107/108, `collector-ledger` also carries `affects_balance` (false for
the `cash_settled` / `transfer_received_by_firefighters` reference entries and their annulments, which
never count in a balance) and `original_entry_id` (the entry a compensation offsets). A restored
balance must add only `affects_balance = true` rows (`scripts/reconcile-backup.sql`, section 4).

Rules: `report.export` is required (only the administrator holds it today) together with the view
permission of the exported data; RLS still applies. Exports are read-only, paginated in 1000-row
pages with a total order (PostgREST `max_rows` is 1000) and streamed; a failure mid-stream aborts
the download instead of producing a file that looks complete. Each export is logged
(`[backups] export generated`).

Frozen rosters (SAN-113): one row per entry of every `frozen` roster of the campaign (generated and
superseded rosters are excluded), with draw id/name/type/date, roster id, `frozen_at` (Buenos Aires
time), entry number, bond id, `bond_number_id`, `number_kind` (`base`, `associated` or
`extraordinary`) and `source_base_number_id` (the base number an associated one hangs from, empty
otherwise; both read from `bond_numbers`, so extra numbers can be told apart from base numbers when
justifying historical results), eligibility and reason, and the buyer and collector snapshots taken
when the roster was generated. Ordered by (`draw_roster_id`, `number_value`), which is unique.

Winners and prizes (SAN-92): one row per prize of the campaign (annulled prizes too), ordered by
(`draw_id`, `position`, `id`): draw id/name/type/date/status, prize id, position, name, description,
status, `excludes_from_consolation`, annulment date and reason, the winning number with its
`result_status`, matched roster entry and load time, and the award the prize resolved to (the live
award, else the latest annulled one): award id and status, bond, buyer and collector ids, award and
delivery times and delivery notes. `awards_count` and `delivery_reversals_count` show the history
behind the current award. Times are Buenos Aires wall-clock.

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
- Weekly manual export stored 30 days; monthly stored 6-12 months. Take the data and the schema as
  separate files (the schema is for reference; a restore rebuilds it from `supabase/migrations`):

  ```sh
  supabase db dump --db-url "$DATABASE_URL" --data-only --use-copy -f data.sql
  supabase db dump --db-url "$DATABASE_URL" -f schema.sql
  ```

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
3. Restore into a NEW project first. Do not restore over production yet.
   - **From a Supabase backup:** Dashboard > Database > Backups > Restore to a new project. This
     copies the whole database, auth and storage included.
   - **From a manual export (`data.sql`):** a plain `psql -f dump.sql` does not work on a fresh
     project. Supabase already owns the `auth`/`storage` schemas there, and the migrations seed
     `roles`, `permissions` and `role_permissions`, so the copy stops on duplicate keys. Use this
     sequence instead, which the local drill below checked:

     ```sh
     supabase link --project-ref "$NEW_PROJECT_REF"
     supabase db push                      # applies supabase/migrations in order
     psql "$NEW_DATABASE_URL" -v ON_ERROR_STOP=1 -X --single-transaction \
       -c 'truncate public.role_permissions, public.permissions, public.roles cascade' \
       -f data.sql
     ```

     The truncate removes only the rows the migrations seed. The dump brings them back with their
     original ids, so the `user_roles` rows keep pointing at the right roles. Run it in one
     transaction: if anything fails, nothing is left half loaded. The dump does not carry the
     migration history; `supabase db push` records it.
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
(credits minus debits, annulled entries excluded), frozen roster entry counts per draw (section 6;
compare them with the source before reopening), prizes per draw and status with their winning
numbers and awards (section 6b) and integrity checks that must return no rows (sections 5a-5c, 6c). Differences must be explained by the
accepted loss window only; anything else blocks reopening.

### Restore drills

| Date       | Where                         | Source                                                                               | Path          | Result                          |
| ---------- | ----------------------------- | ------------------------------------------------------------------------------------ | ------------- | ------------------------------- |
| 2026-11-26 | Local only (two local stacks) | Demo campaign: 240 bonds, 273 payments, 1,183 audit rows, 5 users; `data.sql` 1.7 MB | Manual export | Passed, after correcting step 3 |

Details of the 2026-11-26 drill:

- **Steps.** Dump with `supabase db dump --data-only --use-copy` (10 s for the three files). The target was a second local stack with the migrations applied. Restore as `postgres` with the sequence in step 3. The load took 1 s.
- **Finding.** The documented `psql -f dump.sql` stopped on `duplicate key value violates unique constraint "permissions_code_key"`, because the migrations had already seeded the permissions. Step 3 now has the corrected sequence.
- **Checks.**
  - `scripts/reconcile-backup.sql` output identical to the source (68 lines).
  - The administrator signs in, gets their 57 permissions and sees both campaigns.
  - Anonymous reads are refused (42501), and every `public` table has RLS on.
  - A new settlement continues the numbering (16 after 15).
- **Not covered.** Storage objects: the local target runs without the storage service, and the demo has no files. The real-project drill (SAN-157) is still pending. It must restore into a Supabase project and record who gives the OK to load real data.
