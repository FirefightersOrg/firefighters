# Audit log (`audit_log`)

Immutable record of every sensitive operational action. There is no TypeScript writer: **audit rows are written only by database functions**, in the same transaction as the change they describe.

## Rules

1. **Append-only.** Triggers and revokes forbid `UPDATE`, `DELETE` and `TRUNCATE` for all roles (including `service_role` and table owners).
2. **No direct insert for logged-in users (SAN-94).** `authenticated` and `anon` have no `INSERT` privilege and there is no insert policy (migration `20261212000000_audit_log_no_direct_insert.sql`). A user cannot forge entries, not even under their own name.
3. **Atomic.** Each audited mutation is a `SECURITY DEFINER` function (`set search_path = ''`, revoked from `public`/`anon`/`service_role`, explicit `grant execute ... to authenticated`) that resolves the actor with `current_profile_id()`, checks `has_permission()`, writes the change and inserts the `audit_log` row. If any step fails, everything rolls back. The functions run as the owner, so they do not need the caller to hold `INSERT`.
4. **Actor.** `actor_user_id` references `profiles.id` (not `auth.users.id`). `created_at` is always set by the database.
5. **`service_role` keeps `INSERT`** for trusted server code (seed, system actors). Prefer a database function even there.

## Writing audited code

New code must write audit rows only from DB functions. Do not add a TypeScript `audit_log` insert. Examples:

- Users: `admin_provision_profile` / `admin_grant_roles` (`20261023002000_admin_provision_profile.sql`).
- Campaigns: `campaign_create` / `campaign_update` / `campaign_update_rules` / `campaign_transition` (`20261117000000_campaign_rpcs.sql`), called from `src/lib/server/services/campaigns.ts` with the user-scoped client.

Reading goes through `src/lib/server/repositories/audit-log.ts` under RLS (`audit.view`).
