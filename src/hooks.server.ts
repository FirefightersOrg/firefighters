import type { Handle } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/supabase/server';
import { getUserPermissions } from '$lib/server/auth/permissions';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.requestId = crypto.randomUUID();
	event.locals.supabase = createSupabaseServerClient(event);

	/**
	 * Like `supabase.auth.getSession()`, but validates the auth token with `getUser()`
	 * on the Supabase Auth server, guarding against spoofed or forged JWT cookies.
	 */
	event.locals.safeGetSession = async () => {
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();
		if (!session) {
			return { session: null, user: null };
		}

		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();
		if (error || !user) {
			// JWT has been tampered with, expired, or user was deleted
			return { session: null, user: null };
		}

		return { session, user };
	};

	const { session, user } = await event.locals.safeGetSession();
	event.locals.session = session;
	event.locals.user = user;

	if (user) {
		const { data: profile } = await event.locals.supabase
			.from('profiles')
			.select('id, auth_user_id, full_name, email, status, created_at')
			.eq('auth_user_id', user.id)
			.maybeSingle();

		if (profile && profile.status === 'active') {
			event.locals.profile = profile;
			event.locals.permissions = await getUserPermissions(event.locals.supabase);
		} else {
			// Inactive profile or missing profile: invalidate session context
			event.locals.profile = null;
			event.locals.permissions = [];
		}
	} else {
		event.locals.profile = null;
		event.locals.permissions = [];
	}

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};
