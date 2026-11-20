import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/repositories/campaigns', async (o) => ({
	...(await o<typeof import('$lib/server/repositories/campaigns')>()),
	getCampaignById: vi.fn()
}));
vi.mock('$lib/server/repositories/parties', () => ({
	getBuyer: vi.fn(),
	getCollectorsByIds: vi.fn(),
	listBuyers: vi.fn(),
	findBuyersByIdentification: vi.fn()
}));
vi.mock('$lib/server/repositories/sales', () => ({ findBondsForSale: vi.fn() }));
vi.mock('$lib/server/services/sales', async (o) => ({
	...(await o<typeof import('$lib/server/services/sales')>()),
	registerSale: vi.fn()
}));
vi.mock('$lib/server/services/parties', () => ({ createBuyer: vi.fn() }));
import { actions, _firstDueDateBounds as firstDueDateBounds, load } from './+page.server';
import {
	getBuyer,
	getCollectorsByIds,
	listBuyers,
	findBuyersByIdentification
} from '$lib/server/repositories/parties';
import { findBondsForSale } from '$lib/server/repositories/sales';
import { getCampaignById, mapCampaignRow } from '$lib/server/repositories/campaigns';
import { registerSale, SaleServiceError } from '$lib/server/services/sales';
import { createBuyer } from '$lib/server/services/parties';
import { CAMPAIGN_ID, campaignRow, makeLocals } from '../../../test-helpers';
const BOND = 'b0000000-0000-0000-0000-000000000001',
	BUYER = 'a0000000-0000-0000-0000-000000000001';
