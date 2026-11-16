import type { Cookies } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';

// Supabase SSR auth cookies: `sb-<ref>-auth-token`, its chunks (`.0`, `.1`, ...) and
// `sb-<ref>-auth-token-code-verifier`.
const SUPABASE_AUTH_COOKIE = /^sb-.+-auth-token/;

/** Deletes every Supabase auth cookie on the request, so the browser drops the session. */
export function clearSupabaseAuthCookies(cookies: Cookies): void {
	for (const { name } of cookies.getAll()) {
		if (SUPABASE_AUTH_COOKIE.test(name)) {
			cookies.delete(name, { path: '/' });
		}
	}
}

/**
 * Signs the current session out and guarantees that no session cookie remains.
 *
 * Tries a normal (global) Supabase sign-out first. If that returns an error or throws
 * (network or Auth service failure), the error is logged and the Supabase auth cookies are
 * deleted locally instead. Never throws.
 *
 * @returns `true` if Supabase confirmed the sign-out, `false` if only the local cookies were cleared.
 */
export async function endSession(
	supabase: SupabaseClient,
	cookies: Cookies,
	context: Record<string, unknown> = {}
): Promise<boolean> {
	try {
		const { error } = await supabase.auth.signOut();
		if (!error) return true;
		console.error('[auth] signOut failed; clearing auth cookies locally', { ...context, error });
	} catch (err) {
		console.error('[auth] signOut threw; clearing auth cookies locally', {
			...context,
			error: err
		});
	}

	clearSupabaseAuthCookies(cookies);
	return false;
}
