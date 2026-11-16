import { fail, redirect } from '@sveltejs/kit';
import { isAuthApiError, type SupabaseClient } from '@supabase/supabase-js';
import type { Actions, PageServerLoad } from './$types';
import { loginSchema } from '$lib/schemas/auth';
import { getSafeRedirectPath } from '$lib/server/auth/redirect';
import { endSession } from '$lib/server/auth/session';

const MESSAGES = {
	invalidInput: 'Please provide a valid email and password',
	invalidCredentials: 'Invalid email or password',
	rateLimited: 'Too many sign-in attempts. Please wait a moment and try again.',
	serviceUnavailable: 'The sign-in service is temporarily unavailable. Please try again.',
	statusUnavailable: 'Unable to verify account status. Please try again.',
	notActive: 'Your account is not active. Please contact an administrator.'
} as const;

type ProfileAccess = 'active' | 'not_active' | 'error';

/** Reads the caller's own profile status (RLS allows this regardless of status). Fails closed. */
async function getProfileAccess(
	supabase: SupabaseClient,
	authUserId: string,
	requestId: string | undefined
): Promise<ProfileAccess> {
	try {
		const { data, error } = await supabase
			.from('profiles')
			.select('status')
			.eq('auth_user_id', authUserId)
			.maybeSingle();

		if (error) {
			console.error('[login] profile status lookup failed', { requestId, error });
			return 'error';
		}
		// A missing profile row is treated like an inactive one, matching hooks.server.ts.
		return data?.status === 'active' ? 'active' : 'not_active';
	} catch (err) {
		console.error('[login] profile status lookup threw', { requestId, error: err });
		return 'error';
	}
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const redirectTo = getSafeRedirectPath(url.searchParams.get('redirectTo'));

	// Only an ACTIVE user counts as logged in (the hook leaves profile null otherwise), so a
	// deactivated user with a leftover session cookie can still reach this page and sign in.
	if (locals.user && locals.profile) {
		redirect(303, redirectTo);
	}

	return { redirectTo: redirectTo === '/' ? null : redirectTo };
};

export const actions: Actions = {
	default: async ({ request, locals, url, cookies }) => {
		const formData = await request.formData();
		const email = formData.get('email');
		const password = formData.get('password');
		const redirectToRaw = formData.get('redirectTo');

		const parseResult = loginSchema.safeParse({ email, password });
		if (!parseResult.success) {
			return fail(400, {
				email: typeof email === 'string' ? email : '',
				errors: parseResult.error.flatten().fieldErrors,
				message: MESSAGES.invalidInput
			});
		}

		const { email: validEmail, password: validPassword } = parseResult.data;
		const failure = (status: number, message: string) =>
			fail(status, { email: validEmail, message, errors: undefined });

		let authUserId: string;
		try {
			const { data, error } = await locals.supabase.auth.signInWithPassword({
				email: validEmail,
				password: validPassword
			});

			if (error) {
				if (isAuthApiError(error) && error.status === 429) {
					return failure(429, MESSAGES.rateLimited);
				}
				if (isAuthApiError(error) && error.status >= 400 && error.status < 500) {
					return failure(400, MESSAGES.invalidCredentials);
				}
				console.error('[login] signInWithPassword failed', {
					requestId: locals.requestId,
					error
				});
				return failure(503, MESSAGES.serviceUnavailable);
			}
			if (!data.user) {
				console.error('[login] signInWithPassword returned no user', {
					requestId: locals.requestId
				});
				return failure(503, MESSAGES.serviceUnavailable);
			}
			authUserId = data.user.id;
		} catch (err) {
			console.error('[login] signInWithPassword threw', {
				requestId: locals.requestId,
				error: err
			});
			return failure(503, MESSAGES.serviceUnavailable);
		}

		const access = await getProfileAccess(locals.supabase, authUserId, locals.requestId);
		if (access !== 'active') {
			// Never leave a session cookie behind for a user the app will not let in.
			await endSession(locals.supabase, cookies, { requestId: locals.requestId, source: 'login' });
			return access === 'error'
				? failure(503, MESSAGES.statusUnavailable)
				: failure(403, MESSAGES.notActive);
		}

		const target = getSafeRedirectPath(
			typeof redirectToRaw === 'string' && redirectToRaw.length > 0
				? redirectToRaw
				: url.searchParams.get('redirectTo')
		);
		redirect(303, target);
	}
};
