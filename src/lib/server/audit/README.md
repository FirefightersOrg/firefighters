# Audit Helpers (`src/lib/server/audit/`)

Helper functions to record immutable audit log entries for all sensitive operational actions. Server-only code.

## Architectural Principles

1. **Append-Only Immutability**:
   The `audit_log` table is append-only. Triggers and revokes in the database forbid `UPDATE`, `DELETE`, and `TRUNCATE` operations across all roles (including `service_role` and table owners).
2. **Actor IDs**:
   `actor_user_id` in the database references `profiles.id` (application profile UUID), NOT `auth.users.id`. It is nullable for seed or automated background/system tasks.
3. **Structured Validation**:
   All audit entries are validated with Zod (`auditLogEntrySchema`) before inserting into the database. Invalid entries immediately throw a `ZodError`.
4. **Structured JSON**:
   `old_value` and `new_value` store JSON payloads representing state before and after sensitive mutations.

## Available Functions

### `recordAuditLog(supabase, entry): Promise<void>`

Validates the input entry with Zod, maps camelCase fields to database columns, and inserts an audit log row into `audit_log`. Throws if validation or insertion fails.

```typescript
import { recordAuditLog } from '$lib/server/audit';

await recordAuditLog(locals.supabase, {
	actorUserId: profile.id,
	action: 'campaign.create',
	entityType: 'campaign',
	entityId: newCampaign.id,
	oldValue: null,
	newValue: { name: 'Campaign 2026', totalBonds: 1000 },
	reason: 'Annual fundraising drive kickoff',
	requestId: locals.requestId
});
```

### Schema and Types

```typescript
import { auditLogEntrySchema, type AuditLogEntry } from '$lib/server/audit';
```

Fields:

- `actorUserId`: Optional/nullable UUID string (`profiles.id`)
- `action`: Required non-empty string
- `entityType`: Required non-empty string
- `entityId`: Optional/nullable string
- `oldValue`: Optional/nullable JSON-serializable value
- `newValue`: Optional/nullable JSON-serializable value
- `reason`: Optional/nullable string
- `requestId`: Optional/nullable string correlation ID
