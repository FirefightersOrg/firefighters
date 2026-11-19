# Phase 8 verification (SAN-66)

Verified locally on 2026-11-19, after merging the SAN-63/64/65 review fixes (merge
baseline `afb9a0e`; acceptance assertions updated in `fix(SAN-66): address review`).
`tests/integration/phase-8-acceptance.test.ts` uses a
local Supabase stack, separately authenticated admin, operator, treasurer, read-only, and
collector clients, and calls the production settlement service (`settlements.ts`) and its
SQL RPCs. Its service-role client is limited to setup and audit/integrity evidence; every
business operation is made by its RLS-scoped user client.

## Acceptance criteria

| #   | Criterion                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                          | Result                                                  |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| C1  | Open-settlement totals              | Opens a settlement, adds cash and transfer applications, then removes cash and re-reads `settlement_totals`. It verifies cash, transfer, total, percentage commission, collector-specific fixed-rule override, commission settled, Firefighters net, and the documented zero credit balance.                                                                                                                                      | **Pass**                                                |
| C2  | Atomic closing                      | Adds payments for several sales, captures preliminary totals, closes as treasurer, and verifies confirmed payments, `paid`/`paid_advance`, split installment confirmation across two settlements, stored totals, closer/timestamp, financial snapshots (`partial_payments`, `overdue`, `fully_paid`), and one audit row for each add/close operation. An empty close is rejected and remains `open`, evidencing no partial state. | **Pass**                                                |
| C3  | Closed settlement immutability      | Rejects repeat close and removal with exact conflict/409, and direct authenticated PostgREST `UPDATE` with 403/42501. Every rejection compares full fixture rows and live totals before/after and counts audit rows by request id.                                                                                                                                                                                                | **Pass**                                                |
| C4  | Permissions and own-collector scope | Read-only cannot open/add, operator cannot close, treasurer cannot remove a real pending payment (permission/403). Each denial asserts zero new audit rows and identical settlements, payments, applications, installments and live totals; the fixture remains open/pending. Collector RLS hides foreign settlements and foreign totals fail with exact 42501, also without writes.                                              | **Pass**                                                |
| C5  | Printable documents and UI          | Real workspace/print `load` functions verify delivery-note fields, live/stored totals, preliminary variant, certificate fields (including exact date-only payment date), pending/annulled certificate 404s, disabled closed-workspace mutations, and read denial 403 with no writes. Does not invoke UI form actions add/remove/close/create.                                                                                     | **Partial: loads pass; actions not integration-tested** |

## Decisions and known gaps

- `collector_credit_balance` is intentionally `0` until Phase 9 introduces
  `collector_ledger_entries`; C1 documents and asserts that interim contract.
- `commission_paid_amount` currently equals preliminary commission at settlement close;
  separate settlement/payment of commissions belongs to the ledger work.
- Audited manual commission adjustments remain pending **SAN-67**.
- Closed settlements are never reopened; corrections are future audited adjustments/annulments.
- The settlement workspace and HTML-print routes are covered against the same local-Supabase
  data as the backend service checks.
- C5 does **not** exercise UI form actions (`add`, `remove`, `close`, `create`) against
  Supabase or drive a browser; their unit/render coverage is not end-to-end evidence.

### Review gaps reconciled after dependency merges (comment 4635170997)

| Review       | Previous gap                                                            | Current evidence / remaining limit                                                                                                                                                                                                                                                                                                                         |
| ------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #63 / SAN-63 | Inverse remove/close lock order; missing concurrency tests              | Merged settlement-first locking and `028b_settlement_services_concurrency.test.sql`: two real sessions test remove/close in both orders. `029_payments_settlement_concurrency.test.sql` covers direct admission/status races. A full concurrent **service add/remove/close** scenario is still not covered by C1–C5 (nor by those two narrower SQL tests). |
| #63 / SAN-63 | Undefined permissions fail open in TS                                   | Fixed upstream: mandatory `SettlementRequestContext`; null/undefined permissions fail closed with internal/500, with service unit tests.                                                                                                                                                                                                                   |
| #67 / SAN-64 | Null permissions produce 403 instead of 500 in add/remove/close actions | Fixed upstream: unavailable permissions yield 500, with route unit assertions; C5 does not integration-test these actions.                                                                                                                                                                                                                                 |
| #67 / SAN-64 | Candidate installments silently truncated at 1,000                      | Fixed upstream: paginated repository queries, including candidate/paid/pending rows, with multi-page repository tests. C5 fixtures are small and do not independently prove pagination.                                                                                                                                                                    |
| #66 / SAN-65 | Invented certificate payment time                                       | Fixed upstream: SQL calendar date is formatted without time or timezone shift. C5 asserts the exact es-AR date for an explicit Buenos Aires calendar day, not merely a non-placeholder.                                                                                                                                                                    |
| #66 / SAN-65 | Annulled settlements have no print legend                               | Fixed upstream: ANULADA/CORREGIDA marks and print load/render tests. C5 covers open/closed only, not annulled/corrected rendering against Supabase.                                                                                                                                                                                                        |

No claim is made that dependency unit tests close the remaining integration/browser gaps.

## Commands

```sh
CLI=~/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-linux-x64/bin/supabase
$CLI db reset --local
$CLI test db
# export the local API/anon/service keys, APP_ENV=local, then:
pnpm seed:admin
pnpm test:integration
pnpm check
pnpm lint
pnpm test
```

Run database tests immediately after reset, **before** seeding/integration: some pgTAP
assertions count all visible rows and integration fixtures persist. Running pgTAP on a
populated integration database produces unrelated count failures; it is not a passing run.

Evidence for the 2026-11-19 review-fix tree (baseline `afb9a0e` plus this commit):
database pgTAP **1,763 tests in 29 files**, integration **176 tests in 21 files**
(including C1–C5), unit/render **1,356 tests in 106 files**; `pnpm check` and
`pnpm lint` pass. The earlier **1,704 pgTAP / 176 integration** counts belonged to
the pre-review verification at `d49cb781` on 2026-11-19, not the merged tree.

### Review resolutions

| Comment id | Resolution                                                                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4635170972 | Exact permission/status and direct UPDATE SQLSTATE; real pending remove fixture; per-request service-role audit counts and full before/after state/totals assertions (also for conflict denials and C5 read denial). |
| 4635170982 | Foreign totals require 42501, not any thrown error; certificate requires exact calendar date with no time.                                                                                                           |
| 4635170997 | Dependency fixes and remaining concurrency/action/browser gaps listed above; C5 marked partial; run counts dated and tied to the reviewed baseline plus this commit.                                                 |
