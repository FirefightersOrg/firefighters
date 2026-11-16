import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

/** PostgREST returns an embedded many-to-one relation as an object, but types it loosely. */
type UserRoleRow = { roles: { name: string } | { name: string }[] | null };

export type RoleNamesResult =
	{ data: string[]; error: null } | { data: null; error: PostgrestError };

/**
 * Lists the role names assigned to a profile (`user_roles.user_id = profiles.id`).
 * Runs under the caller's RLS; errors are returned, not swallowed, so callers can tell
 * "no roles" apart from "could not load roles".
 */
export async function listRoleNamesForProfile(
	supabase: SupabaseClient,
	profileId: string
): Promise<RoleNamesResult> {
	const { data, error } = await supabase
		.from('user_roles')
		.select('roles(name)')
		.eq('user_id', profileId)
		.overrideTypes<UserRoleRow[], { merge: false }>();

	if (error) return { data: null, error };

	const names = (data ?? []).flatMap((row) => [row.roles ?? []].flat().map((role) => role.name));
	return { data: [...new Set(names)].sort(), error: null };
}
