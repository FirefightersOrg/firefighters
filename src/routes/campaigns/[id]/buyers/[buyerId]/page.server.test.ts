import { describe, expect, it } from 'vitest';
import { actions, load } from './+page.server';
import {
	ADMIN_PERMISSIONS,
	CAMPAIGN_ID,
	campaignRow,
	makeLocals,
	mockSupabase,
	postRequest,
	type ActionFailure
} from '../../../test-helpers';

const BUYER_ID = 'b0000000-0000-0000-0000-000000000001';
const PAGE_URL = `http://localhost/campaigns/${CAMPAIGN_ID}/buyers/${BUYER_ID}`;
const MANAGER = [...ADMIN_PERMISSIONS, 'buyer.manage'];
const buyer = {
	id: BUYER_ID,
	type: 'business',
	first_name: null,
	last_name: null,
	business_name: 'Acme SA',
	document_number: null,
	tax_id: '20-123',
	phone: null,
	address: null,
	usual_collector_id: null,
	notes: null,
	created_by: null,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z'
};
const fields = (overrides: Record<string, string> = {}) => ({
	type: 'business',
	firstName: 'discard',
	lastName: 'discard',
	businessName: 'Acme SA',
	documentNumber: 'discard',
	taxId: '20-123',
	phone: '',
	address: '',
	usualCollectorId: '',
	notes: '',
	updatedAt: buyer.updated_at,
	...overrides
});
function setup(rpc: { data: unknown; error: unknown } = { data: false, error: null }) {
	const mock = mockSupabase({
		tables: {
			campaigns: { data: campaignRow(), error: null },
			buyers: { data: buyer, error: null },
			collectors: { data: [], error: null },
			bonds: { data: [], error: null }
		},
		rpc
	});
	return { ...mock, locals: makeLocals({ supabase: mock.supabase, permissions: MANAGER }) };
}
function event(locals: App.Locals, form = fields()) {
	return {
		locals,
		params: { id: CAMPAIGN_ID, buyerId: BUYER_ID },
		url: new URL(PAGE_URL),
		request: postRequest(PAGE_URL, form)
	} as unknown as Parameters<typeof actions.update>[0];
}

describe('/campaigns/[id]/buyers/[buyerId]', () => {
	it('returns 403/404 for inaccessible records', async () => {
		await expect(
			load({
				locals: makeLocals({ permissions: ADMIN_PERMISSIONS }),
				params: { id: CAMPAIGN_ID, buyerId: BUYER_ID },
				url: new URL(PAGE_URL)
			} as never)
		).rejects.toMatchObject({ status: 403 });
		await expect(
			load({
				locals: setup().locals,
				params: { id: CAMPAIGN_ID, buyerId: 'nope' },
				url: new URL(PAGE_URL)
			} as never)
		).rejects.toMatchObject({ status: 404 });
	});

	it('loads current and historical buyer bonds', async () => {
		const { locals } = setup();
		const data = await load({
			locals,
			params: { id: CAMPAIGN_ID, buyerId: BUYER_ID },
			url: new URL(PAGE_URL)
		} as never);
		expect(data?.campaignBonds).toEqual([]);
		expect(data?.historicalBonds).toEqual([]);
	});

	it('updates after discarding individual fields, handles stale conflicts and no-ops', async () => {
		const { locals, rpc } = setup();
		const result = await actions.update(event(locals));
		expect(result).toMatchObject({ success: true, message: 'Buyer updated.' });
		expect(rpc).toHaveBeenCalledWith(
			'buyer_update',
			expect.objectContaining({
				p_first_name: null,
				p_last_name: null,
				p_document_number: null,
				p_business_name: 'Acme SA'
			})
		);
		const stale = setup({ data: null, error: { code: 'PT409', message: 'stale' } });
		const conflict = (await actions.update(event(stale.locals))) as ActionFailure;
		expect(conflict.status).toBe(409);
	});
});
