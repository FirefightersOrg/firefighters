import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/repositories/campaigns', () => ({ getCampaignById: vi.fn() }));
vi.mock('$lib/server/repositories/draws', () => ({ listDraws: vi.fn() }));
import { load } from './+page.server';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { listDraws } from '$lib/server/repositories/draws';
import { CAMPAIGN_ID, makeLocals } from '../../test-helpers';
const url = `http://localhost/campaigns/${CAMPAIGN_ID}/draws`;
beforeEach(() => {
	vi.mocked(getCampaignById).mockResolvedValue({ data: { id: CAMPAIGN_ID }, error: null } as never);
	vi.mocked(listDraws).mockResolvedValue({ data: [], error: null });
});
describe('draws load', () => {
	it('fails closed and denies callers without a draw permission', async () => {
		await expect(
			load({
				locals: makeLocals({ permissions: null }),
				params: { id: CAMPAIGN_ID },
				url: new URL(url)
			} as never)
		).rejects.toMatchObject({ status: 500 });
		await expect(
			load({
				locals: makeLocals({ permissions: ['campaign.view'] }),
				params: { id: CAMPAIGN_ID },
				url: new URL(url)
			} as never)
		).rejects.toMatchObject({ status: 403 });
		expect(listDraws).not.toHaveBeenCalled();
	});
	it('passes valid filters and permits any draw capability', async () => {
		await load({
			locals: makeLocals({ permissions: ['campaign.view', 'draw.freeze_roster'] }),
			params: { id: CAMPAIGN_ID },
			url: new URL(`${url}?type=monthly&status=scheduled`)
		} as never);
		expect(listDraws).toHaveBeenCalledWith(expect.anything(), CAMPAIGN_ID, {
			type: 'monthly',
			status: 'scheduled'
		});
	});
});
