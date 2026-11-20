# Phase 10 verification: audited corrections and closed-settlement immutability (SAN-74)

Evidence is `tests/integration/phase-10-acceptance.test.ts`: local Supabase, seeded real admin and
read-only users, RPCs, and service-role reads only where RLS deliberately prevents financial-ledger
selection. Every fixture is identified by the test run UUID/request IDs; date-only fixtures use the
Buenos Aires date.

| Criterion | Evidence                                                                                                                                                                                                                                                                                                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1        | The acceptance test rejects re-close, add, remove, and direct DML against a closed settlement. `settlement_correct` creates its linked record, compares the whole settlement except status/updated_at, asserts its exact compensation rows/audit, and rejects a second correction.                                                                                                     |
| C2        | Cash and transfer confirmed payments in a closed settlement are annulled independently. It asserts the exact `annulment` debit/credit rows, overdue installment and bond snapshot reversion, balance, and unchanged settlement row.                                                                                                                                                    |
| C3        | Both method directions and transfer reassociation assert original/replacement linkage and exact compensation. Sale collector correction asserts the four cash compensation rows for both collectors and both balances; buyer correction asserts previous/new buyer audit snapshots. Closed-settlement `total_cash`/`total_transfer` are intentionally not asserted: see SAN-110 below. |
| C4        | Each exercised successful correction checks exactly one scoped audit row, all nine required keys, key values, and that every reported movement UUID exists. A read-only denial asserts `42501`, no request-scoped audit, and unchanged payment state.                                                                                                                                  |
| C5        | Pending: `it.todo('audit viewer /campaigns/[id]/audit shows the 9 fields (part 2, after SAN-73)')`. Replace it with a real assertion after #74 (SAN-73) is merged; do not treat C5 as verified before then.                                                                                                                                                                            |

## Decisions and known gaps

- This backend-only phase deliberately leaves the audit viewer assertion pending SAN-73 (C5).
- **SAN-110:** correcting a payment method on a closed settlement can leave that settlement's
  `total_cash`/`total_transfer` values stale. Corrections to a payment already moved by a prior
  correction are blocked by `moved_payment_correction_guard`, which currently surfaces its message.
- **SAN-111:** annulled and corrected receipts do not yet show their corresponding status legends.
- Ledger reads use the admin/service client solely because `service_role` has intentionally no direct
  financial-table access; writes remain authenticated audited RPC calls.
- The test verifies `overdue` for past-due annulled installments. `paid_advance → pending` is covered
  at database level by SAN-71 pgTAP 033; adding a second integration fixture would duplicate that
  state-machine proof without changing the acceptance flow.
