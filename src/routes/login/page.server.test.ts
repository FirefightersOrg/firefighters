import { describe, it, expect, vi, beforeEach } from 'vitest';
import { load, actions } from './+page.server';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import type { Session, User, SupabaseClient } from '@supabase/supabase-js';
import type { UserProfile } from '../../app';

const activeProfile = { id: 'p-1', status: 'active' } as UserProfile;
const NOT_ACTIVE = 'Your account is not active. Please contact an administrator.';
const SERVICE_UNAVAILABLE = 'The sign-in service is temporarily unavailable. Please try again.';

type FailResult = { status: number; data: Record<string, unknown> };

describe('/login +page.server', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	describe('load function', () => {
		function loadEvent(locals: Record<string, unknown>, url = 'http://localhost:5173/login') {
			return { locals, url: new URL(url) } as unknown as Parameters<typeof load>[0];
		}

		it('redirects an active user to "/"', async () => {
			const event = loadEvent({
				session: { access_token: 'valid' } as Session,
				user: { id: 'user-1' } as User,
				profile: activeProfile
			});
			await expect(load(event)).rejects.toMatchObject({ status: 303, location: '/' });
		});

		it('redirects an active user to a safe redirectTo', async () => {
			const event = loadEvent(
				{ user: { id: 'user-1' } as User, profile: activeProfile },
				'http://localhost:5173/login?redirectTo=/reports/audit'
			);
			await expect(load(event)).rejects.toMatchObject({ status: 303, location: '/reports/audit' });
		});

		it('renders the page when the hook found no active profile (stale or deactivated session)', async () => {
			// hooks.server.ts leaves session/user/profile null for inactive or missing profiles.
			const event = loadEvent({ session: null, user: null, profile: null });
			await expect(load(event)).resolves.toEqual({ redirectTo: null });
		});

		it('returns a sanitized redirectTo when unauthenticated', async () => {
			const event = loadEvent(
				{ session: null, user: null, profile: null },
				'http://localhost:5173/login?redirectTo=/admin/users'
			);
			await expect(load(event)).resolves.toEqual({ redirectTo: '/admin/users' });
		});

		it.each(['/%09/evil.com', '//evil.com', 'https://evil.com', '/%5Cevil.com'])(
			'drops an unsafe redirectTo %j',
			async (redirectTo) => {
				const event = loadEvent(
					{ session: null, user: null, profile: null },
					`http://localhost:5173/login?redirectTo=${redirectTo}`
				);
				await expect(load(event)).resolves.toEqual({ redirectTo: null });
			}
		);
	});

	describe('default action', () => {
		function createMockActionContext(options?: {
			formData?: Record<string, string>;
			signInUser?: { id: string; email?: string } | null;
			signInError?: Error | null;
			networkError?: boolean;
			profileStatus?: 'active' | 'inactive' | null;
			profileError?: Error | null;
			profileThrows?: boolean;
			signOutError?: Error | null;
			signOutThrows?: boolean;
			url?: string;
		}) {
			const formDataObj = new Map<string, string>(Object.entries(options?.formData ?? {}));

			const signOutMock = vi.fn().mockImplementation(() => {
				if (options?.signOutThrows) return Promise.reject(new Error('fetch failed'));
				return Promise.resolve({ error: options?.signOutError ?? null });
			});
			const cookies = {
				getAll: vi.fn(() => [{ name: 'sb-127-auth-token', value: 'x' }]),
				delete: vi.fn()
			};

			const mockSupabase = {
				auth: {
					signInWithPassword: vi.fn().mockImplementation(() => {
						if (options?.networkError) {
							return Promise.reject(new Error('Connection failed'));
						}
						if (options?.signInError) {
							return Promise.resolve({
								data: { user: null, session: null },
								error: options.signInError
							});
						}
						return Promise.resolve({
							data: {
								user: options?.signInUser !== undefined ? options.signInUser : { id: 'user-123' },
								session: { access_token: 'tok' }
							},
							error: null
						});
					}),
					signOut: signOutMock
				},
				from: vi.fn().mockImplementation((table: string) => {
					if (table === 'profiles') {
						return {
							select: vi.fn().mockReturnValue({
								eq: vi.fn().mockReturnValue({
									maybeSingle: vi.fn().mockImplementation(() => {
										if (options?.profileThrows) {
											return Promise.reject(new Error('fetch failed'));
										}
										if (options?.profileError) {
											return Promise.resolve({ data: null, error: options.profileError });
										}
										if (options?.profileStatus === null) {
											return Promise.resolve({ data: null, error: null });
										}
										return Promise.resolve({
											data: { status: options?.profileStatus ?? 'active' },
											error: null
										});
									})
								})
							})
						};
					}
					throw new Error(`Unexpected table: ${table}`);
				})
			};

			const event = {
				request: {
					formData: vi.fn().mockResolvedValue({
						get: (name: string) => formDataObj.get(name) ?? null
					})
				},
				locals: {
					supabase: mockSupabase as unknown as SupabaseClient
				},
				cookies,
				url: new URL(options?.url ?? 'http://localhost:5173/login')
			} as unknown as Parameters<typeof actions.default>[0];

			return { event, mockSupabase, signOutMock, cookies };
		}

		const credentials = { email: 'user@firefighters.local', password: 'password123' };

		it('returns fail(400) when email is invalid', async () => {
			const { event } = createMockActionContext({
				formData: { email: 'invalid-email', password: 'password123' }
			});

			const result = (await actions.default(event)) as FailResult;
			expect(result.status).toBe(400);
			expect(result.data.email).toBe('invalid-email');
			expect(result.data.message).toBe('Please provide a valid email and password');
			expect(result.data.errors).toBeDefined();
		});

		it('returns fail(400) when password is empty', async () => {
			const { event } = createMockActionContext({
				formData: { email: 'admin@firefighters.local', password: '' }
			});

			const result = (await actions.default(event)) as FailResult;
			expect(result.status).toBe(400);
			expect(result.data.errors).toBeDefined();
		});

		it('returns fail(400) with generic message on bad credentials', async () => {
			const { event, signOutMock } = createMockActionContext({
				formData: credentials,
				signInError: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials')
			});

			const result = (await actions.default(event)) as FailResult;
			expect(result.status).toBe(400);
			expect(result.data.email).toBe('user@firefighters.local');
			expect(result.data.message).toBe('Invalid email or password');
			expect(signOutMock).not.toHaveBeenCalled();
		});

		it('returns fail(429) when sign-in is rate limited', async () => {
			const { event } = createMockActionContext({
				formData: credentials,
				signInError: new AuthApiError('rate limited', 429, 'over_request_rate_limit')
			});
			const result = (await actions.default(event)) as FailResult;
			expect(result.status).toBe(429);
		});

		it('returns fail(503) when the auth service cannot be reached (throws)', async () => {
			const { event } = createMockActionContext({ formData: credentials, networkError: true });

			const result = (await actions.default(event)) as FailResult;
			expect(result.status).toBe(503);
			expect(result.data.message).toBe(SERVICE_UNAVAILABLE);
		});

		it('returns fail(503) on a retryable fetch error', async () => {
			const { event } = createMockActionContext({
				formData: credentials,
				signInError: new AuthRetryableFetchError('fetch failed', 0)
			});
			const result = (await actions.default(event)) as FailResult;
			expect(result.status).toBe(503);
			expect(result.data.message).toBe(SERVICE_UNAVAILABLE);
		});

		it('returns fail(503) when the auth service returns a 5xx error', async () => {
			const { event } = createMockActionContext({
				formData: credentials,
				signInError: new AuthApiError('upstream error', 502, undefined)
			});
			const result = (await actions.default(event)) as FailResult;
			expect(result.status).toBe(503);
		});

		it('signs out and returns fail(403) when profile is inactive', async () => {
			const { event, signOutMock, cookies } = createMockActionContext({
				formData: credentials,
				profileStatus: 'inactive'
			});

			const result = (await actions.default(event)) as FailResult;
			expect(result.status).toBe(403);
			expect(result.data.message).toBe(NOT_ACTIVE);
			expect(signOutMock).toHaveBeenCalledTimes(1);
			expect(cookies.delete).not.toHaveBeenCalled();
		});

		it('signs out and returns fail(403) when the user has no profile row', async () => {
			const { event, signOutMock } = createMockActionContext({
				formData: credentials,
				profileStatus: null
			});

			const result = (await actions.default(event)) as FailResult;
			expect(result.status).toBe(403);
			expect(result.data.message).toBe(NOT_ACTIVE);
			expect(signOutMock).toHaveBeenCalledTimes(1);
		});

		it('clears auth cookies locally when signOut returns an error for an inactive user', async () => {
			const { event, cookies } = createMockActionContext({
				formData: credentials,
				profileStatus: 'inactive',
				signOutError: new Error('service unavailable')
			});

			const result = (await actions.default(event)) as FailResult;
			expect(result.status).toBe(403);
			expect(cookies.delete).toHaveBeenCalledWith('sb-127-auth-token', { path: '/' });
		});

		it('signs out and returns fail(503) when profile lookup fails', async () => {
			const { event, signOutMock } = createMockActionContext({
				formData: credentials,
				profileError: new Error('Database connection failed')
			});

			const result = (await actions.default(event)) as FailResult;
			expect(result.status).toBe(503);
			expect(result.data.message).toBe('Unable to verify account status. Please try again.');
			expect(signOutMock).toHaveBeenCalledTimes(1);
		});

		it('returns fail(503) without throwing when profile lookup and signOut both throw', async () => {
			const { event, cookies } = createMockActionContext({
				formData: credentials,
				profileThrows: true,
				signOutThrows: true
			});

			const result = (await actions.default(event)) as FailResult;
			expect(result.status).toBe(503);
			expect(cookies.delete).toHaveBeenCalledWith('sb-127-auth-token', { path: '/' });
		});

		it('redirects to "/" on successful sign in by default', async () => {
			const { event, signOutMock } = createMockActionContext({
				formData: credentials,
				profileStatus: 'active'
			});

			await expect(actions.default(event)).rejects.toMatchObject({ status: 303, location: '/' });
			expect(signOutMock).not.toHaveBeenCalled();
		});

		it('redirects to valid redirectTo provided in formData', async () => {
			const { event } = createMockActionContext({
				formData: { ...credentials, redirectTo: '/admin/users?tab=active' }
			});

			await expect(actions.default(event)).rejects.toMatchObject({
				status: 303,
				location: '/admin/users?tab=active'
			});
		});

		it('redirects to valid redirectTo provided in URL search params', async () => {
			const { event } = createMockActionContext({
				formData: credentials,
				url: 'http://localhost:5173/login?redirectTo=/reports/audit'
			});

			await expect(actions.default(event)).rejects.toMatchObject({
				status: 303,
				location: '/reports/audit'
			});
		});

		it.each(['/\t/evil.com', '/%09/evil.com', '//evil.com', '/\\evil.com', 'https://evil.com'])(
			'neutralizes redirectTo %j in formData',
			async (redirectTo) => {
				const { event } = createMockActionContext({ formData: { ...credentials, redirectTo } });
				await expect(actions.default(event)).rejects.toMatchObject({ status: 303, location: '/' });
			}
		);

		it('neutralizes a tab-encoded redirectTo from the URL query', async () => {
			const { event } = createMockActionContext({
				formData: credentials,
				url: 'http://localhost:5173/login?redirectTo=/%09/evil.com'
			});
			await expect(actions.default(event)).rejects.toMatchObject({ status: 303, location: '/' });
		});
	});
});
