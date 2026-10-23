import { json, type RequestHandler } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/auth/permissions';
import {
	createAdminManagedUser,
	createAdminManagedUserSchema
} from '$lib/server/services/user-admin';
import { createSupabaseAdminClient } from '$lib/server/supabase/admin';

export const POST: RequestHandler = async ({ request, locals }) => {
	// 1. Enforce granular permission 'user.manage' via user-scoped client
	await requirePermission(locals.supabase, 'user.manage');

	// 2. Parse and validate JSON request body
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ message: 'Invalid JSON payload' }, { status: 400 });
	}

	const rawPayload = typeof body === 'object' && body !== null ? body : {};
	const parseResult = createAdminManagedUserSchema.safeParse({
		...rawPayload,
		actorUserId: locals.profile?.id ?? null,
		requestId: locals.requestId ?? null
	});

	if (!parseResult.success) {
		return json(
			{
				message: 'Validation failed',
				errors: parseResult.error.flatten().fieldErrors
			},
			{ status: 400 }
		);
	}

	// 3. Create user using service role admin client
	const adminClient = createSupabaseAdminClient();

	try {
		const result = await createAdminManagedUser(adminClient, parseResult.data);
		return json(result, { status: 201 });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to create user';
		return json({ message }, { status: 400 });
	}
};
