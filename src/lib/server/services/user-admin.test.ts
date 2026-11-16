import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAdminManagedUser, grantRoles, provisionProfile, UserAdminError } from './user-admin';
import type { SupabaseClient } from '@supabase/supabase-js';

const authUserId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const actorId = '44444444-4444-4444-8444-444444444444';

const createdProfile = {
	id: profileId,
	auth_user_id: authUserId,
	full_name: 'New Operator',
	email: 'newuser@firefighters.local',
	status: 'active',
	created_at: '2026-11-16T00:00:00Z'
};

type Result = { data: unknown; error: unknown };

function createMockAdminClient(overrides?: {
	rolesResult?: Result;
	createUserResult?: Result;
	deleteUserResult?: Result | Error;
	rpcResult?: Result | Error;
}) {
	const createUser = vi.fn().mockImplementation(async (params: { email: string }) => {
		return (
			overrides?.createUserResult ?? {
				data: { user: { id: authUserId, email: params.email } },
				error: null
			}
		);
	});
	const deleteUser = vi.fn().mockImplementation(async () => {
		if (overrides?.deleteUserResult instanceof Error) throw overrides.deleteUserResult;
		return overrides?.deleteUserResult ?? { data: {}, error: null };
	});
	const rpc = vi.fn().mockImplementation(async () => {
		if (overrides?.rpcResult instanceof Error) throw overrides.rpcResult;
		return overrides?.rpcResult ?? { data: createdProfile, error: null };
	});
	const rolesIn = vi.fn().mockResolvedValue(
		overrides?.rolesResult ?? {
			data: [{ name: 'operator' }, { name: 'collector' }],
			error: null
		}
	);
	const from = vi.fn().mockImplementation((table: string) => {
		if (table === 'roles') {
			return { select: vi.fn().mockReturnValue({ in: rolesIn }) };
		}
		throw new Error(`Unexpected table: ${table}`);
	});

	const client = {
		from,
		rpc,
		auth: { admin: { createUser, deleteUser } }
	} as unknown as SupabaseClient;

	return { client, createUser, deleteUser, rpc, from, rolesIn };
}

const validInput = {
	email: '  NewUser@Firefighters.local ',
	password: 'StrongPassword123!',
	fullName: 'New Operator',
	roleNames: ['operator', 'collector', 'operator'],
	actorUserId: actorId,
	requestId: 'req-1'
};

