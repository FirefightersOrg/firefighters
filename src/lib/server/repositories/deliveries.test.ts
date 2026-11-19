import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deliveryDateBounds, listDeliveryNoteBonds } from './deliveries';

function deliveryNoteBondsClient(data: unknown) {
	const query = {
		select: () => query,
		eq: () => query,
		overrideTypes: () => Promise.resolve({ data, error: null })
	};
	return { from: () => query } as unknown as SupabaseClient;
}

const simple = (id: string, base: number) => ({
	id,
	kind: 'simple',
	commercial_unit_count: 1,
	barcode: null,
	numbers: [
		{
			id: `${id}-base`,
			number_value: base,
			number_kind: 'base',
			source_base_number_id: null,
			barcode: null
		}
	],
	groups: []
});

describe('listDeliveryNoteBonds', () => {
	it('sorts bonds and preserves manual-pata members valid when the note was issued', async () => {
		const issuedAt = '2026-11-18T15:30:00Z';
		const result = await listDeliveryNoteBonds(
			deliveryNoteBondsClient([
				{
					bond: {
						...simple('pata', 999),
						kind: 'pata',
						numbers: [],
						groups: [
							{
								grouped_at: '2026-11-01T00:00:00Z',
								ungrouped_at: '2026-11-20T00:00:00Z',
								member: simple('later-ungrouped', 201)
							},
							{
								grouped_at: '2026-11-01T00:00:00Z',
								ungrouped_at: null,
								member: simple('active', 200)
							},
							{
								grouped_at: '2026-11-19T00:00:00Z',
								ungrouped_at: null,
								member: simple('future', 202)
							}
						]
					}
				},
				{ bond: simple('first', 100) }
			]),
			'note',
			issuedAt
		);

		expect(result).toMatchObject({
			data: [
				{ id: 'first' },
				{ id: 'pata', members: [{ id: 'active' }, { id: 'later-ungrouped' }] }
			],
			error: null
		});
	});
});

describe('deliveryDateBounds', () => {
	it('uses half-open Argentina calendar-day bounds', () => {
		expect(deliveryDateBounds({ from: '2026-11-18', to: '2026-11-18' })).toEqual({
			from: '2026-11-18T00:00:00-03:00',
			to: '2026-11-19T00:00:00-03:00'
		});
	});
});
