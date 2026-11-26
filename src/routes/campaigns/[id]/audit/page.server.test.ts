import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/repositories/campaigns', () => ({ getCampaignById: vi.fn() }));
vi.mock('$lib/server/repositories/audit-log', () => ({
	AUDIT_PAGE_SIZE: 50,
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
			page: 11
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
	it('returns ordinary creation history as well as corrections without snapshot filtering', async () => {
		const items = ['sale', 'payment', 'draw', 'prize'].map((entityType) => ({
			id: entityType,
			entityType,
			action: `${entityType}.create`,
			newValue: { status: 'created' }
		}));
		vi.mocked(listCampaignAuditEntries).mockResolvedValueOnce({
			data: { items, total: 4, page: 1, pageSize: 50 },
			error: null
		} as never);
		const result = await load(event(['campaign.view', 'audit.view']) as never);
		expect(result?.entries.items).toEqual(
			items.map((item) => ({
				...item,
				subject: { sale: 'Venta', payment: 'Pago', draw: 'Sorteo', prize: 'Premio' }[
					item.entityType
				]
			}))
		);
	});
});

it('searches names across more than 1,000 authorized rows before paginating', async () => {
	const items = Array.from({ length: 1051 }, (_, i) => ({
		id: String(i),
		action: 'buyer.update',
		entityType: 'buyer',
		entityId: null,
		actorName: null,
		actorUserId: null,
		oldValue: null,
		newValue: { first_name: i === 1050 ? 'Ángela' : 'María', last_name: 'Giménez' },
		createdAt: '2026-11-01T12:00:00Z',
		reason: null,
		requestId: null
	}));
	vi.mocked(listCampaignAuditEntries).mockImplementation(
		async (_client, campaignId, filters = {}) => {
			expect(campaignId).toBe(CAMPAIGN_ID);
			const page = filters.page ?? 1;
			return {
				data: {
					items: items.slice((page - 1) * 50, page * 50),
					total: items.length,
					page,
					pageSize: 50
				},
				error: null
			};
		}
	);
	const result = await load(event(['campaign.view', 'audit.view'], '?person=angela') as never);
	expect(result?.entries.total).toBe(1);
	expect(result?.entries.items).toMatchObject([{ id: '1050', subject: 'Ángela Giménez' }]);
	expect(listCampaignAuditEntries).toHaveBeenCalledTimes(22);
});

it('shows 25 rows per page without skipping the other half of a repository page', async () => {
	const items = Array.from({ length: 50 }, (_, i) => ({
		id: String(i),
		entityType: 'buyer',
		action: 'buyer.create',
		newValue: { first_name: `Persona ${i}` }
	}));
	vi.mocked(listCampaignAuditEntries).mockResolvedValue({
		data: { items, total: 100, page: 1, pageSize: 50 },
		error: null
	} as never);
	const first = await load(event(['campaign.view', 'audit.view']) as never);
	const second = await load(event(['campaign.view', 'audit.view'], '?page=2') as never);
	expect(first?.entries.items.map((row: { id: string }) => row.id)).toEqual(
		items.slice(0, 25).map((row) => row.id)
	);
	expect(second?.entries.items.map((row: { id: string }) => row.id)).toEqual(
		items.slice(25).map((row) => row.id)
	);
	expect(second?.entries).toMatchObject({ page: 2, pageSize: 25, total: 100 });
	expect(listCampaignAuditEntries).toHaveBeenLastCalledWith(
		expect.anything(),
		CAMPAIGN_ID,
		expect.objectContaining({ page: 1 })
	);
});
