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
});
