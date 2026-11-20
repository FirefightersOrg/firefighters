# Phase 11 verification: draw roster generation and frozen roster immutability (SAN-79)

Evidence is `tests/integration/phase-11-acceptance.test.ts`: a local Supabase database, seeded
real admin, authenticated audited RPCs, the draw/draw-roster services, and a real roster route
load. Fixture IDs and request IDs include the test-run UUID; all date-only fixture values use the
Buenos Aires calendar date.

| Criterion | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1        | Creates monthly, final, extraordinary and consolation draws. It asserts the inclusive Buenos Aires cutoff for monthly installments, records a payment dated after that day but does not count it toward coverage, verifies full-payment eligibility/ineligibility, pending and annulled payments, validates invalid consolation create/update with `22023`, and asserts consolation generation succeeds now that SAN-81 enabled it (it failed closed with `55000` until then). |
| C2        | An extraordinary roster asserts one extra for a simple bond and one per base for a pata, source-base linkage, campaign-wide unique number values, and unchanged extraordinary reservations after regeneration.                                                                                                                                                                                                                                                                 |
| C3        | Generated rows contain both eligibility values and stable reason codes. The test asserts the SQL snapshot keys (`buyer_snapshot.id/business_name`, `collector_snapshot.id/display_name`) and calls the real roster load to verify its buyer label comes from `business_name`.                                                                                                                                                                                                  |
| C4        | A frozen roster’s complete ordered entry rows and full roster row (including `frozen_at`) are compared before and after a cutoff-valid late confirmation, payment-method correction, and refused regeneration. The refusal creates no request-scoped audit row; repeat freeze is also audit-free and the draw remains `roster_frozen`.                                                                                                                                         |
| C5        | A real read-only user with forged service permissions receives service `403` caused by database `42501` for create, update, annul, generate, and freeze. Each request has no audit row and preserves the complete target draw and roster-entry rows; direct authenticated `UPDATE`/`DELETE` attempts against frozen roster and entry tables fail with `42501` and leave full rows unchanged.                                                                                   |

## Decisions and known gaps

- Financial tables are read using the signed-in admin client; `service_role` is used only for the
  audit/profile reads needed by this test because financial-table selection is intentionally not
  available to it.
- The test has no concurrency case: Phase 11 does not change the documented financial lock order.
- **SAN-117:** annulling a draw does not yet release its extraordinary numbers; release-on-annul is a
  known follow-up.
- **SAN-118:** `draw.annul` has not yet been separated into its own permission; annulment currently
  follows the update authorization path.
- **SAN-119:** repeated freeze is intentionally an idempotent no-op (and is exercised by C4), but
  the final idempotence contract remains tracked in this ticket.
- Consolation result selection was deferred to Phase 12 and is enabled by **SAN-81**: prior awarded
  prizes that exclude from consolation are excluded (`already_won`), and generation/freezing is refused
  while a previous draw has unresolved excluding prizes. Phase 11 only checks that generation works.
