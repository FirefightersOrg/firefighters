import { json, redirect, type Handle } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/supabase/server';
import { getUserPermissions } from '$lib/server/auth/permissions';
import { decideRouteAccess, mayEndLeftoverSession } from '$lib/server/auth/route-guard';
import { endSession, hasSupabaseAuthCookie } from '$lib/server/auth/session';
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

	// The profile lookup failed (infrastructure error): the user may well be active, so the session
	// is kept and the login page does not claim it expired.
	let profileLookupFailed = false;
	// A valid Supabase session whose profile is inactive or missing (e.g. deactivated while
	// logged in). The app never lets it in, so it is ended below.
	let leftoverSession = false;

	if (user) {
		// Independent queries: my_permissions() already returns [] for an inactive profile.
		// `permissions` is null when loading them failed (logged by getUserPermissions).
		const [profileResult, permissions] = await Promise.all([
			event.locals.supabase
				.from('profiles')
				.select('id, auth_user_id, full_name, email, status, created_at')
				.eq('auth_user_id', user.id)
				.maybeSingle(),
			getUserPermissions(event.locals.supabase)
		]);

		if (profileResult.error) {
			profileLookupFailed = true;
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
			// null (load failed) is kept as is so permission checks answer 500, not 403.
			event.locals.permissions = permissions;
			if (permissions === null) {
				console.error('[hooks] permissions lookup failed; permission checks will answer 500', {
					requestId: event.locals.requestId,
					profileId: profile.id
				});
			}
		} else if (!profileResult.error) {
			leftoverSession = true;
		}
		// Otherwise the user is treated as anonymous for this request.
	}

	const { pathname } = event.url;

	// End a deactivated user's session on their next request, whatever the route. `/login` and
	// `/logout` handle the session themselves (signing in replaces it, logging out ends it).
	if (leftoverSession && user && mayEndLeftoverSession(pathname)) {
		await endSession(event.locals.supabase, event.cookies, {
			requestId: event.locals.requestId,
			source: 'hooks',
			authUserId: user.id
		});
	}

	const authenticated = Boolean(event.locals.user && event.locals.profile);
	const access = decideRouteAccess({
		url: event.url,
		method: event.request.method,
		authenticated,
		// The visitor brought a session that did not get them in: expired/invalid token, or an
		// inactive/missing profile. Not set when only the profile lookup failed.
		sessionExpired:
			!authenticated &&
			!profileLookupFailed &&
			(leftoverSession || hasSupabaseAuthCookie(event.cookies))
	});

	if (access.kind === 'redirect') {
		redirect(303, access.location);
	}
	if (access.kind === 'unauthorized') {
		return json({ message: 'Unauthorized', code: 'unauthenticated' }, { status: 401 });
	}

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};
