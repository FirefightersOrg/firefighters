import { describe, it, expect, vi } from 'vitest';
import {
	hasPermission,
	hasPermissionForUser,
	getUserPermissions,
	requirePermission
} from './permissions';
import { PERMISSIONS } from './permission-codes';
import type { SupabaseClient } from '@supabase/supabase-js';

function createMockSupabase(
	rpcHandler?: (
		fn: string,
		args?: Record<string, unknown>
	) => Promise<{ data: unknown; error: unknown }>
) {
	return {
		rpc: vi.fn().mockImplementation((fn: string, args?: Record<string, unknown>) => {
			if (rpcHandler) {
				return rpcHandler(fn, args);
			}
			return Promise.resolve({ data: null, error: null });
		})
	} as unknown as SupabaseClient;
}

describe('hasPermission', () => {
	it('returns true when RPC returns true', async () => {
		const client = createMockSupabase(async (fn, args) => {
			expect(fn).toBe('has_permission');
			expect(args).toEqual({ permission_code: 'campaign.view' });
			return { data: true, error: null };
		});

		const result = await hasPermission(client, 'campaign.view');
		expect(result).toBe(true);
	});

	it('returns false when RPC returns false', async () => {
		const client = createMockSupabase(async () => {
			return { data: false, error: null };
		});

		const result = await hasPermission(client, 'user.manage');
		expect(result).toBe(false);
	});

	it('fails closed (returns false) on RPC error', async () => {
		const client = createMockSupabase(async () => {
			return { data: null, error: { message: 'Database connection error', code: '500' } };
		});

		const result = await hasPermission(client, 'campaign.view');
		expect(result).toBe(false);
	});

	it('fails closed (returns false) when RPC throws', async () => {
		const client = createMockSupabase(async () => {
			throw new Error('Network failure');
		});

		const result = await hasPermission(client, 'campaign.view');
		expect(result).toBe(false);
	});

	it('fails closed (returns false) when permissionCode is empty', async () => {
		const client = createMockSupabase();
		const result = await hasPermission(client, '');
		expect(result).toBe(false);
		expect(client.rpc).not.toHaveBeenCalled();
	});
});

describe('hasPermissionForUser', () => {
	const testUserId = '11111111-1111-4111-8111-111111111111';

	it('calls has_permission_for_user with p_auth_user_id and permission_code', async () => {
		const client = createMockSupabase(async (fn, args) => {
			expect(fn).toBe('has_permission_for_user');
			expect(args).toEqual({
				p_auth_user_id: testUserId,
				permission_code: 'user.manage'
			});
			return { data: true, error: null };
		});

		const result = await hasPermissionForUser(client, testUserId, 'user.manage');
		expect(result).toBe(true);
	});

	it('returns false when RPC returns false', async () => {
		const client = createMockSupabase(async () => {
			return { data: false, error: null };
		});

		const result = await hasPermissionForUser(client, testUserId, 'payment.annul');
		expect(result).toBe(false);
	});

	it('fails closed when RPC returns an error or throws', async () => {
		const client = createMockSupabase(async () => {
			return { data: null, error: { message: 'permission denied', code: '42501' } };
		});

		const result = await hasPermissionForUser(client, testUserId, 'user.manage');
		expect(result).toBe(false);
	});

	it('fails closed when authUserId is missing', async () => {
		const client = createMockSupabase();
		const result = await hasPermissionForUser(client, '', 'user.manage');
		expect(result).toBe(false);
		expect(client.rpc).not.toHaveBeenCalled();
	});
});

describe('getUserPermissions', () => {
	it('returns permission string array from my_permissions RPC', async () => {
		const expectedPermissions = ['campaign.view', 'bond.view', 'buyer.view'];
		const client = createMockSupabase(async (fn) => {
			expect(fn).toBe('my_permissions');
			return { data: expectedPermissions, error: null };
		});

		const permissions = await getUserPermissions(client);
		expect(permissions).toEqual(expectedPermissions);
	});

	it('fails closed (returns empty array) on RPC error', async () => {
		const client = createMockSupabase(async () => {
			return { data: null, error: { message: 'auth required' } };
		});

		const permissions = await getUserPermissions(client);
		expect(permissions).toEqual([]);
	});

	it('fails closed (returns empty array) when RPC response is not an array', async () => {
		const client = createMockSupabase(async () => {
			return { data: null, error: null };
		});

		const permissions = await getUserPermissions(client);
		expect(permissions).toEqual([]);
	});

	it('fails closed (returns empty array) when RPC throws', async () => {
		const client = createMockSupabase(async () => {
			throw new Error('Timeout');
		});

		const permissions = await getUserPermissions(client);
		expect(permissions).toEqual([]);
	});
});

describe('requirePermission', () => {
	it('resolves without error when user holds the permission', async () => {
		const client = createMockSupabase(async () => ({ data: true, error: null }));

		await expect(requirePermission(client, 'user.manage')).resolves.toBeUndefined();
	});

	it('throws HttpError 403 with structured body when permission is missing', async () => {
		const client = createMockSupabase(async () => ({ data: false, error: null }));

		try {
			await requirePermission(client, 'user.manage');
			expect.fail('Should have thrown');
		} catch (err) {
			const httpError = err as {
				status?: number;
				body?: { message?: string; code?: string; permission?: string };
			};
			expect(httpError.status).toBe(403);
			expect(httpError.body).toEqual({
				message: 'Forbidden',
				code: 'permission_denied',
				permission: 'user.manage'
			});
		}
	});

	it('throws HttpError 403 when RPC errors (fail-closed requirement)', async () => {
		const client = createMockSupabase(async () => ({
			data: null,
			error: { message: 'network error' }
		}));

		try {
			await requirePermission(client, 'user.manage');
			expect.fail('Should have thrown');
		} catch (err) {
			const httpError = err as {
				status?: number;
				body?: { message?: string; code?: string; permission?: string };
			};
			expect(httpError.status).toBe(403);
			expect(httpError.body?.code).toBe('permission_denied');
		}
	});
});

describe('canonical permission codes', () => {
	it('defines exactly 44 unique permission codes', () => {
		expect(PERMISSIONS.length).toBe(44);
		const unique = new Set(PERMISSIONS);
		expect(unique.size).toBe(44);
	});

	it('includes core administrative and operational permissions', () => {
		expect(PERMISSIONS).toContain('user.manage');
		expect(PERMISSIONS).toContain('audit.view');
		expect(PERMISSIONS).toContain('campaign.view');
		expect(PERMISSIONS).toContain('bond.create');
		expect(PERMISSIONS).toContain('draw.freeze_roster');
		expect(PERMISSIONS).toContain('settlement.close');
		expect(PERMISSIONS).not.toContain('role.manage'); // D1: no role.manage
	});
});
