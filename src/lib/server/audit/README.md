# Audit Helpers (`src/lib/server/audit/`)

Helper functions to record immutable audit log entries for all sensitive operational actions. Server-only code.

## Architectural Principles

1. **Append-Only Immutability**:
   The `audit_log` table is append-only. Triggers and revokes in the database forbid `UPDATE`, `DELETE`, and `TRUNCATE` operations across all roles (including `service_role` and table owners).
2. **Actor IDs and which client to use**:
   `actor_user_id` references `profiles.id` (application profile UUID), NOT `auth.users.id`. RLS on `audit_log` decides who may write which actor:
   - **User-scoped client** (anon key + session): `actorUserId` must be the caller's own **active** profile id. `null`, another profile, or an inactive profile is rejected (`42501`).
   - **Service-role admin client** (`createSupabaseAdminClient()`): any actor, including `null` for seed, background or system tasks, and actions performed on behalf of another user.

   `recordAuditLog` inserts without `.select()`, so callers do not need `audit.view`. `created_at` is always set by the database.

3. **Structured Validation**:
   All audit entries are validated with Zod (`auditLogEntrySchema`) before inserting into the database. Invalid entries immediately throw a `ZodError`.
4. **Structured JSON**:
   `old_value` and `new_value` store JSON payloads representing state before and after sensitive mutations.

## Atomicity (known limitation)

`recordAuditLog` is a separate PostgREST request from the business write it describes, so the two are **not** in one transaction. If the audit insert fails after the change is committed, the change has no audit row. If the audit row is written first and the change then fails, the audit row describes something that never happened.

Until that is fixed, write the audit row **after** the business write succeeds, and let the error propagate (do not swallow it) so the failure is visible.

Intended direction for sensitive mutations (bonds, payments, settlements, draws, users): implement each one as a SQL function/RPC that performs the domain change **and** inserts the `audit_log` row in the same transaction. This helper then remains for actions with no DB write of their own and as a fallback.

First example of this pattern: user creation. `admin_provision_profile` (and `admin_grant_roles`, migration `20261023002000_admin_provision_profile.sql`, `service_role` only) writes the profile, its role assignments and the `user.create` / `user.roles.grant` audit row in one transaction; `createAdminManagedUser` no longer calls `recordAuditLog`. Follow it for new sensitive mutations.

## Available Functions

### `recordAuditLog(supabase, entry): Promise<void>`

Validates the input entry with Zod, maps camelCase fields to database columns, and inserts an audit log row into `audit_log`. Throws if validation or insertion fails.

```typescript
import { recordAuditLog } from '$lib/server/audit';

// `supabase` is the user-scoped client (createSupabaseServerClient(event)) and
// `profile.id` is the caller's own active profiles.id. `requestId` is any correlation
// id you have; SAN-11/SAN-14 add `locals.requestId` via hooks.server.ts.
await recordAuditLog(supabase, {
	actorUserId: profile.id,
	action: 'campaign.create',
	entityType: 'campaign',
	entityId: newCampaign.id,
	oldValue: null,
	newValue: { name: 'Campaign 2026', totalBonds: 1000 },
	reason: 'Annual fundraising drive kickoff',
	requestId
});

// System action or acting on behalf of someone else: use the admin client.
import { createSupabaseAdminClient } from '$lib/server/supabase/admin';

await recordAuditLog(createSupabaseAdminClient(), {
	actorUserId: null,
	action: 'system.bootstrap',
	entityType: 'system'
});
```

### Schema and Types

```typescript
import { auditLogEntrySchema, type AuditLogEntry } from '$lib/server/audit';
```

Fields:

- `actorUserId`: Optional/nullable UUID string (`profiles.id`). Validated with `z.guid()` (any Postgres UUID, not only RFC v1-v8). Null requires the admin client.
- `action`: Required non-empty string
- `entityType`: Required non-empty string
- `entityId`: Optional/nullable string
- `oldValue`: Optional/nullable JSON-serializable value
- `newValue`: Optional/nullable JSON-serializable value
- `reason`: Optional/nullable string
- `requestId`: Optional/nullable string correlation ID
