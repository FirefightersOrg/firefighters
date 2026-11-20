import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserProfile } from '../../../app';

/**
 * Validation schema for admin-managed user creation input.
 */
export const PROFILE_FULL_NAME_MAX_LENGTH = 200;
export const PROFILE_EMAIL_MAX_LENGTH = 254;
export const REQUEST_ID_MAX_LENGTH = 100;

export const createAdminManagedUserSchema = z.object({
	email: z
		.string()
		.trim()
		.max(PROFILE_EMAIL_MAX_LENGTH, `Email must be at most ${PROFILE_EMAIL_MAX_LENGTH} characters`)
		.email('Invalid email address'),
	password: z.string().min(8, 'Password must be at least 8 characters'),
	fullName: z
		.string()
		.trim()
		.min(1, 'Full name is required')
		.max(
			PROFILE_FULL_NAME_MAX_LENGTH,
			`Full name must be at most ${PROFILE_FULL_NAME_MAX_LENGTH} characters`
		),
	roleNames: z.array(z.string().trim().min(1)).default([]),
	actorUserId: z.guid().nullable().optional(),
	requestId: z.string().max(REQUEST_ID_MAX_LENGTH).nullable().optional()
});

export type CreateAdminManagedUserInput = z.input<typeof createAdminManagedUserSchema>;

export interface AdminManagedUserResult {
	user: {
		id: string;
		email: string;
	};
	profile: UserProfile;
	roles: string[];
}

/**
 * Failure categories callers can map to responses:
 * - `validation`: bad input (invalid payload, unknown role, weak password). Message is safe to show.
 * - `conflict`: a user with this email already exists.
 * - `internal`: anything else. Message is for logs only, never for clients.
 */
export type UserAdminErrorKind = 'validation' | 'conflict' | 'internal';

export class UserAdminError extends Error {
	readonly kind: UserAdminErrorKind;
	/** Set when the auth user could not be deleted after a failed provisioning (needs cleanup). */
	readonly orphanedAuthUserId?: string;

	constructor(
		kind: UserAdminErrorKind,
		message: string,
		options?: { cause?: unknown; orphanedAuthUserId?: string }
	) {
		super(message, { cause: options?.cause });
		this.name = 'UserAdminError';
		this.kind = kind;
		this.orphanedAuthUserId = options?.orphanedAuthUserId;
	}
}

/** Postgres SQLSTATEs raised by `admin_provision_profile` / `admin_grant_roles`. */
const PG_UNIQUE_VIOLATION = '23505';
const PG_INVALID_PARAMETER_VALUE = '22023';

/** Supabase Auth error codes for an email that is already registered. */
const AUTH_EMAIL_EXISTS_CODES = new Set(['email_exists', 'user_already_exists']);

interface PostgrestLikeError {
	code?: string;
	message: string;
}

function classifyRpcError(rpcError: PostgrestLikeError, context: string): UserAdminError {
	if (rpcError.code === PG_UNIQUE_VIOLATION) {
		return new UserAdminError('conflict', 'A user with this email already exists', {
			cause: rpcError
		});
	}
	if (rpcError.code === PG_INVALID_PARAMETER_VALUE) {
		return new UserAdminError('validation', rpcError.message, { cause: rpcError });
	}
	return new UserAdminError('internal', `${context}: ${rpcError.message}`, { cause: rpcError });
}

/**
 * Creates the profile of an EXISTING auth user, assigns roles and writes the `user.create` audit
 * entry in one database transaction (`public.admin_provision_profile`, service_role only).
 *
 * Does not create or delete the auth user. Throws `UserAdminError` on failure.
 */
export async function provisionProfile(
	adminClient: SupabaseClient,
	args: {
		authUserId: string;
		fullName: string;
		roleNames: string[];
		actorUserId?: string | null;
		requestId?: string | null;
		reason?: string | null;
	}
): Promise<UserProfile> {
	let result: { data: unknown; error: PostgrestLikeError | null };
	try {
		result = await adminClient.rpc('admin_provision_profile', {
			p_auth_user_id: args.authUserId,
			p_full_name: args.fullName,
			p_role_names: args.roleNames,
			p_actor_profile_id: args.actorUserId ?? null,
			p_request_id: args.requestId ?? null,
			p_reason: args.reason ?? null
		});
	} catch (err) {
		throw new UserAdminError('internal', 'admin_provision_profile RPC threw', { cause: err });
	}

	if (result.error) {
		throw classifyRpcError(result.error, 'Failed to provision profile');
	}
	if (!result.data || typeof result.data !== 'object') {
		throw new UserAdminError('internal', 'admin_provision_profile returned no profile');
	}
	return result.data as UserProfile;
}

/**
 * Assigns the given roles to a profile if it does not hold them yet, with one audit entry,
 * atomically (`public.admin_grant_roles`, service_role only). Returns the newly granted names.
 * Throws `UserAdminError` on failure.
 */
