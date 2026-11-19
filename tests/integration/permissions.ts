import type { SupabaseClient } from '@supabase/supabase-js';
import { getUserPermissions } from '$lib/server/auth/permissions';

/**
 * `getUserPermissions` for test fixtures: throws when the list could not be loaded (`null`),
 * so a broken local stack fails the suite instead of looking like a user without permissions.
 */
export async function loadPermissions(client: SupabaseClient): Promise<string[]> {
	const permissions = await getUserPermissions(client);
	if (permissions === null) throw new Error('Could not load the permissions (my_permissions)');
	return permissions;
}
