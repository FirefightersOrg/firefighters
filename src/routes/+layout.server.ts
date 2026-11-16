import type { LayoutServerLoad } from './$types';

// hooks.server.ts already validated the session (and nulls it for inactive/missing profiles).
export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		session: locals.session,
		user: locals.user,
		profile: locals.profile ?? null,
		permissions: locals.permissions ?? []
	};
};
