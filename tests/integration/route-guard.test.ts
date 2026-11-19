import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { handle } from '../../src/hooks.server';
import { createSupabaseServerClient } from '$lib/supabase/server';
import { createAdminManagedUser } from '$lib/server/services/user-admin';
import { findAuthUserByEmail } from '../../scripts/seed-admin';

// Route code under test reads $env/dynamic/*. Build those modules from the same resolved env the
// test's own clients use (tests/integration/global-setup.ts), so both sides share credentials.
vi.mock('$env/dynamic/private', async () => {
	const { inject } = await import('vitest');
	const env = inject('integrationEnv');
	return { env: { SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey, APP_ENV: 'local' } };
});
vi.mock('$env/dynamic/public', async () => {
	const { inject } = await import('vitest');
	const env = inject('integrationEnv');
	return { env: { PUBLIC_SUPABASE_URL: env.supabaseUrl, PUBLIC_SUPABASE_ANON_KEY: env.anonKey } };
});

const { supabaseUrl, anonKey, serviceRoleKey } = inject('integrationEnv');
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };

/** In-memory browser cookie jar implementing the parts of SvelteKit's `Cookies` the app uses. */
function createCookieJar() {
	const jar = new Map<string, string>();
	const cookies = {
		get: (name: string) => jar.get(name),
		getAll: () => [...jar].map(([name, value]) => ({ name, value })),
		set: (name: string, value: string, options?: { maxAge?: number }) => {
			if (value === '' || options?.maxAge === 0) jar.delete(name);
			else jar.set(name, value);
		},
		delete: (name: string) => {
			jar.delete(name);
		}
	};
	return { jar, cookies: cookies as unknown as Cookies };
}

function requestEvent(cookies: Cookies, path: string, method = 'GET'): RequestEvent {
	const url = new URL(path, 'http://localhost:5173');
	return {
		url,
		request: new Request(url, { method }),
		cookies,
		locals: {}
	} as unknown as RequestEvent;
}

const resolve = vi.fn(async () => new Response('ok'));

async function runHandle(event: RequestEvent) {
	try {
		return { response: await handle({ event, resolve }), redirect: null };
	} catch (err) {
		const thrown = err as { status?: number; location?: string };
		if (thrown?.status && thrown.location) {
			return { response: null, redirect: { status: thrown.status, location: thrown.location } };
		}
		throw err;
	}
}

describe('Route guard and deactivated sessions (local Supabase)', () => {
	let serviceClient: SupabaseClient;
	const email = `route_guard_${randomUUID()}@firefighters.local`;
	const password = 'RouteGuardPassword123!';
	const created = { authUserId: null as string | null, profileId: null as string | null };

	beforeAll(async () => {
		serviceClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);
		const result = await createAdminManagedUser(serviceClient, {
			email,
			password,
			fullName: 'Route Guard Test User',
			roleNames: ['read-only'],
			requestId: `req-integration-route-guard-${randomUUID()}`
		});
		created.authUserId = result.user.id;
		created.profileId = result.profile.id;
	});

	afterAll(async () => {
		if (!serviceClient) return;
		if (!created.authUserId) {
			created.authUserId = (await findAuthUserByEmail(serviceClient, email))?.id ?? null;
		}

		// FKs are ON DELETE RESTRICT: user_roles, then profile, then auth user.
		const failures: string[] = [];
		if (created.profileId) {
			const { error: rolesError } = await serviceClient
				.from('user_roles')
				.delete()
				.eq('user_id', created.profileId);
			if (rolesError) failures.push(`user_roles: ${rolesError.message}`);
			const { error: profileError } = await serviceClient
				.from('profiles')
				.delete()
				.eq('id', created.profileId);
			if (profileError) failures.push(`profile: ${profileError.message}`);
		}
		if (created.authUserId) {
			const { error } = await serviceClient.auth.admin.deleteUser(created.authUserId);
			if (error) failures.push(`auth user: ${error.message}`);
		}
		if (failures.length > 0) {
			throw new Error(`Integration cleanup failed; test data leaked:\n  ${failures.join('\n  ')}`);
		}
	});

	it('redirects an anonymous request for a protected page to /login with redirectTo', async () => {
		const { cookies } = createCookieJar();
		resolve.mockClear();

		const result = await runHandle(requestEvent(cookies, '/campaigns?status=active'));

		expect(result.redirect).toEqual({
			status: 303,
			location: '/login?redirectTo=%2Fcampaigns%3Fstatus%3Dactive'
		});
		expect(resolve).not.toHaveBeenCalled();
	});

	it('ends the session of a user deactivated while logged in on their next request', async () => {
		const { jar, cookies } = createCookieJar();

		// 1. Sign in like the login action does: the session lands in the cookie jar.
		const browserSide = createSupabaseServerClient({ cookies });
		const { data: signIn, error: signInError } = await browserSide.auth.signInWithPassword({
			email,
			password
		});
		expect(signInError).toBeNull();
		const refreshToken = signIn.session!.refresh_token;
		expect([...jar.keys()].some((name) => /^sb-.+-auth-token/.test(name))).toBe(true);

		// 2. While active, the guard lets the user through.
		resolve.mockClear();
		const activeEvent = requestEvent(cookies, '/campaigns');
		const active = await runHandle(activeEvent);
		expect(active.redirect).toBeNull();
		expect(resolve).toHaveBeenCalledOnce();
		expect(activeEvent.locals.profile?.id).toBe(created.profileId);

		// 3. An admin deactivates the user.
		const { error: deactivateError } = await serviceClient
			.from('profiles')
			.update({ status: 'inactive' })
			.eq('id', created.profileId!);
		expect(deactivateError).toBeNull();

		// 4. Next request: session ended, sent to /login with the expired banner.
		resolve.mockClear();
		const ended = await runHandle(requestEvent(cookies, '/campaigns'));
		expect(ended.redirect).toEqual({
			status: 303,
			location: '/login?redirectTo=%2Fcampaigns&reason=expired'
		});
		expect(resolve).not.toHaveBeenCalled();
		expect([...jar.keys()].filter((name) => /^sb-.+-auth-token/.test(name))).toEqual([]);

		// The sign-out was global: the old refresh token no longer works anywhere.
		const otherDevice = createClient(supabaseUrl, anonKey, clientOptions);
		const { error: refreshError } = await otherDevice.auth.refreshSession({
			refresh_token: refreshToken
		});
		expect(refreshError).not.toBeNull();

		// 5. Following requests are plain anonymous ones (no cookie left, so no banner).
		const after = await runHandle(requestEvent(cookies, '/campaigns'));
		expect(after.redirect).toEqual({ status: 303, location: '/login?redirectTo=%2Fcampaigns' });
	});
});
