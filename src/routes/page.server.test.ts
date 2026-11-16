import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as actionsModule from './+page.server';
import { load } from './+page.server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { UserProfile } from '../app';

const user: User = { id: 'u-1', email: 'admin@firefighters.local' } as User;
const profile: UserProfile = {
	id: 'p-1',
	auth_user_id: 'u-1',
	full_name: 'Admin User',
	email: 'admin@firefighters.local',
	status: 'active',
	created_at: new Date().toISOString()
};

function supabaseReturning(result: { data: unknown; error: unknown }) {
	const eq = vi.fn().mockReturnValue({ overrideTypes: vi.fn().mockResolvedValue(result) });
	const from = vi.fn().mockImplementation((table: string) => {
		if (table !== 'user_roles') throw new Error(`Unexpected table: ${table}`);
		return { select: vi.fn().mockReturnValue({ eq }) };
	});
	return { from } as unknown as SupabaseClient;
}

function loadEvent(locals: Record<string, unknown>) {
	return { locals } as unknown as Parameters<typeof load>[0];
}

describe('/ +page.server', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('returns empty user, profile, and roles when unauthenticated', async () => {
		const result = await load(loadEvent({ user: null, profile: null }));
		expect(result).toEqual({ user: null, profile: null, roles: [], rolesError: false });
	});

	it('returns roles when user and profile exist', async () => {
		const supabase = supabaseReturning({
			data: [{ roles: { name: 'operator' } }, { roles: { name: 'admin' } }],
			error: null
		});

		const result = (await load(loadEvent({ user, profile, supabase })))!;
		expect(result.user).toEqual(user);
		expect(result.profile).toEqual(profile);
		expect(result.roles).toEqual(['admin', 'operator']);
		expect(result.rolesError).toBe(false);
	});

	it('handles user with no roles assigned', async () => {
		const supabase = supabaseReturning({ data: [], error: null });
		const result = (await load(loadEvent({ user, profile, supabase })))!;
		expect(result.roles).toEqual([]);
		expect(result.rolesError).toBe(false);
	});

	it('flags rolesError (instead of "no roles") when the roles query fails', async () => {
		const supabase = supabaseReturning({
			data: null,
			error: { message: 'permission denied', code: '42501', details: '', hint: '' }
		});
		const result = (await load(loadEvent({ user, profile, supabase })))!;
		expect(result.roles).toEqual([]);
		expect(result.rolesError).toBe(true);
		expect(console.error).toHaveBeenCalled();
	});

	it('does not define its own logout action (the page posts to /logout)', () => {
		expect('actions' in actionsModule).toBe(false);
	});
});
