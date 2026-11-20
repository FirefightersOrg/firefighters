import { loginRedirectPath } from './guards';
import { getSafeRedirectPath } from './redirect';

/**
 * Paths that anyone may open without an active session. Matched exactly against
 * `url.pathname` (SvelteKit strips the `__data.json` suffix of client-side data requests).
 *
 * EVERY OTHER PATH REQUIRES A SIGNED-IN USER WITH AN ACTIVE PROFILE. New routes are protected
 * by default; add a path here only when it must work for anonymous visitors.
 *
 * - `/`: home page, renders a "You are not logged in" view for anonymous visitors.
 * - `/login`: sign-in page and action.
 * - `/logout`: must work for a deactivated user who still holds a session cookie.
 * - `/robots.txt`, `/favicon.ico`: files from `static/` (normally served before the hook runs).
 * - `/manifest.webmanifest`, `/service-worker.js`, `/offline.html`, `/icons/*`: PWA files the browser fetches without a
 *   session; they must never redirect to `/login`.
 * - `/_app/version.json`, `/_app/env.js`: SvelteKit runtime files the login page also needs.
 *
 * There are no auth callback routes (no OAuth, magic links or email confirmation: users are
 * created by an admin and sign in with a password). Add them here if that changes.
 */
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([
	'/',
	'/login',
	'/logout',
	'/robots.txt',
	'/favicon.ico',
	'/manifest.webmanifest',
	'/service-worker.js',
	'/offline.html',
	'/_app/version.json',
	'/_app/env.js'
]);

/**
 * Path prefixes that are public. Only static build output belongs here: `/_app/immutable/` holds
 * the compiled JS, CSS and imported assets (e.g. `$lib/assets/favicon.svg`). Deliberately not all
 * of `/_app/`, which would also expose remote functions (`/_app/remote/...`).
 */
export const PUBLIC_PATH_PREFIXES: readonly string[] = ['/_app/immutable/', '/icons/'];

/**
 * Routes that manage the Supabase session themselves (`/login` signs in and ends a session left
 * behind by an inactive user, `/logout` signs out), so the hook must not end it for them.
 */
const SESSION_MANAGING_PATHS: ReadonlySet<string> = new Set(['/login', '/logout']);

/** Query parameter set on `/login` when the guard ended or rejected an existing session. */
export const SESSION_EXPIRED_PARAM = 'reason';
export const SESSION_EXPIRED_VALUE = 'expired';

export function isPublicPath(pathname: string): boolean {
	return (
		PUBLIC_PATHS.has(pathname) || PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
	);
}

/** True for JSON endpoints, which answer 401 instead of redirecting to the login page. */
export function isApiPath(pathname: string): boolean {
	return pathname === '/api' || pathname.startsWith('/api/');
}

/** Whether the hook may end a leftover session on this path (see `SESSION_MANAGING_PATHS`). */
export function mayEndLeftoverSession(pathname: string): boolean {
	return !SESSION_MANAGING_PATHS.has(pathname);
}

/**
 * `/login?redirectTo=<path>`, plus `reason=expired` when the visitor had a session that
 * is no longer valid (expired token, or a deactivated / missing profile).
 */
export function loginRedirectLocation(returnTo: string, sessionExpired: boolean): string {
	const safe = getSafeRedirectPath(returnTo);
	const base = safe === '/' ? '/login' : loginRedirectPath(safe);
	if (!sessionExpired) return base;
	const separator = base.includes('?') ? '&' : '?';
	return `${base}${separator}${SESSION_EXPIRED_PARAM}=${SESSION_EXPIRED_VALUE}`;
}

export type RouteAccess =
	| { kind: 'allow' }
	| { kind: 'redirect'; location: string }
	| { kind: 'unauthorized' }
	| { kind: 'unavailable'; api: boolean };

/** User-facing message (Spanish) when the profile lookup failed; shown on pages and in API JSON. */
export const SERVICE_UNAVAILABLE_MESSAGE =
	'Servicio no disponible, intentá de nuevo en unos minutos';

export interface RouteAccessInput {
	url: URL;
	method: string;
	/** A signed-in user with an ACTIVE profile (`locals.user` and `locals.profile` set). */
	authenticated: boolean;
	/** The request carried a Supabase session that did not yield an active user. */
	sessionExpired: boolean;
	/**
	 * The profile lookup itself failed (DB/RPC error), so we cannot tell whether the user is
	 * active. That is an outage, not a deactivation: answer 503 instead of redirecting to login.
	 */
	profileLookupFailed?: boolean;
}

/**
 * Decides what the hook does with a request: public paths and active users pass; anyone else gets
 * a 401 on `/api/**` or a 303 to `/login?redirectTo=<path>` on pages.
 *
 * The return path keeps the query string on GET/HEAD only: for a form action the query is
 * `?/action`, which is not a page to come back to.
 */
export function decideRouteAccess({
	url,
	method,
	authenticated,
	sessionExpired,
	profileLookupFailed = false
}: RouteAccessInput): RouteAccess {
	if (authenticated || isPublicPath(url.pathname)) return { kind: 'allow' };
	if (profileLookupFailed) return { kind: 'unavailable', api: isApiPath(url.pathname) };
	if (isApiPath(url.pathname)) return { kind: 'unauthorized' };

	const isRead = method === 'GET' || method === 'HEAD';
	const returnTo = isRead ? url.pathname + url.search : url.pathname;
	return { kind: 'redirect', location: loginRedirectLocation(returnTo, sessionExpired) };
}
