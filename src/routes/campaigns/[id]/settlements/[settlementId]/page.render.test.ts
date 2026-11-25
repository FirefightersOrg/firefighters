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
				settlement: { ...settlement, status },
				totals,
				payments: [
					{ id: 'p', date: '2026-01-01', amount: '3.00', method: 'cash', status: 'confirmed' }
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
	it('renders seven metrics and open forms', () => {
		const body = page();
		// Every Stat value is tabular (acceptance: amounts right-aligned and tabular).
		expect(body.match(/text-number-lg[^"]*tabular-nums/g)).toHaveLength(7);
		expect(body).toContain('?/add');
		expect(body).toContain('?/remove');
		expect(body).toContain('?/close');
		expect(body).toContain('31/12/2025');
		// Native maxlength counts UTF-16 units, unlike the database's code-point limit.
		expect(body).not.toContain('maxlength=');
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
	it('lists the drafts with include and reject (reason required)', () => {
		const html = render_({ reviewSubmitted: true }, [row]);
		expect(html).toContain('Cobros enviados por el cobrador');
		expect(html).toContain('Bono 0068');
		expect(html).toContain('Ada Lovelace');
		expect(html).toContain('Pagó el vecino');
		expect(html).toContain('action="?/includeSubmitted"');
		expect(html).toContain('action="?/rejectSubmitted"');
		expect(html).toContain('Incluir en la rendición');
		expect(html).toContain('Rechazar');
		expect(html).toContain('name="paymentId" value="pay-1"');
		expect(html).toMatch(/name="reason"[^>]*required|required[^>]*name="reason"/);
	});
	it('is read-only without the settlement permissions', () => {
		const html = render_({ reviewSubmitted: false }, [row]);
		expect(html).toContain('Cobros enviados por el cobrador');
		expect(html).not.toContain('?/includeSubmitted');
		expect(html).not.toContain('?/rejectSubmitted');
	});
	it('is absent when there is nothing to review and no permission, and for closed settlements', () => {
		expect(render_({ reviewSubmitted: false }, [])).not.toContain(
			'Cobros enviados por el cobrador'
		);
		expect(page('closed')).not.toContain('Cobros enviados por el cobrador');
	});
});
describe('settlement workspace corrections (SAN-73)', () => {
	const closed = (can: Record<string, boolean>) =>
		render(Page, {
			props: {
				data: {
					campaign: { id },
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
	it('offers one fast-entry option per sale, also for sales with several pending installments', () => {
		const body = render(Page, {
			props: {
				data: {
					campaign: { id },
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
		// Before SAN-135 a sale with more than one candidate installment was hidden from the selector.
		expect(body.match(/<option value="sale-a"/g)).toHaveLength(1);
		expect(body.match(/<option value="sale-b"/g)).toHaveLength(1);
		expect(body).toContain('Bono 0068 — Ana');
	});

	it('reads a closed settlement as a cash sheet (redesign)', () => {
		const sheet = (can: Record<string, boolean> = {}) =>
			render(Page, {
				props: {
					data: {
						campaign: { id },
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
