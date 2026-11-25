import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { defaultLandingPath } from '$lib/server/auth/own-collector';
import { listRoleNamesForProfile } from '$lib/server/repositories/user-roles';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.profile) {
		return { user: null, profile: null, roles: [], rolesError: false };
	}

	// Collectors land on their portal (the operational screens answer 403 to them).
	const landing = defaultLandingPath(locals.permissions);
	if (landing !== '/') redirect(303, landing);

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
