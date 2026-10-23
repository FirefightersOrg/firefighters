import { describe, it, expect, vi } from 'vitest';
import { recordAuditLog, auditLogEntrySchema } from './audit';
import type { SupabaseClient } from '@supabase/supabase-js';

function createMockSupabase(
	insertHandler?: (row: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
) {
	return {
		from: vi.fn().mockImplementation((table: string) => {
			expect(table).toBe('audit_log');
			return {
				insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
					if (insertHandler) {
						return insertHandler(row);
					}
					return Promise.resolve({ data: null, error: null });
				})
			};
		})
	} as unknown as SupabaseClient;
}

describe('recordAuditLog', () => {
	const validActorId = '22222222-2222-4222-8222-222222222222';

	it('inserts correctly formatted snake_case row into audit_log', async () => {
		let insertedRow: Record<string, unknown> | null = null;
		const client = createMockSupabase(async (row) => {
			insertedRow = row;
			return { data: null, error: null };
		});

		await recordAuditLog(client, {
			actorUserId: validActorId,
			action: 'campaign.create',
			entityType: 'campaign',
			entityId: 'camp-123',
			oldValue: null,
			newValue: { name: 'Campaign 2026', totalBonds: 1000 },
			reason: 'Annual campaign setup',
			requestId: 'req-456'
		});

		expect(insertedRow).toEqual({
			actor_user_id: validActorId,
			action: 'campaign.create',
			entity_type: 'campaign',
			entity_id: 'camp-123',
			old_value: null,
			new_value: { name: 'Campaign 2026', totalBonds: 1000 },
			reason: 'Annual campaign setup',
			request_id: 'req-456'
		});
	});

	it('handles optional and omitted fields by defaulting to null', async () => {
		let insertedRow: Record<string, unknown> | null = null;
		const client = createMockSupabase(async (row) => {
			insertedRow = row;
			return { data: null, error: null };
		});

		await recordAuditLog(client, {
			action: 'system.bootstrap',
			entityType: 'system'
		});

		expect(insertedRow).toEqual({
			actor_user_id: null,
			action: 'system.bootstrap',
			entity_type: 'system',
			entity_id: null,
			old_value: null,
			new_value: null,
			reason: null,
			request_id: null
		});
	});

	it('throws an error if Supabase insert fails', async () => {
		const client = createMockSupabase(async () => {
			return {
				data: null,
				error: { message: 'relation audit_log does not exist', code: '42P01' }
			};
		});

		await expect(
			recordAuditLog(client, {
				action: 'user.create',
				entityType: 'user'
			})
		).rejects.toThrow(/Failed to record audit log: relation audit_log does not exist/);
	});

	describe('Zod validation', () => {
		it('rejects missing action', async () => {
			const client = createMockSupabase();
			await expect(
				recordAuditLog(client, {
					action: '',
					entityType: 'user'
				})
			).rejects.toThrow();
		});

		it('rejects missing entityType', async () => {
			const client = createMockSupabase();
			await expect(
				recordAuditLog(client, {
					action: 'user.create',
					entityType: ''
				})
			).rejects.toThrow();
		});

		it('rejects invalid UUID for actorUserId', async () => {
			const client = createMockSupabase();
			await expect(
				recordAuditLog(client, {
					actorUserId: 'not-a-valid-uuid',
					action: 'user.create',
					entityType: 'user'
				})
			).rejects.toThrow();
		});

		it('accepts null, undefined, or valid UUID for actorUserId', () => {
			expect(
				auditLogEntrySchema.safeParse({
					actorUserId: null,
					action: 'act',
					entityType: 'ent'
				}).success
			).toBe(true);

			expect(
				auditLogEntrySchema.safeParse({
					actorUserId: undefined,
					action: 'act',
					entityType: 'ent'
				}).success
			).toBe(true);

			expect(
				auditLogEntrySchema.safeParse({
					actorUserId: validActorId,
					action: 'act',
					entityType: 'ent'
				}).success
			).toBe(true);
		});
	});
});
