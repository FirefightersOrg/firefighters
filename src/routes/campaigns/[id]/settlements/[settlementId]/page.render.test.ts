/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
const id = 'c',
	settlement = {
		id: 's',
		settlementNumber: 1,
		collectorName: 'Ana',
		openedAt: '2026-01-01T02:59:59Z',
		status: 'open'
	};
const totals = {
	totalCash: '1.00',
	totalTransfer: '2.00',
	totalAmount: '3.00',
	commissionAmount: '0.00',
	commissionPaidAmount: '0.00',
	netToFirefighters: '3.00',
	collectorCreditBalance: '0.00'
};
const page = (status = 'open') =>
	render(Page, {
		props: {
			data: {
				campaign: { id },
				today: '2026-11-25',
				settlement: { ...settlement, status },
				totals,
				payments: [
					{
						id: 'p',
						date: '2026-01-01',
						amount: '3.00',
						method: 'cash',
						status: status === 'open' ? 'pending_in_settlement' : 'confirmed',
						bondId: 'b',
						bond: '0068',
						buyer: 'Ada Lovelace',
						installments: [2, 3]
					}
				],
				candidates: [],
				submitted: [],
				reasonMax: 2000,
				can: { add: status === 'open', remove: status === 'open', close: status === 'open' }
			},
			params: { id, settlementId: 's' }
		} as any
	}).body;
