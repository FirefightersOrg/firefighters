/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/repositories/campaigns', () => ({ getCampaignById: vi.fn() }));
vi.mock('$lib/server/repositories/parties', () => ({ listActiveCollectorOptions: vi.fn() }));
vi.mock('$lib/server/repositories/settlements', () => ({ listSettlements: vi.fn() }));
vi.mock('$lib/server/services/settlements', async (o) => ({
	...(await o<any>()),
	openSettlement: vi.fn()
}));
import { actions, load } from './+page.server';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { listActiveCollectorOptions } from '$lib/server/repositories/parties';
import { listSettlements } from '$lib/server/repositories/settlements';
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
	vi.mocked(listSettlements).mockResolvedValue({ data: [], error: null } as never);
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
	it('loads the open settlements, and reads the intent from the URL (UX plan PR 7)', async () => {
		vi.mocked(listSettlements).mockResolvedValueOnce({
			data: [{ id: 's9', collectorId: COLLECTOR, settlementNumber: 9, collectorName: 'Ana' }],
			error: null
		} as never);
		const event = (href: string) =>
			({
				locals: makeLocals({ permissions: ['campaign.view', 'settlement.create'] }),
				params: { id: CAMPAIGN_ID },
				url: new URL(href)
			}) as never;
		const data = (await load(event(`${url}?intent=payment`))) as any;
		expect(listSettlements).toHaveBeenCalledWith(expect.anything(), CAMPAIGN_ID, {
			status: 'open'
		});
		// Only what the page needs: where to send, never the settlement's totals.
		expect(data.openSettlements).toEqual([
			{ id: 's9', collectorId: COLLECTOR, settlementNumber: 9 }
		]);
		expect(data.forPayment).toBe(true);
		expect(data.preselectedCollectorId).toBeNull();
		// Only a collector of the list can come chosen: anything else in the URL is ignored.
		vi.mocked(listActiveCollectorOptions).mockResolvedValueOnce({
			data: [{ id: COLLECTOR, displayName: 'Ana' }],
			error: null
		} as never);
		const chosen = (await load(event(`${url}?intent=payment&collector=${COLLECTOR}`))) as any;
		expect(chosen.preselectedCollectorId).toBe(COLLECTOR);
		const forged = (await load(event(`${url}?collector=%3Cscript%3E`))) as any;
		expect(forged.preselectedCollectorId).toBeNull();
		// A role that cannot read settlements still gets the form.
		vi.mocked(listSettlements).mockResolvedValueOnce({
			data: null,
			error: new Error('denied')
		} as never);
		const plain = (await load(event(url))) as any;
		expect(plain.openSettlements).toEqual([]);
		expect(plain.forPayment).toBe(false);
	});
});
