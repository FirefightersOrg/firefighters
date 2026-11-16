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
				})
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

		const event = {
			locals: {},
			cookies: {
				getAll: vi.fn().mockReturnValue([]),
				set: vi.fn()
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
});