describe('settlement workspace render', () => {
	it('open: the entry by bond number, the running sheet and the close (UX plan PR 7)', () => {
		const body = page();
		expect(body).toContain('Rendición 1 de Ana');
		expect(body).toContain('Desde el 31/12/2025');
		// The entry asks for the bond number and posts to the same action.
		expect(body).toContain('?/add');
		expect(body).toContain('id="bond-number"');
		expect(body).toContain('Número del bono que pagó');
		// No sale with debt in this fixture: the hint says so instead of inviting to type.
		expect(body).toContain('Ana no tiene ventas con deuda en esta campaña.');
		// The sheet: what came in, what the collector keeps, what is left, and the cash to hand over.
		expect(body).toContain('Hasta ahora');
		expect(body).toContain('Efectivo (1 pago)');
		expect(body).toContain('Transferencias (0 pagos)');
		expect(body).toContain('Neto para Bomberos');
		expect(body).toMatch(/Ana tiene que entregar\s*<strong[^>]*>\$\u00a01<\/strong>\s*en efectivo/);
		// One list of amounts: the sheet is a <dl> whose groups only hold dt and dd.
		expect(body).not.toContain('text-number-lg');
		expect(body).toContain('?/close');
		// Native maxlength counts UTF-16 units, unlike the database's code-point limit.
		expect(body).not.toContain('maxlength=');
	});
	it('open: every payment names its bond, its buyer and its installments (audit A4)', () => {
		const body = page();
		expect(body).toContain('Pagos de esta rendición');
		expect(body).toContain('0068');
		expect(body).toContain('/campaigns/c/bonds/b');
		expect(body).toContain('Ada Lovelace');
		expect(body).toContain('Cuotas 2 y 3, efectivo, 01/01/2026');
		// «Quitar» is behind the row menu, which says what it acts on; nothing is posted without a reason.
		expect(body).toContain('Acciones del pago del bono 0068');
		expect(body).not.toContain('action="?/remove"');
		expect(body).not.toContain('Motivo obligatorio');
	});
	it('open: a payment taken out stays on record, apart, and does not count', () => {
		const payment = {
			id: 'p1',
			date: '2026-11-25',
			amount: '3.00',
			method: 'cash',
			status: 'pending_in_settlement',
			bondId: 'b',
			bond: '0068',
			buyer: 'Ada Lovelace',
			installments: [1]
		};
		const body = render(Page, {
			props: {
				data: {
					campaign: { id },
					today: '2026-11-25',
					settlement,
					totals,
					payments: [payment, { ...payment, id: 'p2', bond: '0070', status: 'annulled' }],
					candidates: [],
					submitted: [],
					reasonMax: 2000,
					can: { add: true, remove: true, close: true, correctPayment: true }
				},
				params: { id, settlementId: 's' }
			} as any
		}).body;
		expect(body).toContain('Efectivo (1 pago)');
		expect(body).toContain('1 pago quitado');
		expect(body).toContain('Pagos quitados de esta rendición');
		expect(body).toContain('Anulado');
		// Only the payment that is still in the settlement has a menu.
		expect(body).toContain('Acciones del pago del bono 0068');
		expect(body).not.toContain('Acciones del pago del bono 0070');
	});
	it('open: a payment whose buyer the role cannot read shows the bond alone', () => {
		const body = render(Page, {
			props: {
				data: {
					campaign: { id },
					today: '2026-11-25',
					settlement,
					totals,
					payments: [
						{
							id: 'p',
							date: '2026-11-25',
							amount: '3.00',
							method: 'transfer',
							status: 'pending_in_settlement',
							bondId: null,
							bond: '0068',
							buyer: null,
							installments: [4]
						}
					],
					candidates: [],
					submitted: [],
					reasonMax: 2000,
					can: { add: false, remove: false, close: false }
				},
				params: { id, settlementId: 's' }
			} as any
		}).body;
		expect(body).toContain('0068');
		expect(body).toContain('Cuota 4');
		expect(body).toContain('Transferencia, hoy');
		expect(body).not.toContain('Unknown');
		expect(body).not.toContain('Comprador sin nombre');
		// Read-only: no entry, no row menu, no close.
		expect(body).not.toContain('?/add');
		expect(body).not.toContain('Acciones del pago');
		expect(body).not.toContain('?/close');
	});
	it('renders closed documents read-only', () => {
		const body = page('closed');
		expect(body).toContain('/settlements/s/print');
		expect(body).toContain('/payments/p/print');
		expect(body).not.toContain('?/add');
		expect(body).not.toContain('?/close');
	});
	it('labels the commission as generated only once the settlement closed', () => {
		expect(page('open')).toContain('Comisión preliminar');
		expect(page('open')).toContain('Comisión que se queda el cobrador');
		// An annulled settlement shows no commission at all, and says it is annulled.
		const annulled = page('annulled');
		expect(annulled).toContain('Rendición anulada');
		expect(annulled).toContain('Total registrado');
		expect(annulled).not.toContain('Comisión');
		expect(annulled).not.toContain('Neto para Bomberos');
		for (const status of ['closed', 'corrected']) {
			expect(page(status)).toContain('Comisión generada');
			expect(page(status)).not.toContain('Comisión preliminar');
		}
	});
	it('does not print certificates for unconfirmed payments', () => {
		const body = render(Page, {
			props: {
				data: {
					campaign: { id },
					today: '2026-11-25',
					settlement: { ...settlement, status: 'closed' },
					totals,
					payments: [{ id: 'p', date: '', amount: '1.00', method: 'cash', status: 'annulled' }],
					candidates: [],
					reasonMax: 1,
					can: { add: false, remove: false, close: false }
				},
				params: { id, settlementId: 's' }
			} as any
		}).body;
		expect(body).not.toContain('/payments/p/print');
	});
});

