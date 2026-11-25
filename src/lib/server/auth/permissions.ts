import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PermissionCode } from './permission-codes';

/**
 * Outcome of a permission check against the database.
 *
 * - `granted`: the SQL function returned `true`.
 * - `denied`: the SQL function returned `false` (or the input was empty).
 * - `error`: the check could not be performed (RPC error, network failure, wrong client).
 *   Callers must treat this as "not allowed" (fail closed), but it is NOT a permission denial.
 */
export type PermissionCheckResult = 'granted' | 'denied' | 'error';

async function runPermissionRpc(
	supabase: SupabaseClient,
	fn: 'has_permission' | 'has_permission_for_user',
	args: Record<string, string>
): Promise<PermissionCheckResult> {
	try {
		const { data, error: rpcError } = await supabase.rpc(fn, args);

		if (rpcError) {
			console.error(`[auth] ${fn} RPC failed; failing closed`, { ...args, error: rpcError });
			return 'error';
		}

		return data === true ? 'granted' : 'denied';
	} catch (err) {
		console.error(`[auth] ${fn} RPC threw; failing closed`, { ...args, error: err });
		return 'error';
	}
}

/**
 * Checks whether the currently authenticated user (via `auth.uid()`) holds the
 * permission, distinguishing a denial from an infrastructure failure.
 *
 * Single source of truth is the SQL function `public.has_permission(permission_code)`.
 * RPC failures are logged with `console.error` and reported as `'error'`.
 *
 * @param supabase User-scoped Supabase client (anon key + user session cookies)
 * @param permissionCode Granular permission code
 */
export async function checkPermission(
	supabase: SupabaseClient,
	permissionCode: PermissionCode
): Promise<PermissionCheckResult> {
	if (!permissionCode) {
		return 'denied';
	}

	return runPermissionRpc(supabase, 'has_permission', { permission_code: permissionCode });
}

/**
 * Checks whether the currently authenticated user (via `auth.uid()`) holds the
 * specified granular permission code.
 *
 * Single source of truth is the SQL function `public.has_permission(permission_code)`.
 * Fails closed (returns `false`) if unauthenticated, denied, or on RPC error. RPC errors are
 * logged; use `checkPermission` or `requirePermission` if you need to tell them apart.
 *
 * @param supabase User-scoped Supabase client (anon key + user session cookies)
 * @param permissionCode Granular permission code (e.g. 'user.manage', 'campaign.view')
 */
