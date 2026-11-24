import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { RequestEvent } from '@sveltejs/kit';
import { POST } from '../../src/routes/api/admin/users/+server';
import { PERMISSIONS } from '$lib/server/auth/permission-codes';
import { getUserPermissions, hasPermission } from '$lib/server/auth/permissions';
import { findAuthUserByEmail, resolveSeedConfig } from '../../scripts/seed-admin';
import type { UserProfile } from '../../src/app';

// Route code under test reads $env/dynamic/*. Build those modules from the same resolved env the
// test's own clients use (tests/integration/global-setup.ts), so both sides share credentials.
vi.mock('$env/dynamic/private', async () => {
	const { inject } = await import('vitest');
	const env = inject('integrationEnv');
	return { env: { SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey, APP_ENV: 'local' } };
});
vi.mock('$env/dynamic/public', async () => {
	const { inject } = await import('vitest');
	const env = inject('integrationEnv');
	return { env: { PUBLIC_SUPABASE_URL: env.supabaseUrl, PUBLIC_SUPABASE_ANON_KEY: env.anonKey } };
});

const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seedConfig = resolveSeedConfig(seedEnv);
const ADMIN = seedConfig.admin;
const OPERATOR = seedConfig.fixtures.find((f) => f.roleNames.includes('operator'));

const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const sortedPermissionCodes = [...PERMISSIONS].sort();

interface SignedInUser {
	user: User;
	client: SupabaseClient;
	profile: UserProfile;
}

