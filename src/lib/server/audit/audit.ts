import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Zod validation schema for structured audit log entries.
 *
 * Enforces non-empty action and entityType strings, a Postgres-compatible UUID for actorUserId
 * when provided, and optional/nullable entityId, values, reason, and requestId.
 *
 * `z.guid()` is used instead of `z.string().uuid()`: Zod 4's `.uuid()` enforces RFC 9562
 * version/variant bits, while Postgres `uuid` accepts any 8-4-4-4-12 hex value.
 */
export const auditLogEntrySchema = z.object({
	actorUserId: z.guid().nullable().optional(),
	action: z.string().min(1, 'Action must not be empty'),
	entityType: z.string().min(1, 'Entity type must not be empty'),
	entityId: z.string().nullable().optional(),
	oldValue: z.unknown().nullable().optional(),
	newValue: z.unknown().nullable().optional(),
	reason: z.string().nullable().optional(),
	requestId: z.string().nullable().optional()
});

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

/** Postgres `insufficient_privilege` (RLS / column-grant rejection). */
const INSUFFICIENT_PRIVILEGE = '42501';

/**
 * Records an immutable audit log entry in the `audit_log` table.
 *
 * Validates the input entry against `auditLogEntrySchema` (throws ZodError on invalid input),
 * maps camelCase properties to snake_case database columns, and inserts the row.
 * The row is inserted without `.select()`, so callers do not need `audit.view`.
 *
 * Which client to pass (enforced by RLS on `audit_log`):
 * - **User-scoped client** (anon key + session): `actorUserId` MUST be the caller's own
 *   active `profiles.id`. `null`, another profile, or an inactive profile is rejected (42501).
 * - **Service-role admin client**: any `actorUserId`, including `null` for system/seed/background
 *   actions or for actions performed on behalf of another user (e.g. admin-managed user creation).
 *
 * `actorUserId` references `profiles.id` (app-level profile UUID), NOT `auth.users.id`.
 *
 * Limitation: this is a separate request from the business write it describes, so it is NOT
 * atomic with it. See `src/lib/server/audit/README.md` ("Atomicity") for the intended direction.
 *
 * @param supabase User-scoped client (own actor only) or service_role admin client (any actor)
 * @param entry Structured audit entry to record
 * @throws ZodError if the entry fails validation
 * @throws Error if the database insert fails
 */
export async function recordAuditLog(
	supabase: SupabaseClient,
	entry: AuditLogEntry
): Promise<void> {
	const parsed = auditLogEntrySchema.parse(entry);

	const row = {
		actor_user_id: parsed.actorUserId ?? null,
		action: parsed.action,
		entity_type: parsed.entityType,
		entity_id: parsed.entityId ?? null,
		old_value: parsed.oldValue ?? null,
		new_value: parsed.newValue ?? null,
		reason: parsed.reason ?? null,
		request_id: parsed.requestId ?? null
	};

	const { error } = await supabase.from('audit_log').insert(row);

	if (error) {
		const hint =
			error.code === INSUFFICIENT_PRIVILEGE
				? '. With a user-scoped client, actorUserId must be the active profile id of the caller;' +
					' null/system or other actors require the service-role admin client'
				: '';
		throw new Error(
			`Failed to record audit log: ${error.message} (${error.code ?? 'unknown'})${hint}`
		);
	}
}
