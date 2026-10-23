import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { POST } from '../../src/routes/api/admin/users/+server';
import { hasPermission, getUserPermissions } from '../../src/lib/server/auth/permissions';
import type { RequestEvent } from '@sveltejs/kit';
import type { UserProfile } from '../../src/app';

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseAnonKey =
	process.env.PUBLIC_SUPABASE_ANON_KEY ||
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const supabaseServiceRoleKey =
	process.env.SUPABASE_SERVICE_ROLE_KEY ||
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const ADMIN_EMAIL = process.env.INITIAL_ADMIN_EMAIL || 'admin@firefighters.local';
const ADMIN_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD || 'Admin123456!';
const OPERATOR_EMAIL = 'operator@firefighters.local';
const OPERATOR_PASSWORD = process.env.TEST_USER_PASSWORD || 'LocalDev123456!';

const EXPECTED_PERMISSION_CODES = [
	'campaign.view',
	'campaign.create',
	'campaign.update',
	'campaign.update_rules',
	'campaign.close',
	'bond.view',
	'bond.create',
	'bond.import',
	'bond.scan',
	'bond.assign',
	'bond.return',
	'bond.mark_lost',
	'bond.annul',
	'buyer.view',
	'buyer.manage',
	'collector.view',
	'collector.manage',
	'collector.ledger.view',
	'collector.ledger.adjust',
	'sale.create',
	'sale.correct',
	'payment.create',
	'payment.annul',
	'settlement.create',
	'settlement.update_open',
	'settlement.close',
	'settlement.correct',
	'commission.view',
	'commission.rule_manage',
	'commission.adjust',
	'commission.settle',
	'draw.view',
	'draw.create',
	'draw.update',
	'draw.generate_roster',
	'draw.freeze_roster',
	'draw.load_winner',
	'prize.resolve',
	'prize.deliver',
	'report.view_operational',
	'report.view_financial',
	'report.export',
	'audit.view',
	'user.manage'
];

