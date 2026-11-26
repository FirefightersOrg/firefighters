import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { mapCampaignRow } from '$lib/server/repositories/campaigns';
import {
	pivotPaymentsByDate,
	totalCollectorAccounts,
	totalSettlements
} from '$lib/domain/financial-reports';
import { campaignRow, CAMPAIGN_ID } from '../../../test-helpers';

function page(view: string, overrides: Record<string, unknown> = {}) {
	const accounts = [
		{
			collectorId: 'c1',
			collectorName: 'Ana <script>',
			entryCount: 2,
			creditTotal: '200.50',
			debitTotal: '100.25',
			balance: '100.25',
			lastEntryOn: '2026-11-01'
		}
	];
	return render(Page, {
		props: {
			data: {
				campaign: mapCampaignRow(campaignRow()),
				view,
				page: 1,
				filters: {
					collectorId: 'c1',
					drawId: 'd1',
					method: 'cash',
					settlementStatus: null,
					from: '2026-11-01',
					to: null,
					eligibility: null,
					prizeStatus: null
				},
				collectors: [{ id: 'c1', displayName: 'Ana <script>' }],
				canExport: true,
				payments: pivotPaymentsByDate(
					Array.from({ length: 31 }, (_, i) => ({
						paymentDate: `2026-12-${String(i + 1).padStart(2, '0')}`,
						paymentMethod: 'cash',
						paymentCount: 1,
						total: '100.25'
					}))
				),
				settlements: { rows: [], totals: totalSettlements([]) },
				accounts: { rows: accounts, totals: totalCollectorAccounts(accounts) },
				ledger: [
					{
						entryId: 'e1',
						occurredOn: '2026-11-01',
						occurredTime: '12:10',
						entryType: 'cash_settled',
						direction: 'collector_debit',
						amount: '100.25',
						status: 'recorded',
						settlementNumber: 1,
						reason: 'Entrega en el cuartel',
						runningBalance: '-100.25',
						affectsBalance: false
					}
				],
				draws: [
					{
						drawId: 'd1',
						drawName: 'Noviembre',
						drawType: 'monthly',
						drawDate: '2026-11-01',
						drawStatus: 'roster_frozen',
						rosterStatus: 'frozen',
						eligibleCount: 1,
						ineligibleCount: 0
					}
				],
				selectedDraw: { drawName: 'Noviembre', eligibleCount: 1, ineligibleCount: 0 },
				roster: [
					{
						numberValue: 7,
						eligible: true,
						ineligibilityReason: null,
						buyerName: 'Eva',
						collectorName: 'Ana'
					}
				],
				rosterTruncated: false,
				prizes: { rows: [], counts: {} },
				...overrides
			},
			params: { id: CAMPAIGN_ID }
		} as never
	}).body;
}

describe('financial report views', () => {
	it.each(['payments', 'settlements', 'accounts', 'ledger', 'rosters', 'roster', 'prizes'])(
		'renders just view %s with stacked rows',
		(view) => {
			const body = page(view);
			expect(body.match(/id="report-title"/g)).toHaveLength(1);
			expect(body).toContain('data-stack="true"');
			expect(body).toContain(`view=${view}`);
			expect(body).not.toContain('<script>');
		}
	);
	it('paginates the screen, keeps the full total first and exports the same filters', () => {
		const body = page('payments');
		expect(body).toContain('31 registros. Página 1 de 4.');
		expect(body.indexOf('Totales del reporte')).toBeLessThan(body.indexOf('<table'));
		expect(body).toContain('01/12/2026');
		expect(body).toContain('10/12/2026');
		expect(body).not.toContain('11/12/2026');
		expect(body).toContain('3.108');
		expect(body).not.toContain('3.107,75');
		expect(body).toContain(
			'payments-by-date?collector=c1&amp;method=cash&amp;from=2026-11-01&amp;draw=d1&amp;format=csv'
		);
		expect(page('payments', { page: 4 })).toContain('31/12/2026');
	});
	it('keeps cents and the reference explanation in the ledger, without reversing the final balance', () => {
		const body = page('ledger');
		expect(body).toContain('100,25');
		expect(body).toContain('Referencia: no cambia el saldo.');
		expect(body).toContain('Entrega en el cuartel');
		expect(body).toContain('Saldo al final del período');
	});
	it('links accounts and draws to their own views and pads roster numbers', () => {
		expect(page('accounts')).toContain('view=ledger');
		expect(page('rosters')).toContain('view=roster');
		expect(page('roster')).toContain('0007');
	});
	it('keeps selection empty states and disables unavailable detail exports', () => {
		const body = page('ledger', { ledger: null });
		expect(body).toContain('Elegir un cobrador para ver el detalle de la cuenta.');
		expect(body).not.toContain('collector-ledger?');
		expect(page('roster', { roster: null })).toContain(
			'Elegir un sorteo para ver los números de su padrón.'
		);
	});
});
