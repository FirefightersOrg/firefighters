import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/repositories/campaigns', () => ({ getCampaignById: vi.fn() }));
vi.mock('$lib/server/repositories/draws', () => ({
	getDraw: vi.fn(),
	getCurrentDrawRoster: vi.fn(),
	listDrawRosterEntries: vi.fn()
}));
import { load } from './+page.server';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	getCurrentDrawRoster,
	getDraw,
	listDrawRosterEntries
} from '$lib/server/repositories/draws';
import { CAMPAIGN_ID, makeLocals } from '../../../../test-helpers';
const DRAW_ID = 'd0000000-0000-4000-8000-000000000001';
const url = `http://localhost/campaigns/${CAMPAIGN_ID}/draws/${DRAW_ID}/roster`;
beforeEach(() => {
	vi.mocked(getCampaignById).mockResolvedValue({
		data: {
			id: CAMPAIGN_ID,
			numberDigits: 4,
			maxNumber: 9999,
			associatedNumberOffset: 4871,
			associatedNumberMode: 'linear',
			overflowPolicy: 'reject'
		},
		error: null
	} as never);
	vi.mocked(getDraw).mockResolvedValue({ data: { id: DRAW_ID }, error: null } as never);
	vi.mocked(getCurrentDrawRoster).mockResolvedValue({ data: { id: 'r' }, error: null } as never);
	vi.mocked(listDrawRosterEntries).mockResolvedValue({ data: [], error: null });
});
const event = (permissions: string[] | null, suffix = '') =>
	({
		locals: makeLocals({ permissions }),
		params: { id: CAMPAIGN_ID, drawId: DRAW_ID },
		url: new URL(url + suffix)
	}) as never;
describe('roster load', () => {
	it('fails closed and denies without draw.view', async () => {
		await expect(load(event(null))).rejects.toMatchObject({ status: 500 });
		await expect(load(event(['campaign.view']))).rejects.toMatchObject({ status: 403 });
		expect(listDrawRosterEntries).not.toHaveBeenCalled();
	});
	it('searches formatted numbers, filters eligibility, and paginates more than 1000 rows', async () => {
		vi.mocked(listDrawRosterEntries).mockResolvedValue({
			data: Array.from({ length: 1005 }, (_, index) => ({
				id: String(index),
				numberValue: index,
				bondLabel: `B${index}`,
				buyerName: 'Buyer',
				collectorName: 'Collector',
				eligible: index % 2 === 0,
				ineligibilityReason: index % 2 ? 'not_fully_paid' : null,
				numberKind: index === 2 ? 'extraordinary' : 'base'
			})) as never,
			error: null
		});
		const data = await load(
			event(['campaign.view', 'draw.view'], '?q=0002&eligibility=eligible&page=1')
		);
		expect(data?.entries).toHaveLength(1);
		expect(data?.entries[0].formattedNumber).toBe('0002');
		vi.mocked(listDrawRosterEntries).mockResolvedValueOnce({
			data: Array.from({ length: 1005 }, (_, index) => ({
				id: String(index),
				numberValue: index,
				bondLabel: 'B',
				buyerName: 'Buyer',
				collectorName: 'Collector',
				eligible: true,
				ineligibilityReason: null,
				numberKind: 'base'
			})) as never,
			error: null
		});
		const paged = await load(event(['campaign.view', 'draw.view'], '?page=21'));
		expect(paged?.pagination).toMatchObject({ page: 21, pages: 21, total: 1005 });
		expect(paged?.entries).toHaveLength(5);
	});
});
