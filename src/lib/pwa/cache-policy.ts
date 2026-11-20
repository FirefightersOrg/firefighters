/**
 * Pure caching policy for the service worker (src/service-worker.ts).
 *
 * The app is multi-user and handles financial data, so the worker only ever caches the static
 * app shell: build output and `static/` files listed by `$service-worker`. Everything else
 * (HTML pages, `/api/**`, SvelteKit data requests, Supabase, form POSTs) always goes to the
 * network and is never stored.
 */

/** Public offline fallback page (static/offline.html), precached at install. */
export const OFFLINE_URL = '/offline.html';

export interface RequestLike {
	method: string;
	mode?: string;
}

/** Cache name for a given build; old names are deleted on activate. */
export const CACHE_PREFIX = 'firefighters-shell-';
export function cacheName(version: string): string {
	return `${CACHE_PREFIX}${version}`;
}

/** Caches that belong to this app but not to the current build. */
export function staleCacheNames(allNames: readonly string[], version: string): string[] {
	const current = cacheName(version);
	return allNames.filter((name) => name.startsWith(CACHE_PREFIX) && name !== current);
}

/** Paths that must never be answered from cache (API, SvelteKit data/remote endpoints). */
export function isSensitivePath(pathname: string): boolean {
	return (
		pathname === '/api' ||
		pathname.startsWith('/api/') ||
		pathname.endsWith('/__data.json') ||
		pathname.startsWith('/_app/remote/')
	);
}

/** True for requests the worker may touch at all: same-origin GETs (so not Supabase, not POSTs). */
export function isHandledRequest(request: RequestLike, url: URL, origin: string): boolean {
	return request.method === 'GET' && url.origin === origin && !isSensitivePath(url.pathname);
}

/** Page navigations: network-first, offline fallback, never cached. */
export function isNavigationRequest(request: RequestLike): boolean {
	return request.mode === 'navigate';
}

/**
 * Whether a request may be served from the precache: a same-origin, non-navigation GET whose path
 * is exactly one of the precached static assets. Authenticated HTML is never in that list.
 */
export function isCacheableAsset(
	request: RequestLike,
	url: URL,
	origin: string,
	precachedPaths: ReadonlySet<string>
): boolean {
	return (
		isHandledRequest(request, url, origin) &&
		!isNavigationRequest(request) &&
		precachedPaths.has(url.pathname)
	);
}

/** Which `$service-worker` paths get precached: the worker itself and anything sensitive do not. */
export function isPrecachablePath(pathname: string): boolean {
	return pathname !== '/service-worker.js' && pathname !== '/' && !isSensitivePath(pathname);
}
