/**
 * Guards shared by the UX scripts (`ux-walkthrough.ts`, `ux-flows.ts`). They sign in with the
 * seeded admin and fixture credentials and, for the flows, write data, so the app they drive has to
 * be the local one: `resolveSeedConfig()` checks the Supabase URL, and this checks the browser URL.
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export const DEFAULT_BASE_URL = 'http://127.0.0.1:5173';

/**
 * The origin the scripts may open, from `UX_BASE_URL` (default: the local dev server). Throws
 * unless it is an http(s) URL whose host is localhost / 127.0.0.1 / ::1, so credentials are never
 * typed into a remote site. Returns the origin only (no path, query or user info).
 */
export function resolveLocalBaseUrl(value: string | undefined): string {
	const raw = value?.trim() || DEFAULT_BASE_URL;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`UX_BASE_URL is not a valid URL (${raw}).`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`UX_BASE_URL must be an http(s) URL (got ${url.protocol}).`);
	}
	if (!LOCAL_HOSTNAMES.has(url.hostname)) {
		throw new Error(
			`Refusing to run against ${url.origin}: the UX scripts sign in with the local seed ` +
				'credentials and write data, so UX_BASE_URL must be on localhost / 127.0.0.1.'
		);
	}
	return url.origin;
}

/**
 * Throws unless `pageUrl` is on `baseUrl`'s origin. Called on the login page before any credential
 * is typed, in case the local server redirected somewhere else.
 */
export function assertOnBaseUrl(pageUrl: string, baseUrl: string): void {
	let origin: string;
	try {
		origin = new URL(pageUrl).origin;
	} catch {
		throw new Error(`The login page has no valid URL (${pageUrl}).`);
	}
	if (origin !== new URL(baseUrl).origin) {
		throw new Error(`Refusing to sign in: the login page is on ${origin}, not on ${baseUrl}.`);
	}
}

export interface Attempt<R> {
	result: R;
	/** First line of what went wrong, or null when the attempt completed. */
	error: string | null;
}

export interface RunOutcome<R> {
	results: R[];
	/** Names of the attempts that failed, in the order they ran. */
	failed: string[];
	/** 0 when every attempt completed, 1 otherwise: the process exits with it. */
	exitCode: 0 | 1;
}

/**
 * Runs `attempt` for each name, in order. A failed attempt does not stop the rest and its result is
 * kept (the report should show how far it got), but the outcome carries a nonzero exit code, so a
 * broken run can never look like a successful one.
 */
export async function runEach<R>(
	names: readonly string[],
	attempt: (name: string) => Promise<Attempt<R>>
): Promise<RunOutcome<R>> {
	const results: R[] = [];
	const failed: string[] = [];
	for (const name of names) {
		const { result, error } = await attempt(name);
		results.push(result);
		if (error !== null) failed.push(name);
	}
	return { results, failed, exitCode: failed.length > 0 ? 1 : 0 };
}