describe('Phase 1 end-to-end acceptance (local Supabase)', () => {
	let serviceClient: SupabaseClient;
	let admin: SignedInUser;
	let operator: SignedInUser;

	// Everything the suite creates, recorded as soon as it is known so afterAll can clean it up
	// even when an assertion fails half-way.
	const createdEmails: string[] = [];
	const created = { authUserIds: new Set<string>(), profileIds: new Set<string>() };

	async function signIn(email: string, password: string): Promise<SignedInUser> {
		const anonClient = createClient(supabaseUrl, anonKey, clientOptions);
		const { data, error } = await anonClient.auth.signInWithPassword({ email, password });
		if (error || !data.session) {
			throw new Error(
				`Failed to sign in as ${email}: ${error?.message ?? 'no session'}. ` +
					'Did you run `supabase db reset` and `APP_ENV=local pnpm seed:admin`?'
			);
		}

		const client = createClient(supabaseUrl, anonKey, {
			...clientOptions,
			global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
		});

		const { data: profile, error: profileError } = await serviceClient
			.from('profiles')
			.select('*')
			.eq('auth_user_id', data.user.id)
			.single();
		if (profileError || !profile) {
			throw new Error(`No profile for ${email}: ${profileError?.message ?? 'not found'}`);
		}

		return { user: data.user, client, profile: profile as UserProfile };
	}

	function adminUsersEvent(caller: SignedInUser, body: unknown, requestId: string): RequestEvent {
		return {
			request: new Request('http://localhost/api/admin/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			}),
			locals: {
				supabase: caller.client,
				user: caller.user,
				profile: caller.profile,
				requestId
			}
		} as unknown as RequestEvent;
	}

	async function rolePermissionCodes(roleName: string): Promise<string[]> {
		const { data: role, error: roleError } = await serviceClient
			.from('roles')
			.select('id')
			.eq('name', roleName)
			.single();
		expect(roleError).toBeNull();
		expect(role).not.toBeNull();

		const { data, error } = await serviceClient
			.from('role_permissions')
			.select('permissions(code)')
			.eq('role_id', role!.id);
		expect(error).toBeNull();

		return (data ?? []).map((row) => (row.permissions as unknown as { code: string }).code).sort();
	}

	beforeAll(async () => {
		if (!OPERATOR) throw new Error('resolveSeedConfig returned no operator fixture');

		serviceClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);
		admin = await signIn(ADMIN.email, ADMIN.password);
		operator = await signIn(OPERATOR.email, OPERATOR.password);
	});

	afterAll(async () => {
		if (!serviceClient) return;

		// Fall back to email lookup for anything created but not recorded (e.g. a non-201 response
		// after the auth user was already created).
		for (const email of createdEmails) {
			const authUser = await findAuthUserByEmail(serviceClient, email);
			if (authUser) created.authUserIds.add(authUser.id);
			const { data: profile } = await serviceClient
				.from('profiles')
				.select('id')
				.eq('email', email)
				.maybeSingle();
			if (profile) created.profileIds.add(profile.id);
		}

		// FKs are ON DELETE RESTRICT: user_roles, then profile, then auth user.
		const failures: string[] = [];
		for (const profileId of created.profileIds) {
			const { error: rolesError } = await serviceClient
				.from('user_roles')
				.delete()
				.eq('user_id', profileId);
			if (rolesError) failures.push(`user_roles of ${profileId}: ${rolesError.message}`);

			const { error: profileError } = await serviceClient
				.from('profiles')
				.delete()
				.eq('id', profileId);
			if (profileError) failures.push(`profile ${profileId}: ${profileError.message}`);
		}
		for (const authUserId of created.authUserIds) {
			const { error } = await serviceClient.auth.admin.deleteUser(authUserId);
			if (error) failures.push(`auth user ${authUserId}: ${error.message}`);
		}

		if (failures.length > 0) {
			throw new Error(`Integration cleanup failed; test data leaked:\n  ${failures.join('\n  ')}`);
		}
	});

	describe('1. Roles and granular permissions are seeded', () => {
		it('contains exactly the 5 roles', async () => {
			const { data, error } = await serviceClient.from('roles').select('name').order('name');

			expect(error).toBeNull();
			expect(data?.map((r) => r.name)).toEqual([
				'admin',
				'collector',
				'operator',
				'read-only',
				'treasurer'
			]);
		});

		it('contains exactly the permission codes in PERMISSIONS (docs/permissions.md)', async () => {
			const { data, error } = await serviceClient.from('permissions').select('code');

			expect(error).toBeNull();
			expect(PERMISSIONS).toHaveLength(48);
			expect(data?.map((p) => p.code).sort()).toEqual(sortedPermissionCodes);
		});

		it('grants every permission to the admin role', async () => {
			expect(await rolePermissionCodes('admin')).toEqual(sortedPermissionCodes);
		});
	});

	describe('2. Public self-signup is disabled', () => {
		it('rejects /auth/v1/signup with 422 signup_disabled', async () => {
			const email = `self_signup_${randomUUID()}@example.com`;
			// Cleaned up in afterAll if signup is (wrongly) enabled and the user gets created.
			createdEmails.push(email);
			const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
				method: 'POST',
				headers: { apikey: anonKey, 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password: 'SomePassword123!' })
			});

			expect(response.status).toBe(422);
			expect((await response.json()).error_code).toBe('signup_disabled');
		});
	});

	describe('3. POST /api/admin/users validates user.manage and writes the audit row', () => {
		it('rejects the operator with 403 permission_denied (session verified first)', async () => {
			// Prove the operator session is valid and evaluated by the DB, so the 403 below is a real
			// denial and not a fail-closed auth/RPC error.
			const { data: myPermissions, error: myPermissionsError } =
				await operator.client.rpc('my_permissions');
			expect(myPermissionsError).toBeNull();
			const operatorCodes = await rolePermissionCodes('operator');
			expect(operatorCodes.length).toBeGreaterThan(0);
			expect([...(myPermissions as string[])].sort()).toEqual(operatorCodes);

			const { data: hasUserManage, error: hasUserManageError } = await operator.client.rpc(
				'has_permission',
				{ permission_code: 'user.manage' }
			);
			expect(hasUserManageError).toBeNull();
			expect(hasUserManage).toBe(false);

			const email = `denied_${randomUUID()}@firefighters.local`;
			createdEmails.push(email);
			await expect(
				POST(
					adminUsersEvent(
						operator,
						{ email, password: 'Password123!', fullName: 'Should Fail', roleNames: ['operator'] },
						'req-integration-operator-denied'
					)
				)
			).rejects.toMatchObject({
				status: 403,
				body: { code: 'permission_denied', permission: 'user.manage' }
			});

			expect(await findAuthUserByEmail(serviceClient, email)).toBeNull();
		});

		it('lets the admin create a user (201) with profile, roles and one user.create audit row', async () => {
			const email = `newuser_${randomUUID()}@firefighters.local`;
			const requestId = `req-integration-admin-create-${randomUUID()}`;
			createdEmails.push(email);

			const response = await POST(
				adminUsersEvent(
					admin,
					{
						email,
						password: 'TargetPassword123!',
						fullName: 'Created By Integration Test',
						roleNames: ['operator']
					},
					requestId
				)
			);
			const result = await response.json();
			// Record ids before any assertion so cleanup runs even if one fails.
			if (result?.user?.id) created.authUserIds.add(result.user.id);
			if (result?.profile?.id) created.profileIds.add(result.profile.id);

			expect(response.status).toBe(201);
			expect(result.user.email).toBe(email);
			expect(result.profile.full_name).toBe('Created By Integration Test');
			expect(result.profile.auth_user_id).toBe(result.user.id);
			expect(result.roles).toEqual(['operator']);

			const { data: userRoles, error: userRolesError } = await serviceClient
				.from('user_roles')
				.select('roles(name)')
				.eq('user_id', result.profile.id);
			expect(userRolesError).toBeNull();
			expect(userRoles?.map((r) => (r.roles as unknown as { name: string }).name)).toEqual([
				'operator'
			]);

			const { data: auditEntries, error: auditError } = await serviceClient
				.from('audit_log')
				.select('*')
				.eq('entity_id', result.profile.id)
				.eq('action', 'user.create');
			expect(auditError).toBeNull();
			expect(auditEntries).toHaveLength(1);
			expect(auditEntries![0]).toMatchObject({
				actor_user_id: admin.profile.id,
				entity_type: 'user',
				request_id: requestId,
				reason: 'Admin-managed user creation',
				new_value: {
					id: result.profile.id,
					auth_user_id: result.user.id,
					email,
					full_name: 'Created By Integration Test',
					status: 'active',
					roles: ['operator']
				}
			});

			// Same email again: 409 email_exists, nothing new written.
			const duplicate = await POST(
				adminUsersEvent(
					admin,
					{ email, password: 'TargetPassword123!', fullName: 'Duplicate', roleNames: ['operator'] },
					`${requestId}-dup`
				)
			);
			expect(duplicate.status).toBe(409);
			expect(await duplicate.json()).toMatchObject({ code: 'email_exists' });
		});
	});

	describe('4. Permission helpers against the live database', () => {
		it('hasPermission: admin has user.manage; operator is denied by the DB (no RPC error)', async () => {
			expect(await hasPermission(admin.client, 'user.manage')).toBe(true);

			const { data, error } = await operator.client.rpc('has_permission', {
				permission_code: 'user.manage'
			});
			expect(error).toBeNull();
			expect(data).toBe(false);
		});

		it('getUserPermissions returns every permission for the admin', async () => {
			const permissions = await getUserPermissions(admin.client);
			expect(permissions).not.toBeNull();
			expect([...(permissions ?? [])].sort()).toEqual(sortedPermissionCodes);
		});

		it('has_permission_for_user works for service_role and is denied (42501) to authenticated', async () => {
			const { data: adminResult, error: serviceError } = await serviceClient.rpc(
				'has_permission_for_user',
				{ p_auth_user_id: admin.user.id, permission_code: 'user.manage' }
			);
			expect(serviceError).toBeNull();
			expect(adminResult).toBe(true);

			const { data: operatorResult, error: operatorServiceError } = await serviceClient.rpc(
				'has_permission_for_user',
				{ p_auth_user_id: operator.user.id, permission_code: 'user.manage' }
			);
			expect(operatorServiceError).toBeNull();
			expect(operatorResult).toBe(false);

			const { data, error } = await admin.client.rpc('has_permission_for_user', {
				p_auth_user_id: admin.user.id,
				permission_code: 'user.manage'
			});
			expect(data).toBeNull();
			expect(error).toMatchObject({
				code: '42501',
				message: 'permission denied for function has_permission_for_user'
			});
		});
	});

	// API roles (service_role, authenticated) have no UPDATE/DELETE privilege on audit_log, so
	// PostgREST requests are rejected with 42501 before the append-only trigger can run. The
	// trigger itself (SQLSTATE 23001, "audit_log is append-only: UPDATE is not allowed", also for
	// DELETE and TRUNCATE) is verified as the table owner by pgTAP in
	// supabase/tests/database/003_rls_has_permission.test.sql (`supabase test db`).
	describe('5. audit_log is append-only for API roles', () => {
		let probe: { id: string; action: string };

		beforeAll(async () => {
			const { data, error } = await serviceClient
				.from('audit_log')
				.insert({
					action: 'test.append_only_probe',
					entity_type: 'integration_test',
					entity_id: randomUUID(),
					reason: 'Phase 1 integration: append-only probe',
					request_id: `req-integration-append-only-${randomUUID()}`
				})
				.select('id, action')
				.single();
			expect(error).toBeNull();
			expect(data).not.toBeNull();
			probe = data!;
		});

		async function expectProbeUnchanged() {
			const { data, error } = await serviceClient
				.from('audit_log')
				.select('id, action')
				.eq('id', probe.id)
				.maybeSingle();
			expect(error).toBeNull();
			expect(data).toEqual(probe);
		}

		const permissionDenied = {
			code: '42501',
			message: 'permission denied for table audit_log'
		};

		it.each([
			['service_role', () => serviceClient],
			['authenticated admin', () => admin.client]
		])('rejects UPDATE by %s with 42501', async (_label, client) => {
			const { error } = await client()
				.from('audit_log')
				.update({ action: 'tampered.action' })
				.eq('id', probe.id);

			expect(error).toMatchObject(permissionDenied);
			await expectProbeUnchanged();
		});

		it.each([
			['service_role', () => serviceClient],
			['authenticated admin', () => admin.client]
		])('rejects DELETE by %s with 42501', async (_label, client) => {
			const { error } = await client().from('audit_log').delete().eq('id', probe.id);

			expect(error).toMatchObject(permissionDenied);
			await expectProbeUnchanged();
		});
	});
});