export async function hasPermission(
	supabase: SupabaseClient,
	permissionCode: PermissionCode
): Promise<boolean> {
	return (await checkPermission(supabase, permissionCode)) === 'granted';
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
 * Calling it with a user-scoped client is an RPC error (logged), not a denial.
 *
 * Fails closed (returns `false`) on any error or missing parameters; errors are logged.
 *
 * @param supabase Privileged Supabase client with service_role key
 * @param authUserId UUID of the user in `auth.users` (`profiles.auth_user_id`)
 * @param permissionCode Granular permission code
 */
export async function hasPermissionForUser(
	supabase: SupabaseClient,
	authUserId: string,
	permissionCode: PermissionCode
): Promise<boolean> {
	if (!authUserId || !permissionCode) {
		return false;
	}

	const result = await runPermissionRpc(supabase, 'has_permission_for_user', {
		p_auth_user_id: authUserId,
		permission_code: permissionCode
	});
	return result === 'granted';
}

/**
 * Retrieves all permission codes granted to the currently authenticated user (via `auth.uid()`).
 *
 * Single source of truth is `public.my_permissions()`. Intended to be called once per request
 * (e.g. in `hooks.server.ts`) and combined with `hasPermissionIn` / `requirePermissionIn`
 * to avoid one RPC round-trip per check.
 *
 * Returns `[]` when the caller holds no permissions (unauthenticated or inactive callers included),
 * and `null` when the list could not be loaded (RPC error, thrown error, or a non-array response).
 * Failures are logged. `null` still denies every permission, but `requirePermissionIn` answers
 * 500 for it instead of 403, so an outage does not look like an access problem.
 *
 * @param supabase User-scoped Supabase client (anon key + user session cookies)
 */
export async function getUserPermissions(supabase: SupabaseClient): Promise<string[] | null> {
	try {
		const { data, error: rpcError } = await supabase.rpc('my_permissions');

		if (rpcError) {
			console.error('[auth] my_permissions RPC failed; failing closed', { error: rpcError });
			return null;
		}

		if (!Array.isArray(data)) {
			// my_permissions() always returns an array (empty when none), so anything else is a fault.
			console.error('[auth] my_permissions returned a non-array; failing closed', { data });
			return null;
		}

		return data as string[];
	} catch (err) {
		console.error('[auth] my_permissions RPC threw; failing closed', { error: err });
		return null;
	}
}

/** HttpError 500 for a permission check that could not be performed (the cause is logged). */
function permissionCheckFailed(permissionCode: PermissionCode): never {
	error(500, {
		message: 'No se pudo verificar el permiso. Volver a intentar.',
		code: 'permission_check_failed',
		permission: permissionCode
	});
}

function forbidden(permissionCode: PermissionCode): never {
	error(403, {
		message: 'Forbidden',
		code: 'permission_denied',
		permission: permissionCode
	});
}

/**
 * Asserts that the currently authenticated user holds the required permission.
 *
 * - Denied → throws SvelteKit `HttpError` 403 `{ message: 'Forbidden', code: 'permission_denied', permission }`.
 * - RPC/infrastructure failure → throws `HttpError` 500
 *   `{ message: 'No se pudo verificar el permiso. Volver a intentar.', code: 'permission_check_failed', permission }`
 *   (still fails closed; the underlying error is logged, not exposed).
 *
 * @param supabase User-scoped Supabase client (anon key + user session cookies)
 * @param permissionCode Granular permission code required for the operation
 */
export async function requirePermission(
	supabase: SupabaseClient,
	permissionCode: PermissionCode
): Promise<void> {
	const result = await checkPermission(supabase, permissionCode);

	if (result === 'error') {
		permissionCheckFailed(permissionCode);
	}

	if (result !== 'granted') {
		forbidden(permissionCode);
	}
}

/**
 * Checks a permission against a precomputed, request-scoped permission list
 * (the result of `getUserPermissions`, e.g. `locals.permissions`). No database round-trip.
 *
 * Fails closed on a missing list.
 */
export function hasPermissionIn(
	permissions: readonly string[] | null | undefined,
	permissionCode: PermissionCode
): boolean {
	return !!permissionCode && !!permissions && permissions.includes(permissionCode);
}

/**
 * True when the request's permission list could not be loaded (`locals.permissions === null`,
 * set by `hooks.server.ts` when `getUserPermissions` fails). Callers answer 500, not 403.
 */
export function permissionsUnavailable(
	permissions: readonly string[] | null | undefined
): permissions is null {
	return permissions === null;
}

/**
 * Like `requirePermission`, but checks a precomputed, request-scoped permission list
 * (the result of `getUserPermissions`, e.g. `locals.permissions`). No database round-trip.
 *
 * - List could not be loaded (`null`) → throws `HttpError` 500
 *   `{ message: 'No se pudo verificar el permiso. Volver a intentar.', code: 'permission_check_failed', permission }`.
 * - Permission absent → throws `HttpError` 403
 *   `{ message: 'Forbidden', code: 'permission_denied', permission }`.
 */
export function requirePermissionIn(
	permissions: readonly string[] | null | undefined,
	permissionCode: PermissionCode
): void {
	if (permissionsUnavailable(permissions)) {
		permissionCheckFailed(permissionCode);
	}
	if (!hasPermissionIn(permissions, permissionCode)) {
		forbidden(permissionCode);
	}
}
