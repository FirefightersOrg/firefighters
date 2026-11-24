import type { SupabaseClient } from '@supabase/supabase-js';

export type DocumentKind = 'payment' | 'delivery_note' | 'settlement';

/**
 * SAN-122: the registering user's full name of one printed document, through the permission-gated
 * `document_actor_name` RPC (profiles itself is not readable by treasurers/operators).
 * Returns `{ data: null, error: null }` when the document has no actor.
 */
export async function getDocumentActorName(
	supabase: SupabaseClient,
	kind: DocumentKind,
	id: string
): Promise<{ data: string | null; error: unknown }> {
	const { data, error } = await supabase.rpc('document_actor_name', { p_kind: kind, p_id: id });
	if (error) return { data: null, error };
	return { data: typeof data === 'string' && data.trim() ? data : null, error: null };
}
