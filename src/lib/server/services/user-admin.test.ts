import { describe, it, expect, vi } from 'vitest';
import { createAdminManagedUser } from './user-admin';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('createAdminManagedUser', () => {
	const validUserId = '11111111-1111-4111-8111-111111111111';
	const validProfileId = '22222222-2222-4222-8222-222222222222';
	const validRoleId = '33333333-3333-4333-8333-333333333333';
	const validActorId = '44444444-4444-4444-8444-444444444444';

	function createMockAdminClient(overrides?: {
		rolesSelectResult?: { data: unknown; error: unknown };
		createUserResult?: { data: unknown; error: unknown };
		deleteUserResult?: { data: unknown; error: unknown };
		profileInsertResult?: { data: unknown; error: unknown };
		userRolesInsertResult?: { data: unknown; error: unknown };
		auditInsertResult?: { data: unknown; error: unknown };
	}) {
		const deleteUserMock = vi
			.fn()
			.mockResolvedValue(overrides?.deleteUserResult ?? { data: {}, error: null });
		const createUserMock = vi
			.fn()
			.mockImplementation((params: { email: string; user_metadata?: { full_name?: string } }) => {
				if (overrides?.createUserResult) return overrides.createUserResult;
				return Promise.resolve({
					data: {
						user: {
							id: validUserId,
							email: params.email
						}
					},
					error: null
				});
			});

		const profileDeleteEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
		const profileDeleteMock = vi.fn().mockReturnValue({
			eq: profileDeleteEqMock
		});

		const fromMock = vi.fn().mockImplementation((table: string) => {
			if (table === 'roles') {
				return {
					select: vi.fn().mockReturnValue({
						in: vi.fn().mockResolvedValue(
							overrides?.rolesSelectResult ?? {
								data: [{ id: validRoleId, name: 'operator' }],
								error: null
							}
						)
					})
				};
			}

			if (table === 'profiles') {
				return {
					insert: vi.fn().mockImplementation((insertedRow: Record<string, unknown>) => ({
						select: vi.fn().mockReturnValue({
							single: vi.fn().mockResolvedValue(
								overrides?.profileInsertResult ?? {
									data: {
										id: validProfileId,
										auth_user_id: validUserId,
										full_name: (insertedRow.full_name as string) ?? 'New Operator',
										email: (insertedRow.email as string) ?? 'newuser@firefighters.local',
										status: 'active',
										created_at: new Date().toISOString()
									},
									error: null
								}
							)
						})
					})),
					delete: profileDeleteMock
				};
			}

			if (table === 'user_roles') {
				return {
					insert: vi
						.fn()
						.mockResolvedValue(overrides?.userRolesInsertResult ?? { data: null, error: null })
				};
			}

			if (table === 'audit_log') {
				return {
					insert: vi
						.fn()
						.mockResolvedValue(overrides?.auditInsertResult ?? { data: null, error: null })
				};
			}

			throw new Error(`Unexpected table: ${table}`);
		});

		return {
			client: {
				auth: {
					admin: {
						createUser: createUserMock,
						deleteUser: deleteUserMock
					}
				},
				from: fromMock
			} as unknown as SupabaseClient,
			createUserMock,
			deleteUserMock,
			profileDeleteMock,
			profileDeleteEqMock,
			fromMock
		};
	}

	it('successfully creates an auth user, profile, assigns roles, and records audit log', async () => {
		const { client, createUserMock, deleteUserMock } = createMockAdminClient();

		const result = await createAdminManagedUser(client, {
			email: '  NewUser@Firefighters.Local  ',
			password: 'StrongPassword123!',
			fullName: 'New Operator',
			roleNames: ['operator'],
			actorUserId: validActorId,
			requestId: 'req-001'
		});

		expect(result).toEqual({
			user: {
				id: validUserId,
				email: 'newuser@firefighters.local'
			},
			profile: expect.objectContaining({
				id: validProfileId,
				auth_user_id: validUserId,
				email: 'newuser@firefighters.local',
				full_name: 'New Operator',
				status: 'active'
			}),
			roles: ['operator']
		});

		expect(createUserMock).toHaveBeenCalledWith({
			email: 'newuser@firefighters.local',
			password: 'StrongPassword123!',
			email_confirm: true,
			user_metadata: {
				full_name: 'New Operator'
			}
		});

		expect(deleteUserMock).not.toHaveBeenCalled();
	});

	it('validates schema and rejects invalid email or weak password', async () => {
		const { client } = createMockAdminClient();

		await expect(
			createAdminManagedUser(client, {
				email: 'not-an-email',
				password: 'short',
				fullName: 'Test User',
				roleNames: ['operator']
			})
		).rejects.toThrow();
	});

	it('throws and does NOT call createUser if requested role does not exist', async () => {
		const { client, createUserMock } = createMockAdminClient({
			rolesSelectResult: {
				data: [{ id: validRoleId, name: 'operator' }],
				error: null
			}
		});

		await expect(
			createAdminManagedUser(client, {
				email: 'user@firefighters.local',
				password: 'ValidPassword123!',
				fullName: 'Test User',
				roleNames: ['operator', 'non-existent-role']
			})
		).rejects.toThrow(/One or more specified roles do not exist/);

		expect(createUserMock).not.toHaveBeenCalled();
	});

	it('compensates by deleting the auth user if profile creation fails', async () => {
		const { client, createUserMock, deleteUserMock } = createMockAdminClient({
			profileInsertResult: {
				data: null,
				error: { message: 'duplicate key value violates unique constraint' }
			}
		});

		await expect(
			createAdminManagedUser(client, {
				email: 'user@firefighters.local',
				password: 'ValidPassword123!',
				fullName: 'Test User',
				roleNames: ['operator']
			})
		).rejects.toThrow(/Failed to create user profile/);

		expect(createUserMock).toHaveBeenCalled();
		expect(deleteUserMock).toHaveBeenCalledWith(validUserId);
	});

	it('compensates by deleting profile and auth user if role assignment fails', async () => {
		const { client, createUserMock, deleteUserMock, profileDeleteEqMock } = createMockAdminClient({
			userRolesInsertResult: {
				data: null,
				error: { message: 'foreign key constraint violation' }
			}
		});

		await expect(
			createAdminManagedUser(client, {
				email: 'user@firefighters.local',
				password: 'ValidPassword123!',
				fullName: 'Test User',
				roleNames: ['operator']
			})
		).rejects.toThrow(/Failed to assign user roles/);

		expect(createUserMock).toHaveBeenCalled();
		expect(profileDeleteEqMock).toHaveBeenCalledWith('id', validProfileId);
		expect(deleteUserMock).toHaveBeenCalledWith(validUserId);
	});

	it('supports creating a user without any initial roles', async () => {
		const { client } = createMockAdminClient();

		const result = await createAdminManagedUser(client, {
			email: 'noroles@firefighters.local',
			password: 'ValidPassword123!',
			fullName: 'No Roles User',
			roleNames: []
		});

		expect(result.roles).toEqual([]);
		expect(result.profile.email).toBe('noroles@firefighters.local');
	});
});
