import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';
import {
	ADMIN_PERMISSIONS,
	CAMPAIGN_ID,
	campaignRow,
	makeLocals,
	mockSupabase,
	postRequest,
	profile
} from '../../../test-helpers';

vi.mock('$lib/server/services/deliveries', async (original) => ({
	...(await original<typeof import('$lib/server/services/deliveries')>()),
	returnBondsFromCollector: vi.fn(),
	reassignBondsToCollector: vi.fn(),
	markBondLost: vi.fn()
}));
import {
	DeliveryServiceError,
	markBondLost,
	reassignBondsToCollector,
	returnBondsFromCollector
} from '$lib/server/services/deliveries';

/** SAN-55: custody (return / reassign / mark lost) on the bond record. */

const BOND_ID = 'b0000000-0000-0000-0000-000000000001';
const COLLECTOR = 'c0000000-0000-0000-0000-000000000002';
const NOTE = 'n0000000-0000-0000-0000-000000000009';
const ADMIN = [
	...ADMIN_PERMISSIONS,
	'bond.view',
	'bond.assign',
	'bond.return',
	'bond.mark_lost',
	'collector.view'
];
const OPERATOR = ['campaign.view', 'bond.view', 'bond.assign'];

function bondRow(status: string) {
	return {
		id: BOND_ID,
		campaign_id: CAMPAIGN_ID,
		kind: 'simple',
		origin: 'printed',
		internal_code: null,
		barcode: null,
		commercial_status: status,
		financial_status_snapshot: 'no_payments',
		current_collector_id:
			status === 'delivered_to_collector' ? 'c0000000-0000-0000-0000-000000000001' : null,
		current_buyer_id: null,
		commercial_unit_count: 1,
		total_value: '60000.00',
		annulled_at: null,
		annulled_by: null,
		annul_reason: null,
		annulled_from_status: null,
		created_by: profile.id,
		created_at: '2026-11-17T12:00:00+00:00',
		updated_at: '2026-11-17T12:00:00+00:00'
	};
}

function setup(permissions = ADMIN, status = 'delivered_to_collector', campaign = 'active') {
	const mock = mockSupabase({
		tables: {
			campaigns: { data: campaignRow({ status: campaign as never }), error: null },
			bonds: { data: bondRow(status), error: null },
			bond_numbers: { data: [], error: null },
			bond_groups: { data: [], error: null },
			bond_list: { data: [], error: null },
			bond_assignments: { data: [], error: null },
			collectors: {
				data: [
					{ id: 'c0000000-0000-0000-0000-000000000001', display_name: 'Ana', status: 'active' },
					{ id: COLLECTOR, display_name: 'Beto', status: 'active' }
				],
				error: null
			},
			audit_log: { data: [], error: null }
		}
	});
	return makeLocals({ supabase: mock.supabase, permissions });
}

const loadEvent = (locals: App.Locals) =>
	({
		locals,
		params: { id: CAMPAIGN_ID, bondId: BOND_ID },
		url: new URL(`http://localhost/campaigns/${CAMPAIGN_ID}/bonds/${BOND_ID}`)
	}) as unknown as Parameters<typeof load>[0];

function run(
	action: 'return' | 'reassign' | 'markLost',
	locals: App.Locals,
	fields: Record<string, string>
) {
	const url = `http://localhost/campaigns/${CAMPAIGN_ID}/bonds/${BOND_ID}?/${action}`;
	const event = {
		locals,
		params: { id: CAMPAIGN_ID, bondId: BOND_ID },
		url: new URL(url),
		request: postRequest(url, fields)
	} as unknown as Parameters<typeof actions.return>[0];
	return (actions[action](event) as Promise<unknown>).catch((err) => err) as Promise<
		Record<string, unknown>
	>;
}

