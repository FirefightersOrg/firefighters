import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Checks whether the currently authenticated user (via `auth.uid()`) holds
 * the specified granular permission code.
 *
 * Single source of truth is the SQL function `public.has_permission(permission_code)`.
 * Fails closed (returns `false`) if an RPC error occurs or if unauthenticated.
 *
 * @param supabase User-scoped Supabase client (e.g. `locals.supabase`)
 * @param permissionCode Granular permission code (e.g. 'user.manage', 'campaign.view')
 */
export async function hasPermission(
	supabase: SupabaseClient,
	permissionCode: string
): Promise<boolean> {
	if (!permissionCode) {
		return false;
	}

	try {
		const { data, error: rpcError } = await supabase.rpc('has_permission', {
			permission_code: permissionCode
		});

		if (rpcError) {
			return false;
		}

		return Boolean(data);
	} catch {
		return false;
	}
}

/**
 * Checks whether an arbitrary user (identified by their `auth.users.id` / `authUserId`)
 * holds the specified granular permission code.
 *
 * NOTE: App-level user IDs in profiles are `profiles.id`, but the underlying auth
 * identifier passed here is `auth.users.id` (stored as `profiles.auth_user_id`).
 *
 * Single source of truth is `public.has_permission_for_user(p_auth_user_id, permission_code)`.
 * This SQL function requires `service_role` privileges and is revoked from public/anon/authenticated.
 * Must only be called with a privileged service-role admin client and validated IDs.
 *
 * Fails closed (returns `false`) on any error or missing parameters.
 *
 * @param supabase Privileged Supabase client with service_role key
 * @param authUserId UUID of the user in `auth.users` (`profiles.auth_user_id`)
 * @param permissionCode Granular permission code
 */
export async function hasPermissionForUser(
	supabase: SupabaseClient,
	authUserId: string,
	permissionCode: string
): Promise<boolean> {
	if (!authUserId || !permissionCode) {
		return false;
	}

	try {
		const { data, error: rpcError } = await supabase.rpc('has_permission_for_user', {
			p_auth_user_id: authUserId,
			permission_code: permissionCode
		});

		if (rpcError) {
			return false;
		}

		return Boolean(data);
	} catch {
		return false;
	}
}

/**
 * Retrieves all permission codes granted to the currently authenticated user (via `auth.uid()`).
 *
 * Single source of truth is `public.my_permissions()`.
 * Returns an empty array if unauthenticated or on RPC error (fail closed).
 *
 * @param supabase User-scoped Supabase client (e.g. `locals.supabase`)
 */
export async function getUserPermissions(supabase: SupabaseClient): Promise<string[]> {
	try {
		const { data, error: rpcError } = await supabase.rpc('my_permissions');

		if (rpcError || !Array.isArray(data)) {
			return [];
		}

		return data as string[];
	} catch {
		return [];
	}
}

/**
 * Asserts that the currently authenticated user holds the required permission.
 * Throws a typed SvelteKit 403 Forbidden error if the user lacks the permission
 * or if the RPC check fails.
 *
 * @param supabase User-scoped Supabase client (e.g. `locals.supabase`)
 * @param permissionCode Granular permission code required for the operation
 * @throws HttpError 403 Forbidden with `{ message: 'Forbidden', code: 'permission_denied', permission: permissionCode }`
 */
export async function requirePermission(
	supabase: SupabaseClient,
	permissionCode: string
): Promise<void> {
	const allowed = await hasPermission(supabase, permissionCode);

	if (!allowed) {
		error(403, {
			message: 'Forbidden',
			code: 'permission_denied',
			permission: permissionCode
		});
	}
}
