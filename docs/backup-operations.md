# Backups and Production Operation

## Objective

Define an initial policy suitable for operating the MVP with sensitive economic and administrative data.

## Principles

- The database is the source of truth.
- Every economic operation must be reconstructible from movements.
- Backups must be tested, not only configured.
- Before bulk loads or migrations, a prior export must exist.

## Initial Objectives

```txt
RPO: maximum 24 hours of acceptable loss
RTO: operational restoration during the same day
```

These objectives can be tightened when the system enters intensive use.

## Supabase MVP

Recommended policy:

- Use a plan with automatic database backups.
- Confirm available retention for the contracted plan.
- Export manually before bulk imports.
- Export manually before large rule changes or migrations.
- Keep periodic copies of critical reports.

## Recommended Retention

- Automatic backups: according to Supabase plan, ideally at least 7 days.
- Weekly export of critical data: 30 days.
- Monthly export: 6 to 12 months.
- Final campaign report: indefinite retention.

## Critical Data to Back Up

- Campaigns.
- Bonds and numbers.
- Buyers.
- Collectors.
- Sales.
- Payments.
- Collector settlements.
- Current account.
- Draws and draw rosters.
- Winners and prizes.
- Audit.

## Storage

If receipts or documents are stored:

- Use private buckets.
- Define access policies.
- Back up or export important files.
- Do not depend only on temporary links.

## Procedure Before Risky Operation

Risky operations:

- Bulk import.
- Migration from legacy system.
- Campaign rule change.
- Bulk correction.
- Campaign closing.

Procedure:

```txt
1. Export critical data.
2. Record the reason for the operation.
3. Run in a test environment if possible.
4. Run in production.
5. Validate main reports.
6. Record the result.
```

## Restoration

A documented procedure must exist to:

- Identify a valid backup.
- Restore in a separate environment.
- Validate integrity.
- Decide whether it replaces production.
- Communicate interruption if applicable.

## Minimum Monitoring

- Application errors.
- Login failures.
- Collector settlement closing failures.
- Draw roster generation failures.
- Import failures.
- Use of critical permissions.

## Operational Exports

Even if backups exist, the system must allow exporting administrative reports:

- Bonds by campaign.
- Payments by period.
- Collector settlements.
- Collector current account.
- Frozen draw rosters.
- Winners and prizes.
