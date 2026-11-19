import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { mapCampaignRow } from '$lib/server/repositories/campaigns';
import { CAMPAIGN_ID, campaignRow } from '../../../../test-helpers';

const COLLECTOR_ID = 'c0000000-0000-0000-0000-000000000001';

const entries = [
	{
		id: 'e1',
		occurredAt: '2026-11-19T10:00:00Z',
		entryType: 'commission_generated',
		direction: 'collector_credit',
		amount: 15,
		status: 'recorded',
		settlementId: 's0000000-0000-4000-8000-000000000001',
		paymentId: null,
		reason: null,
		runningBalance: 15
	},
	{
		id: 'e2',
		occurredAt: '2026-11-19T11:00:00Z',
		entryType: 'adjustment_in_favor_of_firefighters',
		direction: 'collector_debit',
		amount: 4,
		status: 'annulled',
		settlementId: null,
		paymentId: null,
		reason: 'Entered twice',
		runningBalance: 15
	},
	{
		id: 'e3',
		occurredAt: '2026-11-19T12:00:00Z',
		entryType: 'adjustment_in_favor_of_collector',
		direction: 'collector_credit',
		amount: 2.5,
		status: 'recorded',
		settlementId: null,
		paymentId: null,
		reason: 'Bonus',
		runningBalance: 17.5
	}
];

function page(can = { adjustCommission: false, adjustLedger: false }, list = entries) {
	return render(Page, {
		props: {
			data: {
				campaign: mapCampaignRow(campaignRow()),
				collector: { id: COLLECTOR_ID, displayName: 'Ada Collector' },
				entries: list,
				balance: list.length ? list[list.length - 1].runningBalance : 0,
				reasonMax: 1000,
				can
			},
			form: null,
			params: { id: CAMPAIGN_ID, collectorId: COLLECTOR_ID }
		} as never
	}).body;
}

describe('collector current account page', () => {
	it('renders every required column, the running balance and the total', () => {
		const body = page();
		for (const column of [
			'Date',
			'Type',
			'Source',
			'Settlement',
			'Payment',
			'Debit',
			'Credit',
			'Balance',
			'Status'
		])
			expect(body).toContain(`>${column}</th>`);
		expect(body).toContain('Commission generated');
		expect(body).toContain('Adjustment in favor of Firefighters');
		expect(body).toMatch(/data-testid="ledger-balance"[^>]*>[^<]*17[.,]50/);
		expect(body).toContain(
			`/campaigns/${CAMPAIGN_ID}/settlements/s0000000-0000-4000-8000-000000000001`
		);
	});

	it('shows annulled entries struck through with their reason', () => {
		const body = page();
		expect(body).toContain('Annulled');
		expect(body).toContain('Entered twice');
		expect(body).toContain('line-through');
	});

	it('hides adjustment forms and annul actions without permissions', () => {
		const body = page();
		expect(body).not.toContain('?/adjustCommission');
		expect(body).not.toContain('?/adjustLedger');
		expect(body).not.toContain('?/annul');
	});

	it('shows forms and annul only for recorded entries without a settlement', () => {
		const body = page({ adjustCommission: true, adjustLedger: true });
		expect(body).toContain('?/adjustCommission');
		expect(body).toContain('?/adjustLedger');
		expect(body.match(/\?\/annul"/g)?.length).toBe(1);
		expect(body).toContain('name="reason"');
	});

	it('renders an empty state', () => {
		expect(page(undefined, [])).toContain('No entries yet.');
	});
});
