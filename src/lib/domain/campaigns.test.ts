import { describe, expect, it } from 'vitest';
import {
	availableCampaignTransitions,
	campaignDayEnd,
	campaignDayStart,
	campaignNumberingConfig,
	canEditCampaignDates,
	canEditCampaignName,
	canEditCampaignRules,
	canDeliverBonds,
	canLoadBonds,
	CAMPAIGN_STATUSES,
	CAMPAIGN_TRANSITION_PERMISSIONS,
	formatCampaignDate,
	isCampaignTransitionAllowed,
	keepTimestampIfSameDay,
	toCampaignDay
} from './campaigns';

describe('campaign status machine', () => {
	it('allows exactly the documented transitions', () => {
		const allowed = CAMPAIGN_STATUSES.flatMap((from) =>
			(['active', 'closing', 'closed', 'annulled'] as const)
				.filter((to) => isCampaignTransitionAllowed(from, to))
				.map((to) => `${from}->${to}`)
		);
		expect(allowed.sort()).toEqual(
			[
				'draft->active',
				'draft->annulled',
				'active->closing',
				'closing->closed',
				'active->annulled'
			].sort()
		);
	});

	it('maps each target status to its permission (activation freezes rules)', () => {
		expect(CAMPAIGN_TRANSITION_PERMISSIONS).toEqual({
			active: 'campaign.update_rules',
			closing: 'campaign.close',
			closed: 'campaign.close',
			annulled: 'campaign.close'
		});
	});

	it('offers only the transitions the permissions allow', () => {
		expect(
			availableCampaignTransitions('draft', ['campaign.update_rules', 'campaign.close'])
		).toEqual(['active', 'annulled']);
		expect(availableCampaignTransitions('draft', ['campaign.close'])).toEqual(['annulled']);
		expect(availableCampaignTransitions('draft', ['campaign.update_rules'])).toEqual(['active']);
		expect(availableCampaignTransitions('active', ['campaign.update_rules'])).toEqual([]);
		expect(availableCampaignTransitions('active', ['campaign.close'])).toEqual([
			'closing',
			'annulled'
		]);
		expect(availableCampaignTransitions('closing', ['campaign.close'])).toEqual(['closed']);
		expect(availableCampaignTransitions('closed', ['campaign.close'])).toEqual([]);
		expect(availableCampaignTransitions('annulled', ['campaign.close'])).toEqual([]);
		expect(availableCampaignTransitions('draft', ['campaign.view'])).toEqual([]);
	});

	it('mirrors the edit windows of the write guard', () => {
		expect(CAMPAIGN_STATUSES.filter(canEditCampaignRules)).toEqual(['draft']);
		expect(CAMPAIGN_STATUSES.filter(canEditCampaignDates)).toEqual(['draft', 'active']);
		expect(CAMPAIGN_STATUSES.filter(canLoadBonds)).toEqual(['draft', 'active']);
		expect(CAMPAIGN_STATUSES.filter(canDeliverBonds)).toEqual(['active']);
		expect(CAMPAIGN_STATUSES.filter(canEditCampaignName)).toEqual(['draft', 'active', 'closing']);
	});

	it('extracts the numbering config', () => {
		expect(
			campaignNumberingConfig({
				numberDigits: 5,
				maxNumber: 99999,
				associatedNumberOffset: 4871,
				overflowPolicy: 'reject'
			})
		).toEqual({
			numberDigits: 5,
			maxNumber: 99999,
			associatedNumberOffset: 4871,
			overflowPolicy: 'reject'
		});
	});
});

describe('campaign dates', () => {
	it('turns calendar days into Argentina start/end-of-day timestamps', () => {
		expect(campaignDayStart('2026-03-01')).toBe('2026-03-01T00:00:00-03:00');
		expect(campaignDayEnd('2026-12-31')).toBe('2026-12-31T23:59:59-03:00');
	});

	it('reads timestamps back as Argentina calendar days', () => {
		expect(toCampaignDay('2026-03-01T03:00:00+00:00')).toBe('2026-03-01');
		expect(toCampaignDay('2027-01-01T02:59:59+00:00')).toBe('2026-12-31');
		expect(toCampaignDay(campaignDayStart('2026-03-01'))).toBe('2026-03-01');
		expect(toCampaignDay(campaignDayEnd('2026-12-31'))).toBe('2026-12-31');
		expect(toCampaignDay(null)).toBeNull();
		expect(toCampaignDay('garbage')).toBeNull();
	});

	it('keeps a stored timestamp when the edited day is the same', () => {
		const stored = '2026-03-01T15:00:00+00:00';
		expect(keepTimestampIfSameDay(campaignDayStart('2026-03-01'), stored)).toBe(stored);
		expect(keepTimestampIfSameDay(campaignDayStart('2026-03-02'), stored)).toBe(
			'2026-03-02T00:00:00-03:00'
		);
		expect(keepTimestampIfSameDay(null, stored)).toBeNull();
		expect(keepTimestampIfSameDay(campaignDayEnd('2026-03-01'), null)).toBe(
			'2026-03-01T23:59:59-03:00'
		);
	});

	it('formats dates for display', () => {
		expect(formatCampaignDate('2027-01-01T02:59:59+00:00')).toBe('Dec 31, 2026');
		expect(formatCampaignDate(null)).toBe('—');
	});
});