describe('collector submissions (SAN-147)', () => {
	const row = {
		id: 'pay-1',
		date: '2026-11-20',
		amount: '70.00',
		method: 'transfer',
		note: 'Pagó el vecino',
		submittedAt: '2026-11-20T10:00:00Z',
		bond: '0068',
		buyer: 'Ada Lovelace',
		installments: [1, 2]
	};
	const render_ = (can: Record<string, boolean>, submitted: unknown[]) =>
		render(Page, {
			props: {
				data: {
					campaign: { id },
					today: '2026-11-25',
					settlement,
					totals,
					payments: [],
					candidates: [],
					submitted,
					reasonMax: 1000,
					can
				},
				params: { id, settlementId: 's' }
			} as any
		}).body;
	it('lists the drafts with include and reject', () => {
		const html = render_({ reviewSubmitted: true }, [row]);
		expect(html).toContain('Cobros que envió Ana');
		expect(html).toContain('0068');
		expect(html).toContain('Ada Lovelace');
		expect(html).toContain('cuotas 1 y 2');
		expect(html).toContain('Nota del cobrador: «Pagó el vecino»');
		expect(html).toContain('action="?/includeSubmitted"');
		expect(html).toContain('Incluir en la rendición');
		expect(html).toContain('name="paymentId" value="pay-1"');
		// «Rechazar» opens a dialog that asks for the reason (E2E): nothing is posted from the row.
		expect(html).toContain('Rechazar');
		expect(html).not.toContain('action="?/rejectSubmitted"');
	});
	it('blocks the close and says what to do while drafts are pending (SAN-156)', () => {
		const html = render_({ reviewSubmitted: true, close: true }, [row, { ...row, id: 'pay-2' }]);
		expect(html).toContain('2 sin procesar');
		expect(html).toContain('suman $\u00a0140');
		expect(html).toContain(
			'Hay 2 cobros enviados por el cobrador sin procesar. Inclúyalos o rechácelos antes de cerrar la rendición.'
		);
		// The close button is disabled and points at the explanation.
		const closeButton = html.match(/<button[^>]*aria-describedby="close-blocked"[^>]*>/)?.[0];
		expect(closeButton).toMatch(/\sdisabled/);
		expect(html).toContain('id="close-blocked"');
		// On a phone the task bar leads to what blocks the close instead of a dead button.
		expect(html).toContain('href="#submitted-payments"');
		expect(html).toContain('Ver 2 cobros sin procesar');
	});
	it('singular wording and an enabled close button when nothing is pending', () => {
		expect(render_({ reviewSubmitted: true, close: true }, [row])).toContain(
			'Hay 1 cobro enviado por el cobrador sin procesar. Inclúyalo o rechácelo'
		);
		const clear = render_({ reviewSubmitted: true, close: true }, []);
		expect(clear).not.toContain('Hay ');
		expect(clear).not.toContain('close-blocked');
		expect(clear).toContain('Cerrar rendición');
	});
	it('is read-only without the settlement permissions', () => {
		const html = render_({ reviewSubmitted: false }, [row]);
		expect(html).toContain('Cobros que envió Ana');
		expect(html).not.toContain('?/includeSubmitted');
		expect(html).not.toContain('?/rejectSubmitted');
	});
	it('is absent when there is nothing to review and no permission, and for closed settlements', () => {
		expect(render_({ reviewSubmitted: false }, [])).not.toContain('Cobros que envió');
		expect(render_({ reviewSubmitted: true }, [])).not.toContain('Cobros que envió');
		expect(page('closed')).not.toContain('Cobros que envió');
	});
});
describe('settlement workspace corrections (SAN-73)', () => {
	const closed = (can: Record<string, boolean>) =>
		render(Page, {
			props: {
				data: {
					campaign: { id },
					today: '2026-11-25',
					settlement: { ...settlement, status: 'closed' },
					totals,
					payments: [
						{ id: 'p', date: '2026-01-01', amount: '3.00', method: 'cash', status: 'confirmed' }
					],
					candidates: [],
					submitted: [],
					reasonMax: 1000,
					can: { add: false, remove: false, close: false, ...can }
				},
				params: { id, settlementId: 's' }
			} as any
		}).body;

	it('shows payment correction forms with the indicative ledger preview only with permission', () => {
		const allowed = closed({ correctPayment: true });
		expect(allowed).toContain('?/annulPayment');
		expect(allowed).toContain('Vista indicativa:');
		const denied = closed({ correctPayment: false });
		expect(denied).not.toContain('?/annulPayment');
		expect(denied).not.toContain('Vista indicativa:');
	});

	it('shows the settlement correction with its ledger preview only with settlement.correct', () => {
		const allowed = closed({ correctSettlement: true });
		expect(allowed).toContain('Vista indicativa del libro');
		expect(allowed).toContain('name="commissionDelta"');
		expect(closed({ correctSettlement: false })).not.toContain('Vista indicativa del libro');
	});
	it('asks for the bond number instead of listing every sale', () => {
		const body = render(Page, {
			props: {
				data: {
					campaign: { id },
					today: '2026-11-25',
					settlement,
					totals,
					payments: [],
					candidates: [
						{
							id: 'i1',
							saleId: 'sale-a',
							bond: '0068',
							buyer: 'Ana',
							number: 1,
							dueDate: '2026-01-10',
							amount: '100.00',
							status: 'pending'
						},
						{
							id: 'i2',
							saleId: 'sale-a',
							bond: '0068',
							buyer: 'Ana',
							number: 2,
							dueDate: '2026-02-10',
							amount: '100.00',
							status: 'pending'
						},
						{
							id: 'i3',
							saleId: 'sale-b',
							bond: '0070',
							buyer: 'Luis',
							number: 1,
							dueDate: '2026-01-10',
							amount: '50.00',
							status: 'pending'
						}
					],
					submitted: [],
					reasonMax: 1000,
					can: { add: true, remove: false, close: false }
				},
				form: null,
				params: { id, settlementId: 's' }
			} as any
		}).body;
		// The sale is found by number in the browser (domain/settlement-entry.test.ts, and the E2E):
		// nothing about a sale is on the page until its number is typed.
		expect(body).toContain('id="bond-number"');
		expect(body).toContain('inputmode="numeric"');
		expect(body).toContain(
			'Solo los bonos que vendió Ana. Enter busca; otro Enter agrega el pago.'
		);
		expect(body).not.toContain('<option value="sale-a"');
		expect(body).not.toContain('name="saleId"');
		expect(body).not.toContain('name="installmentId"');
	});

	it('reads a closed settlement as a cash sheet (redesign)', () => {
		const sheet = (can: Record<string, boolean> = {}) =>
			render(Page, {
				props: {
					data: {
						campaign: { id },
						today: '2026-11-25',
						settlement: {
							...settlement,
							status: 'closed',
							collectorId: 'col-1',
							closedAt: '2026-11-24T21:05:00Z'
						},
						totals: {
							totalCash: '115000.00',
							totalTransfer: '45000.00',
							totalAmount: '160000.00',
							commissionAmount: '16000.00',
							commissionPaidAmount: '11500.00',
							netToFirefighters: '148500.00',
							collectorCreditBalance: '4500.00'
						},
						payments: [
							{
								id: 'p1',
								date: '2026-11-20',
								amount: '115000.00',
								method: 'cash',
								status: 'confirmed'
							},
							{
								id: 'p2',
								date: '2026-11-21',
								amount: '45000.00',
								method: 'transfer',
								status: 'confirmed'
							}
						],
						candidates: [],
						submitted: [],
						reasonMax: 2000,
						can: { add: false, remove: false, close: false, ...can }
					},
					params: { id, settlementId: 's' }
				} as any
			}).body;
		const body = sheet();
		expect(body).toContain('Efectivo recibido (1 pago)');
		expect(body).toContain('Transferencias (1 pago)');
		expect(body).toContain('Neto para Bomberos');
		expect(body).toMatch(/148\.500,00/);
		// No figure is computed on the client: every amount comes from the stored totals.
		expect(body).not.toContain('Se entregan');
		expect(body).toContain('<span class="sr-only">menos</span>');
		expect(body).not.toContain('corrección registrada');
		expect(body).toContain('Saldo a favor del cobrador');
		expect(body).toContain('Ana, cerrada el');
		expect(body).not.toContain('/collectors/col-1/ledger');
		expect(body).not.toContain('Corregir esta rendición');
		const allowed = sheet({ viewLedger: true, correctSettlement: true });
		expect(allowed).toContain('/collectors/col-1/ledger');
		expect(allowed).toContain('Corregir esta rendición');
		expect(allowed).toContain('?/correctSettlement');
		// The open-workspace metric grid is not shown on the sheet.
		expect(allowed).not.toContain('Comisión retenida ahora');
	});

	it('says when a closed settlement was corrected', () => {
		expect(page('corrected')).toContain('Esta rendición tiene una corrección registrada.');
		expect(page('closed')).not.toContain('corrección registrada');
	});
});
