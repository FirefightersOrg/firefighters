import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import {
	buildStatusMatrix,
	pivotInstallments,
	totalBondsByCollector,
	totalCollectorMonthly
} from '$lib/domain/reports';
import { mapCampaignRow } from '$lib/server/repositories/campaigns';
import { CAMPAIGN_ID, campaignRow } from '../../test-helpers';

const COLLECTOR_ID = 'c0000000-0000-0000-0000-000000000001';

function page(overrides: Record<string, unknown> = {}) {
	const byCollector = [
		{
			collectorId: COLLECTOR_ID,
			collectorName: '<b>Ana</b>',
			bondCount: 3,
			deliveredCount: 1,
			soldCount: 2,
			returnedCount: 0,
			totalValue: '180000.00',
			soldValue: '120000.00'
		}
	];
	const monthly = [
		{
			collectorId: COLLECTOR_ID,
			collectorName: '<b>Ana</b>',
			assignedBonds: 1,
			soldBonds: 2,
			soldValue: '120000.00',
			pendingInstallments: 1,
			pendingAmount: '6000.00',
			overdueInstallments: 2,
			overdueAmount: '12000.00',
			paymentsCount: 3,
			paymentsTotal: '18000.00',
			paymentsCash: '12000.00',
			paymentsTransfer: '6000.00'
		}
	];
	return render(Page, {
		props: {
			data: {
				campaign: mapCampaignRow(campaignRow()),
				filters: {
					collectorId: null,
					kind: null,
					commercialStatus: null,
					financialStatus: null,
					month: '2027-03',
					from: null,
					to: null
				},
				collectors: [{ id: COLLECTOR_ID, displayName: 'Ana' }],
				bondsByStatus: buildStatusMatrix([
					{
						commercialStatus: 'sold',
						financialStatus: 'overdue',
						bondCount: 2,
						totalValue: '120000.00'
					}
				]),
				bondsByCollector: { rows: byCollector, totals: totalBondsByCollector(byCollector) },
				installments: pivotInstallments([
					{
						collectorId: COLLECTOR_ID,
						collectorName: '<b>Ana</b>',
						bucket: 'overdue',
						installmentCount: 2,
						amount: '12000.00'
					}
				]),
				monthly: { rows: monthly, totals: totalCollectorMonthly(monthly) },
				...overrides
			},
			params: { id: CAMPAIGN_ID }
		} as never
	}).body;
}

describe('/campaigns/[id]/reports page', () => {
	it('renders the four reports with Argentine money formatting', () => {
		const body = page();
		expect(body).toContain('Bonds by commercial and financial status');
		expect(body).toContain('Bonds by collector');
		expect(body).toContain('Installments: pending, paid, advance and overdue');
		expect(body).toContain('Monthly summary per collector: March 2027');
		expect(body).toContain('120.000,00');
		expect(body).toContain('Overdue');
		expect(body).toContain(`/campaigns/${CAMPAIGN_ID}/collectors/${COLLECTOR_ID}`);
	});

	it('escapes collector names (no raw HTML)', () => {
		const body = page();
		expect(body).not.toContain('<b>Ana</b>');
		expect(body).toContain('&lt;b>Ana&lt;/b>');
	});

	it('shows empty states', () => {
		const body = page({
			bondsByStatus: buildStatusMatrix([]),
			bondsByCollector: { rows: [], totals: totalBondsByCollector([]) },
			installments: pivotInstallments([]),
			monthly: { rows: [], totals: totalCollectorMonthly([]) }
		});
		expect(body).toContain('No bonds match the filters.');
		expect(body).toContain('No installments match the filters.');
		expect(body).toContain('No collector activity in this month.');
	});
});
