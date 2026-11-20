import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/repositories/campaigns', () => ({ getCampaignById: vi.fn() }));
vi.mock('$lib/server/repositories/audit-log', () => ({
	listCampaignAuditEntries: vi.fn(),
	getCampaignAuditEntry: vi.fn()
}));
import { load } from './+page.server';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	getCampaignAuditEntry,
	listCampaignAuditEntries
} from '$lib/server/repositories/audit-log';
import { CAMPAIGN_ID, makeLocals } from '../../test-helpers';

const event = (permissions: string[] | null, search = '') => ({
	locals: makeLocals({ permissions }),
	params: { id: CAMPAIGN_ID },
	url: new URL(`http://localhost/campaigns/${CAMPAIGN_ID}/audit${search}`)
});

beforeEach(() => {
	vi.mocked(getCampaignById).mockResolvedValue({
		data: { id: CAMPAIGN_ID, name: 'Campaign' },
		error: null
	} as never);
	vi.mocked(listCampaignAuditEntries).mockResolvedValue({
		data: { items: [], total: 0, page: 1, pageSize: 50 },
		error: null
	});
	vi.mocked(getCampaignAuditEntry).mockResolvedValue({ data: null, error: null });
});

describe('campaign audit viewer', () => {
	it('fails closed when permissions are unavailable', async () => {
		await expect(load(event(null) as never)).rejects.toMatchObject({ status: 500 });
		expect(listCampaignAuditEntries).not.toHaveBeenCalled();
	});
	it('requires audit.view', async () => {
		await expect(load(event(['campaign.view']) as never)).rejects.toMatchObject({ status: 403 });
		expect(listCampaignAuditEntries).not.toHaveBeenCalled();
	});
	it('passes filters and page to the bounded repository query', async () => {
		const actor = 'a0000000-0000-4000-8000-000000000001';
		await load(
			event(
				['campaign.view', 'audit.view'],
				`?actor=${actor}&action=payment.annul&entityType=payment&from=2026-11-01&to=2026-11-19&page=21`
			) as never
		);
		expect(listCampaignAuditEntries).toHaveBeenCalledWith(expect.anything(), CAMPAIGN_ID, {
			actor,
			action: 'payment.annul',
			entityType: 'payment',
			from: '2026-11-01',
			to: '2026-11-19',
			page: 21
		});
	});
	it('loads a scoped detail and maps missing detail to 404', async () => {
		const detail = 'd0000000-0000-4000-8000-000000000001';
		await expect(
			load(event(['campaign.view', 'audit.view'], `?detail=${detail}`) as never)
		).rejects.toMatchObject({ status: 404 });
		expect(getCampaignAuditEntry).toHaveBeenCalledWith(expect.anything(), CAMPAIGN_ID, detail);
	});
	it('maps repository failures to 500', async () => {
		vi.mocked(listCampaignAuditEntries).mockResolvedValueOnce({
			data: null,
			error: new Error('failed')
		});
		await expect(load(event(['campaign.view', 'audit.view']) as never)).rejects.toMatchObject({
			status: 500
		});
	});
});
