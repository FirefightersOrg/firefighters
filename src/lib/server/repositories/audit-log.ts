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

export function mapAuditRow(row: AuditLogRow): AuditEntry {
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

export const AUDIT_PAGE_SIZE = 50;

export interface CampaignAuditFilters {
	actor?: string | null;
	action?: string | null;
	entityType?: string | null;
	from?: string | null;
	to?: string | null;
	page?: number;
}

/**
 * Campaign audit viewer query. Explicit ranges avoid PostgREST's 1,000-row ceiling and the
 * created_at/id order makes paging deterministic. Rows match by the generated, indexed
 * `campaign_scope` (campaign_id from the top level or from the corrected row snapshot, SAN-74 fix)
 * or, for the campaign row itself, by entity id.
 */
export async function listCampaignAuditEntries(
	supabase: SupabaseClient,
	campaignId: string,
	filters: CampaignAuditFilters = {}
): Promise<
	RepositoryResult<{ items: AuditEntry[]; total: number; page: number; pageSize: number }>
> {
	const page = Math.max(1, filters.page ?? 1);
	let query = supabase
		.from('audit_log')
		.select(AUDIT_LOG_COLUMNS, { count: 'exact' })
		.or(`entity_id.eq.${campaignId},campaign_scope.eq.${campaignId}`);
	if (filters.actor) query = query.eq('actor_user_id', filters.actor);
	if (filters.action) query = query.eq('action', filters.action);
	if (filters.entityType) query = query.eq('entity_type', filters.entityType);
	if (filters.from) query = query.gte('created_at', `${filters.from}T00:00:00-03:00`);
	if (filters.to) query = query.lte('created_at', `${filters.to}T23:59:59.999999-03:00`);
	const { data, error, count } = await query
		.order('created_at', { ascending: false })
		.order('id', { ascending: false })
		.range((page - 1) * AUDIT_PAGE_SIZE, page * AUDIT_PAGE_SIZE - 1)
		.overrideTypes<AuditLogRow[], { merge: false }>();
	return error
		? { data: null, error }
		: {
				data: {
					items: (data ?? []).map(mapAuditRow),
					total: count ?? 0,
					page,
					pageSize: AUDIT_PAGE_SIZE
				},
				error: null
			};
}

export async function getCampaignAuditEntry(
	supabase: SupabaseClient,
	campaignId: string,
	id: string
): Promise<RepositoryResult<AuditEntry | null>> {
	const { data, error } = await supabase
		.from('audit_log')
		.select(AUDIT_LOG_COLUMNS)
		.eq('id', id)
		.or(`entity_id.eq.${campaignId},campaign_scope.eq.${campaignId}`)
		.maybeSingle()
		.overrideTypes<AuditLogRow | null, { merge: false }>();
	return error ? { data: null, error } : { data: data ? mapAuditRow(data) : null, error: null };
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
