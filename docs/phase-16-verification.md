# Phase 16 verification: collector portal (SAN-148)

Evidence is `tests/integration/phase-16-acceptance.test.ts` (real local Supabase, signed-in collectors,
operator, treasurer, read-only and admin, real route loads and form actions), pgTAP `060`, `065`, `066`,
`067` and `068`, the Vitest unit and render tests next to each portal page, and the Playwright accessibility
pass `tests/e2e/portal-a11y.spec.ts` (same method as SAN-137).

## Route map

The portal lives under one campaign-scoped scheme. The campaign id in the URL only filters; the collector is
always resolved from the session (`requireOwnCollector`).

| Route                              | Permission                  | Content                                               |
| ---------------------------------- | --------------------------- | ----------------------------------------------------- |
| `/portal`                          | `bond.view_own`             | Campaign list (one campaign redirects to its bonds)   |
| `/portal/[campaignId]/bonos`       | `bond.view_own`             | Mis bonos (+ `bonos/[bondId]`)                        |
| `/portal/[campaignId]/ventas`      | `sale.view_own`             | Mis ventas (+ `ventas/[saleId]` with Registrar cobro) |
| `/portal/[campaignId]/compradores` | `sale.view_own`             | Mis compradores (+ `compradores/[buyerId]`)           |
| `/portal/[campaignId]/por-cobrar`  | `sale.view_own`             | Cuotas vencidas o por vencer                          |
| `/portal/[campaignId]/cuenta`      | `collector.ledger.view_own` | Mi cuenta corriente                                   |

Every page under `/portal/[campaignId]/` shares one sub-navigation (`PortalNav`), including "Mi cuenta
corriente". The campaign layout answers 404 for a malformed or invisible campaign; a sale or buyer that
does not belong to the campaign of the URL also answers 404.

## Criteria

| Criterion                            | Evidence                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolation between collectors A and B | `1. isolation…`: bonds, sales, buyers and due installments per collector; the campaign filter; URL id tampering (sale, buyer, bond, malformed ids, wrong campaign) answers 404; every `portal_my_*` RPC and direct reads of `sales`, `payments`, `installments`, `buyers`, `settlements`, `collector_ledger_entries` and `bonds` return nothing of B; submissions and ledger are per collector. |
| Unlinked or inactive collector       | `2. a collector login without a collector profile…`: empty screens, 404 on any id, no table rows, registering refused (form 403 and RPC `42501`); an inactive collector is refused the same way and creates no payment.                                                                                                                                                                         |
| Full flow to "Confirmado"            | `4. a submitted collection…`: submit (draft, no effect on installments or ledger) → operator includes it in a settlement of A (still "Pendiente de rendición") → settlement closes → payment `confirmed`, installment `paid`, `commission_generated` 10 in the ledger, portal shows "Confirmado", paid amount and the commission in "Mi cuenta corriente".                                      |
| Rejected path                        | The operator rejects with a reason: the portal shows "Rechazado" with `No llegó la transferencia`, the reserved balance is released, installment and ledger do not change.                                                                                                                                                                                                                      |
| Denials                              | `3. denials`: sale of B (404 and RPC error), annulled (corrected) sale, campaign in `closing`, future date, overpayment (form and RPC), collector cannot confirm, edit, annul or insert payments, operator RPCs answer `42501`, `403` on `/campaigns/**` and `/api/admin/users`.                                                                                                                |
| Other roles unchanged                | Operator, treasurer, read-only and admin answer 403 on every portal page and `42501` on every `portal_my_*` RPC; the operator still reads every sale and bond (global `*.view` scope unchanged, pgTAP 017 and 003).                                                                                                                                                                             |
| Dates in Buenos Aires                | `buenosAiresToday` at 00:30 UTC (21:30 in Buenos Aires) is the previous day; the database accepts that day as today and rejects tomorrow.                                                                                                                                                                                                                                                       |
| Ledger reconciles with the treasury  | The portal summary balance equals `collector_ledger_balance` and the last running balance of the treasury view, and the summary lines add up to it.                                                                                                                                                                                                                                             |
| Campaign scope in SQL                | pgTAP `068_portal_campaign_scope` (14 assertions): filter, NULL gives every own row, isolation, operator and anon denied, SAN-145 functions still answer.                                                                                                                                                                                                                                       |
| Accessibility                        | `tests/e2e/portal-a11y.spec.ts`: axe WCAG 2.1 A/AA (no serious or critical) and no horizontal scroll at 1280px, and no horizontal scroll plus 44px targets at 375px, for the landing, bonds list and detail, sales list and detail (with the collection form), buyers list and detail, due list and account, in light and dark; keyboard navigation through the sub-navigation.                 |

## Decisions and known gaps

- **Route unification (orchestrator decision):** the flat SAN-145/147 routes (`/portal/ventas`,
  `/portal/compradores`, `/portal/por-cobrar`) moved under `/portal/[campaignId]/`. Server action contracts
  and behavior are unchanged; only paths and navigation moved. `portal_my_sales` already filtered by campaign;
  buyers and due installments got `portal_my_campaign_buyers` and `portal_my_campaign_due_installments`
  (migration `20270120000000`), and the SAN-145 functions delegate to them with a NULL campaign.
- **No portal print route for delivery notes:** the collector sees its bonds and deliveries but cannot print
  a delivery note (`/campaigns/[id]/deliveries/[noteId]/print` is an operator route). Pending product decision.
- **Adjustment reasons are hidden:** "Mi cuenta corriente" shows type, amount and status, never the reason or
  internal notes of an adjustment. Pending product decision on whether the collector should read them.
- **Draft visibility:** a collection in `draft` (not yet in a settlement) and one pending in an open settlement
  both read "Pendiente de rendición". Whether the collector should tell them apart is an open decision.
- **`affects_balance` dynamic SQL (pending #130):** `portal_my_ledger_summary` and `portal_my_ledger` detect
  the `affects_balance` column at run time (`portal_ledger_affects_balance_expr`). Once #130 merges and the
  column exists for good, replace it with a plain column reference.
- The corrected sale used for the "no longer active" denial goes through the audited buyer correction
  (`sale_correct_buyer`): there is no direct annul path for a sale, and `service_role` has no table grants
  on `sales`.
- The acceptance suite creates logins, collectors and campaigns with unique ids per run (they cannot be
  deleted), like the other acceptance suites.

## Validation

Run on the local Supabase database after `db reset` and `pnpm seed:admin`, inside one lock
(`scripts/with-db-lock.sh`): `supabase test db`, `pnpm test:integration`, `pnpm check`, `pnpm lint`,
`pnpm test`, `pnpm build` and `pnpm test:e2e`. Counts are in the PR description.
