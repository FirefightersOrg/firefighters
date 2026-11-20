import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/repositories/campaigns', () => ({ getCampaignById: vi.fn() }));
vi.mock('$lib/server/repositories/parties', () => ({ listActiveCollectorOptions: vi.fn() }));
vi.mock('$lib/server/repositories/settlements', () => ({ listSettlements: vi.fn() }));
import { load } from './+page.server';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { listActiveCollectorOptions } from '$lib/server/repositories/parties';
import { listSettlements } from '$lib/server/repositories/settlements';
import { CAMPAIGN_ID, makeLocals } from '../../test-helpers';
const COLLECTOR = 'c0000000-0000-0000-0000-000000000001';
const url = `http://localhost/campaigns/${CAMPAIGN_ID}/settlements`;
const event = (permissions: string[], search = '') => ({
	locals: makeLocals({ permissions }),
	params: { id: CAMPAIGN_ID },
	url: new URL(url + search)
});
beforeEach(() => {
	vi.mocked(getCampaignById).mockResolvedValue({ data: { id: CAMPAIGN_ID }, error: null } as never);
	vi.mocked(listActiveCollectorOptions).mockResolvedValue({ data: [], error: null } as never);
	vi.mocked(listSettlements).mockResolvedValue({ data: [], error: null } as never);
});
describe('settlements list', () => {
	it('denies users without a settlement permission', async () => {
		await expect(load(event(['campaign.view']) as never)).rejects.toMatchObject({ status: 403 });
	});
	it('passes valid filters to the repository', async () => {
		await load(
			event(
				['campaign.view', 'settlement.view'],
				`?collector=${COLLECTOR}&status=closed&from=2026-01-01&to=2026-01-31`
			) as never
		);
		expect(listSettlements).toHaveBeenCalledWith(expect.anything(), CAMPAIGN_ID, {
			collectorId: COLLECTOR,
			status: 'closed',
			from: '2026-01-01',
			to: '2026-01-31'
		});
	});
	it('normalizes invalid filters', async () => {
		await load(
			event(
				['campaign.view', 'settlement.view'],
				'?collector=nope&status=nope&from=bad&to=bad'
			) as never
		);
		expect(listSettlements).toHaveBeenLastCalledWith(expect.anything(), CAMPAIGN_ID, {
			collectorId: null,
			status: null,
			from: null,
			to: null
		});
	});
	it('maps repository errors to 500', async () => {
		vi.mocked(listSettlements).mockResolvedValueOnce({
			data: null,
			error: new Error('no')
		} as never);
		await expect(load(event(['campaign.view', 'settlement.view']) as never)).rejects.toMatchObject({
			status: 500
		});
	});
});
