# Phase 1 verification (SAN-15)

Verified on the local development environment (macOS, Node 24.12.0, pnpm 11.17.0, Supabase CLI 2.108.0), with the local stack started from this branch's `supabase/config.toml`.

## Acceptance criteria

| #   | Criterion                                                                                      | Verified by                                                                     | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 5 roles and exactly 44 granular permissions are seeded                                         | pgTAP `001`, `002`; integration suite §1                                        | **Pass**: roles `admin`, `collector`, `operator`, `read-only`, `treasurer`; the `permissions` table equals `PERMISSIONS` (`src/lib/server/auth/permission-codes.ts`, 44 codes); the admin role holds every code.                                                                                                                                                                                                                                                                    |
| 2   | Public self-signup is disabled; users are created only by an admin (`user.manage`) or the seed | Integration suite §2, §3; `pnpm seed:admin`                                     | **Pass**: `POST /auth/v1/signup` → 422 `signup_disabled`. Users are created by `POST /api/admin/users` or `pnpm seed:admin` (idempotent: second run reports "already provisioned" for all 5 users).                                                                                                                                                                                                                                                                                 |
| 3   | Sensitive actions validate granular permissions                                                | Integration suite §3, §4; unit tests                                            | **Pass**: the operator's session is first shown to be valid (`my_permissions()` equals the operator role's grants; `has_permission('user.manage')` returns `false` with no error), then `POST /api/admin/users` → 403 `permission_denied` and no user is created. Admin → 201 with profile, `operator` role, one `user.create` audit row; same email again → 409 `email_exists`. `has_permission_for_user` works for `service_role` and is rejected for `authenticated` with 42501. |
| 4   | Login with email/password; session management works                                            | Unit tests (`hooks.server`, `login`, `logout`, `session`); integration sign-ins | **Pass**: seeded admin and operator sign in with email/password against local Auth; session validation, login error mapping, redirects and logout are covered by unit tests.                                                                                                                                                                                                                                                                                                        |
| 5   | Audit log is append-only                                                                       | pgTAP `003`; integration suite §5                                               | **Pass**: no API role (`anon`, `authenticated`, `service_role`) has UPDATE/DELETE/TRUNCATE on `audit_log`; via PostgREST, UPDATE and DELETE by `service_role` and by an authenticated admin fail with 42501 `permission denied for table audit_log` and the probe row is unchanged. The append-only **trigger** (SQLSTATE 23001) is only reachable by the table owner and is verified by pgTAP `003`, not by the integration suite.                                                 |

## Commands and results

| Check                     | Command                                                                                                 | Result                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database reset            | `supabase db reset`                                                                                     | Applies `000854` tables, `000857` seeds, `001500` RLS/functions, `002000` `admin_provision_profile`.                                                             |
| pgTAP                     | `supabase test db`                                                                                      | **190/190 pass** in 4 files (`001` schema, `002` seed, `003` RLS / permission functions / append-only triggers, `004` `admin_provision_profile`).                |
| Seed                      | `APP_ENV=local pnpm seed:admin` (run twice)                                                             | First run creates admin + 4 fixture users; second run: all "already provisioned".                                                                                |
| Type check                | `pnpm check`                                                                                            | 0 errors, 0 warnings.                                                                                                                                            |
| Lint / format             | `pnpm lint`                                                                                             | Pass.                                                                                                                                                            |
| Unit tests                | `pnpm test`                                                                                             | **149/149 pass** in 13 files. No Supabase needed: run with outbound fetch/sockets instrumented, zero network calls were made.                                    |
| Integration (live, local) | `APP_ENV=local pnpm test:integration`                                                                   | **13/13 pass** (`tests/integration/phase-1-acceptance.test.ts`). Test users are removed afterwards (only the 5 seeded users remain); audit rows stay, by design. |
| Integration guard         | `PUBLIC_SUPABASE_URL=https://example.supabase.co pnpm test:integration`; `APP_ENV` unset / `production` | Refused before any test or network call: "Refusing to run the integration suite: …".                                                                             |
| Production build          | `pnpm build`                                                                                            | Pass; no `service_role` / `SERVICE_ROLE` string in `.svelte-kit/output/client`.                                                                                  |

## Running the integration suite

`pnpm test` runs unit tests only. The live suite is separate (`vitest.integration.config.ts`) and needs a seeded local stack:

```sh
supabase start
supabase db reset
APP_ENV=local pnpm seed:admin
APP_ENV=local pnpm test:integration
```

Configuration (`tests/integration/local-env.ts`) is read from the shell, then `.env`, then, for anything still missing, `supabase status -o env`. The same values feed the test's own Supabase clients and the `$env/dynamic/*` modules used by the route under test. The suite refuses to run unless `APP_ENV=local` and `PUBLIC_SUPABASE_URL` is on `localhost`/`127.0.0.1`.

## Configuration note

Disabling public registration while keeping email/password login needs, in `supabase/config.toml`:

- `[auth] enable_signup = false` → `GOTRUE_DISABLE_SIGNUP=true`: `/signup` returns 422 `signup_disabled`.
- `[auth.email] enable_signup = true` → `GOTRUE_EXTERNAL_EMAIL_ENABLED=true`: the email provider stays on, so `signInWithPassword` and `auth.admin.createUser` work.

With both set to `false` the email provider is disabled and password login fails (`email_provider_disabled`). These settings only apply after `supabase stop && supabase start` from this checkout; a stack started from another branch keeps that branch's auth settings.
