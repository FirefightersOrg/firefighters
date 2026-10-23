# Phase 1 verification (SAN-15)

Verified end-to-end on local development environment (macOS, Node 24, pnpm 11.17.0, Supabase CLI 2.108.0).

## Milestone Acceptance Verification Summary

| #   | Acceptance Criterion                                                                                               | Verification Method                                                          | Result                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | All 5 roles seeded and exactly 44 granular permissions seeded in the database                                      | `supabase test db` (001, 002), integration tests                             | **Pass**: 5 roles (`admin`, `operator`, `treasurer`, `collector`, `read-only`), 44 granular permissions matching `docs/permissions.md`, admin role granted all 44 permissions, collector granted 0 permissions, no `role.manage` permission.    |
| 2   | Public self-signup is disabled in Supabase Auth; users can only be created by admin (`user.manage`) or seed script | Direct HTTP check on `/auth/v1/signup`, integration tests, `pnpm seed:admin` | **Pass**: `POST /auth/v1/signup` rejected with HTTP 422 (`error_code: signup_disabled`). `pnpm seed:admin` provisions initial admin and local test users idempotently.                                                                          |
| 3   | Sensitive actions validate granular permissions                                                                    | `POST /api/admin/users` integration and unit tests (D14)                     | **Pass**: Request by operator (lacking `user.manage`) rejected with HTTP 403 (`code: permission_denied`). Request by admin succeeds with HTTP 201, creates user, profile, role, and inserts structured audit log entry (`action: user.create`). |
| 4   | Login page authenticates users via email/password; session management works                                        | SvelteKit actions, hooks, and integration tests                              | **Pass**: Email/password authentication verified; session validation uses `auth.getUser()`; permission RPCs (`has_permission`, `my_permissions`) functional; unauthenticated requests redirect to `/login`; logout terminates session.          |
| 5   | Audit log is append-only                                                                                           | `supabase test db` (003), integration tests                                  | **Pass**: UPDATE, DELETE, and TRUNCATE privileges revoked from public, anon, authenticated, and service_role; enforced at database level by triggers (`audit_log is append-only`). Direct UPDATE and DELETE queries rejected.                   |

---

## Detailed Check Matrix

| Check                     | Command                 | Result                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database Reset            | `supabase db reset`     | Clean recreation and migration execution (000854 tables, 000857 seeds, 001500 RLS/functions)                                                                                                                                                                                                                                  |
| Database pgTAP Tests      | `supabase test db`      | **117/117 tests pass** across 3 test suites:<br>- `001_auth_roles_permissions_schema.test.sql` (schema integrity, FKs, unique indexes)<br>- `002_auth_roles_permissions_seed.test.sql` (5 roles, 44 permissions, matrix grants)<br>- `003_rls_has_permission.test.sql` (RLS policies, `has_permission`, append-only triggers) |
| Seed Admin Script         | `pnpm seed:admin`       | Initial execution created admin and role test users; secondary execution confirmed complete idempotency without errors or duplicates                                                                                                                                                                                          |
| Type Check                | `pnpm check`            | **0 errors, 0 warnings**                                                                                                                                                                                                                                                                                                      |
| Code Linting & Formatting | `pnpm lint`             | **Pass** (Prettier and ESLint clean across all files)                                                                                                                                                                                                                                                                         |
| Integration Suite         | `pnpm test:integration` | **11/11 tests pass** in `tests/integration/phase-1-acceptance.test.ts` testing live Supabase instance                                                                                                                                                                                                                         |
| Full Test Suite           | `pnpm test`             | **81/81 tests pass** across 11 test suites                                                                                                                                                                                                                                                                                    |
| Production Build          | `pnpm build`            | **Pass**; verified zero leakage of `SERVICE_ROLE` in client bundles                                                                                                                                                                                                                                                           |

---

## Configuration Note

In Supabase CLI (`config.toml`), disabling public registration while allowing existing users to log in with email/password requires:

- `[auth] enable_signup = false` (sets `GOTRUE_DISABLE_SIGNUP=true`, rejecting public `/signup` calls with `422 signup_disabled`)
- `[auth.email] enable_signup = true` (enables the email authentication provider in GoTrue, allowing `signInWithPassword`)

Setting both to `false` disables the email authentication provider entirely (`email_provider_disabled`). `config.toml` has been adjusted to preserve disabled public signups while permitting password authentication.
