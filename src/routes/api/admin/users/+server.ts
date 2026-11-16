import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/auth/permissions';
import {
	createAdminManagedUser,
	createAdminManagedUserSchema,
	UserAdminError
} from '$lib/server/services/user-admin';
import { createSupabaseAdminClient } from '$lib/server/supabase/admin';

/**
 * Creates an admin-managed user.
 *
 * Responses:
 * - 201 `{ user, profile, roles }`
 * - 400 `{ message, code: 'invalid_json' | 'validation_failed', errors? }`
 * - 401 `{ message, code: 'unauthenticated' }` (no session, or inactive/missing profile)
 * - 403 `{ message, code: 'permission_denied', permission }` (lacks `user.manage`)
 * - 409 `{ message, code: 'email_exists' }`
 * - 500 `{ message, code: 'internal_error' | 'permission_check_failed', requestId? }`
 *   (details are logged server-side, never returned)
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	// 1. Authenticated user with an active profile (hooks.server.ts nulls `user` otherwise).
	if (!locals.user || !locals.profile) {
		error(401, { message: 'Unauthorized', code: 'unauthenticated' });
	}

	// 2. Granular permission, checked against the database (403 denied / 500 check failed).
	await requirePermission(locals.supabase, 'user.manage');

	// 3. Parse and validate the JSON body.
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ message: 'Invalid JSON payload', code: 'invalid_json' }, { status: 400 });
	}

	const rawPayload = typeof body === 'object' && body !== null ? body : {};
	const parseResult = createAdminManagedUserSchema.safeParse({
		...rawPayload,
		actorUserId: locals.profile.id,
		requestId: locals.requestId ?? null
	});

	if (!parseResult.success) {
		return json(
			{
				message: 'Validation failed',
				code: 'validation_failed',
				errors: parseResult.error.flatten().fieldErrors
			},
			{ status: 400 }
		);
	}

	// 4. Create the user with the service-role client.
	try {
		const result = await createAdminManagedUser(createSupabaseAdminClient(), parseResult.data);
		return json(result, { status: 201 });
	} catch (err: unknown) {
		if (err instanceof UserAdminError && err.kind === 'validation') {
			return json({ message: err.message, code: 'validation_failed' }, { status: 400 });
		}
		if (err instanceof UserAdminError && err.kind === 'conflict') {
			return json(
				{ message: 'A user with this email already exists', code: 'email_exists' },
				{ status: 409 }
			);
		}

		console.error('[api/admin/users] user creation failed', {
			requestId: locals.requestId,
			actorProfileId: locals.profile.id,
			error: err
		});
		return json(
			{ message: 'Failed to create user', code: 'internal_error', requestId: locals.requestId },
			{ status: 500 }
		);
	}
};
