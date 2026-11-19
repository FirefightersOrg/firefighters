# Phase 7 verification (SAN-61)

Verified locally on 2026-11-19. `tests/integration/phase-7-acceptance.test.ts` uses live,
per-user Supabase clients, the real SvelteKit sales and bond action/load modules, and unique
`RUN_ID` request/audit data. It creates an active campaign, collector, buyer,
bonds, and delivery in `beforeAll`.

## Acceptance criteria

| #   | Criterion                  | Evidence                                                                                                                                                                                                                                                                                                                                                                  | Result   |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| C1  | Simple bond and pata sale  | Route registration verifies sold custody/buyer, sale totals, and `sale.create` audit rows.                                                                                                                                                                                                                                                                                | **Pass** |
| C2  | Plans and installments     | Verifies numbered monthly rows, totals, full-payment due date, and duplicate `23505`.                                                                                                                                                                                                                                                                                     | **Pass** |
| C3  | Initial financial snapshot | Confirms the persisted and exposed `sold` / `no_payments` initial snapshot only. Financial-status precedence is covered by the named unit tests below; payment-driven independence is Phase 8 work.                                                                                                                                                                       | **Pass** |
| C4  | Rejections                 | Available, lost, annulled and sold bonds are refused with the error on the bond field; a bond delivered while its campaign was active cannot be sold once the campaign is `closing` (error on the campaign field). No sale row (counted per bond) and no audit row for the request id. A draft campaign cannot hold a delivered bond at all (deliveries are active-only). | **Pass** |
| C5  | Sold custody guard         | Return, reassign, and mark-lost route actions return 409 without audit rows.                                                                                                                                                                                                                                                                                              | **Pass** |
| C6  | Permissions and visibility | Admin/operator registration; treasurer and read-only are 403 on registration but can view the sales list and detail through `bond.view`.                                                                                                                                                                                                                                  | **Pass** |

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

- Sale annulment is not implemented. The agreed future behavior returns the bond to `available`;
  it needs a follow-up ticket.
- **SAN-105:** treasurer currently can view the sales list and detail through `bond.view`, but
  receives 403 for registration; C6 verifies that behavior today.
- **SAN-106:** the first-due-date `-31` / `+365` window is provisional, not a contract, and the
  `uncollectible` trigger remains undefined.
- Cash/transfer payment-method support is deferred to Phase 8.
- C3 covers only the initial `no_payments` snapshot. The domain precedence cases are covered by
  `calculateFinancialStatus` unit tests named `returns annulled for an annulled sale`, `returns
uncollectible`, `returns fully paid`, `returns overdue`, and `gives uncollectible precedence
over fully paid` in `src/lib/domain/financial-status.test.ts`; real payment-status independence
  is verified in Phase 8 when payments exist.

## Notes

- The suite deliberately uses the service-role client only for persistence and database
  integrity assertions; route calls retain each user's RLS-scoped client and loaded permissions.
