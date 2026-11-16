import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listRoleNamesForProfile } from './user-roles';

function mockSupabase(result: { data: unknown; error: unknown }) {
	const eq = vi.fn().mockReturnValue({ overrideTypes: vi.fn().mockResolvedValue(result) });
	const select = vi.fn().mockReturnValue({ eq });
	const from = vi.fn().mockReturnValue({ select });
	return { client: { from } as unknown as SupabaseClient, from, select, eq };
}

describe('listRoleNamesForProfile', () => {
	it('queries user_roles for the profile and flattens embedded role names', async () => {
		const { client, from, select, eq } = mockSupabase({
			data: [
				{ roles: { name: 'operator' } },
				{ roles: [{ name: 'admin' }] },
				{ roles: null },
				{ roles: { name: 'admin' } }
			],
			error: null
		});

		await expect(listRoleNamesForProfile(client, 'p-1')).resolves.toEqual({
			data: ['admin', 'operator'],
			error: null
		});
		expect(from).toHaveBeenCalledWith('user_roles');
		expect(select).toHaveBeenCalledWith('roles(name)');
		expect(eq).toHaveBeenCalledWith('user_id', 'p-1');
	});

	it('returns an empty list when the profile has no roles', async () => {
		const { client } = mockSupabase({ data: [], error: null });
		await expect(listRoleNamesForProfile(client, 'p-1')).resolves.toEqual({
			data: [],
			error: null
		});
	});

	it('returns the error instead of an empty list when the query fails', async () => {
		const pgError = { message: 'permission denied', code: '42501', details: '', hint: '' };
		const { client } = mockSupabase({ data: null, error: pgError });
		await expect(listRoleNamesForProfile(client, 'p-1')).resolves.toEqual({
			data: null,
			error: pgError
		});
	});
});
