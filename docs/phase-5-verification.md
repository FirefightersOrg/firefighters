# Phase 5 verification (SAN-52)

Verified locally on 2026-11-18 against the Phase 5 branch, with the running local Supabase
environment left intact (no database reset). The live acceptance suite is
`tests/integration/phase-5-acceptance.test.ts`: **6 new tests**, all using a per-run `RUN_ID`
in party names, auth email addresses, and audit request ids. Collectors and buyers are
append-only by design, so the suite is safe to repeat.

It exercises the actual SvelteKit load/action modules under:

- `src/routes/campaigns/[id]/collectors/**`
- `src/routes/campaigns/[id]/buyers/**`
- `src/routes/campaigns/[id]/+page.server.ts`

Calls use user-scoped Supabase clients and each caller's real `my_permissions()` result. The
database-only integrity checks use the service-role client.

## Acceptance criteria

| #   | Criterion                                                                                            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Result                |
| --- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | Create, edit, search and view collector plus individual and business buyer through their real routes | Test 1 creates a collector through `/collectors/new`, individual and business buyers through `/buyers/new`, searches collector by run id and buyers by DNI/CUIT, loads records, and edits both route actions. The two update audit rows contain only the changed `display_name` / `last_name` keys.                                                                                                                                                                                                                                       | **Pass**              |
| 2   | FK integrity and no deletion                                                                         | Test 2: service role updating `bonds.current_collector_id` / `current_buyer_id` to a random UUID returns `23503`; setting both to the created party IDs succeeds. Inserting a `commission_rules.applies_to_collector_id` with random UUID returns `23503`; existing collector succeeds. Both party deletions are blocked, but return **`42501`**, not the criterion's required `23001`; see Findings.                                                                                                                                     | **Partial / finding** |
| 3   | Permission matrix in routes and RLS, own collector scope, audited writes                             | Test 3 verifies the current seeded matrix: admin manages/views both; operator can manage/view buyers but gets 403 for collectors; treasurer/read-only get 403 for parties; collector gets 403 in campaign routes. A newly provisioned auth user/profile with role `collector`, linked through `user_profile_id`, sees only its own collector row with RLS. Test 1 verifies create/update audit actions and changed keys. **Until SAN-93:** expectations intentionally reflect the current matrix, which lacks the planned `.view` grants. | **Pass**              |
| 4   | Optimistic concurrency                                                                               | Test 4 sends two route updates with the same collector/buyer `updated_at`; the first succeeds, the second is `409`, and the stale request id has no `audit_log` row.                                                                                                                                                                                                                                                                                                                                                                      | **Pass**              |
| 5   | Record sections and audit visibility                                                                 | Test 5 SSR-renders all eight collector sections (General data through Audit) and buyer sections (General data, purchased bonds, installments/debt, prizes, historical numbers, Audit). Admin's audit is rendered; operator's buyer record renders the no-`audit.view` notice.                                                                                                                                                                                                                                                             | **Pass**              |
| 6   | Campaign page links are permission-gated                                                             | Test 6 SSR-renders `/campaigns/[id]`: admin sees both links; operator sees only `Buyers →`; treasurer/read-only see neither. **Until SAN-93:** operator has `buyer.manage`, but no collector permission.                                                                                                                                                                                                                                                                                                                                  | **Pass**              |

## Commands and real results

The integration environment was exported before each integration command:

```sh
SB=/home/juanigm/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-linux-x64/bin/supabase
eval "$($SB status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=' | sed 's/^/export SB_/')"
export APP_ENV=local PUBLIC_SUPABASE_URL="$SB_API_URL" \
  PUBLIC_SUPABASE_ANON_KEY="$SB_ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SB_SERVICE_ROLE_KEY"
```

| Check                   | Command                                                                                                                                                       | Result                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 5 acceptance only | `MISE_PNPM_VERSION=11.17.0 MISE_NODE_VERSION=22.23.1 pnpm exec vitest run --config vitest.integration.config.ts tests/integration/phase-5-acceptance.test.ts` | **6/6 pass**                                                                                                                                                                                                            |
| Type check              | `MISE_PNPM_VERSION=11.17.0 MISE_NODE_VERSION=22.23.1 pnpm check`                                                                                              | **0 errors, 0 warnings**                                                                                                                                                                                                |
| Lint / format           | `MISE_PNPM_VERSION=11.17.0 MISE_NODE_VERSION=22.23.1 pnpm lint`                                                                                               | **Pass**                                                                                                                                                                                                                |
| Unit tests              | `MISE_PNPM_VERSION=11.17.0 MISE_NODE_VERSION=22.23.1 pnpm test`                                                                                               | **1,014/1,014 pass** in 65 files                                                                                                                                                                                        |
| Full integration        | `MISE_PNPM_VERSION=11.17.0 MISE_NODE_VERSION=22.23.1 pnpm test:integration`                                                                                   | **114/119 pass** in 10 files; 5 failures in pre-existing `phase-2-acceptance.test.ts` (four exact `can`-object expectations omit the newly added party-link flags; one audit-count assertion). Phase 5 is **6/6 pass**. |
| pgTAP                   | `/home/juanigm/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-linux-x64/bin/supabase test db`                                                          | **1,267/1,274 pass** in 14 files. `003_rls_has_permission.test.sql` has the known 7 failures with seeded users, to be fixed in #40; all other 13 files, including `019_collectors_buyers.test.sql`, pass.               |

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

## Findings

1. **Deletion SQLSTATE differs from SAN-52.** Reproduction: with service role, run
   `delete from` equivalent through PostgREST on a referenced `collectors` or `buyers` row. It is
   blocked, but returns `42501` (`permission denied for table ...`) because migration
   `20261203000000_collectors_buyers.sql` revokes `DELETE` from `service_role`; the
   `collectors_buyers_forbid_delete` trigger which raises `23001` is never reached. The requested
   condition “nobody can delete: `23001`” is therefore not met, although deletion is prevented.
   No product/migration change was made.

2. **Full integration suite currently has five non-Phase-5 failures.** Four phase-2 assertions
   compare the campaign `can` object exactly and do not include the product's new
   `viewCollectors` / `viewBuyers` properties. The fifth is phase-2's global audit row-count
   assertion. No pre-existing acceptance tests were changed in this task.

3. **Known pgTAP issue:** `003_rls_has_permission.test.sql` fails 7/107 checks in an environment
   with seeded users (profile/audit counts and user-role guard expectations). This is the known
   #40 issue requested in SAN-52; no database reset was used.
