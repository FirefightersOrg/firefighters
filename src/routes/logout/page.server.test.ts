import { describe, it, expect, vi } from 'vitest';
import { load, actions } from './+page.server';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('/logout +page.server', () => {
	it('load redirects (303) to /login', async () => {
		const mockEvent = {} as Parameters<typeof load>[0];
		await expect(load(mockEvent)).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
	});

	it('default action calls supabase signOut and redirects (303) to /login', async () => {
		const signOutMock = vi.fn().mockResolvedValue({ error: null });
		const mockEvent = {
			locals: {
				supabase: {
					auth: {
						signOut: signOutMock
					}
				} as unknown as SupabaseClient
			}
		} as unknown as Parameters<typeof actions.default>[0];

		await expect(actions.default(mockEvent)).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
		expect(signOutMock).toHaveBeenCalledTimes(1);
	});
});
