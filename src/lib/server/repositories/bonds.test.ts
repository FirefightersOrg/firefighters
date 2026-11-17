import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	BOND_COLUMNS,
	BOND_NUMBERS_PAGE_SIZE,
	campaignHasBonds,
	getBondById,
	listBondNumbersByCampaign,
	mapBondRow,
	type BondGroupRow,
	type BondNumberRow,
	type BondRow
} from './bonds';

const BOND_ID = 'e0000000-0000-0000-0000-00000000000a';
const PATA_ID = 'e0000000-0000-0000-0000-00000000000b';
const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';

const bondRow: BondRow = {
	id: BOND_ID,
	campaign_id: CAMPAIGN_ID,
	kind: 'simple',
	origin: 'printed',
	internal_code: 'INT-1',
	barcode: null,
	commercial_status: 'available',
	financial_status_snapshot: 'no_payments',
	current_collector_id: null,
	current_buyer_id: null,
	commercial_unit_count: 1,
	total_value: '60000.00',
	annulled_at: null,
	annulled_by: null,
	annul_reason: null,
	annulled_from_status: null,
	created_by: null,
	created_at: '2026-11-17T12:00:00+00:00',
	updated_at: '2026-11-17T12:00:00+00:00'
};

const numberRow = (value: number, kind: string, id = `n-${value}`): BondNumberRow => ({
	id,
	campaign_id: CAMPAIGN_ID,
	bond_id: BOND_ID,
	number_value: value,
	number_kind: kind,
	source_base_number_id: kind === 'associated' ? 'n-68' : null,
	created_at: '2026-11-17T12:00:00+00:00',
	released_at: null,
	released_by: null
});

const groupRow: BondGroupRow = {
	id: 'g1',
	pata_bond_id: PATA_ID,
	member_bond_id: BOND_ID,
	grouped_at: '2026-11-17T12:00:00+00:00',
	grouped_by: 'p1',
	ungrouped_at: null,
	ungrouped_by: null,
	reason: null
};

/** A chainable PostgREST query mock: every builder method returns itself; awaiting it resolves the next queued result. */
function queryMock(results: Array<{ data: unknown; error: unknown }>) {
	const calls: Array<[string, unknown[]]> = [];
	const builder: Record<string, unknown> = {};
	for (const method of ['select', 'eq', 'is', 'or', 'order', 'range', 'limit', 'maybeSingle']) {
		builder[method] = (...args: unknown[]) => {
			calls.push([method, args]);
			return builder;
		};
	}
	builder.overrideTypes = () => Promise.resolve(results.shift());
	const from = vi.fn((table: string) => {
		calls.push(['from', [table]]);
		return builder;
	});
	return { supabase: { from } as unknown as SupabaseClient, calls };
}

