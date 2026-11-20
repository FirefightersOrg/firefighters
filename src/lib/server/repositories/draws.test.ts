import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listBondDrawRosterEntries, listDrawRosterEntries } from './draws';

function queryMock(data: Record<string, unknown>[]) {
	const calls: Array<[string, unknown[]]> = [];
	const builder: Record<string, unknown> = {};
	for (const method of ['select', 'eq', 'in', 'order', 'range']) {
		builder[method] = (...args: unknown[]) => {
			calls.push([method, args]);
			return builder;
		};
	}
	builder.overrideTypes = () => Promise.resolve({ data, error: null });
	return {
		client: {
			from: vi.fn((table: string) => {
				calls.push(['from', [table]]);
				return builder;
			})
		} as unknown as SupabaseClient,
		calls
	};
}

const entry = (
	id: string,
	buyer_snapshot: Record<string, unknown>,
	collector_snapshot: Record<string, unknown>
) => ({
	id,
	draw_roster_id: 'roster-1',
	bond_id: 'bond-1',
	bond_number_id: `number-${id}`,
	number_value: 12,
	buyer_snapshot,
	collector_snapshot,
	eligible: true,
	ineligibility_reason: null,
	created_at: '2026-11-20T03:00:00+00:00',
	created_by: 'user-1',
	updated_at: '2026-11-20T03:00:00+00:00',
	bond_numbers: { number_kind: 'base' },
	bonds: { kind: 'simple', internal_code: 'B-1' }
});

describe('draws repository', () => {
	it('builds roster labels from the real buyer and collector snapshot keys', async () => {
		const businessBuyer = {
			id: 'buyer-1',
			first_name: 'Ignored',
			last_name: 'Name',
			business_name: 'Fire Supplies SA',
			document_number: '12345',
			tax_id: '30-12345678-9'
		};
		const personBuyer = {
			id: 'buyer-2',
			first_name: 'Ana',
			last_name: 'Pérez',
			business_name: null,
			document_number: '23456',
			tax_id: null
		};
		const collector = {
			id: 'collector-1',
			display_name: 'Roster collector',
			user_profile_id: 'profile-1'
		};
		const { client } = queryMock([
			entry('entry-1', businessBuyer, collector),
			entry('entry-2', personBuyer, collector)
		]);

		const result = await listDrawRosterEntries(client, 'roster-1');

		expect(
			result.data?.map(({ buyerName, collectorName }) => ({ buyerName, collectorName }))
		).toEqual([
			{ buyerName: 'Fire Supplies SA', collectorName: 'Roster collector' },
			{ buyerName: 'Ana Pérez', collectorName: 'Roster collector' }
		]);
	});

	it('excludes entries from superseded rosters on a bond detail', async () => {
		const { client, calls } = queryMock([]);

		await listBondDrawRosterEntries(client, 'campaign-1', 'bond-1');

		expect(calls).toContainEqual(['in', ['draw_rosters.status', ['generated', 'frozen']]]);
	});
});
