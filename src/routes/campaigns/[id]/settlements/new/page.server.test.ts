/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/repositories/campaigns', () => ({ getCampaignById: vi.fn() }));
vi.mock('$lib/server/repositories/parties', () => ({ listActiveCollectorOptions: vi.fn() }));
vi.mock('$lib/server/services/settlements', async (o) => ({
	...(await o<any>()),
	openSettlement: vi.fn()
}));
import { actions, load } from './+page.server';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { listActiveCollectorOptions } from '$lib/server/repositories/parties';
import { openSettlement, SettlementServiceError } from '$lib/server/services/settlements';
import { CAMPAIGN_ID, makeLocals } from '../../../test-helpers';
const COLLECTOR = 'c0000000-0000-0000-0000-000000000001',
	url = `http://localhost/campaigns/${CAMPAIGN_ID}/settlements/new`;
const run = async (permissions: string[], fields: Record<string, string>) => {
	const body = new FormData();
	Object.entries(fields).forEach(([k, v]) => body.set(k, v));
	try {
		return await actions.create({
			locals: makeLocals({ permissions }),
			params: { id: CAMPAIGN_ID },
			url: new URL(url),
			request: new Request(url, { method: 'POST', body })
		} as never);
	} catch (e) {
		return e;
	}
};
beforeEach(() => {
	vi.mocked(getCampaignById).mockResolvedValue({ data: { id: CAMPAIGN_ID }, error: null } as never);
	vi.mocked(listActiveCollectorOptions).mockResolvedValue({ data: [], error: null } as never);
	vi.mocked(openSettlement).mockResolvedValue('s');
});
describe('new settlement', () => {
	it('denies load and action without settlement.create', async () => {
		await expect(
			load({
				locals: makeLocals({ permissions: ['campaign.view'] }),
				params: { id: CAMPAIGN_ID },
				url: new URL(url)
			} as never)
		).rejects.toMatchObject({ status: 403 });
		expect(await run(['campaign.view'], {})).toMatchObject({ status: 403 });
	});
	it('validates collector and notes length', async () => {
		expect(await run(['campaign.view', 'settlement.create'], {})).toMatchObject({ status: 400 });
		expect(
			await run(['campaign.view', 'settlement.create'], {
				collectorId: COLLECTOR,
				notes: 'x'.repeat(2001)
			})
		).toMatchObject({ status: 400 });
	});
	it('redirects and maps service errors', async () => {
		expect(
			await run(['campaign.view', 'settlement.create'], { collectorId: COLLECTOR, notes: '' })
		).toMatchObject({ status: 303 });
		vi.mocked(openSettlement).mockRejectedValueOnce(
			new SettlementServiceError('conflict', 'Open exists.')
		);
		expect(
			await run(['campaign.view', 'settlement.create'], { collectorId: COLLECTOR, notes: '' })
		).toMatchObject({ status: 409 });
	});
});
