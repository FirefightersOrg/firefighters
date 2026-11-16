import type { Handle } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/supabase/server';
import { getUserPermissions } from '$lib/server/auth/permissions';
import type { UserProfile } from './app';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.requestId = crypto.randomUUID();
	event.locals.supabase = createSupabaseServerClient(event);

	/**
	 * Like `supabase.auth.getSession()`, but validates the auth token with `getUser()`
	 * on the Supabase Auth server, guarding against spoofed or forged JWT cookies.
	 *
	 * This only validates the Supabase Auth session. It does NOT check the app profile, so an
	 * inactive user still gets a session here. Use `locals.session` / `locals.user` (set below)
	 * for authorization: they are null unless the user also has an ACTIVE profile.
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

	event.locals.session = null;
	event.locals.user = null;
	event.locals.profile = null;
	event.locals.permissions = [];

	if (user) {
		// Independent queries: my_permissions() already returns [] for an inactive profile.
		const [profileResult, permissions] = await Promise.all([
			event.locals.supabase
				.from('profiles')
				.select('id, auth_user_id, full_name, email, status, created_at')
				.eq('auth_user_id', user.id)
				.maybeSingle(),
			getUserPermissions(event.locals.supabase)
		]);

		if (profileResult.error) {
			console.error('[hooks] profile lookup failed; treating request as anonymous', {
				requestId: event.locals.requestId,
				error: profileResult.error
			});
		}

		const profile = profileResult.data as UserProfile | null;
		if (!profileResult.error && profile?.status === 'active') {
			event.locals.session = session;
			event.locals.user = user;
			event.locals.profile = profile;
			event.locals.permissions = permissions;
		}
		// Otherwise (inactive or missing profile, or lookup error): the user is treated as
		// anonymous for this request. The Supabase session cookie is left as is; the login
		// action reads profiles.status itself to explain why access is denied.
	}

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};