describe('createAdminManagedUser', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('creates the auth user, then provisions profile/roles/audit in one RPC', async () => {
		const { client, createUser, rpc, deleteUser } = createMockAdminClient();

		const result = await createAdminManagedUser(client, validInput);

		expect(createUser).toHaveBeenCalledWith({
			email: 'newuser@firefighters.local',
			password: 'StrongPassword123!',
			email_confirm: true,
			user_metadata: { full_name: 'New Operator' }
		});
		expect(rpc).toHaveBeenCalledTimes(1);
		expect(rpc).toHaveBeenCalledWith('admin_provision_profile', {
			p_auth_user_id: authUserId,
			p_full_name: 'New Operator',
			p_role_names: ['collector', 'operator'],
			p_actor_profile_id: actorId,
			p_request_id: 'req-1',
			p_reason: null
		});
		expect(deleteUser).not.toHaveBeenCalled();
		expect(result).toEqual({
			user: { id: authUserId, email: 'newuser@firefighters.local' },
			profile: createdProfile,
			roles: ['collector', 'operator']
		});
	});

	it('rejects unknown roles as validation before creating the auth user', async () => {
		const { client, createUser } = createMockAdminClient({
			rolesResult: { data: [{ name: 'operator' }], error: null }
		});

		await expect(
			createAdminManagedUser(client, { ...validInput, roleNames: ['operator', 'ghost'] })
		).rejects.toMatchObject({ kind: 'validation', message: 'Unknown role(s): ghost' });
		expect(createUser).not.toHaveBeenCalled();
	});

	it('reports a roles query error as internal', async () => {
		const { client, createUser } = createMockAdminClient({
			rolesResult: { data: null, error: { message: 'db down' } }
		});

		await expect(createAdminManagedUser(client, validInput)).rejects.toMatchObject({
			kind: 'internal'
		});
		expect(createUser).not.toHaveBeenCalled();
	});

	it('rejects invalid input as validation', async () => {
		const { client, createUser } = createMockAdminClient();

		await expect(
			createAdminManagedUser(client, { ...validInput, email: 'nope', password: '1' })
		).rejects.toMatchObject({ kind: 'validation' });
		expect(createUser).not.toHaveBeenCalled();
	});

	it('maps an already registered email to conflict', async () => {
		const { client, rpc } = createMockAdminClient({
			createUserResult: {
				data: { user: null },
				error: {
					code: 'email_exists',
					message: 'A user with this email address has already been registered'
				}
			}
		});

		await expect(createAdminManagedUser(client, validInput)).rejects.toMatchObject({
			kind: 'conflict'
		});
		expect(rpc).not.toHaveBeenCalled();
	});

	it('maps a weak password to validation', async () => {
		const { client } = createMockAdminClient({
			createUserResult: { data: { user: null }, error: { code: 'weak_password', message: 'weak' } }
		});

		await expect(createAdminManagedUser(client, validInput)).rejects.toMatchObject({
			kind: 'validation'
		});
	});

	it('maps other auth errors to internal', async () => {
		const { client } = createMockAdminClient({
			createUserResult: { data: { user: null }, error: { message: 'auth down' } }
		});

		await expect(createAdminManagedUser(client, validInput)).rejects.toMatchObject({
			kind: 'internal'
		});
	});

	it('deletes the auth user when the provisioning RPC fails', async () => {
		const { client, deleteUser } = createMockAdminClient({
			rpcResult: { data: null, error: { code: 'XX000', message: 'boom' } }
		});

		const err = await createAdminManagedUser(client, validInput).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(UserAdminError);
		expect(err).toMatchObject({ kind: 'internal', orphanedAuthUserId: undefined });
		expect(deleteUser).toHaveBeenCalledWith(authUserId);
	});

	it('deletes the auth user when the provisioning RPC throws', async () => {
		const { client, deleteUser } = createMockAdminClient({ rpcResult: new Error('network') });

		await expect(createAdminManagedUser(client, validInput)).rejects.toMatchObject({
			kind: 'internal'
		});
		expect(deleteUser).toHaveBeenCalledWith(authUserId);
	});

	it('maps a unique violation from the RPC to conflict (after compensating)', async () => {
		const { client, deleteUser } = createMockAdminClient({
			rpcResult: { data: null, error: { code: '23505', message: 'duplicate key' } }
		});

		await expect(createAdminManagedUser(client, validInput)).rejects.toMatchObject({
			kind: 'conflict'
		});
		expect(deleteUser).toHaveBeenCalledWith(authUserId);
	});

	it('detects a compensation failure returned as { error } and reports the orphan', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { client } = createMockAdminClient({
			rpcResult: { data: null, error: { code: 'XX000', message: 'boom' } },
			deleteUserResult: { data: null, error: { message: 'delete failed' } }
		});

		const err = await createAdminManagedUser(client, validInput).catch((e: unknown) => e);
		expect(err).toMatchObject({ kind: 'internal', orphanedAuthUserId: authUserId });
		expect((err as Error).message).toContain('could not be deleted');
		expect(consoleError).toHaveBeenCalledWith(
			expect.stringContaining('compensation failed'),
			expect.objectContaining({ authUserId })
		);
	});

	it('detects a compensation failure thrown by deleteUser', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { client } = createMockAdminClient({
			rpcResult: { data: null, error: { code: '22023', message: 'unknown role(s): x' } },
			deleteUserResult: new Error('network')
		});

		await expect(createAdminManagedUser(client, validInput)).rejects.toMatchObject({
			kind: 'validation',
			orphanedAuthUserId: authUserId
		});
	});
});

describe('provisionProfile / grantRoles', () => {
	it('provisionProfile maps 22023 to validation', async () => {
		const { client } = createMockAdminClient({
			rpcResult: { data: null, error: { code: '22023', message: 'unknown role(s): x' } }
		});

		await expect(
			provisionProfile(client, { authUserId, fullName: 'X', roleNames: ['x'] })
		).rejects.toMatchObject({ kind: 'validation', message: 'unknown role(s): x' });
	});

	it('provisionProfile treats an empty result as internal', async () => {
		const { client } = createMockAdminClient({ rpcResult: { data: null, error: null } });

		await expect(
			provisionProfile(client, { authUserId, fullName: 'X', roleNames: [] })
		).rejects.toMatchObject({ kind: 'internal' });
	});

	it('grantRoles returns the newly granted role names', async () => {
		const { client, rpc } = createMockAdminClient({ rpcResult: { data: ['admin'], error: null } });

		await expect(
			grantRoles(client, { profileId, roleNames: ['admin'], requestId: 'r' })
		).resolves.toEqual(['admin']);
		expect(rpc).toHaveBeenCalledWith('admin_grant_roles', {
			p_profile_id: profileId,
			p_role_names: ['admin'],
			p_actor_profile_id: null,
			p_request_id: 'r',
			p_reason: null
		});
	});

	it('grantRoles surfaces RPC errors', async () => {
		const { client } = createMockAdminClient({
			rpcResult: { data: null, error: { code: 'P0002', message: 'profile not found' } }
		});

		await expect(grantRoles(client, { profileId, roleNames: ['admin'] })).rejects.toMatchObject({
			kind: 'internal'
		});
	});
});
