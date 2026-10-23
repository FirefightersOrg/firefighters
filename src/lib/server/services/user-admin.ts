import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuditLog } from '../audit/audit';
import type { UserProfile } from '../../../app';

/**
 * Validation schema for admin-managed user creation input.
 */
export const createAdminManagedUserSchema = z.object({
	email: z.string().trim().email('Invalid email address'),
	password: z.string().min(8, 'Password must be at least 8 characters'),
	fullName: z.string().trim().min(1, 'Full name is required'),
	roleNames: z.array(z.string().min(1)).default([]),
	actorUserId: z.string().uuid().nullable().optional(),
	requestId: z.string().nullable().optional()
});

export type CreateAdminManagedUserInput = z.infer<typeof createAdminManagedUserSchema>;

export interface AdminManagedUserResult {
	user: {
		id: string;
		email: string;
	};
	profile: UserProfile;
	roles: string[];
}

/**
 * Creates an admin-managed user, their public profile, assigned roles, and an audit log entry.
 *
 * Enforces transactional compensation:
 * - If profile creation fails, the newly created Supabase auth user is deleted.
 * - If role assignment fails, the profile and auth user are deleted.
 *
 * @param adminClient Supabase admin client (service_role key, bypasses RLS)
 * @param data User creation payload
 * @returns Result object containing created auth user, profile, and roles
 */
export async function createAdminManagedUser(
	adminClient: SupabaseClient,
	data: CreateAdminManagedUserInput
): Promise<AdminManagedUserResult> {
	const parsed = createAdminManagedUserSchema.parse(data);
	const normalizedEmail = parsed.email.toLowerCase().trim();

	// 1. Verify all requested role names exist before creating the auth user
	let matchedRoles: { id: string; name: string }[] = [];
	if (parsed.roleNames.length > 0) {
		const { data: rolesData, error: rolesError } = await adminClient
			.from('roles')
			.select('id, name')
			.in('name', parsed.roleNames);

		if (rolesError) {
			throw new Error(`Failed to query roles: ${rolesError.message}`);
		}

		matchedRoles = (rolesData ?? []) as { id: string; name: string }[];
		const foundNames = new Set(matchedRoles.map((r) => r.name));
		const missing = parsed.roleNames.filter((name) => !foundNames.has(name));

		if (missing.length > 0) {
			throw new Error(`One or more specified roles do not exist: ${missing.join(', ')}`);
		}
	}

	// 2. Create the auth user in Supabase Auth (confirmed email, self-signup is disabled)
	const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
		email: normalizedEmail,
		password: parsed.password,
		email_confirm: true,
		user_metadata: {
			full_name: parsed.fullName
		}
	});

	if (authError || !authData?.user) {
		throw new Error(`Failed to create auth user: ${authError?.message ?? 'unknown auth error'}`);
	}

	const createdAuthUser = authData.user;

	// 3. Insert public.profiles row
	const { data: profileData, error: profileError } = await adminClient
		.from('profiles')
		.insert({
			auth_user_id: createdAuthUser.id,
			full_name: parsed.fullName,
			email: normalizedEmail,
			status: 'active'
		})
		.select('id, auth_user_id, full_name, email, status, created_at')
		.single();

	if (profileError || !profileData) {
		// COMPENSATION: Delete the auth user if profile creation fails
		try {
			await adminClient.auth.admin.deleteUser(createdAuthUser.id);
		} catch (deleteErr) {
			console.error('Compensation failed to delete auth user:', deleteErr);
		}
		throw new Error(
			`Failed to create user profile: ${profileError?.message ?? 'unknown profile error'}`
		);
	}

	const createdProfile = profileData as UserProfile;

	// 4. Assign roles in public.user_roles (linking profiles.id, not auth_user_id)
	if (matchedRoles.length > 0) {
		const userRoleRows = matchedRoles.map((role) => ({
			user_id: createdProfile.id,
			role_id: role.id
		}));

		const { error: userRolesError } = await adminClient.from('user_roles').insert(userRoleRows);

		if (userRolesError) {
			// COMPENSATION: Delete profile and auth user
			try {
				await adminClient.from('profiles').delete().eq('id', createdProfile.id);
				await adminClient.auth.admin.deleteUser(createdAuthUser.id);
			} catch (rollbackErr) {
				console.error('Compensation failed during role assignment rollback:', rollbackErr);
			}
			throw new Error(`Failed to assign user roles: ${userRolesError.message}`);
		}
	}

	// 5. Record structured audit log entry
	await recordAuditLog(adminClient, {
		actorUserId: parsed.actorUserId ?? null,
		action: 'user.create',
		entityType: 'user',
		entityId: createdProfile.id,
		newValue: {
			id: createdProfile.id,
			auth_user_id: createdProfile.auth_user_id,
			email: createdProfile.email,
			full_name: createdProfile.full_name,
			roles: parsed.roleNames
		},
		reason: 'Admin-managed user creation',
		requestId: parsed.requestId ?? null
	});

	return {
		user: {
			id: createdAuthUser.id,
			email: createdAuthUser.email ?? normalizedEmail
		},
		profile: createdProfile,
		roles: parsed.roleNames
	};
}
