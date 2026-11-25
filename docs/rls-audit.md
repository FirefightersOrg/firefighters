# RLS and testing-contract audit (SAN-91)

## Row level security

`supabase/tests/database/058_rls_audit.test.sql` audits the database by **enumerating the catalog**
(`pg_class`, `pg_policy`, `pg_proc`), so any table, view or function added later is checked
automatically:

- Every table in `public` has RLS enabled and at least one SELECT policy.
- `anon` has no privilege on any table, cannot execute any `SECURITY DEFINER` function, and no
  `SECURITY DEFINER` function is executable by `PUBLIC`.
- `authenticated` writes directly only to `profiles` and `user_roles` (user administration). Those
  INSERT, UPDATE and DELETE policies require `user.manage`. Every other write goes through an audited
  `SECURITY DEFINER` RPC. Nothing can be truncated.
- Every `SECURITY DEFINER` function pins `search_path = ''`.
- Every view runs with the caller's permissions (`security_invoker`).
- For each seeded role, `has_permission` returns exactly the role's seeded permission set. Admin
  holds every permission.
- A real payment and settlement are visible exactly to the roles holding a matching permission.

### Roles

The ticket names five roles: treasury, operations, collector_coordinator and auditor. The seeded
roles map to them as follows:

| Ticket                | Seeded role                      |
| --------------------- | -------------------------------- |
| treasury              | `treasurer`                      |
| operations            | `operator`                       |
| auditor               | `read-only`                      |
| —                     | `admin`                          |
| —                     | `collector`                      |
| collector_coordinator | Not created; deferred to SAN-139 |

## Service-role key

`src/lib/server/service-role-key.test.ts` scans `src/` and checks three things:

- `SUPABASE_SERVICE_ROLE_KEY` appears only in server-only modules.
- The service-role client (`$lib/server/supabase/admin`) is imported only from server-only modules.
- Private env (`$env/*/private`) is never read outside server-only modules.

A server-only module is anything under `$lib/server/**`, an endpoint (`+server.ts`) or any
`*.server.ts` file. SvelteKit refuses to bundle those for the browser. Today the key is read only in
`src/lib/server/supabase/admin.ts`, and that client is used only by `routes/api/admin/users/+server.ts`.

## Minimum testing contract (docs/technical-design.md)

| Contract item                                                            | Tests                                                                                        |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Associated number calculation, formatting per campaign, range validation | `src/lib/domain/numbering.test.ts`, `numbering-preview.test.ts`                              |
| Pata value calculation                                                   | `src/lib/domain/pata-preview.test.ts`, `bonds.test.ts`                                       |
| Commission calculation                                                   | `src/lib/domain/commissions.test.ts`                                                         |
| Draw eligibility                                                         | `src/lib/domain/draw-eligibility.test.ts`                                                    |
| Settlement closing (`closeSettlement`)                                   | `src/lib/server/services/settlements.test.ts` (`closeSettlement` block) and pgTAP 028 / 028b |
| Confirmed payment annulment                                              | `src/lib/server/services/payment-corrections.test.ts` and pgTAP 033                          |
| Roster generation (`generateDrawRoster`)                                 | `src/lib/server/services/draw-rosters.test.ts` and pgTAP 038                                 |
| Winner loading (`loadWinningNumber`)                                     | `src/lib/server/services/prizes.test.ts` and pgTAP 042                                       |
| Critical E2E flows                                                       | `tests/e2e/money-flow.spec.ts` and `draw-flow.spec.ts` (Playwright, #121)                    |

## Findings

No gaps found:

- no table without RLS;
- no grant to `anon`;
- no `SECURITY DEFINER` function without `search_path` or executable by `anon` / `PUBLIC`;
- no unexpected direct write.

The only direct writes, `profiles` and `user_roles`, are intentional and gated by `user.manage`.

## Collector own scope (SAN-143)

The collector role reads rows through policies of the form `global permission OR (*_own permission AND is_own_collector(collector_id))`: `bonds`, `bond_numbers`, `bond_groups`, `delivery_notes`, `bond_assignments`, `sales` (plans and installments follow the sale), `payments`, `settlements`, `collector_ledger_entries` and `commission_adjustments`. `buyers_select` stays closed; buyers reach the portal only through `portal_my_buyers`. pgTAP `060_collector_portal_scope` checks two collectors, an unlinked profile, an inactive collector and the unchanged roles; `058_rls_audit` fixes the permission matrix.

## Alcance por campaña del portal (SAN-148)

`portal_my_campaign_buyers(p_campaign_id, ...)` and `portal_my_campaign_due_installments(p_campaign_id, ...)` (SECURITY DEFINER, empty search_path, `authenticated` only) are the campaign-filtered variants of the SAN-145 lists. They check `sale.view_own` and only read the caller's own sales; a `NULL` campaign gives the SAN-145 result, and `portal_my_buyers_page` / `portal_my_due_installments` now delegate to them. pgTAP `068_portal_campaign_scope`; end-to-end isolation and the payment flow are in `tests/integration/phase-16-acceptance.test.ts`.

## Mi cuenta corriente (SAN-146)

`portal_my_ledger_summary` and `portal_my_ledger` (SECURITY DEFINER, empty search_path, `authenticated` only) read the ledger of the caller's own collector, resolved from the session; they take no collector id, need `collector.ledger.view_own`, and return no reasons or notes. Reference entries (`affects_balance = false`, #130) are listed but never counted; the functions detect the column at run time. pgTAP `066_portal_my_ledger`.
