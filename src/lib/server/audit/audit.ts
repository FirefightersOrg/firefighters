import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Zod validation schema for structured audit log entries.
 *
 * Enforces non-empty action and entityType strings, UUID format for actorUserId
 * when provided, and optional/nullable entityId, values, reason, and requestId.
 */
export const auditLogEntrySchema = z.object({
	actorUserId: z.string().uuid().nullable().optional(),
	action: z.string().min(1, 'Action must not be empty'),
	entityType: z.string().min(1, 'Entity type must not be empty'),
	entityId: z.string().nullable().optional(),
	oldValue: z.unknown().nullable().optional(),
	newValue: z.unknown().nullable().optional(),
	reason: z.string().nullable().optional(),
	requestId: z.string().nullable().optional()
});

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

/**
 * Records an immutable audit log entry in the `audit_log` table.
 *
 * Validates the input entry against `auditLogEntrySchema` (throws ZodError on invalid input),
 * maps camelCase properties to snake_case database columns, and inserts the row.
 *
 * Note on actorUserId:
 * - In this architecture, `actor_user_id` references `profiles.id` (app-level profile UUID),
 *   NOT `auth.users.id`.
 * - For system actions or unauthenticated operations, `actorUserId` is nullable.
 *
 * @param supabase Supabase client (e.g. user-scoped client or service_role admin client)
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
		old_value: parsed.oldValue !== undefined ? parsed.oldValue : null,
		new_value: parsed.newValue !== undefined ? parsed.newValue : null,
		reason: parsed.reason ?? null,
		request_id: parsed.requestId ?? null
	};

	const { error } = await supabase.from('audit_log').insert(row);

	if (error) {
		throw new Error(`Failed to record audit log: ${error.message} (${error.code ?? 'unknown'})`);
	}
}
