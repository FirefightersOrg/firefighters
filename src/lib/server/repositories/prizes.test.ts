import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPrizeInDraw, listDrawPrizes } from './prizes';

function clientWithPages(
	results: Array<{ data: Record<string, unknown>[] | null; error: unknown }>
) {
	const calls: Array<[string, unknown[]]> = [];
	const builder: Record<string, unknown> = {};
	for (const method of ['select', 'eq', 'order', 'range', 'maybeSingle']) {
		builder[method] = (...args: unknown[]) => {
			calls.push([method, args]);
			return builder;
		};
	}
	let index = 0;
	builder.overrideTypes = () => Promise.resolve(results[index++] ?? results.at(-1));
	return {
		client: { from: vi.fn(() => builder) } as unknown as SupabaseClient,
		calls
	};
}

const row = (id: string) => ({
	id,
	draw_id: 'draw',
	name: 'Bike',
	description: null,
	position: 1,
	status: 'pending_validation',
	excludes_from_consolation: true,
	annulled_at: null,
	annul_reason: null,
	created_at: '2026-01-01T00:00:00Z',
	winning_numbers: {
		id: 'winner',
		number_value: 7,
		result_status: 'not_eligible',
		notes: null,
		loaded_at: '2026-11-20T02:30:00+00:00',
		matched_roster_entry_id: 'entry',
		draw_roster_entries: {
			bond_id: 'bond',
			eligible: false,
			ineligibility_reason: 'not_fully_paid',
			buyer_snapshot: {
				id: 'buyer',
				first_name: 'Ana',
				last_name: 'Pérez',
				business_name: null
			},
			collector_snapshot: { id: 'collector', display_name: 'Central station' },
			bonds: { internal_code: 'B-7' }
		}
	}
});

describe('prizes repository', () => {
	it('reads real snapshot keys and paginates deterministic 500-row batches', async () => {
		const first = Array.from({ length: 500 }, (_, i) => row(`p-${i}`));
		const { client, calls } = clientWithPages([
			{ data: first, error: null },
			{ data: [row('p-500')], error: null }
		]);
		const result = await listDrawPrizes(client, 'draw');
		expect(result.data).toHaveLength(501);
		expect(result.data?.[0].winningNumber).toMatchObject({
			buyerLabel: 'Ana Pérez',
			collectorLabel: 'Central station',
			bondLabel: 'B-7',
			ineligibilityReason: 'not_fully_paid'
		});
		expect(calls.filter(([method]) => method === 'range')).toEqual([
			['range', [0, 499]],
			['range', [500, 999]]
		]);
		expect(calls.filter(([method]) => method === 'order').map(([, args]) => args[0])).toEqual([
			'position',
			'created_at',
			'id'
		]);
	});

	it('returns a clean missing-row result', async () => {
		const { client } = clientWithPages([{ data: null, error: null }]);
		await expect(getPrizeInDraw(client, 'draw', 'missing')).resolves.toEqual({
			data: null,
			error: null
		});
	});
});
