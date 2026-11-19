# Phase 6 verification (SAN-57)

Verified locally on 2026-11-18 against the Phase 6 branch with the shared local Supabase left
intact (no reset). `tests/integration/phase-6-acceptance.test.ts` is a live acceptance suite:
**6 tests**, one per criterion. It invokes the real SvelteKit load/action modules with
user-scoped clients and real `my_permissions()` results; the service-role client is used only to
inspect persisted results. Each run has a unique `RUN_ID` in campaign/collector names and audit
request IDs, and never attempts cleanup.

## Acceptance criteria

| #   | Criterion                     | Evidence                                                                                                                                                                                                                                                                     | Result   |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| C1  | Deliver three available bonds | Operator posts `deliveries/new?/deliver`; service-role checks delivered status, collector, active delivery assignments, note/items, sequential campaign note number, and `bond.deliver` plus `delivery_note.issue` audit rows. The bond-record load exposes custody history. | **Pass** |
| C2  | Printable delivery note       | Loads the real print server module and SSR-renders `+page@.svelte`. Checks all 13 documented fields, a barcode and an absent-barcode row, and both original/duplicate copies.                                                                                                | **Pass** |
| C3  | Return and reassign           | Exercises bond return/reassign and collector bulk reassign/return actions. Verifies available/cleared return state, returned/reassigned assignment history and reassignment notes. Operator's disallowed loss leaves data/audit unchanged.                                   | **Pass** |
| C4  | Loss                          | Missing fields and a future date return 400 with no audit. A valid loss persists status, responsible party, date, reason and `bond.mark_lost` audit.                                                                                                                         | **Pass** |
| C5  | Permissions                   | Operator delivers/reassigns but is 403 on return/loss. Treasurer/read-only can list notes but are 403 on delivery; denied writes have no audit row.                                                                                                                          | **Pass** |
| C6  | Campaign window               | A campaign is activated, given available/delivered bonds, then transitioned to `closing`. Deliver, return, reassign and loss all return 409, emit no audit and leave statuses unchanged.                                                                                     | **Pass** |

## Commands and real results

Export the local integration environment first:

```sh
eval "$(pnpm exec supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=' | sed 's/^/export SB_/')"
export APP_ENV=local PUBLIC_SUPABASE_URL="$SB_API_URL" \
  PUBLIC_SUPABASE_ANON_KEY="$SB_ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SB_SERVICE_ROLE_KEY"
```

| Check              | Command                                                              | Result                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 6 acceptance | `pnpm test:integration tests/integration/phase-6-acceptance.test.ts` | **6/6 pass**                                                                                                                                             |
| Type check         | `pnpm check`                                                         | **0 errors, 0 warnings**                                                                                                                                 |
| Lint / format      | `pnpm lint`                                                          | **Fails only on `.claude-brief/brief-57.md`** (an ignored supplied brief that is not Prettier-formatted). The two SAN-57 files pass Prettier and ESLint. |
| Unit tests         | `pnpm test`                                                          | **1,056/1,056 pass** in 73 files                                                                                                                         |
| Full integration   | `pnpm test:integration`                                              | **134/134 pass** in 13 files                                                                                                                             |
| pgTAP              | `pnpm exec supabase test db`                                         | **1,323/1,330 pass** in 15 files; the 7 failures are the known shared-DB `003` failures fixed in #40.                                                    |

## Re-run data

The campaign names are `[it-p6 <RUN_ID>] custody` and `[it-p6 <RUN_ID>] closing`; collectors
and audit request ids use `it-p6-<RUN_ID>-*`. The records are append-only.

```sql
select id, name, status from public.campaigns where name like '[it-p6 <RUN_ID>]%';
select action, entity_id, request_id from public.audit_log
where request_id like 'it-p6-<RUN_ID>-%' order by created_at;
```

## Known gaps

- **Sold-bond rejection is not acceptance-tested.** Phase 6 has no sale RPC, so a legitimate
  sold bond cannot be produced through the application before Phase 7. The suite instead proves
  a denied custody attempt leaves a delivered bond unchanged.
- **Current permissions intentionally deny the operator `bond.return` and `bond.mark_lost`.** The
  suite asserts 403 for both; this remains pending the product decision in issue #50 / SAN-93.

## Notes

- The suite calls route modules directly rather than HTTP endpoints, but does not mock route,
  permission, service, repository or database behavior.
- C6 uses `campaign_transition` (`draft → active → closing`) rather than direct table writes.
