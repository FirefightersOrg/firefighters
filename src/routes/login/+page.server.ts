import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { loginSchema } from '$lib/schemas/auth';

export function _getSafeRedirectUrl(target: string | null | undefined): string {
	if (!target) return '/';
	if (target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/\\')) {
		return target;
	}
	return '/';
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.session && locals.user) {
		redirect(303, '/');
	}

	return {
		reason: url.searchParams.get('reason'),
		redirectTo: url.searchParams.get('redirectTo')
	};
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const formData = await request.formData();
		const email = formData.get('email');
		const password = formData.get('password');
		const redirectToRaw = formData.get('redirectTo');

		const parseResult = loginSchema.safeParse({ email, password });
		if (!parseResult.success) {
			return fail(400, {
				email: typeof email === 'string' ? email : '',
				errors: parseResult.error.flatten().fieldErrors,
				message: 'Please provide a valid email and password'
			});
		}

		const { email: validEmail, password: validPassword } = parseResult.data;

		let signInData;
		try {
			const { data, error } = await locals.supabase.auth.signInWithPassword({
				email: validEmail,
				password: validPassword
			});

			if (error || !data.user) {
				return fail(400, {
					email: validEmail,
					message: 'Invalid email or password',
					errors: undefined
				});
			}

			signInData = data;
		} catch {
			return fail(400, {
				email: validEmail,
				message: 'Unable to connect to authentication service. Please try again.',
				errors: undefined
			});
		}

		// Verify that the user's profile is active
		try {
			const { data: profile, error: profileError } = await locals.supabase
				.from('profiles')
				.select('status')
				.eq('auth_user_id', signInData.user.id)
				.maybeSingle();

			if (profileError) {
				await locals.supabase.auth.signOut();
				return fail(400, {
					email: validEmail,
					message: 'Unable to verify account status. Please try again.',
					errors: undefined
				});
			}

			if (profile && profile.status === 'inactive') {
				await locals.supabase.auth.signOut();
				return fail(400, {
					email: validEmail,
					message: 'Your account is inactive. Please contact an administrator.',
					errors: undefined
				});
			}
		} catch {
			await locals.supabase.auth.signOut();
			return fail(400, {
				email: validEmail,
				message: 'Unable to verify account status. Please try again.',
				errors: undefined
			});
		}

		const target = _getSafeRedirectUrl(
			typeof redirectToRaw === 'string' && redirectToRaw.length > 0
				? redirectToRaw
				: url.searchParams.get('redirectTo')
		);

		redirect(303, target);
	}
};
