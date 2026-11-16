import { describe, it, expect, vi, beforeEach } from 'vitest';
import { load, actions } from './+page.server';
import type { SupabaseClient } from '@supabase/supabase-js';

function actionEvent(signOut: () => Promise<unknown>) {
	const signOutMock = vi.fn(signOut);
	const cookies = {
		getAll: vi.fn(() => [
			{ name: 'sb-127-auth-token', value: 'x' },
			{ name: 'other', value: 'y' }
		]),
		delete: vi.fn()
	};
	const event = {
		// locals.user/profile are null: logout must work for a deactivated user's stale session too.
		locals: {
			user: null,
			profile: null,
			supabase: { auth: { signOut: signOutMock } } as unknown as SupabaseClient
		},
		cookies
	} as unknown as Parameters<typeof actions.default>[0];
	return { event, signOutMock, cookies };
}

describe('/logout +page.server', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('load redirects (303) to /login', async () => {
		const mockEvent = {} as Parameters<typeof load>[0];
		await expect(load(mockEvent)).rejects.toMatchObject({ status: 303, location: '/login' });
	});

	it('calls signOut even when the app treats the user as anonymous, then redirects', async () => {
		const { event, signOutMock, cookies } = actionEvent(async () => ({ error: null }));

		await expect(actions.default(event)).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
		expect(signOutMock).toHaveBeenCalledTimes(1);
		expect(cookies.delete).not.toHaveBeenCalled();
	});

	it('clears Supabase auth cookies locally when signOut returns an error', async () => {
		const { event, cookies } = actionEvent(async () => ({ error: new Error('503') }));

		await expect(actions.default(event)).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
		expect(cookies.delete).toHaveBeenCalledTimes(1);
		expect(cookies.delete).toHaveBeenCalledWith('sb-127-auth-token', { path: '/' });
	});

	it('clears Supabase auth cookies locally when signOut throws', async () => {
		const { event, cookies } = actionEvent(async () => {
			throw new Error('fetch failed');
		});

		await expect(actions.default(event)).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
		expect(cookies.delete).toHaveBeenCalledWith('sb-127-auth-token', { path: '/' });
	});
});
