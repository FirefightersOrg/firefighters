import { describe, it, expect, vi, beforeEach } from 'vitest';
import { load, actions, _getSafeRedirectUrl } from './+page.server';
import type { Session, User, SupabaseClient } from '@supabase/supabase-js';

describe('/login +page.server', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	describe('_getSafeRedirectUrl', () => {
		it('returns "/" when target is null, undefined, or empty', () => {
			expect(_getSafeRedirectUrl(null)).toBe('/');
			expect(_getSafeRedirectUrl(undefined)).toBe('/');
			expect(_getSafeRedirectUrl('')).toBe('/');
		});

		it('allows valid relative paths', () => {
			expect(_getSafeRedirectUrl('/admin/users')).toBe('/admin/users');
			expect(_getSafeRedirectUrl('/campaigns/123')).toBe('/campaigns/123');
			expect(_getSafeRedirectUrl('/')).toBe('/');
		});

		it('rejects protocol-relative and open-redirect targets', () => {
			expect(_getSafeRedirectUrl('//evil.com')).toBe('/');
			expect(_getSafeRedirectUrl('/\\evil.com')).toBe('/');
			expect(_getSafeRedirectUrl('https://evil.com')).toBe('/');
			expect(_getSafeRedirectUrl('javascript:alert(1)')).toBe('/');
		});
	});

	describe('load function', () => {
		it('redirects to "/" when active session and user exist in locals', async () => {
			const mockEvent = {
				locals: {
					session: { access_token: 'valid' } as Session,
					user: { id: 'user-1' } as User
				},
				url: new URL('http://localhost:5173/login')
			} as unknown as Parameters<typeof load>[0];

			await expect(load(mockEvent)).rejects.toMatchObject({
				status: 303,
				location: '/'
			});
		});

		it('returns reason and redirectTo search params when unauthenticated', async () => {
			const mockEvent = {
				locals: {
					session: null,
					user: null
				},
				url: new URL('http://localhost:5173/login?reason=expired&redirectTo=/admin/users')
			} as unknown as Parameters<typeof load>[0];

			const result = await load(mockEvent);
			expect(result).toEqual({
				reason: 'expired',
				redirectTo: '/admin/users'
			});
		});
	});

	describe('default action', () => {
		function createMockActionContext(options?: {
			formData?: Record<string, string>;
			signInUser?: { id: string; email?: string } | null;
			signInError?: Error | null;
			networkError?: boolean;
			profileStatus?: 'active' | 'inactive' | null;
			profileError?: Error | null;
			url?: string;
		}) {
			const formDataObj = new Map<string, string>();
			if (options?.formData) {
				for (const [key, val] of Object.entries(options.formData)) {
					formDataObj.set(key, val);
				}
			}

			const signOutMock = vi.fn().mockResolvedValue({ error: null });

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
				url: new URL(options?.url ?? 'http://localhost:5173/login')
			} as unknown as Parameters<typeof actions.default>[0];

			return { event, mockSupabase, signOutMock };
		}

		it('returns fail(400) when email is invalid', async () => {
			const { event } = createMockActionContext({
				formData: { email: 'invalid-email', password: 'password123' }
			});

			const result = (await actions.default(event)) as {
				status: number;
				data: Record<string, unknown>;
			};
			expect(result.status).toBe(400);
			expect(result.data.email).toBe('invalid-email');
			expect(result.data.message).toBe('Please provide a valid email and password');
			expect(result.data.errors).toBeDefined();
		});

		it('returns fail(400) when password is empty', async () => {
			const { event } = createMockActionContext({
				formData: { email: 'admin@firefighters.local', password: '' }
			});

			const result = (await actions.default(event)) as {
				status: number;
				data: Record<string, unknown>;
			};
			expect(result.status).toBe(400);
			expect(result.data.errors).toBeDefined();
		});

		it('returns fail(400) with generic message on bad credentials', async () => {
			const { event } = createMockActionContext({
				formData: { email: 'user@firefighters.local', password: 'wrongpassword' },
				signInError: new Error('Invalid login credentials')
			});

			const result = (await actions.default(event)) as {
				status: number;
				data: Record<string, unknown>;
			};
			expect(result.status).toBe(400);
			expect(result.data.email).toBe('user@firefighters.local');
			expect(result.data.message).toBe('Invalid email or password');
		});

		it('returns fail(400) on network or authentication service failure', async () => {
			const { event } = createMockActionContext({
				formData: { email: 'user@firefighters.local', password: 'password123' },
				networkError: true
			});

			const result = (await actions.default(event)) as {
				status: number;
				data: Record<string, unknown>;
			};
			expect(result.status).toBe(400);
			expect(result.data.message).toContain('Unable to connect');
		});

		it('signs out and returns fail(400) when profile is inactive', async () => {
			const { event, signOutMock } = createMockActionContext({
				formData: { email: 'inactive@firefighters.local', password: 'password123' },
				profileStatus: 'inactive'
			});

			const result = (await actions.default(event)) as {
				status: number;
				data: Record<string, unknown>;
			};
			expect(result.status).toBe(400);
			expect(result.data.message).toBe(
				'Your account is inactive. Please contact an administrator.'
			);
			expect(signOutMock).toHaveBeenCalledTimes(1);
		});

		it('signs out and returns fail(400) when profile lookup fails', async () => {
			const { event, signOutMock } = createMockActionContext({
				formData: { email: 'user@firefighters.local', password: 'password123' },
				profileError: new Error('Database connection failed')
			});

			const result = (await actions.default(event)) as {
				status: number;
				data: Record<string, unknown>;
			};
			expect(result.status).toBe(400);
			expect(result.data.message).toBe('Unable to verify account status. Please try again.');
			expect(signOutMock).toHaveBeenCalledTimes(1);
		});

		it('redirects to "/" on successful sign in by default', async () => {
			const { event } = createMockActionContext({
				formData: { email: 'admin@firefighters.local', password: 'correctpassword' },
				profileStatus: 'active'
			});

			await expect(actions.default(event)).rejects.toMatchObject({
				status: 303,
				location: '/'
			});
		});

		it('redirects to valid redirectTo provided in formData', async () => {
			const { event } = createMockActionContext({
				formData: {
					email: 'admin@firefighters.local',
					password: 'correctpassword',
					redirectTo: '/admin/users'
				},
				profileStatus: 'active'
			});

			await expect(actions.default(event)).rejects.toMatchObject({
				status: 303,
				location: '/admin/users'
			});
		});

		it('redirects to valid redirectTo provided in URL search params', async () => {
			const { event } = createMockActionContext({
				formData: {
					email: 'admin@firefighters.local',
					password: 'correctpassword'
				},
				url: 'http://localhost:5173/login?redirectTo=/reports/audit',
				profileStatus: 'active'
			});

			await expect(actions.default(event)).rejects.toMatchObject({
				status: 303,
				location: '/reports/audit'
			});
		});

		it('neutralizes open redirect attempts and defaults to "/"', async () => {
			const { event } = createMockActionContext({
				formData: {
					email: 'admin@firefighters.local',
					password: 'correctpassword',
					redirectTo: 'https://attacker.example.com'
				},
				profileStatus: 'active'
			});

			await expect(actions.default(event)).rejects.toMatchObject({
				status: 303,
				location: '/'
			});
		});
	});
});
