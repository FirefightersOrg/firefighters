# Phase 6 verification (SAN-57)

Verified locally on 2026-11-18 against the Phase 6 branch with the shared local Supabase left
intact (no reset). `tests/integration/phase-6-acceptance.test.ts` is a live acceptance suite:
**6 tests**, one per criterion. It invokes the real SvelteKit load/action modules with
user-scoped clients and real `my_permissions()` results; the service-role client is used only to
inspect persisted results. Each run has a unique `RUN_ID` in campaign/collector names and audit
request IDs, and never attempts cleanup.

## Acceptance criteria

| #   | Criterion                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Result   |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| C1  | Deliver three available bonds | Operator posts `deliveries/new?/deliver`; service-role checks delivered status, collector, active delivery assignments, note/items, sequential campaign note number, and `bond.deliver` plus `delivery_note.issue` audit rows. The bond-record load exposes custody history.                                                                                                                                                                                                                                                                                      | **Pass** |
| C2  | Printable delivery note       | Loads the real print server module and SSR-renders `+page@.svelte`. Checks all 13 documented fields, a barcode and an absent-barcode row, and both original/duplicate copies.                                                                                                                                                                                                                                                                                                                                                                                     | **Pass** |
| C3  | Return and reassign           | Bond-record return and reassign, and collector-record bulk reassign and return, through the real actions, passing the collector the screen showed: a return issues a **return note** (reason `return`) and opens it, leaving the bond `available` with no collector and history `delivery(returned)` → `return`; a reassignment issues a `reassignment` note, changes the collector and marks the old assignment `reassigned`. A **lost** bond is refused (`409`) on return and on reassign, with no audit row and the row unchanged. Sold bonds: see Known gaps. | **Pass** |
| C4  | Loss                          | Missing fields and a future date return 400 with no audit. A valid loss persists status, responsible party, date, reason and `bond.mark_lost` audit.                                                                                                                                                                                                                                                                                                                                                                                                              | **Pass** |
| C5  | Permissions                   | After SAN-93 (#44): the operator delivers, reassigns and returns, but gets 403 on mark lost. Treasurer and read-only **see the issued note** in the list (`can.deliver` false), get 403 on the `deliveries/new` page and on deliver, return, reassign and mark lost; no audit row for any denied request, and the bonds keep their status.                                                                                                                                                                                                                        | **Pass** |
| C6  | Campaign window               | A campaign is activated, given available/delivered bonds, then transitioned to `closing`. Deliver, return, reassign and loss all return 409, emit no audit and leave statuses unchanged.                                                                                                                                                                                                                                                                                                                                                                          | **Pass** |

## Commands and real results

Export the local integration environment first:

```sh
eval "$(pnpm exec supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=' | sed 's/^/export SB_/')"
export APP_ENV=local PUBLIC_SUPABASE_URL="$SB_API_URL" \
  PUBLIC_SUPABASE_ANON_KEY="$SB_ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SB_SERVICE_ROLE_KEY"
```

| Check              | Command                                                              | Result                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 6 acceptance | `pnpm test:integration tests/integration/phase-6-acceptance.test.ts` | **6/6 pass**                                                                                                                                                                    |
| Type check         | `pnpm check`                                                         | **0 errors, 0 warnings**                                                                                                                                                        |
| Lint / format      | `pnpm lint`                                                          | **Pass**                                                                                                                                                                        |
| Unit tests         | `pnpm test`                                                          | **1,231/1,231 pass** in 82 files (Node `v24.22.3`, from `node --version`)                                                                                                       |
| Full integration   | `pnpm test:integration`                                              | **157/157 pass** in 15 files                                                                                                                                                    |
| pgTAP              | `pnpm exec supabase test db`                                         | **1,468/1,469 pass** in 20 files; the only failure is `008`'s truncate check, because the shared local database already has the sales tables of #54 (which updates that check). |

The results above include #48 with its ICU-stable date test (merged into this branch).

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
  sold bond cannot be produced through the application before Phase 7. The suite proves the same
  guard with a lost bond (return and reassign refused with 409); pgTAP
  [`020_bond_delivery`](../supabase/tests/database/020_bond_delivery.test.sql) does cover return,
  reassignment and loss rejection after the owner writes a bond's status as `sold`. The application
  acceptance case belongs to SAN-61.
- **Manual pata acceptance is not covered here.** pgTAP `020` covers delivering, returning and
  losing a manual pata (members stay blocked), and #48's tests cover printing member numbers; this
  suite has no route-level case for it.
- **A collector's own-login route scope is not covered.** pgTAP `020` checks that a collector's own
  login reads only its notes and custody; the routes still require `bond.view` / `bond.assign`.

Decisions now asserted by the suite (#47): deliveries and reassignments happen only while the
campaign is **active** (C6 also covers `closing`); a return covers one collector at a time and
issues a return note; screens pass the source collector, so a stale screen gets 409 (#51's
integration test covers the bulk case); the operator holds `bond.return` (SAN-93, #44).

## Notes

- The suite calls route modules directly rather than HTTP endpoints, but does not mock route,
  permission, service, repository or database behavior.
- C6 uses `campaign_transition` (`draft → active → closing`) rather than direct table writes.
