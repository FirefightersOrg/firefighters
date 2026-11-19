import type { SupabaseClient } from '@supabase/supabase-js';
import type { RepositoryResult } from './campaigns';

/**
 * Read access to `public.audit_log` under the caller's RLS (`audit.view`: without it every read
 * returns no rows). Rows are written only by the audited SQL functions.
 */

/** Most audit entries read for one record. */
export const AUDIT_ENTRIES_LIMIT = 200;

interface AuditLogRow {
	id: string;
	action: string;
	entity_type: string;
	entity_id: string | null;
	actor_user_id: string | null;
	old_value: unknown;
	new_value: unknown;
	reason: string | null;
	created_at: string;
	request_id: string | null;
	/** Null when the actor's profile is not visible to the caller (profiles RLS) or no actor. */
	actor: { full_name: string } | null;
}

export interface AuditEntry {
	id: string;
	action: string;
	entityType: string;
	entityId: string | null;
	actorUserId: string | null;
	/** The actor's name, when the caller can see their profile (else null). */
	actorName: string | null;
	oldValue: unknown;
	newValue: unknown;
	reason: string | null;
	createdAt: string;
	requestId: string | null;
}

export const AUDIT_LOG_COLUMNS =
	'id, action, entity_type, entity_id, actor_user_id, old_value, new_value, reason, created_at, ' +
	'request_id, actor:profiles!audit_log_actor_user_id_fkey(full_name)';

function mapAuditRow(row: AuditLogRow): AuditEntry {
	return {
		id: row.id,
		action: row.action,
		entityType: row.entity_type,
		entityId: row.entity_id,
		actorUserId: row.actor_user_id,
		actorName: row.actor?.full_name ?? null,
		oldValue: row.old_value,
		newValue: row.new_value,
		reason: row.reason,
		createdAt: row.created_at,
		requestId: row.request_id
	};
}

/**
 * Audit entries of the given entities (`entity_type` + any of `entityIds`), newest first, at most
 * `limit` ({@link AUDIT_ENTRIES_LIMIT}). Uses the `(entity_type, entity_id)` index.
 */
export async function listAuditEntriesForEntities(
	supabase: SupabaseClient,
	entityType: string,
	entityIds: readonly string[],
	options: { limit?: number } = {}
): Promise<RepositoryResult<AuditEntry[]>> {
	if (entityIds.length === 0) return { data: [], error: null };
	const { data, error } = await supabase
		.from('audit_log')
		.select(AUDIT_LOG_COLUMNS)
		.eq('entity_type', entityType)
		.in('entity_id', [...entityIds])
		.order('created_at', { ascending: false })
		.order('id', { ascending: false })
		.limit(options.limit ?? AUDIT_ENTRIES_LIMIT)
		.overrideTypes<AuditLogRow[], { merge: false }>();
	if (error) return { data: null, error };
	return { data: (data ?? []).map(mapAuditRow), error: null };
}