describe('bond record custody', () => {
	beforeEach(() => {
		vi.mocked(returnBondsFromCollector).mockReset();
		vi.mocked(reassignBondsToCollector).mockReset();
		vi.mocked(markBondLost).mockReset();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('a delivered bond offers return, reassign and loss to an admin', async () => {
		const data = (await load(loadEvent(setup())))!;
		expect(data.custody.can).toEqual({ returnBond: true, reassign: true, markLost: true });
		// The current collector is not offered as the reassignment target.
		expect(data.custody.collectors.map((c: { displayName: string }) => c.displayName)).toEqual([
			'Beto'
		]);
	});

	it('actions follow the bond status, the campaign window and the permissions', async () => {
		expect((await load(loadEvent(setup(ADMIN, 'available'))))!.custody.can).toEqual({
			returnBond: false,
			reassign: false,
			markLost: true
		});
		expect((await load(loadEvent(setup(ADMIN, 'sold'))))!.custody.can).toEqual({
			returnBond: false,
			reassign: false,
			markLost: false
		});
		expect(
			(await load(loadEvent(setup(ADMIN, 'delivered_to_collector', 'closing'))))!.custody.can
		).toEqual({
			returnBond: false,
			reassign: false,
			markLost: false
		});
		expect((await load(loadEvent(setup(OPERATOR))))!.custody.can).toEqual({
			returnBond: false,
			reassign: true,
			markLost: false
		});
	});

	it('return: 403 without bond.return; success message', async () => {
		expect(await run('return', setup(OPERATOR), {})).toMatchObject({ status: 403 });
		vi.mocked(returnBondsFromCollector).mockResolvedValue(NOTE);
		expect(
			await run('return', setup(), {
				notes: ' back ',
				fromCollectorId: 'c0000000-0000-0000-0000-000000000001'
			})
		).toMatchObject({
			status: 303,
			location: `/campaigns/${CAMPAIGN_ID}/deliveries/${NOTE}`
		});
		expect(vi.mocked(returnBondsFromCollector).mock.calls[0][1]).toEqual({
			campaignId: CAMPAIGN_ID,
			bondIds: [BOND_ID],
			notes: 'back',
			fromCollectorId: 'c0000000-0000-0000-0000-000000000001'
		});
	});

	it('reassign: collector required; redirects to the new note', async () => {
		expect(await run('reassign', setup(), { collectorId: '' })).toMatchObject({
			status: 400,
			data: { errors: { collectorId: expect.any(Array) } }
		});
		vi.mocked(reassignBondsToCollector).mockResolvedValue(NOTE);
		expect(
			await run('reassign', setup(OPERATOR), {
				collectorId: COLLECTOR,
				fromCollectorId: 'c0000000-0000-0000-0000-000000000001'
			})
		).toMatchObject({
			status: 303,
			location: `/campaigns/${CAMPAIGN_ID}/deliveries/${NOTE}`
		});
	});

	it('markLost: every field is required; a database refusal lands on its field', async () => {
		const empty = await run('markLost', setup(), { responsibleParty: '', lostOn: 'x', reason: '' });
		expect(empty).toMatchObject({ status: 400 });
		expect(Object.keys((empty.data as { errors: object }).errors).sort()).toEqual([
			'lostOn',
			'reason',
			'responsibleParty'
		]);
		vi.mocked(markBondLost).mockRejectedValue(
			new DeliveryServiceError('validation', 'The date cannot be in the future.', {
				field: 'lostOn'
			})
		);
		expect(
			await run('markLost', setup(), { responsibleParty: 'Ana', lostOn: '2099-01-01', reason: 'x' })
		).toMatchObject({
			status: 400,
			data: { errors: { lostOn: ['The date cannot be in the future.'] } }
		});
	});

	it('a bond of another campaign is 404', async () => {
		const locals = setup();
		const event = {
			locals,
			params: { id: 'a0000000-0000-0000-0000-00000000ffff', bondId: BOND_ID },
			url: new URL('http://localhost/x?/return'),
			request: postRequest('http://localhost/x?/return', {})
		} as unknown as Parameters<typeof actions.return>[0];
		expect(await actions.return(event)).toMatchObject({ status: 404 });
	});
});
