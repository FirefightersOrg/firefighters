import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { endSession } from '$lib/server/auth/session';

export const load: PageServerLoad = async () => {
	redirect(303, '/login');
};

export const actions: Actions = {
	// Deliberately not gated on locals.user: a user whose profile was deactivated is anonymous
	// to the app but may still hold a Supabase session cookie, and must be able to drop it.
	default: async ({ locals, cookies }) => {
		await endSession(locals.supabase, cookies, { requestId: locals.requestId, source: 'logout' });
		redirect(303, '/login');
	}
};
