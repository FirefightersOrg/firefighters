import { describe, it, expect, vi } from 'vitest';
import { load, actions } from './+page.server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { UserProfile } from '../app';

describe('/ +page.server', () => {
	describe('load function', () => {
		it('returns empty user, profile, and roles when unauthenticated', async () => {
			const mockEvent = {
				locals: {
					user: null,
					profile: null
				}
			} as unknown as Parameters<typeof load>[0];

			const result = (await load(mockEvent))!;
			expect(result).toEqual({
				user: null,
				profile: null,
				roles: []
			});
		});

		it('fetches and returns roles when user and profile exist', async () => {
			const user: User = { id: 'u-1', email: 'admin@firefighters.local' } as User;
			const profile: UserProfile = {
				id: 'p-1',
				auth_user_id: 'u-1',
				full_name: 'Admin User',
				email: 'admin@firefighters.local',
				status: 'active',
				created_at: new Date().toISOString()
			};

			const mockSupabase = {
				from: vi.fn().mockImplementation((table: string) => {
					if (table === 'user_roles') {
						return {
							select: vi.fn().mockReturnValue({
								eq: vi.fn().mockResolvedValue({
									data: [{ roles: { name: 'admin' } }, { roles: { name: 'operator' } }],
									error: null
								})
							})
						};
					}
					throw new Error(`Unexpected table: ${table}`);
				})
			};

			const mockEvent = {
				locals: {
					user,
					profile,
					supabase: mockSupabase as unknown as SupabaseClient
				}
			} as unknown as Parameters<typeof load>[0];

			const result = (await load(mockEvent))!;
			expect(result.user).toEqual(user);
			expect(result.profile).toEqual(profile);
			expect(result.roles).toEqual(['admin', 'operator']);
		});

		it('handles user with no roles assigned', async () => {
			const user: User = { id: 'u-2', email: 'norole@firefighters.local' } as User;
			const profile: UserProfile = {
				id: 'p-2',
				auth_user_id: 'u-2',
				full_name: 'No Role User',
				email: 'norole@firefighters.local',
				status: 'active',
				created_at: new Date().toISOString()
			};

			const mockSupabase = {
				from: vi.fn().mockImplementation((table: string) => {
					if (table === 'user_roles') {
						return {
							select: vi.fn().mockReturnValue({
								eq: vi.fn().mockResolvedValue({
									data: [],
									error: null
								})
							})
						};
					}
					throw new Error(`Unexpected table: ${table}`);
				})
			};

			const mockEvent = {
				locals: {
					user,
					profile,
					supabase: mockSupabase as unknown as SupabaseClient
				}
			} as unknown as Parameters<typeof load>[0];

			const result = (await load(mockEvent))!;
			expect(result.roles).toEqual([]);
		});
	});

	describe('logout action', () => {
		it('calls signOut and redirects (303) to /login', async () => {
			const signOutMock = vi.fn().mockResolvedValue({ error: null });
			const mockEvent = {
				locals: {
					supabase: {
						auth: {
							signOut: signOutMock
						}
					} as unknown as SupabaseClient
				}
			} as unknown as Parameters<typeof actions.logout>[0];

			await expect(actions.logout(mockEvent)).rejects.toMatchObject({
				status: 303,
				location: '/login'
			});
			expect(signOutMock).toHaveBeenCalledTimes(1);
		});
	});
});