const url = `http://localhost/campaigns/${CAMPAIGN_ID}/sales/new`;
const e = (perms: string[], fields: Record<string, string>, action: keyof typeof actions) => {
	const body = new FormData();
	Object.entries(fields).forEach(([k, v]) => body.set(k, v));
	return {
		locals: makeLocals({ permissions: perms }),
		params: { id: CAMPAIGN_ID },
		url: new URL(url),
		request: new Request(url + '?/' + action, { method: 'POST', body })
	} as never;
};
const run = async (
	a: keyof typeof actions,
	x: Parameters<typeof e>[0],
	f: Parameters<typeof e>[1]
) => {
	try {
		return await (actions[a] as (event: never) => Promise<unknown>)(e(x, f, a));
	} catch (err) {
		return err;
	}
};
beforeEach(() => {
	vi.mocked(getCampaignById).mockResolvedValue({
		data: mapCampaignRow(campaignRow({ status: 'active' })),
		error: null
	} as never);
	vi.mocked(listBuyers).mockResolvedValue({ data: { items: [] }, error: null } as never);
	vi.mocked(getBuyer).mockResolvedValue({ data: { id: BUYER }, error: null } as never);
	vi.mocked(findBuyersByIdentification).mockResolvedValue({ data: [], error: null } as never);
	vi.mocked(getCollectorsByIds).mockResolvedValue({ data: new Map(), error: null } as never);
	vi.mocked(findBondsForSale).mockResolvedValue({
		data: [{ id: BOND, sellable: true, reason: null }],
		error: null
	} as never);
});
describe('new sale', () => {
	it('load and actions deny sale creation without sale.create', async () => {
		await expect(
			load({
				locals: makeLocals({ permissions: ['campaign.view'] }),
				params: { id: CAMPAIGN_ID },
				url: new URL(url)
			} as never)
		).rejects.toMatchObject({ status: 403 });
		expect(await run('register', ['campaign.view'], {})).toMatchObject({ status: 403 });
	});
	it('returns 500 when permissions could not be loaded', async () => {
		await expect(
			load({
				locals: makeLocals({ permissions: null }),
				params: { id: CAMPAIGN_ID },
				url: new URL(url)
			} as never)
		).rejects.toMatchObject({ status: 500 });
		for (const action of ['lookup', 'createBuyer', 'register'] as const)
			expect(await run(action, null as never, {})).toMatchObject({ status: 500 });
	});
	it('lookup accepts number/barcode and reports unavailable matches', async () => {
		expect(await run('lookup', ['campaign.view', 'sale.create'], {})).toMatchObject({
			status: 400
		});
		await run('lookup', ['campaign.view', 'sale.create'], { query: 'BC-1' });
		expect(findBondsForSale).toHaveBeenLastCalledWith(expect.anything(), CAMPAIGN_ID, {
			code: 'BC-1'
		});
		await run('lookup', ['campaign.view', 'sale.create'], { query: '0068' });
		expect(findBondsForSale).toHaveBeenLastCalledWith(expect.anything(), CAMPAIGN_ID, {
			number: 68
		});
		vi.mocked(findBondsForSale).mockResolvedValueOnce({
			data: [{ id: BOND, sellable: false, reason: 'It is already sold.' }],
			error: null
		} as never);
		expect(await run('lookup', ['campaign.view', 'sale.create'], { query: '2' })).toMatchObject({
			found: [{ sellable: false, reason: 'It is already sold.' }]
		});
	});
	it('accepts full payments without a due date and validates installment due-date bounds', async () => {
		const { min, max } = firstDueDateBounds();
		const date = (value: string, days: number) => {
			const [year, month, day] = value.split('-').map(Number);
			return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
		};
		const fields = (firstDueDate: string) => ({
			bondId: BOND,
			buyerId: BUYER,
			paymentMode: 'installments',
			firstDueDate
		});
		vi.mocked(registerSale).mockResolvedValue('a0000000-0000-0000-0000-000000000009');
		expect(
			await run('register', ['campaign.view', 'sale.create'], {
				bondId: BOND,
				buyerId: BUYER,
				paymentMode: 'full_payment',
				firstDueDate: 'not-a-date'
			})
		).toMatchObject({ status: 303 });
		expect(registerSale).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.objectContaining({ paymentMode: 'full_payment', firstDueDate: null }),
			expect.anything()
		);
		expect(
			await run('register', ['campaign.view', 'sale.create'], fields(date(min, -1)))
		).toMatchObject({
			status: 400,
			data: { errors: { firstDueDate: expect.any(Array) } }
		});
		expect(await run('register', ['campaign.view', 'sale.create'], fields(min))).toMatchObject({
			status: 303
		});
		expect(await run('register', ['campaign.view', 'sale.create'], fields(max))).toMatchObject({
			status: 303
		});
		expect(
			await run('register', ['campaign.view', 'sale.create'], fields(date(max, 1)))
		).toMatchObject({
			status: 400,
			data: { errors: { firstDueDate: expect.any(Array) } }
		});
		expect(
			await run('register', ['campaign.view', 'sale.create'], fields('not-a-date'))
		).toMatchObject({
			status: 400,
			data: { errors: { firstDueDate: expect.any(Array) } }
		});
	});
	it('creates buyers only for managers, validates, warns duplicates and selects success', async () => {
		expect(await run('createBuyer', ['campaign.view'], {})).toMatchObject({ status: 403 });
		expect(
			await run('createBuyer', ['campaign.view', 'buyer.manage'], { type: 'individual' })
		).toMatchObject({ status: 400 });
		vi.mocked(findBuyersByIdentification).mockResolvedValueOnce({
			data: [{ id: BUYER, firstName: 'Ada', lastName: 'L' }],
			error: null
		} as never);
		expect(
			await run('createBuyer', ['campaign.view', 'buyer.manage'], {
				type: 'individual',
				firstName: 'Ada',
				lastName: 'L',
				documentNumber: '1'
			})
		).toMatchObject({ duplicates: expect.anything() });
		vi.mocked(createBuyer).mockResolvedValue(BUYER);
		expect(
			await run('createBuyer', ['campaign.view', 'buyer.manage'], {
				type: 'individual',
				firstName: 'Ada',
				lastName: 'L',
				createAnyway: 'on'
			})
		).toMatchObject({ success: true, buyerId: BUYER });
	});
	it('validates register, maps service field failures, and preserves redirect', async () => {
		expect(await run('register', ['campaign.view', 'sale.create'], {})).toMatchObject({
			status: 400
		});
		vi.mocked(registerSale).mockRejectedValueOnce(
			new SaleServiceError('conflict', 'Already sold.', { field: 'bondId' })
		);
		expect(
			await run('register', ['campaign.view', 'sale.create'], {
				bondId: BOND,
				buyerId: BUYER,
				paymentMode: 'full_payment',
				firstDueDate: '2027-01-01'
			})
		).toMatchObject({ status: 409, data: { errors: { bondId: ['Already sold.'] } } });
		vi.mocked(registerSale).mockResolvedValueOnce('a0000000-0000-0000-0000-000000000009');
		expect(
			await run('register', ['campaign.view', 'sale.create'], {
				bondId: BOND,
				buyerId: BUYER,
				paymentMode: 'full_payment',
				firstDueDate: '2027-01-01'
			})
		).toMatchObject({
			status: 303,
			location: `/campaigns/${CAMPAIGN_ID}/sales/a0000000-0000-0000-0000-000000000009`
		});
	});
});