export async function grantRoles(
	adminClient: SupabaseClient,
	args: {
		profileId: string;
		roleNames: string[];
		actorUserId?: string | null;
		requestId?: string | null;
		reason?: string | null;
	}
): Promise<string[]> {
	let result: { data: unknown; error: PostgrestLikeError | null };
	try {
		result = await adminClient.rpc('admin_grant_roles', {
			p_profile_id: args.profileId,
			p_role_names: args.roleNames,
			p_actor_profile_id: args.actorUserId ?? null,
			p_request_id: args.requestId ?? null,
			p_reason: args.reason ?? null
		});
	} catch (err) {
		throw new UserAdminError('internal', 'admin_grant_roles RPC threw', { cause: err });
	}

	if (result.error) {
		throw classifyRpcError(result.error, 'Failed to grant roles');
	}
	return Array.isArray(result.data) ? (result.data as string[]) : [];
}

/**
 * Creates an admin-managed user: Supabase Auth user, then profile + roles + audit entry.
 *
 * Consistency: profile, role assignments and the audit row are written in ONE database
 * transaction (`admin_provision_profile`), so they either all exist or none do. The auth user is
 * a separate system: if provisioning fails it is deleted again (compensation). If that delete
 * also fails, the error is logged and reported via `UserAdminError.orphanedAuthUserId`; the
 * orphan has no profile, so it cannot use the app (treated as anonymous) and the seed script can
 * adopt it.
 *
 * @param adminClient Supabase admin client (service_role key)
 * @param data User creation payload; `actorUserId` is the acting admin's `profiles.id`
 *             (null for system/seed actions)
 * @throws UserAdminError
 */
export async function createAdminManagedUser(
	adminClient: SupabaseClient,
	data: CreateAdminManagedUserInput
): Promise<AdminManagedUserResult> {
	const parseResult = createAdminManagedUserSchema.safeParse(data);
	if (!parseResult.success) {
		throw new UserAdminError('validation', 'Invalid user data', { cause: parseResult.error });
	}
	const parsed = parseResult.data;
	const normalizedEmail = parsed.email.toLowerCase();
	const roleNames = [...new Set(parsed.roleNames)].sort();

	// 1. Reject unknown roles before touching Supabase Auth (the RPC re-validates atomically).
	if (roleNames.length > 0) {
		const { data: rolesData, error: rolesError } = await adminClient
			.from('roles')
			.select('name')
			.in('name', roleNames);

		if (rolesError) {
			throw new UserAdminError('internal', `Failed to query roles: ${rolesError.message}`, {
				cause: rolesError
			});
		}

		const found = new Set(((rolesData ?? []) as { name: string }[]).map((r) => r.name));
		const missing = roleNames.filter((name) => !found.has(name));
		if (missing.length > 0) {
			throw new UserAdminError('validation', `Unknown role(s): ${missing.join(', ')}`);
		}
	}

	// 2. Create the auth user (email confirmed; self-signup is disabled).
	const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
		email: normalizedEmail,
		password: parsed.password,
		email_confirm: true,
		user_metadata: { full_name: parsed.fullName }
	});

	if (authError || !authData?.user) {
		if (authError?.code && AUTH_EMAIL_EXISTS_CODES.has(authError.code)) {
			throw new UserAdminError('conflict', 'A user with this email already exists', {
				cause: authError
			});
		}
		if (authError?.code === 'weak_password') {
			throw new UserAdminError('validation', 'Password does not meet the requirements', {
				cause: authError
			});
		}
		throw new UserAdminError(
			'internal',
			`Failed to create auth user: ${authError?.message ?? 'no user returned'}`,
			{ cause: authError }
		);
	}

	const authUser = authData.user;

	// 3. Profile + roles + audit in one transaction; on failure, delete the auth user again.
	let profile: UserProfile;
	try {
		profile = await provisionProfile(adminClient, {
			authUserId: authUser.id,
			fullName: parsed.fullName,
			roleNames,
			actorUserId: parsed.actorUserId ?? null,
			requestId: parsed.requestId ?? null
		});
	} catch (provisionErr) {
		const original =
			provisionErr instanceof UserAdminError
				? provisionErr
				: new UserAdminError('internal', 'Failed to provision profile', { cause: provisionErr });

		const compensationError = await deleteAuthUserQuietly(adminClient, authUser.id);
		if (!compensationError) {
			throw original;
		}

		console.error('[user-admin] compensation failed: auth user left without profile', {
			authUserId: authUser.id,
			email: normalizedEmail,
			requestId: parsed.requestId ?? null,
			provisionError: original,
			compensationError
		});
		throw new UserAdminError(
			original.kind,
			`${original.message} (and the auth user ${authUser.id} could not be deleted)`,
			{ cause: original, orphanedAuthUserId: authUser.id }
		);
	}

	return {
		user: { id: authUser.id, email: authUser.email ?? normalizedEmail },
		profile,
		roles: roleNames
	};
}

/** Deletes an auth user, returning the error (from `{ error }` or a throw) instead of throwing. */
async function deleteAuthUserQuietly(
	adminClient: SupabaseClient,
	authUserId: string
): Promise<unknown> {
	try {
		const { error } = await adminClient.auth.admin.deleteUser(authUserId);
		return error ?? null;
	} catch (err) {
		return err ?? new Error('deleteUser threw');
	}
}
