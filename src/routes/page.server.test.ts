import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as actionsModule from './+page.server';
import { isRedirect } from '@sveltejs/kit';
import { _staffLandingPath, load } from './+page.server';
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

describe('/ +page.server: where a signed-in person lands', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	/** A client whose `campaigns` query answers `result`; any other table is unexpected. */
	function campaignsReturning(result: { data: unknown; error: unknown }) {
		const limit = vi.fn().mockResolvedValue(result);
		const eq = vi.fn().mockReturnValue({ limit });
		const select = vi.fn().mockReturnValue({ eq });
		const from = vi.fn().mockImplementation((table: string) => {
			if (table !== 'campaigns') throw new Error(`Unexpected table: ${table}`);
			return { select };
		});
		return { client: { from } as unknown as SupabaseClient, select, eq, limit };
	}
	async function landing(locals: Record<string, unknown>) {
		try {
			await load(loadEvent({ user, profile, ...locals }));
		} catch (err) {
			if (isRedirect(err)) return { status: err.status, location: err.location };
			throw err;
		}
		return null;
	}
	const STAFF = ['campaign.view', 'bond.view'];

	it('goes to the campaign when exactly one is active', async () => {
		const { client, eq, limit } = campaignsReturning({ data: [{ id: 'c-1' }], error: null });
		expect(await landing({ permissions: STAFF, supabase: client })).toEqual({
			status: 303,
			location: '/campaigns/c-1'
		});
		expect(eq).toHaveBeenCalledWith('status', 'active');
		// Two rows are enough to know whether there is exactly one.
		expect(limit).toHaveBeenCalledWith(2);
	});

	it('goes to the list when there is no active campaign, or more than one', async () => {
		for (const data of [[], [{ id: 'c-1' }, { id: 'c-2' }]]) {
			const { client } = campaignsReturning({ data, error: null });
			expect(await landing({ permissions: STAFF, supabase: client })).toEqual({
				status: 303,
				location: '/campaigns'
			});
		}
	});

	it('goes to the list when the lookup fails, and logs it', async () => {
		const { client } = campaignsReturning({ data: null, error: { message: 'boom' } });
		expect(await landing({ permissions: STAFF, supabase: client, requestId: 'r-1' })).toEqual({
			status: 303,
			location: '/campaigns'
		});
		expect(console.error).toHaveBeenCalled();
	});

	it('still sends a collector with own-scope access to the portal, without asking for campaigns', async () => {
		const { client, select } = campaignsReturning({ data: [{ id: 'c-1' }], error: null });
		expect(
			await landing({ permissions: ['campaign.view', 'bond.view_own'], supabase: client })
		).toEqual({ status: 303, location: '/portal' });
		expect(select).not.toHaveBeenCalled();
	});

	it('keeps the session page for whoever cannot open campaigns', async () => {
		const supabase = supabaseReturning({ data: [], error: null });
		expect(await landing({ permissions: [], supabase })).toBeNull();
	});

	it('_staffLandingPath: one active campaign, or the list', () => {
		expect(_staffLandingPath(['a'])).toBe('/campaigns/a');
		expect(_staffLandingPath([])).toBe('/campaigns');
		expect(_staffLandingPath(['a', 'b'])).toBe('/campaigns');
	});
});
