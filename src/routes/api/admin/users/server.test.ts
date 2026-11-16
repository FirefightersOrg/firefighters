import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserProfile } from '../../../../app';
import * as userAdminService from '$lib/server/services/user-admin';
import { UserAdminError } from '$lib/server/services/user-admin';
import * as adminSupabase from '$lib/server/supabase/admin';

describe('POST /api/admin/users', () => {
	const validUserId = '11111111-1111-4111-8111-111111111111';
	const validProfileId = '22222222-2222-4222-8222-222222222222';

	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	function createMockEvent(options: {
		body?: unknown;
		hasPermission?: boolean;
		permissionRpcError?: boolean;
		profile?: Partial<UserProfile> | null;
		user?: { id: string } | null;
		requestId?: string;
	}): RequestEvent {
		const rpcMock = vi.fn().mockImplementation((fn: string) => {
			if (fn === 'has_permission') {
				if (options.permissionRpcError) {
					return Promise.resolve({ data: null, error: { message: 'rpc failed' } });
				}
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
				user: options.user === null ? null : (options.user ?? { id: validUserId }),
				profile:
					options.profile === null
						? null
						: ((options.profile ?? { id: validProfileId }) as unknown as UserProfile),
				requestId: options.requestId ?? 'req-123'
			}
		} as unknown as RequestEvent;
	}

	it('returns 401 when there is no authenticated user with an active profile', async () => {
		await expect(POST(createMockEvent({ user: null, profile: null }))).rejects.toMatchObject({
			status: 401,
			body: expect.objectContaining({ code: 'unauthenticated' })
		});
		await expect(POST(createMockEvent({ profile: null }))).rejects.toMatchObject({
			status: 401
		});
	});

	it('returns 500 when the permission check itself fails', async () => {
		await expect(POST(createMockEvent({ permissionRpcError: true }))).rejects.toMatchObject({
			status: 500,
			body: expect.objectContaining({ code: 'permission_check_failed' })
		});
	});

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

	const validBody = {
		email: 'existing@firefighters.local',
		password: 'StrongPassword123!',
		fullName: 'Existing User',
		roleNames: ['operator']
	};

	function mockServiceFailure(err: unknown) {
		vi.spyOn(adminSupabase, 'createSupabaseAdminClient').mockReturnValue(
			{} as unknown as SupabaseClient
		);
		vi.spyOn(userAdminService, 'createAdminManagedUser').mockRejectedValue(err);
	}

	it('returns 409 when the email already exists', async () => {
		mockServiceFailure(new UserAdminError('conflict', 'raw upstream message'));

		const response = await POST(createMockEvent({ body: validBody }));
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			message: 'A user with this email already exists',
			code: 'email_exists'
		});
	});

	it('returns 400 for service-level validation errors (e.g. unknown role)', async () => {
		mockServiceFailure(new UserAdminError('validation', 'Unknown role(s): ghost'));

		const response = await POST(createMockEvent({ body: validBody }));
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			message: 'Unknown role(s): ghost',
			code: 'validation_failed'
		});
	});

	it('returns a generic 500 for internal errors and logs the details', async () => {
		mockServiceFailure(new UserAdminError('internal', 'Failed to query roles: secret pg detail'));

		const response = await POST(createMockEvent({ body: validBody, requestId: 'req-500' }));
		expect(response.status).toBe(500);
		const data = await response.json();
		expect(data).toEqual({
			message: 'Failed to create user',
			code: 'internal_error',
			requestId: 'req-500'
		});
		expect(JSON.stringify(data)).not.toContain('secret');
		expect(console.error).toHaveBeenCalled();
	});

	it('returns a generic 500 for unexpected exceptions', async () => {
		mockServiceFailure(new Error('boom'));

		const response = await POST(createMockEvent({ body: validBody }));
		expect(response.status).toBe(500);
		expect((await response.json()).message).toBe('Failed to create user');
	});
});
