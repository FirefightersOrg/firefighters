import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	checkPermission,
	hasPermission,
	hasPermissionForUser,
	hasPermissionIn,
	getUserPermissions,
	permissionsUnavailable,
	requirePermission,
	requirePermissionIn
} from './permissions';
import { PERMISSIONS, type PermissionCode } from './permission-codes';
import type { SupabaseClient } from '@supabase/supabase-js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	consoleErrorSpy.mockRestore();
});

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
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining('has_permission RPC failed'),
			expect.objectContaining({ permission_code: 'campaign.view' })
		);
	});

	it('fails closed (returns false) when RPC throws', async () => {
		const client = createMockSupabase(async () => {
			throw new Error('Network failure');
		});

		const result = await hasPermission(client, 'campaign.view');
		expect(result).toBe(false);
		expect(consoleErrorSpy).toHaveBeenCalled();
	});

	it('fails closed (returns false) when permissionCode is empty', async () => {
		const client = createMockSupabase();
		const result = await hasPermission(client, '' as PermissionCode);
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
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining('has_permission_for_user RPC failed'),
			expect.objectContaining({ p_auth_user_id: testUserId })
		);
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

	it('returns an empty array when the user holds no permissions', async () => {
		const client = createMockSupabase(async () => ({ data: [], error: null }));

		expect(await getUserPermissions(client)).toEqual([]);
		expect(consoleErrorSpy).not.toHaveBeenCalled();
	});

	it('returns null (load failed) and logs on RPC error', async () => {
		const client = createMockSupabase(async () => {
			return { data: null, error: { message: 'auth required' } };
		});

		const permissions = await getUserPermissions(client);
		expect(permissions).toBeNull();
		expect(consoleErrorSpy).toHaveBeenCalled();
	});

	it('returns null (load failed) and logs when the RPC response is not an array', async () => {
		for (const data of [null, 'campaign.view', { code: 'campaign.view' }]) {
			consoleErrorSpy.mockClear();
			const client = createMockSupabase(async () => ({ data, error: null }));

			expect(await getUserPermissions(client)).toBeNull();
			expect(consoleErrorSpy).toHaveBeenCalled();
		}
	});

	it('returns null (load failed) and logs when the RPC throws', async () => {
		const client = createMockSupabase(async () => {
			throw new Error('Timeout');
		});

		const permissions = await getUserPermissions(client);
		expect(permissions).toBeNull();
		expect(consoleErrorSpy).toHaveBeenCalled();
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

	it('throws HttpError 500 (not 403) when the RPC errors, still failing closed', async () => {
		const client = createMockSupabase(async () => ({
			data: null,
			error: { message: 'network error' }
		}));

		await expect(requirePermission(client, 'user.manage')).rejects.toMatchObject({
			status: 500,
			body: {
				message: 'No se pudo verificar el permiso. Volver a intentar.',
				code: 'permission_check_failed',
				permission: 'user.manage'
			}
		});
		expect(consoleErrorSpy).toHaveBeenCalled();
	});

	it('throws HttpError 500 when the RPC throws', async () => {
		const client = createMockSupabase(async () => {
			throw new Error('ECONNREFUSED');
		});

		await expect(requirePermission(client, 'user.manage')).rejects.toMatchObject({ status: 500 });
	});
});

describe('checkPermission', () => {
	it('distinguishes granted, denied and error', async () => {
		expect(
			await checkPermission(
				createMockSupabase(async () => ({ data: true, error: null })),
				'bond.view'
			)
		).toBe('granted');
		expect(
			await checkPermission(
				createMockSupabase(async () => ({ data: false, error: null })),
				'bond.view'
			)
		).toBe('denied');
		expect(
			await checkPermission(
				createMockSupabase(async () => ({ data: null, error: { message: 'boom' } })),
				'bond.view'
			)
		).toBe('error');
	});
});

describe('request-scoped checks (hasPermissionIn / requirePermissionIn)', () => {
	const permissions = ['campaign.view', 'bond.view'];

	it('checks membership without any RPC', () => {
		expect(hasPermissionIn(permissions, 'campaign.view')).toBe(true);
		expect(hasPermissionIn(permissions, 'user.manage')).toBe(false);
	});

	it('fails closed on a missing list', () => {
		expect(hasPermissionIn(undefined, 'campaign.view')).toBe(false);
		expect(hasPermissionIn(null, 'campaign.view')).toBe(false);
		expect(hasPermissionIn([], 'campaign.view')).toBe(false);
	});

	it('requirePermissionIn throws 403 with structured body when absent', () => {
		expect(() => requirePermissionIn(permissions, 'campaign.view')).not.toThrow();
		try {
			requirePermissionIn(permissions, 'user.manage');
			expect.fail('Should have thrown');
		} catch (err) {
			expect(err).toMatchObject({
				status: 403,
				body: { message: 'Forbidden', code: 'permission_denied', permission: 'user.manage' }
			});
		}
	});

	it('requirePermissionIn throws 403 for an empty or missing list (no permissions)', () => {
		for (const list of [[], undefined]) {
			expect(() => requirePermissionIn(list, 'campaign.view')).toThrow(
				expect.objectContaining({
					status: 403,
					body: { message: 'Forbidden', code: 'permission_denied', permission: 'campaign.view' }
				})
			);
		}
	});

	it('requirePermissionIn throws 500 when the list could not be loaded (null)', () => {
		try {
			requirePermissionIn(null, 'campaign.view');
			expect.fail('Should have thrown');
		} catch (err) {
			expect(err).toMatchObject({
				status: 500,
				body: {
					message: 'No se pudo verificar el permiso. Volver a intentar.',
					code: 'permission_check_failed',
					permission: 'campaign.view'
				}
			});
		}
	});

	it('permissionsUnavailable is true only for null', () => {
		expect(permissionsUnavailable(null)).toBe(true);
		expect(permissionsUnavailable(undefined)).toBe(false);
		expect(permissionsUnavailable([])).toBe(false);
		expect(permissionsUnavailable(permissions)).toBe(false);
	});
});

describe('canonical permission codes', () => {
	it('defines exactly 56 unique permission codes', () => {
		expect(PERMISSIONS.length).toBe(56);
		const unique = new Set(PERMISSIONS);
		expect(unique.size).toBe(56);
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

	it('matches the permission codes seeded by the SQL migrations (drift check)', () => {
		// Parses every `insert into public.permissions (...) values (...)` statement in
		// supabase/migrations, so adding/renaming a permission in SQL without updating
		// PERMISSIONS (or vice versa) fails `pnpm test` without needing a database.
		// If a future migration deletes or renames a code, extend this parser accordingly.
		const migrationsDir = fileURLToPath(
			new URL('../../../../supabase/migrations/', import.meta.url)
		);
		const seeded = new Set<string>();
		for (const file of readdirSync(migrationsDir)
			.filter((f) => f.endsWith('.sql'))
			.sort()) {
			const sql = readFileSync(`${migrationsDir}${file}`, 'utf8');
			const inserts = sql.matchAll(
				/insert\s+into\s+public\.permissions\s*\(\s*code\b[^)]*\)\s*values([\s\S]*?);/gi
			);
			for (const [, values] of inserts) {
				for (const [, code] of values.matchAll(/\(\s*'([^']+)'/g)) {
					seeded.add(code);
				}
			}
		}

		expect(seeded.size).toBeGreaterThan(0);
		expect([...PERMISSIONS].sort()).toEqual([...seeded].sort());
	});
});
