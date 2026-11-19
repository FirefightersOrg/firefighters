/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/repositories/campaigns', () => ({ getCampaignById: vi.fn() }));
vi.mock('$lib/server/repositories/sales', () => ({ getSaleDetail: vi.fn() }));
import { load } from './+page.server';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getSaleDetail } from '$lib/server/repositories/sales';
import { CAMPAIGN_ID, makeLocals } from '../../../test-helpers';
const SALE = 'a0000000-0000-0000-0000-000000000009',
	url = `http://localhost/campaigns/${CAMPAIGN_ID}/sales/${SALE}`;
const event = (permissions: string[], saleId = SALE) => ({
	locals: makeLocals({ permissions }),
	params: { id: CAMPAIGN_ID, saleId },
	url: new URL(url)
});
beforeEach(() => {
	vi.mocked(getCampaignById).mockResolvedValue({ data: { id: CAMPAIGN_ID }, error: null } as never);
	vi.mocked(getSaleDetail).mockResolvedValue({
		data: {
			sale: { status: 'active' },
			plan: { status: 'active' },
			installments: [
				{ installmentNumber: 1, dueDate: '2020-01-01', amount: '10.00', status: 'pending' }
			]
		},
		error: null
	} as never);
});
describe('sale detail', () => {
	it('requires sale or bond viewing', async () => {
		await expect(load(event(['campaign.view']) as never)).rejects.toMatchObject({ status: 403 });
	});
	it('returns 500 when permissions are unavailable', async () => {
		await expect(load(event(null as never) as never)).rejects.toMatchObject({ status: 500 });
	});
	it('returns 404 for malformed, missing, or out-of-campaign sales', async () => {
		await expect(load(event(['campaign.view', 'sale.view'], 'bad') as never)).rejects.toMatchObject(
			{ status: 404 }
		);
		vi.mocked(getSaleDetail).mockResolvedValueOnce({ data: null, error: null } as never);
		await expect(load(event(['campaign.view', 'sale.view']) as never)).rejects.toMatchObject({
			status: 404
		});
	});
	it('includes installments and computed financial status', async () => {
		const out = (await load(event(['campaign.view', 'sale.view']) as never)) as any;
		expect(out.sale.installments).toHaveLength(1);
		expect(out.financialStatus).toBe('overdue');
	});
});
