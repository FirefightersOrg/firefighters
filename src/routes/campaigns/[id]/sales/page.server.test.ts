/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/repositories/campaigns', () => ({ getCampaignById: vi.fn() }));
vi.mock('$lib/server/repositories/parties', () => ({ listActiveCollectorOptions: vi.fn() }));
vi.mock('$lib/server/repositories/sales', () => ({ listSales: vi.fn() }));
import { load } from './+page.server';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { listActiveCollectorOptions } from '$lib/server/repositories/parties';
import { listSales } from '$lib/server/repositories/sales';
import { CAMPAIGN_ID, makeLocals } from '../../test-helpers';
const id = 'c0000000-0000-0000-0000-000000000001';
const page = `http://localhost/campaigns/${CAMPAIGN_ID}/sales`;
const event = (permissions: string[], search = '') => ({
	locals: makeLocals({ permissions }),
	params: { id: CAMPAIGN_ID },
	url: new URL(page + search)
});
beforeEach(() => {
	vi.mocked(getCampaignById).mockResolvedValue({
		data: { id: CAMPAIGN_ID, name: 'Campaign' },
		error: null
	} as never);
	vi.mocked(listActiveCollectorOptions).mockResolvedValue({
		data: [{ id, displayName: 'Ana' }],
		error: null
	});
	vi.mocked(listSales).mockResolvedValue({
		data: { items: [], total: 31, page: 1, pageSize: 10 },
		error: null
	} as never);
});
describe('sales list load', () => {
	it('requires sale.view, sale.create, or bond.view', async () => {
		await expect(load(event(['campaign.view']) as never)).rejects.toMatchObject({ status: 403 });
	});
	it('passes supported filters and pagination to the query', async () => {
		const out = (await load(
			event(
				['campaign.view', 'sale.view'],
				`?collector=${id}&buyer=Ada&paymentMode=installments&financialStatus=overdue&page=2`
			) as never
		)) as any;
		expect(listSales).toHaveBeenCalledWith(expect.anything(), CAMPAIGN_ID, {
			collectorId: id,
			buyerSearch: 'Ada',
			paymentMode: 'installments',
			financialStatus: 'overdue',
			page: 2
		});
		expect(out.pagination).toMatchObject({ pageCount: 4 });
	});
	it('ignores invalid filters and clamps pagination', async () => {
		await load(
			event(
				['campaign.view', 'sale.create'],
				'?collector=nope&paymentMode=nope&financialStatus=nope&page=-3'
			) as never
		);
		expect(listSales).toHaveBeenCalledWith(
			expect.anything(),
			CAMPAIGN_ID,
			expect.objectContaining({
				collectorId: null,
				buyerSearch: null,
				paymentMode: null,
				financialStatus: null,
				page: 1
			})
		);
	});
});
