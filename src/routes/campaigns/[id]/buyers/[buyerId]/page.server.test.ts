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
function setup(
	rpc: { data: unknown; error: unknown } = { data: false, error: null },
	currentBuyer:
		| typeof buyer
		| (Omit<typeof buyer, 'usual_collector_id'> & { usual_collector_id: string | null }) = buyer,
	options: { permissions?: string[] | null; prizes?: { data: unknown; error: unknown } } = {}
) {
	const mock = mockSupabase({
		tables: {
			campaigns: { data: campaignRow(), error: null },
			buyers: { data: currentBuyer, error: null },
			collectors: { data: [], error: null },
			bonds: { data: [], error: null },
			prize_awards: options.prizes ?? { data: [], error: null }
		},
		rpc
	});
	return {
		...mock,
		locals: makeLocals({
			supabase: mock.supabase,
			permissions: options.permissions === undefined ? MANAGER : options.permissions
		})
	};
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

	it('fails closed before load or update database calls when permissions are unavailable', async () => {
		const unavailable = setup(undefined, buyer, { permissions: null });
		await expect(load(event(unavailable.locals) as never)).rejects.toMatchObject({ status: 500 });
		const result = (await actions.update(event(unavailable.locals))) as ActionFailure;
		expect(result.status).toBe(500);
		expect(unavailable.from).not.toHaveBeenCalled();
		expect(unavailable.rpc).not.toHaveBeenCalled();
	});

	it('loads prizes through the award buyer id', async () => {
		const configured = setup(undefined, buyer, {
			permissions: [...MANAGER, 'draw.view'],
			prizes: {
				data: [
					{
						id: 'award',
						delivered_at: null,
						prizes: {
							id: 'prize',
							name: 'Bike',
							position: 1,
							status: 'pending_delivery',
							draws: { id: 'draw', name: 'December', campaign_id: CAMPAIGN_ID }
						}
					}
				],
				error: null
			}
		});
		const data = await load(event(configured.locals) as never);
		expect(data?.prizes).toEqual([
			{
				id: 'prize',
				drawId: 'draw',
				drawName: 'December',
				name: 'Bike',
				position: 1,
				status: 'pending_delivery',
				deliveredAt: null
			}
		]);
		expect(configured.chains.prize_awards[0].eq).toHaveBeenCalledWith('buyer_id', BUYER_ID);
	});

	it('updates after discarding individual fields, handles stale conflicts and no-ops', async () => {
		const { locals, rpc } = setup();
		const result = await actions.update(event(locals));
		expect(result).toMatchObject({ success: true, message: 'Comprador actualizado.' });
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

	it('returns field errors for invalid input, versions, and ids', async () => {
		const invalid = (await actions.update(
			event(setup().locals, fields({ businessName: '' }))
		)) as ActionFailure;
		expect(invalid.status).toBe(400);
		expect(invalid.data).toMatchObject({
			message: 'Revisar los campos marcados.',
			errors: { businessName: ['Ingresar la razón social.'] }
		});
		const version = (await actions.update(
			event(setup().locals, fields({ updatedAt: 'not-a-date' }))
		)) as ActionFailure;
		expect(version.status).toBe(400);
		expect(version.data.errors).toMatchObject({ updatedAt: expect.any(Array) });
		const badId = (await actions.update({
			...event(setup().locals),
			params: { id: CAMPAIGN_ID, buyerId: 'nope' }
		})) as ActionFailure;
		expect(badId.status).toBe(404);
	});

	it('keeps a hidden usual collector only for buyers that already have one', async () => {
		const collectorId = 'c0000000-0000-4000-8000-000000000001';
		const current = { ...buyer, usual_collector_id: collectorId };
		const valid = setup(undefined, current);
		const result = await actions.update(
			event(valid.locals, fields({ usualCollectorId: '__keep__' }))
		);
		expect(result).toMatchObject({ success: true });
		expect(valid.rpc).toHaveBeenCalledWith(
			'buyer_update',
			expect.objectContaining({ p_usual_collector_id: collectorId })
		);
		const invalid = (await actions.update(
			event(setup().locals, fields({ usualCollectorId: '__keep__' }))
		)) as ActionFailure;
		expect(invalid.status).toBe(400);
		expect(invalid.data.errors).toMatchObject({ usualCollectorId: expect.any(Array) });
	});
});
