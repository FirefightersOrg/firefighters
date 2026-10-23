import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserProfile } from '../../../../app';
import * as userAdminService from '$lib/server/services/user-admin';
import * as adminSupabase from '$lib/server/supabase/admin';

describe('POST /api/admin/users', () => {
	const validUserId = '11111111-1111-4111-8111-111111111111';
	const validProfileId = '22222222-2222-4222-8222-222222222222';

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	function createMockEvent(options: {
		body?: unknown;
		hasPermission?: boolean;
		profile?: Partial<UserProfile> | null;
		requestId?: string;
	}): RequestEvent {
		const rpcMock = vi.fn().mockImplementation((fn: string) => {
			if (fn === 'has_permission') {
				return Promise.resolve({
					data: options.hasPermission ?? true,
					error: null
				});
			}
			return Promise.resolve({ data: null, error: null });
		});

		const requestMock = {
			json: vi.fn().mockImplementation(() => {
				if (options.body instanceof Error) {
					return Promise.reject(options.body);
				}
				return Promise.resolve(options.body ?? {});
			})
		} as unknown as Request;

		return {
			request: requestMock,
			locals: {
				supabase: { rpc: rpcMock } as unknown as SupabaseClient,
				profile:
					options.profile === null
						? null
						: ((options.profile ?? { id: validProfileId }) as unknown as UserProfile),
				requestId: options.requestId ?? 'req-123'
			}
		} as unknown as RequestEvent;
	}

	it('returns 403 Forbidden when caller lacks user.manage permission', async () => {
		const event = createMockEvent({ hasPermission: false });

		await expect(POST(event)).rejects.toMatchObject({
			status: 403,
			body: expect.objectContaining({
				code: 'permission_denied',
				permission: 'user.manage'
			})
		});
	});

	it('returns 400 when request payload is not valid JSON', async () => {
		const event = createMockEvent({
			hasPermission: true,
			body: new Error('Invalid JSON')
		});

		const response = await POST(event);
		expect(response.status).toBe(400);

		const data = await response.json();
		expect(data.message).toBe('Invalid JSON payload');
	});

	it('returns 400 when validation fails (invalid email or short password)', async () => {
		const event = createMockEvent({
			hasPermission: true,
			body: {
				email: 'not-an-email',
				password: '123',
				fullName: 'Admin User',
				roleNames: ['admin']
			}
		});

		const response = await POST(event);
		expect(response.status).toBe(400);

		const data = await response.json();
		expect(data.message).toBe('Validation failed');
		expect(data.errors).toHaveProperty('email');
		expect(data.errors).toHaveProperty('password');
	});

	it('successfully calls createAdminManagedUser and returns 201', async () => {
		const mockCreatedResult = {
			user: { id: validUserId, email: 'operator@firefighters.local' },
			profile: {
				id: validProfileId,
				auth_user_id: validUserId,
				full_name: 'Test Operator',
				email: 'operator@firefighters.local',
				status: 'active',
				created_at: new Date().toISOString()
			},
			roles: ['operator']
		};

		vi.spyOn(adminSupabase, 'createSupabaseAdminClient').mockReturnValue(
			{} as unknown as SupabaseClient
		);
		const createAdminSpy = vi
			.spyOn(userAdminService, 'createAdminManagedUser')
			.mockResolvedValue(mockCreatedResult as unknown as userAdminService.AdminManagedUserResult);

		const event = createMockEvent({
			hasPermission: true,
			body: {
				email: 'operator@firefighters.local',
				password: 'StrongPassword123!',
				fullName: 'Test Operator',
				roleNames: ['operator']
			},
			profile: { id: validProfileId },
			requestId: 'req-custom-99'
		});

		const response = await POST(event);
		expect(response.status).toBe(201);

		const data = await response.json();
		expect(data).toEqual(mockCreatedResult);

		expect(createAdminSpy).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				email: 'operator@firefighters.local',
				password: 'StrongPassword123!',
				fullName: 'Test Operator',
				roleNames: ['operator'],
				actorUserId: validProfileId,
				requestId: 'req-custom-99'
			})
		);
	});

	it('returns 400 when user creation service throws', async () => {
		vi.spyOn(adminSupabase, 'createSupabaseAdminClient').mockReturnValue(
			{} as unknown as SupabaseClient
		);
		vi.spyOn(userAdminService, 'createAdminManagedUser').mockRejectedValue(
			new Error('A user with this email address has already been registered')
		);

		const event = createMockEvent({
			hasPermission: true,
			body: {
				email: 'existing@firefighters.local',
				password: 'StrongPassword123!',
				fullName: 'Existing User',
				roleNames: ['operator']
			}
		});

		const response = await POST(event);
		expect(response.status).toBe(400);

		const data = await response.json();
		expect(data.message).toBe('A user with this email address has already been registered');
	});
});