describe('Phase 1 End-to-End Acceptance Verification', () => {
	let adminClient: SupabaseClient;
	let userScopedAdminClient: SupabaseClient;
	let userScopedOperatorClient: SupabaseClient;
	let adminProfile: UserProfile;
	let operatorProfile: UserProfile;
	let createdTestUserId: string | null = null;
	let createdTestProfileId: string | null = null;

	beforeAll(async () => {
		// Privileged client
		adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
			auth: { autoRefreshToken: false, persistSession: false }
		});

		// 1. Authenticate admin user
		const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
			auth: { autoRefreshToken: false, persistSession: false }
		});

		const { data: adminAuth, error: adminAuthError } = await anonClient.auth.signInWithPassword({
			email: ADMIN_EMAIL,
			password: ADMIN_PASSWORD
		});
		if (adminAuthError || !adminAuth.session) {
			throw new Error(`Failed to log in as admin fixture: ${adminAuthError?.message}`);
		}

		userScopedAdminClient = createClient(supabaseUrl, supabaseAnonKey, {
			auth: { autoRefreshToken: false, persistSession: false },
			global: {
				headers: {
					Authorization: `Bearer ${adminAuth.session.access_token}`
				}
			}
		});

		const { data: adminProfData } = await adminClient
			.from('profiles')
			.select('*')
			.eq('auth_user_id', adminAuth.user.id)
			.single();
		adminProfile = adminProfData as UserProfile;

		// 2. Authenticate operator user
		const { data: opAuth, error: opAuthError } = await anonClient.auth.signInWithPassword({
			email: OPERATOR_EMAIL,
			password: OPERATOR_PASSWORD
		});
		if (opAuthError || !opAuth.session) {
			throw new Error(`Failed to log in as operator fixture: ${opAuthError?.message}`);
		}

		userScopedOperatorClient = createClient(supabaseUrl, supabaseAnonKey, {
			auth: { autoRefreshToken: false, persistSession: false },
			global: {
				headers: {
					Authorization: `Bearer ${opAuth.session.access_token}`
				}
			}
		});

		const { data: opProfData } = await adminClient
			.from('profiles')
			.select('*')
			.eq('auth_user_id', opAuth.user.id)
			.single();
		operatorProfile = opProfData as UserProfile;
	});

	afterAll(async () => {
		// Clean up created test user if present
		if (createdTestProfileId) {
			await adminClient.from('user_roles').delete().eq('user_id', createdTestProfileId);
			await adminClient.from('profiles').delete().eq('id', createdTestProfileId);
		}
		if (createdTestUserId) {
			await adminClient.auth.admin.deleteUser(createdTestUserId);
		}
	});

	describe('1. Roles and granular permissions seeded in database', () => {
		it('contains exactly the 5 specified roles', async () => {
			const { data: roles, error } = await adminClient.from('roles').select('name').order('name');

			expect(error).toBeNull();
			const roleNames = roles?.map((r) => r.name);
			expect(roleNames).toEqual(['admin', 'collector', 'operator', 'read-only', 'treasurer']);
		});

		it('contains exactly the 44 granular permissions specified in docs/permissions.md', async () => {
			const { data: permissions, error } = await adminClient
				.from('permissions')
				.select('code')
				.order('code');

			expect(error).toBeNull();
			expect(permissions).toHaveLength(44);

			const actualCodes = permissions?.map((p) => p.code).sort();
			const expectedSorted = [...EXPECTED_PERMISSION_CODES].sort();
			expect(actualCodes).toEqual(expectedSorted);
		});

		it('grants all 44 permissions to the admin role in role_permissions', async () => {
			const { data: adminRole } = await adminClient
				.from('roles')
				.select('id')
				.eq('name', 'admin')
				.single();

			const { data: adminPerms, error } = await adminClient
				.from('role_permissions')
				.select('permission_id')
				.eq('role_id', adminRole?.id);

			expect(error).toBeNull();
			expect(adminPerms).toHaveLength(44);
		});
	});

	describe('2. Public self-signup is disabled', () => {
		it('rejects self-signup requests at the Supabase Auth endpoint', async () => {
			const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
				method: 'POST',
				headers: {
					apikey: supabaseAnonKey,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					email: `unauthorized_signup_${Date.now()}@example.com`,
					password: 'SomePassword123!'
				})
			});

			expect(response.status).toBe(422);
			const body = await response.json();
			expect(body.error_code).toBe('signup_disabled');
		});
	});

	describe('3. Sensitive actions validate granular permissions & audit logging (POST /api/admin/users)', () => {
		it('returns 403 when caller lacks user.manage permission (operator)', async () => {
			const mockEvent = {
				request: new Request('http://localhost:5173/api/admin/users', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: 'should_fail@firefighters.local',
						password: 'Password123!',
						fullName: 'Should Fail',
						roleNames: ['operator']
					})
				}),
				locals: {
					supabase: userScopedOperatorClient,
					profile: operatorProfile,
					requestId: 'req-op-unauthorized'
				}
			} as unknown as RequestEvent;

			await expect(POST(mockEvent)).rejects.toMatchObject({
				status: 403,
				body: expect.objectContaining({
					code: 'permission_denied',
					permission: 'user.manage'
				})
			});
		});

		it('allows user creation when caller has user.manage permission (admin) and writes structured audit log', async () => {
			const uniqueSuffix = Date.now();
			const targetEmail = `newuser_${uniqueSuffix}@firefighters.local`;
			const requestId = `req-admin-create-${uniqueSuffix}`;

			const mockEvent = {
				request: new Request('http://localhost:5173/api/admin/users', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						email: targetEmail,
						password: 'TargetPassword123!',
						fullName: 'Created By Integration Test',
						roleNames: ['operator']
					})
				}),
				locals: {
					supabase: userScopedAdminClient,
					profile: adminProfile,
					requestId
				}
			} as unknown as RequestEvent;

			const response = await POST(mockEvent);
			expect(response.status).toBe(201);

			const result = await response.json();
			expect(result.user.email).toBe(targetEmail);
			expect(result.profile.full_name).toBe('Created By Integration Test');
			expect(result.roles).toEqual(['operator']);

			createdTestUserId = result.user.id;
			createdTestProfileId = result.profile.id;

			// Verify structured audit log was recorded
			const { data: auditEntries, error: auditError } = await adminClient
				.from('audit_log')
				.select('*')
				.eq('entity_id', createdTestProfileId)
				.eq('action', 'user.create');

			expect(auditError).toBeNull();
			expect(auditEntries).toHaveLength(1);

			const entry = auditEntries![0];
			expect(entry.actor_user_id).toBe(adminProfile.id);
			expect(entry.entity_type).toBe('user');
			expect(entry.request_id).toBe(requestId);
			expect(entry.new_value.email).toBe(targetEmail);
			expect(entry.new_value.roles).toEqual(['operator']);
		});
	});

	describe('4. Permission and session helpers with live database', () => {
		it('verifies hasPermission returns true for admin and false for operator on user.manage', async () => {
			const adminHasUserManage = await hasPermission(userScopedAdminClient, 'user.manage');
			expect(adminHasUserManage).toBe(true);

			const operatorHasUserManage = await hasPermission(userScopedOperatorClient, 'user.manage');
			expect(operatorHasUserManage).toBe(false);
		});

		it('verifies getUserPermissions returns full 44 list for admin', async () => {
			const permissions = await getUserPermissions(userScopedAdminClient);
			expect(permissions).toHaveLength(44);
			expect(permissions).toContain('user.manage');
			expect(permissions).toContain('audit.view');
		});

		it('denies authenticated client from calling service-role-only has_permission_for_user', async () => {
			const { error } = await userScopedAdminClient.rpc('has_permission_for_user', {
				p_auth_user_id: adminProfile.auth_user_id,
				permission_code: 'user.manage'
			});

			expect(error).not.toBeNull();
			// Permission denied on function for authenticated role
			expect(error?.message).toMatch(/permission denied|does not exist/i);
		});
	});

	describe('5. Audit log is append-only', () => {
		it('prevents UPDATE operations on audit_log via revoked privileges and trigger', async () => {
			const { data: existingAudit } = await adminClient
				.from('audit_log')
				.select('id')
				.limit(1)
				.single();

			expect(existingAudit).toBeDefined();

			const { error: updateError } = await adminClient
				.from('audit_log')
				.update({ action: 'tampered.action' })
				.eq('id', existingAudit!.id);

			expect(updateError).not.toBeNull();
			expect(updateError?.message).toMatch(
				/permission denied|append-only: updates are not permitted/i
			);
		});

		it('prevents DELETE operations on audit_log via revoked privileges and trigger', async () => {
			const { data: existingAudit } = await adminClient
				.from('audit_log')
				.select('id')
				.limit(1)
				.single();

			expect(existingAudit).toBeDefined();

			const { error: deleteError } = await adminClient
				.from('audit_log')
				.delete()
				.eq('id', existingAudit!.id);

			expect(deleteError).not.toBeNull();
			expect(deleteError?.message).toMatch(
				/permission denied|append-only: deletes are not permitted/i
			);
		});
	});
});
