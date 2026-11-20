import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	AUDIT_ENTRIES_LIMIT,
	AUDIT_PAGE_SIZE,
	listAuditEntriesForEntities,
	listCampaignAuditEntries
} from './audit-log';

function queryMock(result: { data: unknown; error: unknown; count?: number }) {
	const calls: Array<[string, unknown[]]> = [];
	const builder: Record<string, unknown> = {};
	for (const method of ['select', 'eq', 'in', 'or', 'gte', 'lte', 'order', 'limit', 'range']) {
		builder[method] = (...args: unknown[]) => {
			calls.push([method, args]);
			return builder;
		};
	}
	builder.overrideTypes = () => Promise.resolve(result);
	const from = vi.fn((table: string) => {
		calls.push(['from', [table]]);
		return builder;
	});
	return { supabase: { from } as unknown as SupabaseClient, calls };
}

describe('audit log repository', () => {
	it('reads the entries of some entities, newest first, with the actor name when visible', async () => {
		const { supabase, calls } = queryMock({
			data: [
				{
					id: 'a1',
					action: 'bond.create',
					entity_type: 'bond',
					entity_id: 'b1',
					actor_user_id: 'p1',
					old_value: null,
					new_value: { numbers: [] },
					reason: null,
					created_at: '2026-11-17T12:00:00+00:00',
					request_id: 'r1',
					actor: { full_name: 'Admin' }
				},
				{
					id: 'a0',
					action: 'bond.group',
					entity_type: 'bond',
					entity_id: 'b2',
					actor_user_id: 'p2',
					old_value: null,
					new_value: null,
					reason: null,
					created_at: '2026-11-17T11:00:00+00:00',
					request_id: null,
					actor: null
				}
			],
			error: null
		});
		const result = await listAuditEntriesForEntities(supabase, 'bond', ['b1', 'b2']);
		expect(result.data?.map((e) => [e.id, e.actorName])).toEqual([
			['a1', 'Admin'],
			['a0', null]
		]);
		expect(calls).toEqual([
			['from', ['audit_log']],
			['select', [expect.stringContaining('actor:profiles!audit_log_actor_user_id_fkey')]],
			['eq', ['entity_type', 'bond']],
			['in', ['entity_id', ['b1', 'b2']]],
			['order', ['created_at', { ascending: false }]],
			['order', ['id', { ascending: false }]],
			['limit', [AUDIT_ENTRIES_LIMIT]]
		]);
	});

	it('does not query for no entities and passes errors through', async () => {
		const none = queryMock({ data: [], error: null });
		await expect(listAuditEntriesForEntities(none.supabase, 'bond', [])).resolves.toEqual({
			data: [],
			error: null
		});
		expect(none.calls).toEqual([]);
		const failed = queryMock({ data: null, error: { message: 'boom' } });
		await expect(listAuditEntriesForEntities(failed.supabase, 'bond', ['b1'])).resolves.toEqual({
			data: null,
			error: { message: 'boom' }
		});
	});

	it('uses deterministic explicit ranges beyond PostgREST row 1000 with BA date boundaries', async () => {
		const { supabase, calls } = queryMock({ data: [], error: null, count: 1051 });
		const result = await listCampaignAuditEntries(
			supabase,
			'f0000000-0000-4000-8000-000000000001',
			{
				actor: 'a0000000-0000-4000-8000-000000000001',
				action: 'payment.annul',
				entityType: 'payment',
				from: '2026-11-01',
				to: '2026-11-19',
				page: 21
			}
		);
		expect(result.data).toMatchObject({
			total: 1051,
			page: 21,
			pageSize: AUDIT_PAGE_SIZE
		});
		expect(calls).toContainEqual(['gte', ['created_at', '2026-11-01T00:00:00-03:00']]);
		expect(calls).toContainEqual(['lte', ['created_at', '2026-11-19T23:59:59.999999-03:00']]);
		expect(calls).toContainEqual(['order', ['created_at', { ascending: false }]]);
		expect(calls).toContainEqual(['order', ['id', { ascending: false }]]);
		expect(calls).toContainEqual(['range', [1000, 1049]]);
	});
});
