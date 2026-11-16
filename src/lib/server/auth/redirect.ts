const INTERNAL_ORIGIN = 'http://internal.invalid';

// ASCII control characters (incl. tab/CR/LF, which browsers strip from a Location header),
// any whitespace, and backslashes (which browsers treat like '/').
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\s\\]/;
// eslint-disable-next-line no-control-regex
const UNSAFE_DECODED_PATH_CHARS = /[\u0000-\u001f\u007f\\]/;

/**
 * Returns a same-origin path that is safe to use as a post-login redirect target, or `'/'`.
 *
 * Accepts only a single leading `/` followed by a non-`/` character (or nothing), with no
 * whitespace, control characters or backslashes, either raw or percent-encoded in the path.
 * The value is resolved against a fixed origin and must stay on it; the normalized
 * `pathname + search + hash` is returned.
 */
export function getSafeRedirectPath(target: unknown): string {
	if (typeof target !== 'string' || target.length === 0 || target.length > 2048) return '/';
	if (UNSAFE_CHARS.test(target)) return '/';
	if (!target.startsWith('/') || target.startsWith('//')) return '/';

	let url: URL;
	try {
		url = new URL(target, INTERNAL_ORIGIN);
	} catch {
		return '/';
	}
	if (url.origin !== INTERNAL_ORIGIN) return '/';

	// Reject encoded tricks such as `/%09/evil.com` or `/%2F/evil.com` in case anything
	// downstream decodes the path before using it.
	let decodedPath: string;
	try {
		decodedPath = decodeURIComponent(url.pathname);
	} catch {
		return '/';
	}
	if (UNSAFE_DECODED_PATH_CHARS.test(decodedPath) || decodedPath.startsWith('//')) return '/';

	return `${url.pathname}${url.search}${url.hash}`;
}
