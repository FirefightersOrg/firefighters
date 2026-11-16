import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { endSession } from './session';

function mockCookies(names: string[]) {
	return {
		getAll: vi.fn(() => names.map((name) => ({ name, value: 'x' }))),
		delete: vi.fn()
	};
}

function mockSupabase(signOut: () => Promise<unknown>) {
	return { auth: { signOut: vi.fn(signOut) } } as unknown as SupabaseClient;
}

const COOKIE_NAMES = [
	'sb-127-auth-token',
	'sb-127-auth-token.0',
	'sb-127-auth-token.1',
	'sb-127-auth-token-code-verifier',
	'theme'
];

describe('endSession', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('returns true and leaves cookie handling to Supabase when signOut succeeds', async () => {
		const cookies = mockCookies(COOKIE_NAMES);
		const supabase = mockSupabase(async () => ({ error: null }));

		await expect(endSession(supabase, cookies as unknown as Cookies)).resolves.toBe(true);
		expect(cookies.delete).not.toHaveBeenCalled();
	});

	it('deletes Supabase auth cookies when signOut returns an error', async () => {
		const cookies = mockCookies(COOKIE_NAMES);
		const supabase = mockSupabase(async () => ({ error: new Error('503') }));

		await expect(endSession(supabase, cookies as unknown as Cookies)).resolves.toBe(false);
		expect(cookies.delete.mock.calls.map(([name]) => name)).toEqual(COOKIE_NAMES.slice(0, 4));
		expect(cookies.delete).toHaveBeenCalledWith('sb-127-auth-token', { path: '/' });
		expect(console.error).toHaveBeenCalled();
	});

	it('deletes Supabase auth cookies and does not throw when signOut throws', async () => {
		const cookies = mockCookies(COOKIE_NAMES);
		const supabase = mockSupabase(async () => {
			throw new Error('fetch failed');
		});

		await expect(endSession(supabase, cookies as unknown as Cookies)).resolves.toBe(false);
		expect(cookies.delete).toHaveBeenCalledTimes(4);
	});
});
