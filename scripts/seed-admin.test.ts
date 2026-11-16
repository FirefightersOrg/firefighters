import { describe, it, expect, vi, beforeEach } from 'vitest';
import { seedAdmin, findAuthUserByEmail, resolveSeedConfig, ensureUser } from './seed-admin';
import * as userAdminService from '../src/lib/server/services/user-admin';
import type { SupabaseClient } from '@supabase/supabase-js';

const localEnv = {
	APP_ENV: 'local',
	PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321'
};

const prodEnv = {
	APP_ENV: 'production',
	PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
	SUPABASE_SERVICE_ROLE_KEY: 'key',
	INITIAL_ADMIN_EMAIL: 'Chief@Example.org',
	INITIAL_ADMIN_PASSWORD: 'a-real-secret'
};

describe('resolveSeedConfig', () => {
	it('uses local defaults and fixtures only when APP_ENV=local and the URL is local', () => {
		const config = resolveSeedConfig(localEnv);
		expect(config.admin).toMatchObject({
			email: 'admin@firefighters.local',
			password: 'Admin123456!',
			roleNames: ['admin']
		});
		expect(config.fixtures.map((f) => f.roleNames[0])).toEqual([
			'operator',
			'treasurer',
			'collector',
			'read-only'
		]);
		expect(config.fixtures.every((f) => f.password === 'LocalDev123456!')).toBe(true);
	});

	it('accepts localhost as a local URL and honours TEST_USER_PASSWORD', () => {
		const config = resolveSeedConfig({
			...localEnv,
			PUBLIC_SUPABASE_URL: 'http://localhost:54321',
			TEST_USER_PASSWORD: 'other-password'
		});
		expect(config.fixtures[0].password).toBe('other-password');
	});

	it('fails when APP_ENV is unset and no admin password is given', () => {
		expect(() =>
			resolveSeedConfig({
				PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
				INITIAL_ADMIN_EMAIL: 'chief@example.org'
			})
		).toThrow(/INITIAL_ADMIN_PASSWORD is required/);
	});

	it('fails outside local without an admin email or Supabase URL', () => {
		expect(() => resolveSeedConfig({ ...prodEnv, INITIAL_ADMIN_EMAIL: '' })).toThrow(
			/INITIAL_ADMIN_EMAIL is required/
		);
		expect(() => resolveSeedConfig({ ...prodEnv, PUBLIC_SUPABASE_URL: undefined })).toThrow(
			/PUBLIC_SUPABASE_URL is required/
		);
	});

	it('never creates fixtures outside local', () => {
		const config = resolveSeedConfig(prodEnv);
		expect(config.fixtures).toEqual([]);
		expect(config.admin).toMatchObject({
			email: 'chief@example.org',
			password: 'a-real-secret'
		});
	});

	it('refuses APP_ENV=local against a non-local Supabase URL', () => {
		expect(() =>
			resolveSeedConfig({ ...localEnv, PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' })
		).toThrow(/not localhost/);
	});
});

function createMockClient(options?: {
	profiles?: Record<string, { id: string; status: string }>;
	profileError?: { message: string };
	authPages?: { id: string; email: string }[][];
	listError?: { message: string };
}) {
	const maybeSingle = vi.fn();
	const eq = vi.fn().mockImplementation((_col: string, email: string) => {
		maybeSingle.mockResolvedValueOnce({
			data: options?.profiles?.[email] ?? null,
			error: options?.profileError ?? null
		});
		return { maybeSingle };
	});
	const from = vi.fn().mockImplementation((table: string) => {
		if (table === 'profiles') return { select: vi.fn().mockReturnValue({ eq }) };
		throw new Error(`Unexpected table: ${table}`);
	});
	const listUsers = vi.fn().mockImplementation(async ({ page }: { page: number }) => {
		if (options?.listError) return { data: { users: [] }, error: options.listError };
		return { data: { users: options?.authPages?.[page - 1] ?? [] }, error: null };
	});

	const client = { from, auth: { admin: { listUsers } } } as unknown as SupabaseClient;
	return { client, listUsers, eq };
}

describe('findAuthUserByEmail', () => {
	it('pages through listUsers until it finds the email', async () => {
		const { client, listUsers } = createMockClient({
			authPages: [
				[
					{ id: 'a', email: 'a@x.org' },
					{ id: 'b', email: 'b@x.org' }
				],
				[
					{ id: 'c', email: 'c@x.org' },
					{ id: 'd', email: 'Admin@X.org' }
				],
				[]
			]
		});

		const found = await findAuthUserByEmail(client, 'admin@x.org', 2);
		expect(found).toMatchObject({ id: 'd' });
		expect(listUsers).toHaveBeenCalledTimes(2);
		expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 2 });
	});

	it('stops at the first short page and returns null', async () => {
		const { client, listUsers } = createMockClient({
			authPages: [
				[
					{ id: 'a', email: 'a@x.org' },
					{ id: 'b', email: 'b@x.org' }
				],
				[{ id: 'c', email: 'c@x.org' }]
			]
		});

		await expect(findAuthUserByEmail(client, 'nobody@x.org', 2)).resolves.toBeNull();
		expect(listUsers).toHaveBeenCalledTimes(2);
	});

	it('throws on a listUsers error', async () => {
		const { client } = createMockClient({ listError: { message: 'nope' } });
		await expect(findAuthUserByEmail(client, 'a@x.org')).rejects.toThrow(/Failed to list/);
	});
});

