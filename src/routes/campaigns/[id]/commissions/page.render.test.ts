import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { mapCampaignRow } from '$lib/server/repositories/campaigns';
import { CAMPAIGN_ID, campaignRow } from '../../test-helpers';

const COLLECTOR_ID = 'c0000000-0000-4000-8000-000000000009';

function rule(overrides: Record<string, unknown> = {}) {
	return {
		id: 'r0000000-0000-4000-8000-000000000001',
		campaignId: CAMPAIGN_ID,
		ruleType: 'installment_first',
		installmentNumber: null,
		percentage: '20',
		fixedAmount: null,
		appliesToCollectorId: null,
		validFrom: '2026-01-01',
		validTo: null,
		status: 'active',
		annulledAt: null,
		annulledBy: null,
		annulReason: null,
		createdBy: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides
	};
}

function page(manage: boolean, extra: Record<string, unknown> = {}) {
	return render(Page, {
		props: {
			data: {
				campaign: mapCampaignRow(campaignRow()),
				rules: [],
				specialRules: [
					{
						...rule({
							id: 'r0000000-0000-4000-8000-000000000002',
							appliesToCollectorId: COLLECTOR_ID
						}),
						collectorName: 'Ada Collector'
					}
				],
				collectors: manage ? [{ id: COLLECTOR_ID, displayName: 'Ada Collector' }] : [],
				today: '2026-11-19',
				editRuleId: null,
				editNotFound: false,
				can: { manage },
				...extra
			},
			form: null,
			params: { id: CAMPAIGN_ID }
		} as never
	}).body;
}

describe('/campaigns/[id]/commissions page (SAN-69 special rules)', () => {
	it('lists special collector rules with the collector name', () => {
		const body = page(false);
		expect(body).toContain('Special collector rules');
		expect(body).toContain('Ada Collector');
	});

	it('offers the collector selector on the create form to managers only', () => {
		expect(page(true)).toContain('name="appliesToCollectorId"');
		expect(page(false)).not.toContain('name="appliesToCollectorId"');
	});

	it('shows an empty state without special rules', () => {
		expect(page(false, { specialRules: [] })).toContain('No special collector rules.');
	});
});
