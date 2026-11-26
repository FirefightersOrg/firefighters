/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

const installment = (number: number, dueDate: string, extra: Record<string, unknown> = {}) => ({
	id: `i${number}`,
	installmentNumber: number,
	dueDate,
	amount: '10000.00',
	status: 'pending',
	applied: '0.00',
	lastPayment: null,
	waiting: '0.00',
	waitingPayment: null,
	...extra
});
const INSTALLMENTS = [
	installment(1, '2026-10-10', {
		status: 'paid',
		applied: '10000.00',
		lastPayment: { date: '2026-10-08', method: 'cash', settlementNumber: 4 }
	}),
	installment(2, '2026-11-10', {
		waiting: '10000.00',
		waitingPayment: {
			date: '2026-11-20',
			method: 'transfer',
			settlementNumber: 9,
			submittedByCollector: false
		}
	}),
	installment(3, '2026-12-10')
];

describe('sale record', () => {
	const page = (extra: Record<string, any> = {}, form: unknown = null) =>
		render(Page, {
			props: {
				data: {
					campaign: {
						id: 'c',
						name: 'Campaign',
						numberDigits: 4,
						maxNumber: 9999,
						associatedNumberOffset: 4871,
						associatedNumberMode: 'linear',
						overflowPolicy: 'reject'
					},
					sale: {
						bondId: 'b',
						bondNumberPairs: [{ base: 68, associated: 4939 }],
						sale: {
							buyerId: 'buyer',
							collectorId: 'collector',
							paymentMode: 'installments',
							totalAmount: '30000.00',
							soldAt: '2026-09-12T15:00:00Z',
							status: 'active',
							...(extra.saleRow ?? {})
						},
						uncollectible: extra.uncollectible ?? null
					},
					today: '2026-11-26',
					parties: extra.parties ?? {
						buyer: { id: 'buyer', name: 'Ada Gómez', canOpen: true },
						collector: { id: 'collector', name: 'Ana Pérez', canOpen: true }
					},
					installments: extra.installments ?? INSTALLMENTS,
					canViewPayments: extra.canViewPayments ?? true,
					canPay: extra.canPay ?? false,
					financialStatus: extra.financialStatus ?? 'overdue',
					financialStatusSnapshot: 'no_payments',
					correction: extra.correction ?? null,
					canMarkUncollectible: extra.canMarkUncollectible ?? false,
					canRevertUncollectible: extra.canRevertUncollectible ?? false
				},
				form,
				params: { id: 'c', saleId: 's' }
			} as any
		}).body;
	const text = (body: string) =>
		body
			.replace(/<!--.*?-->/g, '')
			.replace(/<[^>]+>/g, ' ')
			.replace(/&nbsp;|\u00a0/g, ' ')
			.replace(/\s+/g, ' ')
			.replace(/ ([.,])/g, '$1');
	const CORRECTION = {
		buyers: [
			{ id: 'buyer', firstName: 'Ada', lastName: 'Gómez', businessName: null },
			{ id: 'new-buyer', firstName: 'Bea', lastName: 'Buyer', businessName: null }
		],
		buyersTotal: 2,
		collectors: [
			{ id: 'collector', displayName: 'Ana Pérez' },
			{ id: 'new-collector', displayName: 'Beto' }
		]
	};

	it('leads with what is owed and says the sale in one sentence', () => {
		const body = page();
		const plain = text(body);
		expect(plain).toContain('Venta del bono 0068');
		expect(body).toMatch(/data-sale-lead[\s\S]*?Falta cobrar[\s\S]*?\$(&nbsp;|\u00a0)20\.000/);
		expect(plain).toContain(
			'Ada Gómez compró el bono 0068 el 12/09/2026 en 3 cuotas, por $ 30.000. Lo cobra Ana Pérez. Pagó 1 cuota y debe $ 20.000, de los cuales $ 10.000 están vencidos.'
		);
		// The associated number is named apart, never beside the bond's own number.
		expect(plain).toContain('Número asociado 4939');
		expect(plain).not.toContain('0068 / 4939');
		// The debt is said once as a figure: the list does not repeat it.
		expect(plain.match(/Falta cobrar/g)).toHaveLength(1);
	});
	it('links the bond, the buyer and the collector when the role can open them', () => {
		const body = page();
		expect(body).toContain('href="/campaigns/c/bonds/b"');
		expect(body).toContain('href="/campaigns/c/buyers/buyer"');
		expect(body).toContain('href="/campaigns/c/collectors/collector"');
	});
	it('names without a link what the role cannot open, and never a party it cannot read', () => {
		const named = page({
			parties: {
				buyer: { id: 'buyer', name: 'Ada Gómez', canOpen: false },
				collector: { id: 'collector', name: 'Ana Pérez', canOpen: false }
			}
		});
		expect(named).toContain('Ada Gómez');
		expect(named).not.toContain('/buyers/buyer');
		expect(named).not.toContain('/collectors/collector');
		const unread = text(
			page({
				parties: {
					buyer: { id: 'buyer', name: null, canOpen: false },
					collector: { id: 'collector', name: null, canOpen: false }
				}
			})
		);
		expect(unread).toContain('El bono 0068 se vendió el 12/09/2026 en 3 cuotas');
		expect(unread).not.toMatch(/Unknown|Sin acceso|Lo cobra/);
	});
	it('lists the installments with how each was paid and the payment that still waits', () => {
		const body = page();
		const plain = text(body);
		expect(body.match(/data-installment=/g)).toHaveLength(3);
		expect(plain).toContain('Pagada el 08/10/2026 en efectivo, rendición 4');
		expect(plain).toContain('Venció el 10/11/2026');
		expect(plain).toContain(
			'Pago de $ 10.000 por transferencia cargado en la rendición 9, que sigue abierta'
		);
		expect(plain).toContain('Vence el 10/12/2026');
		expect(text(page({ canViewPayments: false }))).toContain('Sin permiso para ver los pagos');
	});
	it('offers «Registrar pago» for the sale’s collector only while there is something to collect', () => {
		expect(page()).not.toContain('Registrar pago');
		expect(page({ canPay: true })).toContain(
			'href="/campaigns/c/settlements/new?intent=payment&amp;collector=collector"'
		);
		const paid = page({
			canPay: true,
			financialStatus: 'fully_paid',
			installments: [1, 2, 3].map((n) =>
				installment(n, '2026-10-10', { status: 'paid', applied: '10000.00' })
			)
		});
		expect(paid).not.toContain('Registrar pago');
		expect(text(paid)).toMatch(/Pagado \$ 30\.000/);
		const annulled = page({ canPay: true, saleRow: { status: 'annulled' } });
		expect(annulled).not.toContain('Registrar pago');
		expect(text(annulled)).toContain('La venta fue anulada: no se cobra.');
		expect(text(annulled)).toMatch(/Total de la venta \$ 30\.000/);
	});
	it('keeps the corrections collapsed, behind their permission, each with its dialog', () => {
		const none = page();
		expect(none).not.toContain('Corregir la venta');
		expect(none).not.toContain('?/correctBuyer');
		const body = page({ correction: CORRECTION });
		expect(body).toContain('Corregir la venta');
		expect(body).toContain('action="?/correctBuyer"');
		expect(body).toContain('action="?/correctCollector"');
		expect(body).not.toContain('?/markUncollectible');
		const plain = text(body);
		expect(plain).toContain('¿Corregir el comprador de la venta del bono 0068?');
		expect(plain).toContain('Hoy figura Ada Gómez. Cambiar el comprador no mueve la cuenta');
		expect(plain).toContain('Hoy figura Ana Pérez. Cambiar el cobrador compensa la comisión');
		expect(plain).toContain('base de datos');
		expect(body).not.toContain('maxlength=');
	});
	it('reopens a rejected correction with its values and the error inside the dialog', () => {
		const body = page(
			{ correction: { ...CORRECTION, buyersTotal: 750 } },
			{
				form: 'correctBuyer',
				success: false,
				message: 'Corrección inválida.',
				errors: {},
				values: { newBuyerId: 'new-buyer', reason: 'Se cargó a nombre del hermano' }
			}
		);
		expect(body).toContain('Corrección inválida.');
		expect(body).toContain('Se cargó a nombre del hermano');
		// The current buyer is not offered as the correct one.
		expect(body).toContain('value="new-buyer"');
		expect(body).not.toContain('value="buyer"');
		expect(body).toContain('data-testid="buyers-truncated"');
		expect(text(body)).toContain('Se muestran los primeros 2 de 750');
		// The other dialog's fields are not on the page.
		expect(body).not.toContain('name="newCollectorId"');
	});
	it('shows a field error of the reason next to the reason', () => {
		const body = page(
			{ canMarkUncollectible: true },
			{
				form: 'markUncollectible',
				success: false,
				message: 'El motivo es obligatorio.',
				errors: { reason: ['El motivo es obligatorio.'] },
				values: { reason: '' }
			}
		);
		expect(body.match(/El motivo es obligatorio\./g)).toHaveLength(1);
		expect(body).toContain('id="markUncollectible-reason-error"');
	});
	it('offers the uncollectible mark only when allowed, and shows it once set (SAN-106)', () => {
		expect(page()).not.toContain('?/markUncollectible');
		const allowed = page({ canMarkUncollectible: true });
		expect(allowed).toContain('action="?/markUncollectible"');
		expect(text(allowed)).toContain('Solo un administrador puede revertir la marca.');
		const marked = page({
			financialStatus: 'uncollectible',
			uncollectible: { markedAt: '2026-11-25T15:00:00Z', reason: 'Se mudó sin aviso' }
		});
		expect(marked).toContain('Venta incobrable');
		expect(marked).toContain('Se mudó sin aviso');
		expect(text(marked)).toMatch(/Quedó sin cobrar \$ 20\.000/);
		expect(marked).not.toContain('?/markUncollectible');
		expect(marked).not.toContain('Registrar pago');
	});
	it('offers the revert only to who may revert a marked sale', () => {
		const marked = {
			uncollectible: { markedAt: '2026-11-25T15:00:00Z', reason: 'Se mudó' }
		};
		expect(page(marked)).not.toContain('?/revertUncollectible');
		const body = page({ ...marked, canRevertUncollectible: true });
		expect(body).toContain('Revertir la marca');
		expect(body).toContain('action="?/revertUncollectible"');
	});
	it('says a success above the record', () => {
		const body = page(
			{ correction: CORRECTION },
			{ form: 'correctBuyer', success: true, message: 'Comprador corregido.', errors: {} }
		);
		expect(body).toContain('Comprador corregido.');
		expect(body).not.toContain('name="newBuyerId"');
	});
});
