import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handle } from './hooks.server';
import type { RequestEvent } from '@sveltejs/kit';
import type { Session, User, AuthError, SupabaseClient } from '@supabase/supabase-js';
import type { UserProfile } from './app';
import * as serverSupabase from '$lib/supabase/server';
import * as permissionsModule from '$lib/server/auth/permissions';

describe('hooks.server handle', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	function createMockEvent(options?: {
		session?: Partial<Session> | null;
		user?: Partial<User> | null;
		getUserError?: AuthError | Error | null;
		profile?: UserProfile | null;
		profileError?: { message: string } | null;
		path?: string;
		method?: string;
		cookieNames?: string[];
	}) {
		const session = (options?.session ?? null) as Session | null;
		const user = (options?.user ?? null) as User | null;
		const getUserError = options?.getUserError ?? null;

		const mockSupabase = {
			auth: {
				getSession: vi.fn().mockResolvedValue({
					data: { session },
					error: null
				}),
				getUser: vi.fn().mockResolvedValue({
					data: { user: getUserError ? null : user },
					error: getUserError
				}),
				signOut: vi.fn().mockResolvedValue({ error: null })
			},
			from: vi.fn().mockImplementation((table: string) => {
				if (table === 'profiles') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({
									data: options?.profileError ? null : (options?.profile ?? null),
									error: options?.profileError ?? null
								})
							})
						})
					};
				}
				throw new Error(`Unexpected table: ${table}`);
			})
		};

		vi.spyOn(serverSupabase, 'createSupabaseServerClient').mockReturnValue(
			mockSupabase as unknown as SupabaseClient
		);

		// Requests that carry a session send its Supabase auth cookie.
		const cookieNames = options?.cookieNames ?? (session ? ['sb-127-auth-token'] : []);
		const event = {
			locals: {},
			url: new URL(options?.path ?? '/', 'http://localhost:5173'),
			request: new Request(new URL(options?.path ?? '/', 'http://localhost:5173'), {
				method: options?.method ?? 'GET'
			}),
			cookies: {
				getAll: vi.fn().mockReturnValue(cookieNames.map((name) => ({ name, value: 'x' }))),
				set: vi.fn(),
				delete: vi.fn()
			}
		} as unknown as RequestEvent;

		const resolve = vi.fn().mockImplementation((_event, opts) => {
			if (opts?.filterSerializedResponseHeaders) {
				expect(opts.filterSerializedResponseHeaders('content-range')).toBe(true);
				expect(opts.filterSerializedResponseHeaders('x-supabase-api-version')).toBe(true);
				expect(opts.filterSerializedResponseHeaders('x-other-header')).toBe(false);
			}
			return new Response('ok');
		});

		return { event, resolve, mockSupabase };
	}

	it('populates locals with unauthenticated state when no session exists', async () => {
		const { event, resolve } = createMockEvent({
			session: null,
			user: null
		});

		await handle({ event, resolve });

		expect(event.locals.session).toBeNull();
		expect(event.locals.user).toBeNull();
		expect(event.locals.profile).toBeNull();
		expect(event.locals.permissions).toEqual([]);
		expect(event.locals.requestId).toBeDefined();
	});

	it('invalidates session if getSession returns a session but getUser returns an error (spoofed token)', async () => {
		const { event, resolve } = createMockEvent({
			session: { access_token: 'fake-token' },
			user: { id: 'spoofed-id' },
			getUserError: new Error('Invalid JWT signature')
		});

		await handle({ event, resolve });

		expect(event.locals.session).toBeNull();
		expect(event.locals.user).toBeNull();
		expect(event.locals.profile).toBeNull();
		expect(event.locals.permissions).toEqual([]);
	});

	it('populates active profile and permissions when valid user is authenticated', async () => {
		const validProfile: UserProfile = {
			id: 'prof-123',
			auth_user_id: 'user-123',
			full_name: 'John Firefighter',
			email: 'john@firefighters.local',
			status: 'active',
			created_at: new Date().toISOString()
		};

		vi.spyOn(permissionsModule, 'getUserPermissions').mockResolvedValue([
			'campaign.view',
			'bond.view'
		]);

		const { event, resolve } = createMockEvent({
			session: { access_token: 'valid-token' },
			user: { id: 'user-123', email: 'john@firefighters.local' },
			profile: validProfile
		});

		await handle({ event, resolve });

		expect(event.locals.session).toBeDefined();
		expect(event.locals.user).toEqual({ id: 'user-123', email: 'john@firefighters.local' });
		expect(event.locals.profile).toEqual(validProfile);
		expect(event.locals.permissions).toEqual(['campaign.view', 'bond.view']);
	});

	it('loads the profile and permissions in parallel', async () => {
		let resolvePermissions!: (value: string[]) => void;
		vi.spyOn(permissionsModule, 'getUserPermissions').mockImplementation(
			() => new Promise((r) => (resolvePermissions = r))
		);
		const { event, resolve, mockSupabase } = createMockEvent({
			session: { access_token: 'valid-token' },
			user: { id: 'user-123' },
			profile: {
				id: 'prof-123',
				auth_user_id: 'user-123',
				full_name: 'John',
				email: 'john@firefighters.local',
				status: 'active',
				created_at: new Date().toISOString()
			}
		});

		const pending = handle({ event, resolve });
		await vi.waitFor(() => expect(mockSupabase.from).toHaveBeenCalledWith('profiles'));
		resolvePermissions(['user.manage']);
		await pending;

		expect(event.locals.permissions).toEqual(['user.manage']);
	});

	describe('when loading the permissions fails', () => {
		const activeProfile: UserProfile = {
			id: 'prof-123',
			auth_user_id: 'user-123',
			full_name: 'John Firefighter',
			email: 'john@firefighters.local',
			status: 'active',
			created_at: new Date().toISOString()
		};

		it('keeps the active user signed in, sets permissions to null and logs it', async () => {
			const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
			vi.spyOn(permissionsModule, 'getUserPermissions').mockResolvedValue(null);
			const { event, resolve, mockSupabase } = createMockEvent({
				path: '/campaigns',
				session: { access_token: 'valid-token' },
				user: { id: 'user-123' },
				profile: activeProfile
			});

			await handle({ event, resolve });

			expect(event.locals.user).toEqual({ id: 'user-123' });
			expect(event.locals.profile).toEqual(activeProfile);
			expect(event.locals.permissions).toBeNull();
			// Not a session problem: the request goes through and the permission check answers 500.
			expect(resolve).toHaveBeenCalledOnce();
			expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();
			expect(consoleError).toHaveBeenCalledWith(
				'[hooks] permissions lookup failed; permission checks will answer 500',
				expect.objectContaining({ requestId: event.locals.requestId, profileId: 'prof-123' })
			);
		});

		it('still serves the public home page', async () => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			vi.spyOn(permissionsModule, 'getUserPermissions').mockResolvedValue(null);
			const { event, resolve } = createMockEvent({
				path: '/',
				session: { access_token: 'valid-token' },
				user: { id: 'user-123' },
				profile: activeProfile
			});

			const response = await handle({ event, resolve });

			expect(response.status).toBe(200);
			expect(resolve).toHaveBeenCalledOnce();
		});

		it('leaves permissions as [] for a request that is not signed in', async () => {
			vi.spyOn(permissionsModule, 'getUserPermissions').mockResolvedValue(null);
			const { event, resolve } = createMockEvent({
				session: { access_token: 'valid-token' },
				user: { id: 'user-999' },
				profile: { ...activeProfile, status: 'inactive' }
			});

			await handle({ event, resolve });

			expect(event.locals.user).toBeNull();
			expect(event.locals.permissions).toEqual([]);
		});
	});

	it('treats a user with no profile as anonymous', async () => {
		vi.spyOn(permissionsModule, 'getUserPermissions').mockResolvedValue([]);
		const { event, resolve } = createMockEvent({
			session: { access_token: 'valid-token' },
			user: { id: 'user-404' },
			profile: null
		});

		await handle({ event, resolve });

		expect(event.locals.session).toBeNull();
		expect(event.locals.user).toBeNull();
		expect(event.locals.profile).toBeNull();
		expect(event.locals.permissions).toEqual([]);
	});

	it('treats a profile lookup error as anonymous (fail closed) and logs it', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(permissionsModule, 'getUserPermissions').mockResolvedValue(['user.manage']);
		const { event, resolve } = createMockEvent({
			session: { access_token: 'valid-token' },
			user: { id: 'user-123' },
			profileError: { message: 'db down' }
		});

		await handle({ event, resolve });

		expect(event.locals.user).toBeNull();
		expect(event.locals.permissions).toEqual([]);
		expect(consoleError).toHaveBeenCalled();
	});

	it('rejects inactive profiles by clearing session, user, profile and permissions', async () => {
		const inactiveProfile: UserProfile = {
			id: 'prof-999',
			auth_user_id: 'user-999',
			full_name: 'Inactive User',
			email: 'inactive@firefighters.local',
			status: 'inactive',
			created_at: new Date().toISOString()
		};

		const { event, resolve } = createMockEvent({
			session: { access_token: 'valid-token' },
			user: { id: 'user-999' },
			profile: inactiveProfile
		});

		vi.spyOn(permissionsModule, 'getUserPermissions').mockResolvedValue([]);

		await handle({ event, resolve });

		expect(event.locals.session).toBeNull();
		expect(event.locals.user).toBeNull();
		expect(event.locals.profile).toBeNull();
		expect(event.locals.permissions).toEqual([]);
	});

	describe('route guard', () => {
		const activeProfile: UserProfile = {
			id: 'prof-123',
			auth_user_id: 'user-123',
			full_name: 'John Firefighter',
			email: 'john@firefighters.local',
			status: 'active',
			created_at: new Date().toISOString()
		};
		const inactiveProfile: UserProfile = { ...activeProfile, status: 'inactive' };

		it('redirects an anonymous request for a protected page to /login, keeping the path', async () => {
			const { event, resolve } = createMockEvent({ path: '/campaigns/7/bonds?page=2' });

			await expect(handle({ event, resolve })).rejects.toMatchObject({
				status: 303,
				location: '/login?redirectTo=%2Fcampaigns%2F7%2Fbonds%3Fpage%3D2'
			});
			expect(resolve).not.toHaveBeenCalled();
		});

		it('protects a route nobody has allowlisted (new routes are protected by default)', async () => {
			const { event, resolve } = createMockEvent({ path: '/imports/new' });

			await expect(handle({ event, resolve })).rejects.toMatchObject({
				status: 303,
				location: '/login?redirectTo=%2Fimports%2Fnew'
			});
		});

		it('lets anonymous visitors reach public routes', async () => {
			for (const path of ['/', '/login', '/login?redirectTo=%2Fcampaigns']) {
				const { event, resolve } = createMockEvent({ path });
				await handle({ event, resolve });
				expect(resolve).toHaveBeenCalledOnce();
			}
		});

		it('answers 401 JSON for an anonymous API request', async () => {
			const { event, resolve } = createMockEvent({ path: '/api/admin/users', method: 'POST' });

			const response = await handle({ event, resolve });

			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({ message: 'Unauthorized', code: 'unauthenticated' });
			expect(resolve).not.toHaveBeenCalled();
		});

		it('lets an active user through to a protected page', async () => {
			vi.spyOn(permissionsModule, 'getUserPermissions').mockResolvedValue(['campaign.view']);
			const { event, resolve, mockSupabase } = createMockEvent({
				path: '/campaigns',
				session: { access_token: 'valid-token' },
				user: { id: 'user-123' },
				profile: activeProfile
			});

			await handle({ event, resolve });

			expect(resolve).toHaveBeenCalledOnce();
			expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();
		});

		it('ends the session of a user deactivated while logged in and shows the expired banner', async () => {
			vi.spyOn(permissionsModule, 'getUserPermissions').mockResolvedValue([]);
			const { event, resolve, mockSupabase } = createMockEvent({
				path: '/campaigns',
				session: { access_token: 'valid-token' },
				user: { id: 'user-123' },
				profile: inactiveProfile
			});

			await expect(handle({ event, resolve })).rejects.toMatchObject({
				status: 303,
				location: '/login?redirectTo=%2Fcampaigns&reason=expired'
			});
			expect(mockSupabase.auth.signOut).toHaveBeenCalledOnce();
		});

		it('ends the session of a user whose profile is gone', async () => {
			vi.spyOn(permissionsModule, 'getUserPermissions').mockResolvedValue([]);
			const { event, resolve, mockSupabase } = createMockEvent({
				path: '/campaigns',
				session: { access_token: 'valid-token' },
				user: { id: 'user-404' },
				profile: null
			});

			await expect(handle({ event, resolve })).rejects.toMatchObject({ status: 303 });
			expect(mockSupabase.auth.signOut).toHaveBeenCalledOnce();
		});

		it('clears the auth cookies locally when signOut fails for a deactivated user', async () => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			vi.spyOn(permissionsModule, 'getUserPermissions').mockResolvedValue([]);
			const { event, resolve, mockSupabase } = createMockEvent({
				path: '/campaigns',
				session: { access_token: 'valid-token' },
				user: { id: 'user-123' },
				profile: inactiveProfile
			});
			mockSupabase.auth.signOut.mockResolvedValue({ error: new Error('auth down') });

			await expect(handle({ event, resolve })).rejects.toMatchObject({ status: 303 });
			expect(event.cookies.delete).toHaveBeenCalledWith('sb-127-auth-token', { path: '/' });
		});

		it('ends a deactivated session on a public page too, and renders it anonymously', async () => {
			vi.spyOn(permissionsModule, 'getUserPermissions').mockResolvedValue([]);
			const { event, resolve, mockSupabase } = createMockEvent({
				path: '/',
				session: { access_token: 'valid-token' },
				user: { id: 'user-123' },
				profile: inactiveProfile
			});

			await handle({ event, resolve });

			expect(mockSupabase.auth.signOut).toHaveBeenCalledOnce();
			expect(resolve).toHaveBeenCalledOnce();
			expect(event.locals.user).toBeNull();
		});

		it.each(['/login', '/logout'])(
			'leaves a deactivated session to %s, which manages it itself',
			async (path) => {
				vi.spyOn(permissionsModule, 'getUserPermissions').mockResolvedValue([]);
				const { event, resolve, mockSupabase } = createMockEvent({
					path,
					method: 'POST',
					session: { access_token: 'valid-token' },
					user: { id: 'user-123' },
					profile: inactiveProfile
				});

				await handle({ event, resolve });

				expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();
				expect(resolve).toHaveBeenCalledOnce();
			}
		);

		it('flags an expired or invalid session cookie on the redirect, without signing out', async () => {
			const { event, resolve, mockSupabase } = createMockEvent({
				path: '/campaigns',
				session: { access_token: 'expired-token' },
				user: { id: 'user-123' },
				getUserError: new Error('JWT expired')
			});

			await expect(handle({ event, resolve })).rejects.toMatchObject({
				status: 303,
				location: '/login?redirectTo=%2Fcampaigns&reason=expired'
			});
			expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();
		});

		describe('when the profile lookup itself fails', () => {
			function lookupFailure(path: string, method = 'GET') {
				const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
				vi.spyOn(permissionsModule, 'getUserPermissions').mockResolvedValue([]);
				const mocks = createMockEvent({
					path,
					method,
					session: { access_token: 'valid-token' },
					user: { id: 'user-123' },
					profileError: { message: 'db down' }
				});
				return { ...mocks, consoleError };
			}

			it('answers 503 on a page instead of redirecting to /login, keeping the session', async () => {
				const { event, resolve, mockSupabase, consoleError } = lookupFailure('/campaigns');

				await expect(handle({ event, resolve })).rejects.toMatchObject({
					status: 503,
					body: { message: 'Servicio no disponible, intentá de nuevo en unos minutos' }
				});
				expect(resolve).not.toHaveBeenCalled();
				expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();
				expect(event.cookies.delete).not.toHaveBeenCalled();
				expect(consoleError).toHaveBeenCalledWith(
					expect.stringContaining('profile lookup failed'),
					expect.objectContaining({ requestId: event.locals.requestId })
				);
			});

			it('answers a 503 JSON on an API route, keeping the session', async () => {
				const { event, resolve, mockSupabase } = lookupFailure('/api/admin/users', 'POST');

				const response = await handle({ event, resolve });

				expect(response.status).toBe(503);
				expect(await response.json()).toEqual({
					message: 'Servicio no disponible, intentá de nuevo en unos minutos',
					code: 'service_unavailable'
				});
				expect(resolve).not.toHaveBeenCalled();
				expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();
			});

			it('still serves public routes', async () => {
				for (const path of ['/', '/login']) {
					const { event, resolve } = lookupFailure(path);
					const response = await handle({ event, resolve });
					expect(response.status).toBe(200);
					expect(resolve).toHaveBeenCalledOnce();
				}
			});
		});

		it('drops the ?/action query from the return path of a form action', async () => {
			const { event, resolve } = createMockEvent({
				path: '/campaigns/new?/create',
				method: 'POST'
			});

			await expect(handle({ event, resolve })).rejects.toMatchObject({
				status: 303,
				location: '/login?redirectTo=%2Fcampaigns%2Fnew'
			});
		});
	});
});