describe('bonds repository', () => {
	it('tells whether a campaign has any bond, reading one id at most', async () => {
		const withBonds = queryMock([{ data: [{ id: BOND_ID }], error: null }]);
		await expect(campaignHasBonds(withBonds.supabase, CAMPAIGN_ID)).resolves.toEqual({
			data: true,
			error: null
		});
		expect(withBonds.calls).toEqual([
			['from', ['bonds']],
			['select', ['id']],
			['eq', ['campaign_id', CAMPAIGN_ID]],
			['limit', [1]]
		]);

		await expect(
			campaignHasBonds(queryMock([{ data: [], error: null }]).supabase, CAMPAIGN_ID)
		).resolves.toEqual({ data: false, error: null });
		await expect(
			campaignHasBonds(
				queryMock([{ data: null, error: { message: 'boom' } }]).supabase,
				CAMPAIGN_ID
			)
		).resolves.toEqual({ data: null, error: { message: 'boom' } });
	});

	it('selects money as text and maps rows', () => {
		expect(BOND_COLUMNS).toContain('total_value::text');
		expect(mapBondRow({ ...bondRow, total_value: 60000 }).totalValue).toBe('60000.00');
		expect(() => mapBondRow({ ...bondRow, commercial_status: 'grouped' })).toThrow(
			/commercial_status/
		);
	});

	it('maps the status a bond was annulled from', () => {
		expect(BOND_COLUMNS).toContain('annulled_from_status');
		expect(mapBondRow(bondRow).annulledFromStatus).toBeNull();
		expect(
			mapBondRow({
				...bondRow,
				commercial_status: 'annulled',
				annulled_at: '2026-11-17T12:00:00+00:00',
				annulled_by: 'p1',
				annul_reason: 'Loaded by mistake',
				annulled_from_status: 'available'
			}).annulledFromStatus
		).toBe('available');
		expect(() => mapBondRow({ ...bondRow, annulled_from_status: 'grouped' })).toThrow(
			/annulled_from_status/
		);
	});

	it('gets a bond with its numbers (base first) and its active group', async () => {
		const { supabase, calls } = queryMock([
			{ data: bondRow, error: null },
			{ data: [numberRow(4939, 'associated'), numberRow(68, 'base')], error: null },
			{ data: [groupRow], error: null }
		]);
		const result = await getBondById(supabase, BOND_ID);
		expect(result.error).toBeNull();
		expect(result.data?.numbers.map((n) => [n.numberValue, n.numberKind])).toEqual([
			[68, 'base'],
			[4939, 'associated']
		]);
		expect(result.data?.activeGroup).toMatchObject({ pataBondId: PATA_ID, memberBondId: BOND_ID });
		expect(result.data?.activeMembers).toEqual([]);
		expect(calls).toContainEqual([
			'or',
			[`member_bond_id.eq.${BOND_ID},pata_bond_id.eq.${BOND_ID}`]
		]);
		expect(calls).toContainEqual(['is', ['ungrouped_at', null]]);
	});

	it('lists the active members of a manual pata', async () => {
		const { supabase } = queryMock([
			{
				data: {
					...bondRow,
					id: PATA_ID,
					kind: 'pata',
					origin: 'manual_grouping',
					commercial_unit_count: 2
				},
				error: null
			},
			{ data: [], error: null },
			{ data: [{ ...groupRow }, { ...groupRow, id: 'g2', member_bond_id: 'other' }], error: null }
		]);
		const result = await getBondById(supabase, PATA_ID);
		expect(result.data?.activeGroup).toBeNull();
		expect(result.data?.activeMembers.map((m) => m.memberBondId)).toEqual([BOND_ID, 'other']);
	});

	it('returns null for a missing bond and errors without throwing', async () => {
		await expect(
			getBondById(queryMock([{ data: null, error: null }]).supabase, BOND_ID)
		).resolves.toEqual({
			data: null,
			error: null
		});
		const failed = await getBondById(
			queryMock([
				{ data: bondRow, error: null },
				{ data: null, error: { message: 'boom' } },
				{ data: [], error: null }
			]).supabase,
			BOND_ID
		);
		expect(failed).toMatchObject({ data: null, error: { message: 'boom' } });
	});

	it('lists live campaign numbers across pages', async () => {
		const fullPage = Array.from({ length: BOND_NUMBERS_PAGE_SIZE }, (_, i) =>
			numberRow(i, 'base', `id-${i}`)
		);
		const { supabase, calls } = queryMock([
			{ data: fullPage, error: null },
			{ data: [numberRow(5000, 'base')], error: null }
		]);
		const result = await listBondNumbersByCampaign(supabase, CAMPAIGN_ID);
		expect(result.data).toHaveLength(BOND_NUMBERS_PAGE_SIZE + 1);
		expect(calls.filter(([m]) => m === 'range').map(([, args]) => args)).toEqual([
			[0, BOND_NUMBERS_PAGE_SIZE - 1],
			[BOND_NUMBERS_PAGE_SIZE, 2 * BOND_NUMBERS_PAGE_SIZE - 1]
		]);
		expect(calls).toContainEqual(['is', ['released_at', null]]);
	});

	it('can include released numbers', async () => {
		const { supabase, calls } = queryMock([{ data: [], error: null }]);
		await listBondNumbersByCampaign(supabase, CAMPAIGN_ID, { includeReleased: true });
		expect(calls.some(([m]) => m === 'is')).toBe(false);
	});
});
