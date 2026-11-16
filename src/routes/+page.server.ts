import type { PageServerLoad } from './$types';
import { listRoleNamesForProfile } from '$lib/server/repositories/user-roles';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.profile) {
		return { user: null, profile: null, roles: [], rolesError: false };
	}

	const { data: roles, error } = await listRoleNamesForProfile(locals.supabase, locals.profile.id);
	if (error) {
		console.error('[home] role lookup failed', { requestId: locals.requestId, error });
	}

	return {
		user: locals.user,
		profile: locals.profile,
		roles: roles ?? [],
		rolesError: !!error
	};
};
