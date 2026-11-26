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

function page(overrides: Record<string, unknown> = {}, form: unknown = null) {
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
				view: 'by-status',
				canViewCollectors: true,
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
				overdueWarning: {
					threshold: 3,
					canEdit: false,
					canViewSales: true,
					sales: [
						{
							saleId: 's1',
							bondId: 'b1',
							bondLabel: '0068',
							collectorId: COLLECTOR_ID,
							collectorName: 'Ana',
							overdueCount: 4,
							overdueAmount: '24000.00',
							oldestDueDate: '2027-01-10'
						}
					]
				},
				...overrides
			},
			params: { id: CAMPAIGN_ID },
			form
		} as never
	}).body;
}

describe('/campaigns/[id]/reports page', () => {
	it('renders exactly one report per URL, with totals before the table and whole pesos', () => {
		const expected = {
			'by-status': 'Bonos por estado comercial y financiero',
			'by-collector': 'Bonos por cobrador',
			installments: 'Cuotas: pendientes, pagadas, adelantadas y vencidas',
			monthly: 'Resumen mensual por cobrador: marzo de 2027'
		};
		for (const [view, title] of Object.entries(expected)) {
			const body = page({ view });
			expect(body).toContain(`<h2 id="report-title" class="min-w-0 text-heading-2">${title}</h2>`);
			expect(body.match(/id="report-title"/g)).toHaveLength(1);
			expect(body.indexOf('Totales del reporte')).toBeLessThan(body.indexOf('<table'));
			expect(body).toContain(view === 'installments' ? '12.000' : '120.000');
			expect(body).not.toContain('120.000,00');
			expect(body).toContain('data-stack="true"');
		}
		expect(page({ view: 'by-collector' })).toContain(
			`/campaigns/${CAMPAIGN_ID}/collectors/${COLLECTOR_ID}`
		);
	});

	it('escapes collector names (no raw HTML)', () => {
		const body = page({ view: 'by-collector' });
		expect(body).not.toContain('<b>Ana</b>');
		expect(body).toContain('&lt;b>Ana&lt;/b>');
	});

	it('keeps collector names from the report without offering an inaccessible record link', () => {
		const body = page({ view: 'by-collector', canViewCollectors: false });
		expect(body).toContain('&lt;b>Ana&lt;/b>');
		expect(body).not.toContain(`/campaigns/${CAMPAIGN_ID}/collectors/${COLLECTOR_ID}`);
	});

	it('shows each view’s empty state', () => {
		expect(page({ view: 'by-status', bondsByStatus: buildStatusMatrix([]) })).toContain(
			'Ningún bono coincide con los filtros.'
		);
		expect(page({ view: 'installments', installments: pivotInstallments([]) })).toContain(
			'Ninguna cuota coincide con los filtros.'
		);
		expect(
			page({ view: 'monthly', monthly: { rows: [], totals: totalCollectorMonthly([]) } })
		).toContain('No hubo actividad de cobradores en este mes.');
	});

	it('lists the overdue-warning sales, informative only (SAN-142)', () => {
		const body = page({ view: 'overdue-warning' });
		expect(body).toContain('Ventas con 3 o más cuotas vencidas');
		expect(body).toContain('no marca ninguna venta como incobrable');
		expect(body).toContain(`/campaigns/${CAMPAIGN_ID}/sales/s1`);
		expect(body).toContain('24.000');
		expect(body).toContain('10/01/2027');
		expect(body).not.toContain('?/setOverdueThreshold');
	});

	it('links sales only with sale.view, offers the N form only when editable, and says when none match', () => {
		const base = {
			threshold: 1,
			canEdit: true,
			canViewSales: false,
			sales: [] as unknown[]
		};
		const empty = page({ view: 'overdue-warning', overdueWarning: base });
		expect(empty).toContain('Ventas con 1 o más cuota vencida');
		expect(empty).toContain('Ninguna venta tiene 1 o más cuota vencida.');
		expect(empty).toContain('?/setOverdueThreshold');
		expect(empty).toContain('value="1"');
		const unlinked = page({
			view: 'overdue-warning',
			overdueWarning: {
				...base,
				canEdit: false,
				sales: [
					{
						saleId: 's1',
						bondId: 'b1',
						bondLabel: '0068',
						collectorId: COLLECTOR_ID,
						collectorName: 'Ana',
						overdueCount: 1,
						overdueAmount: '6000.00',
						oldestDueDate: '2027-01-10'
					}
				]
			}
		});
		expect(unlinked).toContain('0068');
		expect(unlinked).not.toContain('/sales/s1');
	});

	it('shows a threshold validation error on the field, and other errors in the alert', () => {
		const editable = {
			overdueWarning: { threshold: 3, canEdit: true, canViewSales: false, sales: [] }
		};
		const invalid = page(editable, {
			form: 'setOverdueThreshold',
			threshold: '0',
			fieldError: 'Ingresar un número entre 1 y 120.',
			message: null
		});
		expect(invalid).toContain('Ingresar un número entre 1 y 120.');
		expect(invalid).toContain('id="overdue-threshold-error"');
		expect(invalid).toMatch(/aria-describedby="[^"]*overdue-threshold-error/);
		expect(invalid).toContain('value="0"');
		expect(invalid).not.toContain('role="alert"');
		const conflict = page(editable, {
			form: 'setOverdueThreshold',
			threshold: '4',
			fieldError: null,
			message: 'No se puede cambiar el aviso de una campaña cerrada o anulada.'
		});
		expect(conflict).toContain('role="alert"');
	});
});
