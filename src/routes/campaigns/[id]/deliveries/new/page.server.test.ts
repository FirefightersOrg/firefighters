import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';
import { CAMPAIGN_ID, campaignRow, makeLocals, mockSupabase } from '../../../test-helpers';

vi.mock('$lib/server/services/deliveries', async (original) => ({
	...(await original<typeof import('$lib/server/services/deliveries')>()),
	assignBondsToCollector: vi.fn()
}));
vi.mock('$lib/server/repositories/deliveries', () => ({ findAvailableBonds: vi.fn() }));
import { assignBondsToCollector, DeliveryServiceError } from '$lib/server/services/deliveries';
import { findAvailableBonds } from '$lib/server/repositories/deliveries';

const OPERATOR = ['campaign.view', 'bond.view', 'bond.assign'];
const COLLECTOR = 'c0000000-0000-0000-0000-000000000001';
const BOND = 'b0000000-0000-0000-0000-000000000001';
const PAGE = `http://localhost/campaigns/${CAMPAIGN_ID}/deliveries/new`;

function locals(permissions = OPERATOR, status = 'active') {
	const { supabase } = mockSupabase({
		tables: {
			campaigns: { data: campaignRow({ status: status as never }), error: null },
			collectors: { data: [], error: null }
		}
	});
	return makeLocals({ supabase, permissions });
}

function act(
	name: 'deliver' | 'lookup',
	l: App.Locals,
	fields: Record<string, string | string[]>,
	id = CAMPAIGN_ID
) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) body.append(k, x);
	const event = {
		locals: l,
		params: { id },
		url: new URL(`${PAGE}?/${name}`),
		request: new Request(`${PAGE}?/${name}`, { method: 'POST', body })
	} as unknown as Parameters<typeof actions.deliver>[0];
	return (actions[name] as (e: typeof event) => Promise<unknown>)(event).catch((err) => err);
}

describe('/campaigns/[id]/deliveries/new', () => {
	beforeEach(() => {
		vi.mocked(assignBondsToCollector).mockReset();
		vi.mocked(findAvailableBonds).mockReset();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('load requires bond.assign', async () => {
		const event = {
			locals: locals(['campaign.view', 'bond.view']),
			params: { id: CAMPAIGN_ID },
			url: new URL(PAGE)
		};
		await expect(load(event as never)).rejects.toMatchObject({ status: 403 });
	});

	it('deliver: validation errors on collector and bonds (400)', async () => {
		const result = (await act('deliver', locals(), { collectorId: 'x' })) as {
			status: number;
			data: { errors: object };
		};
		expect(result.status).toBe(400);
		expect(result.data.errors).toMatchObject({
			collectorId: expect.any(Array),
			bondIds: expect.any(Array)
		});
	});

	it('deliver: 403 without bond.assign, 404 for a malformed campaign id', async () => {
		expect(
			await act('deliver', locals(['campaign.view', 'bond.view']), {
				collectorId: COLLECTOR,
				bondIds: BOND
			})
		).toMatchObject({ status: 403 });
		expect(
			await act('deliver', locals(), { collectorId: COLLECTOR, bondIds: BOND }, 'nope')
		).toMatchObject({ status: 404 });
	});

	it('deliver: 409 when the campaign no longer accepts bonds', async () => {
		expect(
			await act('deliver', locals(OPERATOR, 'closing'), { collectorId: COLLECTOR, bondIds: BOND })
		).toMatchObject({ status: 409 });
	});

	it('deliver: redirects to the new note (the redirect is not swallowed)', async () => {
		vi.mocked(assignBondsToCollector).mockResolvedValue('n0000000-0000-0000-0000-000000000001');
		const result = await act('deliver', locals(), {
			collectorId: COLLECTOR,
			bondIds: [BOND, BOND]
		});
		expect(result).toMatchObject({
			status: 303,
			location: `/campaigns/${CAMPAIGN_ID}/deliveries/n0000000-0000-0000-0000-000000000001`
		});
		expect(vi.mocked(assignBondsToCollector).mock.calls[0][1]).toMatchObject({ bondIds: [BOND] });
	});

	it('deliver: a service refusal lands on its field', async () => {
		vi.mocked(assignBondsToCollector).mockRejectedValue(
			new DeliveryServiceError('conflict', 'Bond 0068 is sold.', { field: 'bondIds' })
		);
		expect(await act('deliver', locals(), { collectorId: COLLECTOR, bondIds: BOND })).toMatchObject(
			{
				status: 409,
				data: { errors: { bondIds: ['Bond 0068 is sold.'] } }
			}
		);
	});

	it('lookup: a range must be valid; a number or a code is searched', async () => {
		expect(await act('lookup', locals(), { from: '0050', to: '0010' })).toMatchObject({
			status: 400
		});
		vi.mocked(findAvailableBonds).mockResolvedValue({
			data: { items: [], truncated: false },
			error: null
		});
		await act('lookup', locals(), { query: '0068' });
		expect(vi.mocked(findAvailableBonds).mock.calls[0][2]).toEqual({ number: 68 });
		await act('lookup', locals(), { query: 'ABC-1' });
		expect(vi.mocked(findAvailableBonds).mock.calls[1][2]).toEqual({ code: 'ABC-1' });
	});
});
