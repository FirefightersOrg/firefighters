import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	BOND_COLUMNS,
	BOND_NUMBERS_PAGE_SIZE,
	campaignHasBonds,
	getBondById,
	getBondCampaignId,
	listBondBaseNumbers,
	listBondNumbersByCampaign,
	listBonds,
	listMembershipsOfMember,
	quotePostgrestValue,
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
	for (const method of [
		'select',
		'eq',
		'is',
		'or',
		'in',
		'contains',
		'order',
		'range',
		'limit',
		'maybeSingle'
	]) {
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

	it('reads the campaign of a bond (one column), null when not visible', async () => {
		const found = queryMock([{ data: { campaign_id: CAMPAIGN_ID }, error: null }]);
		await expect(getBondCampaignId(found.supabase, BOND_ID)).resolves.toEqual({
			data: CAMPAIGN_ID,
			error: null
		});
		expect(found.calls).toEqual([
			['from', ['bonds']],
			['select', ['campaign_id']],
			['eq', ['id', BOND_ID]],
			['maybeSingle', []]
		]);
		await expect(
			getBondCampaignId(queryMock([{ data: null, error: null }]).supabase, BOND_ID)
		).resolves.toEqual({ data: null, error: null });
		await expect(
			getBondCampaignId(queryMock([{ data: null, error: { message: 'boom' } }]).supabase, BOND_ID)
		).resolves.toEqual({ data: null, error: { message: 'boom' } });
	});

	it('lists a page of bonds from bond_list with filters, stable order and the exact count', async () => {
		const row = {
			id: BOND_ID,
			campaign_id: CAMPAIGN_ID,
			kind: 'pata',
			origin: 'manual_grouping',
			internal_code: null,
			barcode: 'BC,1',
			commercial_status: 'available',
			financial_status_snapshot: 'no_payments',
			commercial_unit_count: 2,
			total_value: 120000,
			created_at: '2026-11-17T12:00:00+00:00',
			base_numbers: [68, 69],
			associated_numbers: null,
			group_pata_id: null
		};
		const { supabase, calls } = queryMock([{ data: [row], error: null, count: 30 } as never]);
		const result = await listBonds(
			supabase,
			CAMPAIGN_ID,
			{
				baseNumber: 68,
				associatedNumber: 4940,
				code: 'BC,1',
				kind: 'pata',
				commercialStatus: 'available',
				financialStatus: 'no_payments'
			},
			{ page: 2, pageSize: 10 }
		);
		expect(result).toEqual({
			data: {
				entries: [
					{
						id: BOND_ID,
						campaignId: CAMPAIGN_ID,
						kind: 'pata',
						origin: 'manual_grouping',
						internalCode: null,
						barcode: 'BC,1',
						commercialStatus: 'available',
						financialStatus: 'no_payments',
						commercialUnitCount: 2,
						totalValue: '120000.00',
						createdAt: '2026-11-17T12:00:00+00:00',
						baseNumbers: [68, 69],
						associatedNumbers: [],
						groupPataId: null
					}
				],
				total: 30
			},
			error: null
		});
		expect(calls).toEqual([
			['from', ['bond_list']],
			['select', [expect.stringContaining('total_value::text'), { count: 'exact' }]],
			['eq', ['campaign_id', CAMPAIGN_ID]],
			['contains', ['base_numbers', [68]]],
			['contains', ['associated_numbers', [4940]]],
			['or', ['barcode.eq."BC,1",internal_code.eq."BC,1"']],
			['eq', ['kind', 'pata']],
			['eq', ['commercial_status', 'available']],
			['eq', ['financial_status_snapshot', 'no_payments']],
			['order', ['sort_number', { ascending: true, nullsFirst: false }]],
			['order', ['created_at', { ascending: true }]],
			['order', ['id', { ascending: true }]],
			['range', [10, 19]]
		]);

		const failed = queryMock([{ data: null, error: { message: 'boom' } }]);
		await expect(listBonds(failed.supabase, CAMPAIGN_ID, {}, { page: 1 })).resolves.toEqual({
			data: null,
			error: { message: 'boom' }
		});
	});

	it('quotes PostgREST logic-filter values', () => {
		expect(quotePostgrestValue('A,B')).toBe('"A,B"');
		expect(quotePostgrestValue('a"b\\c')).toBe('"a\\"b\\\\c"');
	});

	it('reads base numbers of several bonds, without a query for none', async () => {
		const none = queryMock([]);
		await expect(listBondBaseNumbers(none.supabase, [])).resolves.toEqual({
			data: new Map(),
			error: null
		});
		expect(none.calls).toEqual([]);
		const { supabase, calls } = queryMock([
			{ data: [{ id: PATA_ID, base_numbers: [68, 69] }], error: null }
		]);
		const result = await listBondBaseNumbers(supabase, [PATA_ID]);
		expect(result.data?.get(PATA_ID)).toEqual([68, 69]);
		expect(calls).toContainEqual(['in', ['id', [PATA_ID]]]);
	});

	it('lists every pata a bond was a member of, oldest first', async () => {
		const ungrouped = {
			...groupRow,
			ungrouped_at: '2026-11-17T13:00:00+00:00',
			ungrouped_by: 'p1',
			reason: 'Wrong'
		};
		const { supabase, calls } = queryMock([{ data: [ungrouped], error: null }]);
		const result = await listMembershipsOfMember(supabase, BOND_ID);
		expect(result.data).toEqual([
			{
				id: 'g1',
				pataBondId: PATA_ID,
				memberBondId: BOND_ID,
				groupedAt: '2026-11-17T12:00:00+00:00',
				groupedBy: 'p1',
				ungroupedAt: '2026-11-17T13:00:00+00:00',
				ungroupedBy: 'p1',
				reason: 'Wrong'
			}
		]);
		expect(calls).toContainEqual(['eq', ['member_bond_id', BOND_ID]]);
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
