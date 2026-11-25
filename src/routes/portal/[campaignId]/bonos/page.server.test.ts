import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';
import { load as detailLoad } from './[bondId]/+page.server';
import {
	CAMPAIGN_ID,
	campaignRow,
	makeLocals,
	mockSupabase
} from '../../../campaigns/test-helpers';

const COLLECTOR = {
	id: 'c0000000-0000-0000-0000-000000000001',
	display_name: 'Ana',
	status: 'active'
};
const BOND_ID = 'b0000000-0000-0000-0000-000000000001';
const PERMISSIONS = ['campaign.view', 'bond.view_own'];

function bondRow(overrides = {}) {
	return {
		id: BOND_ID,
		kind: 'simple',
		commercial_status: 'delivered_to_collector',
		financial_status_snapshot: 'no_payments',
		commercial_unit_count: 1,
		total_value: '60000.00',
		bond_numbers: [
			{ number_value: 4939, number_kind: 'associated', released_at: null },
			{ number_value: 68, number_kind: 'base', released_at: null },
			{ number_value: 70, number_kind: 'base', released_at: '2026-11-01T00:00:00Z' }
		],
		...overrides
	};
}

function setup(
	tables: Record<string, { data: unknown; error: unknown; count?: number }>,
	permissions: string[] | null = PERMISSIONS,
	rpcData: unknown = [COLLECTOR]
) {
	const mock = mockSupabase({
		tables: { campaigns: { data: campaignRow(), error: null }, ...tables },
		rpc: { data: rpcData, error: null }
	});
	return { ...mock, locals: makeLocals({ supabase: mock.supabase, permissions }) };
}

const listEvent = (locals: App.Locals, search = '', campaignId = CAMPAIGN_ID) =>
	({
		locals,
		params: { campaignId },
		url: new URL(`http://localhost/portal/${campaignId}/bonos${search}`)
	}) as unknown as Parameters<typeof load>[0];
const detailEvent = (locals: App.Locals, bondId = BOND_ID) =>
	({
		locals,
		params: { campaignId: CAMPAIGN_ID, bondId },
		url: new URL(`http://localhost/portal/${CAMPAIGN_ID}/bonos/${bondId}`)
	}) as unknown as Parameters<typeof detailLoad>[0];

describe('/portal/[campaignId]/bonos', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('lists own bonds filtered by the session collector, in a stable order, with formatted numbers', async () => {
		const { locals, chains, rpc } = setup({
			bonds: { data: [bondRow()], error: null, count: 1 }
		});
		const result = (await load(listEvent(locals)))!;
		expect(rpc).toHaveBeenCalledWith('portal_my_collector');
		const chain = chains.bonds[0];
		expect(chain.eq).toHaveBeenCalledWith('current_collector_id', COLLECTOR.id);
		expect(chain.order.mock.calls).toEqual([
			['created_at', { ascending: true }],
			['id', { ascending: true }]
		]);
		expect(chain.range).toHaveBeenCalledWith(0, 24);
		expect(result.bonds).toHaveLength(1);
		expect(result.bonds[0]).toMatchObject({
			baseNumbers: ['0068'],
			associatedNumbers: ['4939'],
			typeLabel: 'Bono simple'
		});
		expect(result.pagination).toMatchObject({ page: 1, total: 1, pageCount: 1 });
	});

	it('ignores a collector id passed in the URL and pages with a range', async () => {
		const { locals, chains } = setup({ bonds: { data: [], error: null, count: 60 } });
		const result = (await load(
			listEvent(locals, '?collector=other&page=3&status=sold&financial=nope')
		))!;
		const chain = chains.bonds[0];
		expect(chain.eq).toHaveBeenCalledWith('current_collector_id', COLLECTOR.id);
		expect(chain.eq).toHaveBeenCalledWith('commercial_status', 'sold');
		expect(chain.eq).not.toHaveBeenCalledWith('financial_status_snapshot', 'nope');
		expect(chain.range).toHaveBeenCalledWith(50, 74);
		expect(result.pagination.pageCount).toBe(3);
	});

	it('shows an empty portal for an unlinked profile without reading bonds', async () => {
		const { locals, from } = setup({}, PERMISSIONS, []);
		const result = (await load(listEvent(locals)))!;
		expect(result.collector).toBeNull();
		expect(result.bonds).toEqual([]);
		expect(from).not.toHaveBeenCalledWith('bonds');
	});

	it('null permissions answer 500, a missing permission 403, a bad id or campaign 404', async () => {
		await expect(load(listEvent(setup({}, null).locals))).rejects.toMatchObject({ status: 500 });
		await expect(load(listEvent(setup({}, ['campaign.view']).locals))).rejects.toMatchObject({
			status: 403
		});
		await expect(load(listEvent(setup({}).locals, '', 'nope'))).rejects.toMatchObject({
			status: 404
		});
		const none = setup({ campaigns: { data: null, error: null } });
		await expect(load(listEvent(none.locals))).rejects.toMatchObject({ status: 404 });
	});

	it('a failed read answers 500', async () => {
		const { locals } = setup({ bonds: { data: null, error: { message: 'boom' } } });
		await expect(load(listEvent(locals))).rejects.toMatchObject({ status: 500 });
	});
});

describe('/portal/[campaignId]/bonos/[bondId]', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('returns the bond, own assignments and notes; print links only with bond.view', async () => {
		const tables = {
			bonds: { data: bondRow(), error: null },
			bond_assignments: {
				data: [
					{
						id: 'a1',
						assignment_type: 'delivery',
						status: 'active',
						assigned_at: '2026-11-02T12:00:00Z',
						returned_at: null,
						delivery_note: { note_number: 7 }
					}
				],
				error: null
			},
			delivery_notes: {
				data: [
					{
						id: 'n1',
						note_number: 7,
						reason: 'delivery',
						status: 'issued',
						issued_at: '2026-11-02T12:00:00Z'
					}
				],
				error: null
			}
		};
		const own = setup(tables);
		const result = (await detailLoad(detailEvent(own.locals)))!;
		expect(own.chains.bonds[0].eq).toHaveBeenCalledWith('current_collector_id', COLLECTOR.id);
		expect(own.chains.bond_assignments[0].eq).toHaveBeenCalledWith('collector_id', COLLECTOR.id);
		expect(own.chains.delivery_notes[0].eq).toHaveBeenCalledWith('collector_id', COLLECTOR.id);
		expect(result.assignments).toEqual([
			expect.objectContaining({ assignmentType: 'delivery', status: 'active', noteNumber: 7 })
		]);
		expect(result.notes).toHaveLength(1);
		expect(result.canPrintNotes).toBe(false);
		const staff = setup(tables, [...PERMISSIONS, 'bond.view']);
		expect((await detailLoad(detailEvent(staff.locals)))!.canPrintNotes).toBe(true);
	});

	it('404 for a bond that is not the collector own, a bad id, or an unlinked profile', async () => {
		const { locals } = setup({ bonds: { data: null, error: null } });
		await expect(detailLoad(detailEvent(locals))).rejects.toMatchObject({ status: 404 });
		await expect(detailLoad(detailEvent(setup({}).locals, 'nope'))).rejects.toMatchObject({
			status: 404
		});
		await expect(detailLoad(detailEvent(setup({}, PERMISSIONS, []).locals))).rejects.toMatchObject({
			status: 404
		});
	});

	it('null permissions answer 500', async () => {
		await expect(detailLoad(detailEvent(setup({}, null).locals))).rejects.toMatchObject({
			status: 500
		});
	});
});
