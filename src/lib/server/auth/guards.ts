import { redirect } from '@sveltejs/kit';
import type { UserProfile } from '../../../app';

/** `/login?redirectTo=<path>` for the current page (login re-validates the target). */
export function loginRedirectPath(path: string): string {
	return `/login?redirectTo=${encodeURIComponent(path)}`;
}

/**
 * Asserts that the request comes from a signed-in user with an ACTIVE profile (the hook leaves
 * `locals.user` / `locals.profile` null otherwise) and returns that profile. Anyone else is
 * redirected (303) to the login page, which sends them back to `returnTo` after signing in.
 *
 * Defense in depth for `/campaigns/**` loads and actions: hooks.server.ts already redirects
 * anonymous requests for every non-public path (`$lib/server/auth/route-guard`).
 * Form actions do not run layout loads, so every action must call this itself.
 *
 * @param returnTo Path to come back to, e.g. `url.pathname + url.search` in a load, or
 *   `url.pathname` in an action (its `?/action` query is not a page).
 */
export function requireActiveUser(locals: App.Locals, returnTo: string): UserProfile {
	if (!locals.user || !locals.profile) {
		redirect(303, loginRedirectPath(returnTo));
	}
	return locals.profile;
}
