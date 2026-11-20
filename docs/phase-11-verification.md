# Phase 11 verification: draw roster generation and frozen roster immutability (SAN-79)

Evidence is `tests/integration/phase-11-acceptance.test.ts`: a local Supabase database, seeded
real admin, authenticated audited RPCs, the draw/draw-roster services, and a real roster route
load. Fixture IDs and request IDs include the test-run UUID; all date-only fixture values use the
Buenos Aires calendar date.

| Criterion | Evidence                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1        | Creates monthly, final, extraordinary and consolation draws. It asserts the inclusive Buenos Aires cutoff for monthly installments, rejects a payment dated after that day, verifies full-payment eligibility/ineligibility, pending and annulled payments, validates invalid consolation create/update with `22023`, and asserts consolation generation fails with `55000`. |
| C2        | An extraordinary roster asserts one extra for a simple bond and one per base for a pata, source-base linkage, campaign-wide unique number values, and unchanged extraordinary reservations after regeneration.                                                                                                                                                               |
| C3        | Generated rows contain both eligibility values and stable reason codes. The test asserts the SQL snapshot keys (`buyer_snapshot.id/business_name`, `collector_snapshot.id/display_name`) and calls the real roster load to verify its buyer label comes from `business_name`.                                                                                                |
| C4        | A frozen roster’s complete ordered entry rows are compared before and after a cutoff-valid late confirmation and a payment-method correction. Generation maps its `55000` to service conflict, repeat freeze creates no request-scoped audit row, and the draw remains `roster_frozen`.                                                                                      |

## Decisions and known gaps

- Financial tables are read using the signed-in admin client; `service_role` is used only for the
  audit/profile reads needed by this test because financial-table selection is intentionally not
  available to it.
- The test has no concurrency case: Phase 11 does not change the documented financial lock order.
- The Phase 12 consolation result-selection flow is deliberately not tested; Phase 11’s required
  fail-closed `55000` behavior is tested instead.
