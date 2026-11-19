# Phase 8 verification (SAN-66, backend Part 1)

Verified locally on 2026-11-19. `tests/integration/phase-8-acceptance.test.ts` uses a
local Supabase stack, separately authenticated admin, operator, treasurer, read-only, and
collector clients, and calls the production settlement service (`settlements.ts`) and its
SQL RPCs. Its service-role client is limited to setup and audit/integrity evidence; every
business operation is made by its RLS-scoped user client.

## Acceptance criteria

| #   | Criterion                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                          | Result             |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| C1  | Open-settlement totals              | Opens a settlement, adds cash and transfer applications, then removes cash and re-reads `settlement_totals`. It verifies cash, transfer, total, percentage commission, collector-specific fixed-rule override, commission settled, Firefighters net, and the documented zero credit balance.                                                                                                                                      | **Pass**           |
| C2  | Atomic closing                      | Adds payments for several sales, captures preliminary totals, closes as treasurer, and verifies confirmed payments, `paid`/`paid_advance`, split installment confirmation across two settlements, stored totals, closer/timestamp, financial snapshots (`partial_payments`, `overdue`, `fully_paid`), and one audit row for each add/close operation. An empty close is rejected and remains `open`, evidencing no partial state. | **Pass**           |
| C3  | Closed settlement immutability      | Rejects repeat close, removal of a closed payment, and a direct authenticated PostgREST `UPDATE`.                                                                                                                                                                                                                                                                                                                                 | **Pass**           |
| C4  | Permissions and own-collector scope | Verifies read-only cannot open, operator cannot close, treasurer cannot remove an open payment, and collector RLS returns only the linked collector's settlement and rejects foreign totals.                                                                                                                                                                                                                                      | **Pass**           |
| C5  | Printable documents and UI          | `it.todo` deliberately reserves verification of screens and printable settlement/delivery documents for SAN-64/65, Part 2.                                                                                                                                                                                                                                                                                                        | **Pending Part 2** |

## Decisions and known gaps

- `collector_credit_balance` is intentionally `0` until Phase 9 introduces
  `collector_ledger_entries`; C1 documents and asserts that interim contract.
- `commission_paid_amount` currently equals preliminary commission at settlement close;
  separate settlement/payment of commissions belongs to the ledger work.
- Audited manual commission adjustments remain pending **SAN-67**.
- Closed settlements are never reopened; corrections are future audited adjustments/annulments.
- This document covers backend services only. UI and HTML-print verification are intentionally
  deferred to SAN-64/65.

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
