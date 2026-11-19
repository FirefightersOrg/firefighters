# Phase 7 verification (SAN-61)

Verified locally on 2026-11-19. `tests/integration/phase-7-acceptance.test.ts` uses live,
per-user Supabase clients, the real SvelteKit sales and bond action/load modules, and unique
`RUN_ID` request/audit data. It creates an active campaign, draft campaign, collector, buyer,
bonds, and delivery in `beforeAll`.

## Acceptance criteria

| #   | Criterion                  | Evidence                                                                                   | Result   |
| --- | -------------------------- | ------------------------------------------------------------------------------------------ | -------- |
| C1  | Simple bond and pata sale  | Route registration verifies sold custody/buyer, sale totals, and `sale.create` audit rows. | **Pass** |
| C2  | Plans and installments     | Verifies numbered monthly rows, totals, full-payment due date, and duplicate `23505`.      | **Pass** |
| C3  | Financial independence     | Confirms sold/no-payments snapshot and domain overdue calculation independently.           | **Pass** |
| C4  | Rejections                 | Available, lost, annulled, sold, and draft cases return errors without sale/audit writes.  | **Pass** |
| C5  | Sold custody guard         | Return, reassign, and mark-lost route actions return 409 without audit rows.               | **Pass** |
| C6  | Permissions and visibility | Admin/operator registration, treasurer/read-only 403s, read-only list/detail visibility.   | **Pass** |

## Commands and real results

Run after exporting local Supabase variables:

```sh
eval "$(pnpm exec supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=' | sed 's/^/export SB_/')"
export APP_ENV=local PUBLIC_SUPABASE_URL="$SB_API_URL" PUBLIC_SUPABASE_ANON_KEY="$SB_ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SB_SERVICE_ROLE_KEY"
```

| Check              | Command                                                              | Result                           |
| ------------------ | -------------------------------------------------------------------- | -------------------------------- |
| Phase 7 acceptance | `pnpm test:integration tests/integration/phase-7-acceptance.test.ts` | **6/6 pass**                     |
| Type check         | `pnpm check`                                                         | **0 errors, 0 warnings**         |
| Lint / format      | `pnpm lint`                                                          | **Pass**                         |
| Unit tests         | `pnpm test`                                                          | **1,273/1,273 pass** in 88 files |
| Full integration   | `pnpm test:integration`                                              | **165/165 pass** in 19 files     |
| pgTAP              | `pnpm exec supabase test db`                                         | **1,567/1,567 pass** in 22 files |

## Re-run data

Campaigns use `[it-p7 <RUN_ID>]`; party data and audit request ids use `it-p7-<RUN_ID>-*`.
No cleanup is attempted because these operational records are append-only.

## Known gaps

- Payments arrive in Phase 8, so financial status is `no_payments` in practice.
- The `uncollectible` trigger is undefined.
- Cash/transfer payment method support is Phase 8.
- The due-date rule is provisional; see `docs/open-questions.md`.

## Notes

- The suite deliberately uses the service-role client only for persistence and database
  integrity assertions; route calls retain each user's RLS-scoped client and loaded permissions.
