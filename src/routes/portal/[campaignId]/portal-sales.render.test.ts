/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SalesPage from './ventas/+page.svelte';
import SalePage from './ventas/[saleId]/+page.svelte';
import BuyersPage from './compradores/+page.svelte';
import BuyerPage from './compradores/[buyerId]/+page.svelte';
import DuePage from './por-cobrar/+page.svelte';
import HomePage from '../+page.svelte';
import PortalNav from '$lib/components/portal/PortalNav.svelte';
import CollectSheet from '$lib/components/portal/CollectSheet.svelte';

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
	render(Page, {
		props: { data: { campaign: { id: 'k', name: 'Campaña 2027' }, ...data }, params: {} } as never
	}).body;

describe('portal sales and buyers pages', () => {
	it('lists sales with status badges, formatted money and links', () => {
		const html = body(SalesPage, { collector, sales: [sale], pagination });
		expect(html).toContain('0068');
		expect(html).toContain('href="/portal/k/ventas/s1"');
		expect(html).toContain('href="/portal/k/compradores/b1"');
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
		expect(html).toContain('href="/portal/k/ventas"');
		expect(html).toContain('href="/portal/k/ventas?page=3"');
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
			],
			submissions: [],
			reserved: {},
			canRegister: false,
			today: '2026-11-25',
			noteMax: 500,
			requestKey: 'k',
			submitted: false
		});
		expect(html).toContain('Vencida');
		expect(html).toContain('Pagada por adelantado');
		expect(html).toContain('En rendición');
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
		expect(html).toContain('href="/portal/k/compradores/b1"');
		expect(html).not.toContain('Documento');
	});

	it('renders the buyer detail with the own sales', () => {
		const html = body(BuyerPage, {
			collector,
			buyer: { id: 'b1', displayName: 'Ada Lovelace', phone: '11 5555', address: 'Calle 1' },
			sales: [sale]
		});
		expect(html).toContain('Calle 1');
		expect(html).toContain('href="/portal/k/ventas/s1"');
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
		const collectProps = {
			reserved: {},
			canRegister: true,
			today: '2026-11-26',
			noteMax: 500,
			requestKey: '00000000-0000-4000-8000-000000000000'
		};
		const text = (data: Record<string, unknown>) =>
			body(DuePage, { collector, pagination, ...collectProps, ...data })
				.replace(/<!--.*?-->/g, '')
				.replace(/<[^>]+>/g, ' ')
				.replaceAll('\u00a0', ' ')
				.replace(/\s+/g, ' ');
		const overdue = text({ due: [due] });
		expect(overdue).toContain('Vencidas');
		expect(overdue).toContain('1 cuota, $ 100');
		expect(overdue).toContain('0068');
		expect(overdue).toContain('Cuota 2, venció el 10/11/2026');
		expect(overdue).toContain('Cobrar la cuota 2 del bono 0068');
		expect(overdue).not.toContain('Llamar');
		expect(body(DuePage, { collector, due: [], pagination, ...collectProps })).toContain(
			'No hay cuotas por cobrar'
		);
	});

	it('groups what is overdue and what is due this week, with a call link and «Cobrar» (UX plan PR 10)', () => {
		const item = (over: Record<string, unknown>) => ({
			saleId: 's1',
			campaignName: 'C',
			numberDigits: 4,
			bondNumbers: [68],
			buyerId: 'b1',
			buyerName: 'Ada Lovelace',
			buyerPhone: '2364 47-1234',
			installmentId: 'i1',
			installmentNumber: 2,
			dueDate: '2026-11-10',
			amount: '100.00',
			status: 'overdue',
			pendingAmount: '0.00',
			balance: '100.00',
			...over
		});
		const props = {
			collector,
			pagination,
			reserved: { i3: '60.00', i4: '100.00' },
			canRegister: true,
			today: '2026-11-26',
			noteMax: 500,
			requestKey: '00000000-0000-4000-8000-000000000000'
		};
		const html = body(DuePage, {
			...props,
			due: [
				item({}),
				item({
					installmentId: 'i2',
					installmentNumber: 3,
					status: 'pending',
					dueDate: '2026-11-30'
				}),
				item({ installmentId: 'i3', saleId: 's2', bondNumbers: [70], status: 'pending' }),
				item({ installmentId: 'i4', saleId: 's3', bondNumbers: [71], status: 'pending' })
			]
		});
		expect(html.indexOf('Vencidas')).toBeLessThan(html.indexOf('Vencen esta semana'));
		expect(html.match(/data-due-row/g)).toHaveLength(4);
		// Every phone number is a call link.
		expect(html.match(/href="tel:2364471234"/g)).toHaveLength(4);
		expect(html).toContain('Llamar a Ada Lovelace al 2364 47-1234');
		// The bond leads to the sale and the buyer to their record.
		expect(html).toContain('href="/portal/k/ventas/s1"');
		expect(html).toContain('href="/portal/k/compradores/b1"');
		// What was sent and not processed yet stays in the list as «Enviado»; when nothing is left to
		// send for the installment, «Cobrar» is not offered.
		const flat = html.replace(/<!--.*?-->/g, '').replaceAll('\u00a0', ' ');
		expect(flat).toContain('Enviado $ 60');
		expect(flat).toContain('Enviado $ 100');
		expect(html.match(/Cobrar<span/g)).toHaveLength(3);
		expect(html).not.toContain('la cuota 2 del bono 0071');

		// Without the permission, or with an inactive collector, the list is read-only.
		const readOnly = body(DuePage, { ...props, canRegister: false, due: [item({})] });
		expect(readOnly).not.toContain('Cobrar<span');
		expect(readOnly).toContain('Llamar');
	});

	it('lists the campaigns on the portal landing, each linking to what there is to collect', () => {
		const html = body(HomePage, {
			collector,
			campaigns: [
				{ id: 'k', name: 'Campaña 2027', status: 'active' },
				{ id: 'j', name: 'Campaña 2026', status: 'closing' }
			]
		});
		// Decision P5: the way into a campaign is «Por cobrar».
		expect(html).toContain('href="/portal/k/por-cobrar"');
		expect(html).toContain('href="/portal/j/por-cobrar"');
		expect(html).toContain('Elegir la campaña');
		expect(html).toContain('En cierre');
		expect(body(HomePage, { collector: null, campaigns: [] })).toContain('no está vinculado');
		// A linked collector with no campaign in course is told so (decision Q4).
		expect(body(HomePage, { collector, campaigns: [] })).toContain('No hay una campaña en curso');
	});

	describe('portal sub-navigation', () => {
		const nav = (permissions: string[], pathname: string) =>
			render(PortalNav, {
				props: { campaignId: 'k', campaignName: 'Campaña 2027', permissions, pathname }
			}).body;
		const all = ['bond.view_own', 'sale.view_own', 'collector.ledger.view_own'];

		it('links every section, including Mi cuenta corriente, and marks the current one', () => {
			const html = nav(all, '/portal/k/ventas/s1');
			for (const section of ['bonos', 'ventas', 'compradores', 'por-cobrar', 'cuenta'])
				expect(html).toContain(`href="/portal/k/${section}"`);
			expect(html).toContain('Mi cuenta corriente');
			expect(html.match(/aria-current="page"/g)).toHaveLength(1);
			expect(html).toMatch(/aria-current="page"[^>]*>[\s\S]*?Mis ventas/);
			expect(html.indexOf('aria-current="page"')).toBeGreaterThan(html.indexOf('/portal/k/bonos'));
			expect(html.indexOf('aria-current="page"')).toBeLessThan(
				html.indexOf('/portal/k/compradores')
			);
		});

		it('puts «Por cobrar» first, and is one nav for the tab bar and the strip (UX plan PR 10)', () => {
			const html = nav(all, '/portal/k/por-cobrar');
			const order = ['por-cobrar', 'bonos', 'ventas', 'compradores', 'cuenta'].map((section) =>
				html.indexOf(`href="/portal/k/${section}"`)
			);
			expect([...order].sort((a, b) => a - b)).toEqual(order);
			expect(html.match(/<nav /g)).toHaveLength(1);
			expect(html).toContain('data-portal-tabs');
			// The short word under the icon is only drawn: the link's name stays the full label.
			expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*>Cuenta<\/span>/);
			expect(html).toMatch(/<span class="max-lg:sr-only">Mi cuenta corriente<\/span>/);
		});

		it('hides the sections the collector has no permission for', () => {
			const html = nav(['bond.view_own'], '/portal/k/bonos');
			expect(html).toContain('href="/portal/k/bonos"');
			expect(html).not.toContain('/portal/k/ventas');
			expect(html).not.toContain('/portal/k/cuenta');
		});
	});

	describe('Registrar cobro (SAN-147)', () => {
		const installments = [
			{
				id: 'i1',
				number: 1,
				dueDate: '2026-11-10',
				amount: '100.00',
				status: 'overdue',
				confirmedAmount: '0.00',
				pendingAmount: '0.00',
				balance: '100.00'
			},
			{
				id: 'i2',
				number: 2,
				dueDate: '2026-12-10',
				amount: '100.00',
				status: 'paid',
				confirmedAmount: '100.00',
				pendingAmount: '0.00',
				balance: '0.00'
			}
		];
		const base = {
			collector,
			sale,
			installments,
			payments: [],
			submissions: [],
			reserved: { i1: '30.00' },
			canRegister: true,
			today: '2026-11-25',
			noteMax: 500,
			requestKey: 'req-key',
			submitted: false
		};

		it('offers «Cobrar» only on collectable installments; nothing is posted from the row', () => {
			const html = body(SalePage, base);
			expect(html).toMatch(/Cobrar<span[^>]*>\s*la cuota 1<\/span>/);
			expect(html).not.toContain('la cuota 2</span>');
			// The form lives in the sheet, which opens on a tap: the page itself has none.
			expect(html).not.toContain('<form');
			expect(html).not.toContain('name="collectorId"');
		});

		it('the sheet posts the same fields to the sale’s registrar action, with what is left as maximum', () => {
			const html = render(CollectSheet, {
				props: {
					target: {
						action: '?/registrar',
						installmentId: 'i1',
						installmentNumber: 1,
						bond: '0068',
						buyerName: 'Ada Lovelace',
						available: '70.00'
					},
					today: '2026-11-25',
					noteMax: 500,
					requestKey: 'req-key',
					onClose: () => {}
				}
			}).body;
			expect(html).toMatch(/<form[^>]*method="POST"[^>]*action="\?\/registrar"/);
			// The fields and default values the action has always received.
			expect(html).toContain('name="installmentId" value="i1"');
			expect(html).toContain('name="requestKey" value="req-key"');
			expect(html).toMatch(/name="amount"[^>]*value="70.00"|value="70.00"[^>]*name="amount"/);
			expect(html).toMatch(
				/name="paymentDate"[^>]*value="2026-11-25"|value="2026-11-25"[^>]*name="paymentDate"/
			);
			expect(html).toContain('max="2026-11-25"');
			expect(html).toMatch(/<input[^>]*type="radio"[^>]*value="cash"[^>]*checked/);
			expect(html).toMatch(
				/<input[^>]*name="paymentMethod"[^>]*value="transfer"|value="transfer"[^>]*name="paymentMethod"/
			);
			expect(html).toContain('name="note"');
			expect([...html.matchAll(/name="([a-zA-Z]+)"/g)].map((m) => m[1]).sort()).toEqual([
				'amount',
				'installmentId',
				'note',
				'paymentDate',
				'paymentMethod',
				'paymentMethod',
				'requestKey'
			]);
			// The collector is never a form field.
			expect(html).not.toContain('name="collectorId"');
			expect(html).toContain('Cobrar la cuota 1 del bono 0068');
			expect(html).toContain('Ada Lovelace');
			expect(html).toContain('Una vez enviado, no se puede editar.');
			expect(html.replaceAll('\u00a0', ' ')).toContain('Enviar cobro de $ 70');
		});

		it('a submission the server sent back reopens the sheet with what was typed and the error', () => {
			const html = render(SalePage, {
				props: {
					data: { campaign: { id: 'k', name: 'Campaña 2027' }, ...base },
					form: {
						form: 'registrar',
						installmentId: 'i1',
						message: 'Revisar los campos marcados.',
						errors: { paymentDate: ['La fecha del cobro no puede ser futura.'] },
						values: {
							installmentId: 'i1',
							amount: '45,50',
							paymentMethod: 'transfer',
							paymentDate: '2026-12-01',
							note: 'En mano'
						}
					},
					params: {}
				} as never
			}).body;
			expect(html).toContain('action="?/registrar"');
			expect(html).toContain('Revisar los campos marcados.');
			expect(html).toContain('La fecha del cobro no puede ser futura.');
			expect(html).toContain('value="45,50"');
			expect(html).toMatch(/<input[^>]*type="radio"[^>]*value="transfer"[^>]*checked/);
			expect(html).toContain('En mano');
		});

		it('hides the action without payment.create_own or on an inactive sale', () => {
			const html = body(SalePage, { ...base, canRegister: false });
			expect(html).not.toContain('Cobrar<span');
			expect(html).not.toContain('<form');
			expect(html).not.toContain('Acciones');
		});

		it('says the totals in one line, and the phone is a call link', () => {
			const html = body(SalePage, base)
				.replace(/<!--.*?-->/g, '')
				.replaceAll('\u00a0', ' ');
			const line = html
				.slice(html.indexOf('data-sale-totals'))
				.replace(/<[^>]+>/g, '')
				.replace(/\s+/g, ' ');
			expect(line).toContain(
				'Cobrado $ 100,00 de $ 300,00. Falta cobrar $ 160,00; hay $ 40,00 pendientes de rendición.'
			);
			expect(html).toContain('href="tel:115555"');
		});

		it('lists sent collections: the four states, rejected with the reason', () => {
			const html = body(SalePage, {
				...base,
				submissions: [
					{
						id: 'a',
						paymentDate: '2026-11-20',
						amount: '30.00',
						method: 'cash',
						status: 'draft',
						rejectionReason: null,
						note: 'En mano',
						createdAt: '2026-11-20T10:00:00Z',
						installmentNumbers: [1]
					},
					{
						id: 'd',
						paymentDate: '2026-11-21',
						amount: '15.00',
						method: 'cash',
						status: 'pending_in_settlement',
						rejectionReason: null,
						note: null,
						createdAt: '2026-11-21T10:00:00Z',
						installmentNumbers: [1]
					},
					{
						id: 'b',
						paymentDate: '2026-11-19',
						amount: '20.00',
						method: 'transfer',
						status: 'confirmed',
						rejectionReason: null,
						note: null,
						createdAt: '2026-11-19T10:00:00Z',
						installmentNumbers: [1]
					},
					{
						id: 'c',
						paymentDate: '2026-11-18',
						amount: '10.00',
						method: 'cash',
						status: 'annulled',
						rejectionReason: 'No llegó el dinero',
						note: null,
						createdAt: '2026-11-18T10:00:00Z',
						installmentNumbers: [1]
					}
				]
			});
			expect(html).toContain('Cobros enviados');
			expect(html).toContain('Enviado');
			expect(html).toContain('En rendición');
			expect(html).toContain('Confirmado');
			expect(html).toContain('Rechazado');
			expect(html).toContain('Motivo: No llegó el dinero');
			expect(html).toContain('Nota: En mano');
		});

		it('shows the confirmation after sending', () => {
			expect(body(SalePage, { ...base, submitted: true })).toContain('Cobro enviado');
		});
	});
});
