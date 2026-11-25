/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SalesPage from './ventas/+page.svelte';
import SalePage from './ventas/[saleId]/+page.svelte';
import BuyersPage from './compradores/+page.svelte';
import BuyerPage from './compradores/[buyerId]/+page.svelte';
import DuePage from './por-cobrar/+page.svelte';
import HomePage from './+page.svelte';

const collector = { id: 'c', displayName: 'Ana', status: 'active' };
const pagination = { page: 1, pageCount: 1 };
const sale = {
	saleId: 's1',
	campaignId: 'k',
	campaignName: 'Campaña 2027',
	numberDigits: 4,
	bondNumbers: [68],
	buyerId: 'b1',
	buyerName: 'Ada Lovelace',
	buyerPhone: '11 5555',
	buyerAddress: 'Calle 1',
	saleStatus: 'active',
	paymentMode: 'installments',
	totalAmount: '300.00',
	paidAmount: '100.00',
	pendingAmount: '40.00',
	balance: '160.00',
	overdueCount: 1,
	nextDueDate: '2026-12-01',
	financialStatus: 'overdue',
	soldAt: '2026-11-01T15:00:00Z'
};
const body = (Page: any, data: Record<string, unknown>) =>
	render(Page, { props: { data, params: {} } as never }).body;

describe('portal sales and buyers pages', () => {
	it('lists sales with status badges, formatted money and links', () => {
		const html = body(SalesPage, { collector, sales: [sale], pagination });
		expect(html).toContain('0068');
		expect(html).toContain('href="/portal/ventas/s1"');
		expect(html).toContain('href="/portal/compradores/b1"');
		expect(html).toContain('En mora');
		expect(html).toContain('01/12/2026');
		expect(html).toContain('1 vencida');
		expect(html).toMatch(/\$\s160,00/);
	});

	it('shows an empty state, and a distinct one without a linked collector', () => {
		expect(body(SalesPage, { collector, sales: [], pagination })).toContain(
			'Todavía no hay ventas'
		);
		expect(body(SalesPage, { collector: null, sales: [], pagination })).toContain(
			'Sin cobrador vinculado'
		);
	});

	it('renders pagination links with the page query', () => {
		const html = body(SalesPage, {
			collector,
			sales: [sale],
			pagination: { page: 2, pageCount: 3 }
		});
		expect(html).toContain('Página 2 de 3');
		expect(html).toContain('href="/portal/ventas"');
		expect(html).toContain('href="/portal/ventas?page=3"');
	});

	it('renders the sale detail: installment states, pending payment and no write controls', () => {
		const html = body(SalePage, {
			collector,
			sale,
			installments: [
				{
					id: 'i1',
					number: 1,
					dueDate: '2026-11-10',
					amount: '100.00',
					status: 'overdue',
					confirmedAmount: '0.00',
					pendingAmount: '40.00',
					balance: '60.00'
				},
				{
					id: 'i2',
					number: 2,
					dueDate: '2026-12-10',
					amount: '100.00',
					status: 'paid_advance',
					confirmedAmount: '100.00',
					pendingAmount: '0.00',
					balance: '0.00'
				}
			],
			payments: [
				{
					id: 'p1',
					paymentDate: '2026-11-12',
					amount: '40.00',
					method: 'cash',
					status: 'pending_in_settlement'
				}
			]
		});
		expect(html).toContain('Vencida');
		expect(html).toContain('Pagada por adelantado');
		expect(html).toContain('Pendiente de rendición');
		expect(html).toContain('Efectivo');
		expect(html).toContain('Calle 1');
		expect(html).not.toContain('<form');
		expect(html).not.toContain('Acciones');
	});

	it('lists buyers with contact data only', () => {
		const html = body(BuyersPage, {
			collector,
			buyers: [
				{
					id: 'b1',
					displayName: 'Ada Lovelace',
					phone: '11 5555',
					address: null,
					saleCount: 2,
					balance: '160.00'
				}
			],
			pagination
		});
		expect(html).toContain('Ada Lovelace');
		expect(html).toContain('11 5555');
		expect(html).toContain('href="/portal/compradores/b1"');
		expect(html).not.toContain('Documento');
	});

	it('renders the buyer detail with the own sales', () => {
		const html = body(BuyerPage, {
			collector,
			buyer: { id: 'b1', displayName: 'Ada Lovelace', phone: '11 5555', address: 'Calle 1' },
			sales: [sale]
		});
		expect(html).toContain('Calle 1');
		expect(html).toContain('href="/portal/ventas/s1"');
	});

	it('renders the due list with its empty state', () => {
		const due = {
			saleId: 's1',
			campaignName: 'C',
			numberDigits: 4,
			bondNumbers: [68],
			buyerId: 'b1',
			buyerName: 'Ada',
			buyerPhone: null,
			installmentId: 'i1',
			installmentNumber: 2,
			dueDate: '2026-11-10',
			amount: '100.00',
			status: 'overdue',
			pendingAmount: '0.00',
			balance: '100.00'
		};
		expect(body(DuePage, { collector, due: [due], pagination })).toContain('Vencida');
		expect(body(DuePage, { collector, due: [], pagination })).toContain('No hay cuotas por cobrar');
	});

	it('links the portal home to the new sections only with sale.view_own', () => {
		expect(body(HomePage, { collector, canViewSales: true })).toContain(
			'href="/portal/por-cobrar"'
		);
		expect(body(HomePage, { collector, canViewSales: false })).not.toContain('/portal/ventas');
	});
});