describe('ensureUser', () => {
	const user = {
		email: 'admin@firefighters.local',
		password: 'pw-123456',
		fullName: 'Admin',
		roleNames: ['admin']
	};

	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	it('reports an existing, complete user without changes', async () => {
		const { client } = createMockClient({
			profiles: { 'admin@firefighters.local': { id: 'p1', status: 'active' } }
		});
		const grant = vi.spyOn(userAdminService, 'grantRoles').mockResolvedValue([]);
		const create = vi.spyOn(userAdminService, 'createAdminManagedUser');

		await expect(ensureUser(client, user, 'seed-admin')).resolves.toBe('existing');
		expect(grant).toHaveBeenCalledWith(
			client,
			expect.objectContaining({ profileId: 'p1', roleNames: ['admin'], actorUserId: null })
		);
		expect(create).not.toHaveBeenCalled();
	});

	it('repairs a profile that is missing the admin role', async () => {
		const { client } = createMockClient({
			profiles: { 'admin@firefighters.local': { id: 'p1', status: 'active' } }
		});
		vi.spyOn(userAdminService, 'grantRoles').mockResolvedValue(['admin']);

		await expect(ensureUser(client, user, 'seed-admin')).resolves.toBe('repaired');
	});

	it('provisions a profile for an auth user that has none', async () => {
		const { client } = createMockClient({
			authPages: [[{ id: 'auth-1', email: 'admin@firefighters.local' }]]
		});
		const provision = vi.spyOn(userAdminService, 'provisionProfile').mockResolvedValue({} as never);
		const create = vi.spyOn(userAdminService, 'createAdminManagedUser');

		await expect(ensureUser(client, user, 'seed-admin')).resolves.toBe('repaired');
		expect(provision).toHaveBeenCalledWith(
			client,
			expect.objectContaining({ authUserId: 'auth-1', roleNames: ['admin'] })
		);
		expect(create).not.toHaveBeenCalled();
	});

	it('creates the user when nothing exists', async () => {
		const { client } = createMockClient();
		const create = vi
			.spyOn(userAdminService, 'createAdminManagedUser')
			.mockResolvedValue({} as never);

		await expect(ensureUser(client, user, 'seed-admin')).resolves.toBe('created');
		expect(create).toHaveBeenCalledWith(
			client,
			expect.objectContaining({
				email: 'admin@firefighters.local',
				password: 'pw-123456',
				roleNames: ['admin'],
				actorUserId: null,
				requestId: 'seed-admin'
			})
		);
	});

	it('throws on a profile lookup error instead of treating it as missing', async () => {
		const { client } = createMockClient({ profileError: { message: 'db down' } });
		const create = vi.spyOn(userAdminService, 'createAdminManagedUser');

		await expect(ensureUser(client, user, 'seed-admin')).rejects.toThrow(/db down/);
		expect(create).not.toHaveBeenCalled();
	});
});

describe('seedAdmin', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	it('ensures the admin and the 4 fixture users in local mode', async () => {
		const { client } = createMockClient();
		const create = vi
			.spyOn(userAdminService, 'createAdminManagedUser')
			.mockResolvedValue({} as never);

		const outcomes = await seedAdmin(client, localEnv);

		expect(create).toHaveBeenCalledTimes(5);
		expect(create.mock.calls.map(([, input]) => input.roleNames)).toEqual([
			['admin'],
			['operator'],
			['treasurer'],
			['collector'],
			['read-only']
		]);
		expect(Object.values(outcomes)).toEqual(Array(5).fill('created'));
	});

	it('only ensures the admin outside local', async () => {
		const { client } = createMockClient();
		const create = vi
			.spyOn(userAdminService, 'createAdminManagedUser')
			.mockResolvedValue({} as never);

		await seedAdmin(client, prodEnv);

		expect(create).toHaveBeenCalledTimes(1);
		expect(create).toHaveBeenCalledWith(
			client,
			expect.objectContaining({ email: 'chief@example.org', password: 'a-real-secret' })
		);
	});

	it('does nothing when the configuration is unsafe', async () => {
		const { client } = createMockClient();
		const create = vi.spyOn(userAdminService, 'createAdminManagedUser');

		await expect(
			seedAdmin(client, { PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' })
		).rejects.toThrow();
		expect(create).not.toHaveBeenCalled();
	});
});
