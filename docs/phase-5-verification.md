# Phase 5 verification (SAN-52)

Verified locally on 2026-11-18 against the Phase 5 branch, with the running local Supabase
environment left intact (no database reset). The live acceptance suite is
`tests/integration/phase-5-acceptance.test.ts`: **7 tests**, all using a per-run `RUN_ID`
in party names, auth email addresses, and audit request ids. Collectors and buyers are
append-only by design, so the suite is safe to repeat. The parties are created in `beforeAll`
through the real routes, so each test stands on its own (one failure does not cascade).

It exercises the actual SvelteKit load/action modules under:

- `src/routes/campaigns/[id]/collectors/**`
- `src/routes/campaigns/[id]/buyers/**`
- `src/routes/campaigns/[id]/+page.server.ts`

Calls use user-scoped Supabase clients and each caller's real `my_permissions()` result. The
database-only integrity checks use the service-role client.

## Acceptance criteria

| #   | Criterion                                                                                            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Result   |
| --- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Create, edit, search and view collector plus individual and business buyer through their real routes | `beforeAll` creates a collector through `/collectors/new`, and individual and business buyers through `/buyers/new`. Test 1 checks the persisted columns follow the type (business: `business_name`/`tax_id`, person columns null; individual: the reverse), searches buyers by first name, last name, business name, DNI and CUIT and the collector by run id, loads both records and edits both through the route actions. The two update audit rows contain only the changed `display_name` / `last_name` keys.                                                                                                                                                                                             | **Pass** |
| 2   | FK integrity and no deletion                                                                         | Test 2: service role updating `bonds.current_collector_id` / `current_buyer_id` to a random UUID returns `23503`; setting both to the created party IDs succeeds. A `commission_rules.applies_to_collector_id` with a random UUID returns `23503`; an existing collector succeeds. Deleting either party is refused with `42501`: API roles have no `DELETE` privilege, and the `23001` trigger is the backstop for the table owner (pgTAP `019`).                                                                                                                                                                                                                                                             | **Pass** |
| 3   | Permission matrix in routes and RLS, own collector scope, audited writes                             | Test 3 verifies the seeded matrix after SAN-93 (#44) for reads: the operator lists collectors (`collector.view`) and sees the buyer it searched; treasurer/read-only 403 on buyers; a collector 403 in campaign routes. A new user with role `collector`, linked through `user_profile_id`, gets exactly its own row from an **unfiltered** `select` (RLS alone). Test 4 sends writes without the permission through the routes: treasurer and read-only → `buyers/new` and `buyers/[id]?/update`, operator → `collectors/[id]?/update`; all **403**, no `audit_log` row for those request ids, and the rows and buyer count are unchanged. Test 1 verifies create/update audit. See Known gaps (`own` scope). | **Pass** |
| 4   | Optimistic concurrency                                                                               | Test 5 sends two route updates with the same collector/buyer `updated_at`; the first succeeds, the second is `409`, and the stale request id has no `audit_log` row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **Pass** |
| 5   | Record sections and audit visibility                                                                 | Test 6 SSR-renders all eight collector sections (General data through Audit) and the buyer sections (General data, purchased bonds, installments/debt, prizes, historical numbers, Audit). The admin's audit shows the `*.create` rows; the operator's buyer record shows the no-`audit.view` notice.                                                                                                                                                                                                                                                                                                                                                                                                          | **Pass** |
| 6   | Campaign page links are permission-gated                                                             | Test 7 SSR-renders `/campaigns/[id]`: admin sees both links; the operator sees both (`collector.view` from SAN-93, `buyer.manage`); treasurer/read-only see neither.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **Pass** |

## Commands and real results

Run at the head of this branch, with the local Supabase environment exported first:

```sh
eval "$(pnpm exec supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=' | sed 's/^/export SB_/')"
export APP_ENV=local PUBLIC_SUPABASE_URL="$SB_API_URL" \
  PUBLIC_SUPABASE_ANON_KEY="$SB_ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SB_SERVICE_ROLE_KEY"
```

| Check                   | Command                                                              | Result                                                                                                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 5 acceptance only | `pnpm test:integration tests/integration/phase-5-acceptance.test.ts` | **7/7 pass**                                                                                                                                                                                                                                                                           |
| Type check              | `pnpm check`                                                         | **0 errors, 0 warnings**                                                                                                                                                                                                                                                               |
| Lint / format           | `pnpm lint`                                                          | **Pass**                                                                                                                                                                                                                                                                               |
| Unit tests              | `pnpm test`                                                          | **1,025/1,025 pass** in 67 files                                                                                                                                                                                                                                                       |
| Full integration        | `pnpm test:integration`                                              | **120/120 pass** in 10 files. `phase-2-acceptance.test.ts` expects the new `viewCollectors` / `viewBuyers` flags (it compares the campaign `can` object exactly).                                                                                                                      |
| pgTAP                   | `pnpm exec supabase test db`                                         | **1,271/1,279** in 14 files, `019_collectors_buyers` included. The 8 failures are environmental: `003` (7, seeded users, fixed in #40) and one `008` truncate check, because the shared local database already has #47's delivery tables referencing `bonds` (#47 updates that check). |

## Re-run data

Every suite-created campaign is named `[it-p5 <RUN_ID>] parties`; party field values, the custom
collector auth address (`it-p5-own-<RUN_ID>@example.test`), and audit request IDs
(`it-p5-<RUN_ID>-*`) are unique. No cleanup is attempted because deletes are forbidden.

```sql
select id, display_name, user_profile_id, status
from public.collectors
where display_name like '%<RUN_ID>%';

select id, type, first_name, last_name, business_name
from public.buyers
where coalesce(first_name, '') like '%<RUN_ID>%'
   or coalesce(business_name, '') like '%<RUN_ID>%';

select action, entity_type, entity_id, old_value, new_value, request_id
from public.audit_log
where request_id like 'it-p5-<RUN_ID>-%'
order by created_at;
```

## Known gaps

These stay open after Phase 5; none is a regression of this phase.

- **SAN-103: duplicate detection compares identity numbers as exact text.** `30.111.222` and
  `30111222`, or a CUIT with and without hyphens, are not reported as duplicates. This suite
  creates buyers with `createAnyway: 'on'`, so it does not exercise the duplicate warning.
- **SAN-93 (merged in #44):** the operator now holds `collector.view`; treasurer and read-only
  still see neither party (no `collector.view` / `buyer.view` for them by decision).
- **The `own` scope exists only in RLS.** A collector linked through `user_profile_id` reads its
  own row from the database, but the routes require `collector.view` / `collector.manage`, so the
  same user gets 403 on `/collectors` and on its own record. A route-level `own` scope is not
  built yet.

## Notes

- **Deletion is blocked in two layers.** API roles (`anon`, `authenticated`, `service_role`) have
  no `DELETE` privilege on `collectors` / `buyers`, so PostgREST answers `42501`; the
  `collectors_buyers_forbid_delete` trigger (`23001`) is the backstop for the table owner, covered
  by pgTAP `019`. That is the intended design, so criterion 2 passes.
- The first full integration run failed 5 tests in `phase-2-acceptance.test.ts`: the campaign
  page gained the `viewCollectors` / `viewBuyers` flags and that suite compares the `can` object
  exactly (the fifth failure was its global audit count, which runs after the others). The
  expectations were updated in this PR.
