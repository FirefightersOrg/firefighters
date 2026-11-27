import { describe, expect, it } from 'vitest';
import { load } from './+page.server';
import {
	ADMIN_PERMISSIONS,
	CAMPAIGN_ID,
	campaignRow,
	makeLocals,
	mockSupabase
} from '../../test-helpers';

const BUYER = {
	id: 'b0000000-0000-0000-0000-000000000001',
	type: 'individual',
	first_name: 'Ada',
	last_name: 'Lovelace',
	business_name: null,
	document_number: '123',
	tax_id: null,
	phone: null,
	address: null,
	usual_collector_id: null,
	notes: null,
	created_by: null,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z'
};

describe('/campaigns/[id]/buyers', () => {
	it('requires buyer.view or buyer.manage and returns 404 for missing campaigns', async () => {
		const event = (locals: App.Locals, id = CAMPAIGN_ID) =>
			({
				locals,
				params: { id },
				url: new URL(`http://localhost/campaigns/${id}/buyers`)
			}) as never;
		await expect(load(event(makeLocals({ permissions: ADMIN_PERMISSIONS })))).rejects.toMatchObject(
			{ status: 403 }
		);
		await expect(
			load(event(makeLocals({ permissions: [...ADMIN_PERMISSIONS, 'buyer.view'] }), 'nope'))
		).rejects.toMatchObject({ status: 404 });
	});

	it('lists searched buyers', async () => {
		const mock = mockSupabase({
			tables: {
				campaigns: { data: campaignRow(), error: null },
				buyers: { data: [BUYER], error: null },
				collectors: { data: [], error: null }
			}
		});
		const data = await load({
			locals: makeLocals({
				supabase: mock.supabase,
				permissions: [...ADMIN_PERMISSIONS, 'buyer.view']
			}),
			params: { id: CAMPAIGN_ID },
			url: new URL(`http://localhost/campaigns/${CAMPAIGN_ID}/buyers?q=Lovelace`)
		} as never);
		expect(data?.buyers[0]).toMatchObject({ lastName: 'Lovelace', documentNumber: '123' });
		expect(mock.chains.buyers[0].or).toHaveBeenCalled();
	});

	// UX plan PR 14b: how many bonds of the campaign each buyer has, for the roles that read bonds.
	const listEvent = (mock: ReturnType<typeof mockSupabase>, permissions: string[]) =>
		({
			locals: makeLocals({ supabase: mock.supabase, permissions }),
			params: { id: CAMPAIGN_ID },
			url: new URL(`http://localhost/campaigns/${CAMPAIGN_ID}/buyers`)
		}) as never;
	it('does not read bonds without bond.view', async () => {
		const mock = mockSupabase({
			tables: {
				campaigns: { data: campaignRow(), error: null },
				buyers: { data: [BUYER], error: null }
			}
		});
		const data = await load(listEvent(mock, [...ADMIN_PERMISSIONS, 'buyer.view']));
		expect(mock.chains.bonds).toBeUndefined();
		expect(mock.rpc).not.toHaveBeenCalled();
		expect(data?.buyers[0].bondCount).toBeNull();
		expect(data?.can.bondCounts).toBe(false);
	});

	it('counts the bonds of this campaign per buyer with one grouped query', async () => {
		const second = { ...BUYER, id: 'b0000000-0000-0000-0000-000000000002', last_name: 'Byron' };
		const mock = mockSupabase({
			tables: {
				campaigns: { data: campaignRow(), error: null },
				buyers: { data: [BUYER, second], error: null }
			},
			// A buyer without bonds is absent from the grouped result.
			rpc: { data: [{ buyer_id: BUYER.id, bond_count: 2 }], error: null }
		});
		const data = await load(listEvent(mock, [...ADMIN_PERMISSIONS, 'buyer.view', 'bond.view']));
		expect(mock.rpc).toHaveBeenCalledTimes(1);
		expect(mock.rpc).toHaveBeenCalledWith('buyer_bond_counts', {
			p_campaign_id: CAMPAIGN_ID,
			p_buyer_ids: [BUYER.id, second.id]
		});
		expect(mock.chains.bonds).toBeUndefined();
		expect(data?.buyers.map((buyer: { bondCount: number | null }) => buyer.bondCount)).toEqual([
			2, 0
		]);
		expect(data?.can.bondCounts).toBe(true);
	});

	it('fails when the bonds cannot be counted, instead of saying a buyer has none', async () => {
		const mock = mockSupabase({
			tables: {
				campaigns: { data: campaignRow(), error: null },
				buyers: { data: [BUYER], error: null }
			},
			rpc: { data: null, error: { message: 'boom' } }
		});
		await expect(
			load(listEvent(mock, [...ADMIN_PERMISSIONS, 'buyer.view', 'bond.view']))
		).rejects.toMatchObject({ status: 500 });
	});
});
