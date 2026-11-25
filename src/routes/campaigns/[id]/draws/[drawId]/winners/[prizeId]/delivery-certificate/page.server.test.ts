import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/repositories/campaigns', () => ({ getCampaignById: vi.fn() }));
vi.mock('$lib/server/repositories/printable-prizes', () => ({ getPrizeCertificateData: vi.fn() }));
import { load } from './+page.server';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getPrizeCertificateData } from '$lib/server/repositories/printable-prizes';
import { CAMPAIGN_ID, campaignRow, makeLocals } from '../../../../../../test-helpers';

const DRAW_ID = 'd0000000-0000-4000-8000-000000000001';
const PRIZE_ID = 'a0000000-0000-4000-8000-000000000001';
const source = {
	campaignId: CAMPAIGN_ID,
	drawId: DRAW_ID,
	drawName: 'December',
	drawType: 'monthly',
	drawDate: '2026-12-31',
	prizeId: PRIZE_ID,
	prizeName: 'Bike',
	prizePosition: 1,
	prizeStatus: 'delivered',
	winningNumber: 7,
	winnerStatus: 'eligible_winner',
	winnerNotes: null,
	rosterEligible: true,
	ineligibilityReason: null,
	buyerSnapshot: { business_name: 'Buyer SA' },
	collectorSnapshot: { display_name: 'Collector' },
	bondId: 'bond',
	bondLabel: 'B-7',
	awardStatus: 'delivered',
	deliveredAt: '2027-01-01T02:30:00Z',
	deliveryNotes: 'Received',
	deliveredByName: 'Operator',
	unawardedByName: null,
	unawardedAt: null,
	resolutionNotes: null
};
const event = (permissions: string[] | null = ['campaign.view', 'draw.view']) =>
	({
		locals: makeLocals({ permissions }),
		params: { id: CAMPAIGN_ID, drawId: DRAW_ID, prizeId: PRIZE_ID },
		url: new URL('http://localhost/certificate')
	}) as never;

/** ICU emits a regular, no-break or narrow no-break space (U+202F) before `p. m.` depending on version. */
const plainSpaces = (value: string) => value.replace(/\s/gu, ' ');

describe('delivery prize certificate load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getCampaignById).mockResolvedValue({
			data: {
				...campaignRow({ id: CAMPAIGN_ID }),
				numberDigits: 4,
				maxNumber: 9999,
				associatedNumberOffset: 100,
				associatedNumberMode: 'linear',
				overflowPolicy: 'reject'
			},
			error: null
		} as never);
		vi.mocked(getPrizeCertificateData).mockResolvedValue({ data: source, error: null } as never);
	});
	it('fails closed and denies before database access', async () => {
		await expect(load(event(null))).rejects.toMatchObject({ status: 500 });
		await expect(load(event(['campaign.view']))).rejects.toMatchObject({ status: 403 });
		expect(getPrizeCertificateData).not.toHaveBeenCalled();
	});
	it('returns a printable document for a scoped delivered prize', async () => {
		const result = (await load(event()))!;
		expect({
			...result.document,
			deliveryDate: plainSpaces(result.document.deliveryDate)
		}).toMatchObject({
			prize: '#1 — Bike',
			winningNumber: '0007',
			deliveryDate: '31/12/2026, 23:30',
			registeredBy: 'Operator'
		});
	});
	it('returns 404 for wrong campaign, draw, missing and wrong-status prizes', async () => {
		for (const patch of [
			{ campaignId: 'other' },
			{ drawId: 'other' },
			{ prizeStatus: 'unawarded' },
			{ prizeStatus: 'pending_delivery', awardStatus: 'awarded', deliveredAt: null },
			{ awardStatus: 'annulled' }
		]) {
			vi.mocked(getPrizeCertificateData).mockResolvedValue({
				data: { ...source, ...patch },
				error: null
			} as never);
			await expect(load(event())).rejects.toMatchObject({ status: 404 });
		}
		vi.mocked(getPrizeCertificateData).mockResolvedValue({ data: null, error: null });
		await expect(load(event())).rejects.toMatchObject({ status: 404 });
	});
	it('maps repository failures to 500', async () => {
		vi.mocked(getPrizeCertificateData).mockResolvedValue({
			data: null,
			error: new Error('db')
		});
		await expect(load(event())).rejects.toMatchObject({ status: 500 });
	});
});
