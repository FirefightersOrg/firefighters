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

Procedure:

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
