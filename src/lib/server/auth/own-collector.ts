import { error } from '@sveltejs/kit';
import { requireActiveUser } from './guards';
import { requirePermissionIn } from './permissions';
import type { PermissionCode } from './permission-codes';

/** The collector linked to the signed-in profile (`collectors.user_profile_id`). */
export interface OwnCollector {
	id: string;
	displayName: string;
	status: string;
}

/**
 * Own-scope guard for the collector portal. Resolves the collector FROM THE SESSION
 * (`portal_my_collector()` reads `current_profile_id()` -> `collectors.user_profile_id`), never from a URL
 * or form value: every portal load and action uses the returned `id`, so one collector cannot ask for another.
 *
 * - No active user: redirect to `/login`.
 * - Permissions not loaded: 500; permission missing: 403 (`requirePermissionIn`).
 * - Profile not linked to a collector: `null` (the page shows an empty state; RLS returns no rows anyway).
 * - The lookup failed: 500 (never a silent empty portal).
 *
 * @param returnTo Path to come back to after login.
 * @param permission The own-scope permission the screen needs (default `bond.view_own`).
 */
export async function requireOwnCollector(
	locals: App.Locals,
	returnTo: string,
	permission: PermissionCode = 'bond.view_own'
): Promise<OwnCollector | null> {
	requireActiveUser(locals, returnTo);
	requirePermissionIn(locals.permissions, permission);

	const { data, error: rpcError } = await locals.supabase.rpc('portal_my_collector');
	if (rpcError) {
		console.error('[portal] own collector lookup failed', {
			requestId: locals.requestId,
			error: rpcError
		});
		error(500, { message: 'No se pudo cargar tu cuenta de cobrador. Volver a intentar.' });
	}

	const row = (data as { id: string; display_name: string; status: string }[] | null)?.[0];
	return row ? { id: row.id, displayName: row.display_name, status: row.status } : null;
}

/**
 * Where a signed-in person lands from `/`: collectors who only hold own-scope access (`bond.view_own`
 * without the global `bond.view`) go to the portal; everyone else keeps the home page.
 */
export function defaultLandingPath(permissions: readonly string[] | null | undefined): string {
	const list = permissions ?? [];
	return list.includes('bond.view_own') && !list.includes('bond.view') ? '/portal' : '/';
}
