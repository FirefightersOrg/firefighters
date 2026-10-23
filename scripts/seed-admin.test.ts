import { describe, it, expect, vi, beforeEach } from 'vitest';
import { seedAdmin, findExistingUserByEmail } from './seed-admin';
import * as userAdminService from '../src/lib/server/services/user-admin';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('seedAdmin script', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	function createMockSupabase(options?: {
		profileResult?: { id: string; email: string; auth_user_id: string } | null;
		authUsersList?: { id: string; email: string }[];
	}) {
		const maybeSingleMock = vi.fn().mockResolvedValue({
			data: options?.profileResult ?? null,
			error: null
		});

		const fromMock = vi.fn().mockImplementation((table: string) => {
			if (table === 'profiles') {
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							maybeSingle: maybeSingleMock
						})
					})
				};
			}
			throw new Error(`Unexpected table: ${table}`);
		});

		const listUsersMock = vi.fn().mockResolvedValue({
			data: {
				users: options?.authUsersList ?? []
			},
			error: null
		});

		const client = {
			from: fromMock,
			auth: {
				admin: {
					listUsers: listUsersMock
				}
			}
		} as unknown as SupabaseClient;

		return { client, maybeSingleMock, listUsersMock, fromMock };
	}

	describe('findExistingUserByEmail', () => {
		it('returns profile if existing profile is found', async () => {
			const { client } = createMockSupabase({
				profileResult: {
					id: 'profile-1',
					auth_user_id: 'auth-1',
					email: 'admin@firefighters.local'
				}
			});

			const found = await findExistingUserByEmail(client, 'admin@firefighters.local');
			expect(found).toMatchObject({ id: 'profile-1', email: 'admin@firefighters.local' });
		});

		it('returns auth user if profile is not found but auth user exists', async () => {
			const { client } = createMockSupabase({
				profileResult: null,
				authUsersList: [{ id: 'auth-2', email: 'admin@firefighters.local' }]
			});

			const found = await findExistingUserByEmail(client, 'admin@firefighters.local');
			expect(found).toMatchObject({ auth_user_id: 'auth-2', email: 'admin@firefighters.local' });
		});

		it('returns null if neither profile nor auth user exists', async () => {
			const { client } = createMockSupabase({
				profileResult: null,
				authUsersList: []
			});

			const found = await findExistingUserByEmail(client, 'nobody@firefighters.local');
			expect(found).toBeNull();
		});
	});

	describe('seedAdmin idempotency and role provisioning', () => {
		it('skips admin creation if admin user already exists', async () => {
			const { client } = createMockSupabase({
				profileResult: {
					id: 'admin-prof',
					auth_user_id: 'admin-auth',
					email: 'admin@firefighters.local'
				}
			});

			const dummyResult: userAdminService.AdminManagedUserResult = {
				user: { id: 'dummy', email: 'dummy@test.com' },
				profile: {
					id: 'dummy',
					auth_user_id: 'dummy',
					full_name: 'Dummy',
					email: 'dummy@test.com',
					status: 'active',
					created_at: new Date().toISOString()
				},
				roles: []
			};

			const createSpy = vi
				.spyOn(userAdminService, 'createAdminManagedUser')
				.mockResolvedValue(dummyResult);

			const prevEnv = process.env.APP_ENV;
			process.env.APP_ENV = 'production';

			await seedAdmin(client);

			expect(createSpy).not.toHaveBeenCalled();

			process.env.APP_ENV = prevEnv;
		});

		it('creates admin user if not present, and creates local test users in local mode', async () => {
			const { client } = createMockSupabase({
				profileResult: null,
				authUsersList: []
			});

			const dummyResult: userAdminService.AdminManagedUserResult = {
				user: { id: 'dummy', email: 'dummy@test.com' },
				profile: {
					id: 'dummy',
					auth_user_id: 'dummy',
					full_name: 'Dummy',
					email: 'dummy@test.com',
					status: 'active',
					created_at: new Date().toISOString()
				},
				roles: []
			};

			const createSpy = vi
				.spyOn(userAdminService, 'createAdminManagedUser')
				.mockResolvedValue(dummyResult);

			const prevEnv = process.env.APP_ENV;
			process.env.APP_ENV = 'local';

			await seedAdmin(client);

			// Admin + 4 test users (operator, treasurer, collector, read-only) = 5 calls
			expect(createSpy).toHaveBeenCalledTimes(5);

			// First call is admin
			expect(createSpy).toHaveBeenNthCalledWith(
				1,
				client,
				expect.objectContaining({
					email: 'admin@firefighters.local',
					roleNames: ['admin'],
					requestId: 'seed-admin'
				})
			);

			// Operator
			expect(createSpy).toHaveBeenNthCalledWith(
				2,
				client,
				expect.objectContaining({
					email: 'operator@firefighters.local',
					roleNames: ['operator']
				})
			);

			// Treasurer
			expect(createSpy).toHaveBeenNthCalledWith(
				3,
				client,
				expect.objectContaining({
					email: 'treasurer@firefighters.local',
					roleNames: ['treasurer']
				})
			);

			// Collector
			expect(createSpy).toHaveBeenNthCalledWith(
				4,
				client,
				expect.objectContaining({
					email: 'collector@firefighters.local',
					roleNames: ['collector']
				})
			);

			// Read-only
			expect(createSpy).toHaveBeenNthCalledWith(
				5,
				client,
				expect.objectContaining({
					email: 'readonly@firefighters.local',
					roleNames: ['read-only']
				})
			);

			process.env.APP_ENV = prevEnv;
		});
	});
});
