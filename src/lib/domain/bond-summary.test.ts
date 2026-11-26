import { describe, expect, it } from 'vitest';
import {
	bondSummary,
	summaryText,
	type BondSummaryInput,
	type BondSummaryInstallment
} from './bond-summary';

const TODAY = '2026-11-26';
const installment = (
	number: number,
	dueDate: string,
	over: Partial<BondSummaryInstallment> = {}
): BondSummaryInstallment => ({
	number,
	dueDate,
	amount: '10000.00',
	applied: '0.00',
	status: 'pending',
	...over
});
/** Six installments of $ 10.000: the first paid, four overdue, the last one not due yet. */
const sixInstallments = [
	installment(1, '2026-07-22', { status: 'paid', applied: '10000.00' }),
	installment(2, '2026-08-22', { status: 'overdue' }),
	installment(3, '2026-09-22', { status: 'overdue' }),
	installment(4, '2026-10-22', { status: 'overdue' }),
	installment(5, '2026-11-22', { status: 'overdue' }),
	installment(6, '2026-12-22')
];
const input = (over: Partial<BondSummaryInput>): BondSummaryInput => ({
	commercialStatus: 'sold',
	collectorName: 'Héctor Acosta',
	buyerName: 'Stella Rodríguez',
	installments: sixInstallments,
	today: TODAY,
	...over
});
// formatMoney puts a non-breaking space after «$»: compare with plain spaces.
const said = (over: Partial<BondSummaryInput>) =>
	summaryText(bondSummary(input(over))).replaceAll(' ', ' ');

describe('bondSummary: the sentence for each state', () => {
	it.each<[string, Partial<BondSummaryInput>, string]>([
		[
			'available',
			{ commercialStatus: 'available', collectorName: null, buyerName: null, installments: [] },
			'Disponible. Todavía no se entregó a ningún cobrador.'
		],
		[
			'created',
			{ commercialStatus: 'created', collectorName: null, buyerName: null, installments: [] },
			'Disponible. Todavía no se entregó a ningún cobrador.'
		],
		[
			'delivered',
			{ commercialStatus: 'delivered_to_collector', buyerName: null, installments: [] },
			'Lo tiene Héctor Acosta. Todavía no se vendió.'
		],
		[
			'delivered, collector not readable',
			{
				commercialStatus: 'delivered_to_collector',
				collectorName: null,
				buyerName: null,
				installments: []
			},
			'Entregado a un cobrador. Todavía no se vendió.'
		],
		[
			'sold in installments, part overdue',
			{},
			'Vendido a Stella Rodríguez en 6 cuotas. Lo cobra Héctor Acosta. Pagó 1 cuota y debe $ 50.000, de los cuales $ 40.000 están vencidos.'
		],
		[
			'sold, nothing paid, nothing overdue',
			{
				installments: [installment(1, '2026-12-22'), installment(2, '2027-01-22')]
			},
			'Vendido a Stella Rodríguez en 2 cuotas. Lo cobra Héctor Acosta. Todavía no pagó ninguna cuota y debe $ 20.000.'
		],
		[
			'sold, up to date',
			{
				installments: [
					installment(1, '2026-10-22', { status: 'paid', applied: '10000.00' }),
					installment(2, '2026-11-22', { status: 'paid_advance', applied: '10000.00' }),
					installment(3, '2026-12-22')
				]
			},
			'Vendido a Stella Rodríguez en 3 cuotas. Lo cobra Héctor Acosta. Pagó 2 cuotas y debe $ 10.000.'
		],
		[
			'sold, everything owed is overdue',
			{
				installments: [
					installment(1, '2026-09-22', { status: 'paid', applied: '10000.00' }),
					installment(2, '2026-10-22', { status: 'overdue' })
				]
			},
			'Vendido a Stella Rodríguez en 2 cuotas. Lo cobra Héctor Acosta. Pagó 1 cuota y debe $ 10.000, todo vencido.'
		],
		[
			'sold, paid',
			{
				installments: [
					installment(1, '2026-09-22', { status: 'paid', applied: '10000.00' }),
					installment(2, '2026-10-22', { status: 'paid', applied: '10000.00' })
				]
			},
			'Vendido a Stella Rodríguez en 2 cuotas. Lo cobró Héctor Acosta. Está pagado.'
		],
		[
			'sold in one payment, not due yet',
			{ installments: [installment(1, '2026-12-01', { amount: '60000.00' })] },
			'Vendido a Stella Rodríguez en un pago. Lo cobra Héctor Acosta. Debe $ 60.000, que vence el 01/12/2026.'
		],
		[
			'sold in one payment, overdue, partly paid',
			{
				installments: [
					installment(1, '2026-11-01', {
						amount: '60000.00',
						applied: '20000.50',
						status: 'overdue'
					})
				]
			},
			'Vendido a Stella Rodríguez en un pago. Lo cobra Héctor Acosta. Pagó $ 20.000,50 y debe $ 39.999,50, que venció el 01/11/2026.'
		],
		[
			'sold, the role cannot read the buyer',
			{ buyerName: null },
			'Vendido en 6 cuotas. Lo cobra Héctor Acosta. Pagó 1 cuota y debe $ 50.000, de los cuales $ 40.000 están vencidos.'
		],
		[
			'sold, the role can read neither',
			{ buyerName: null, collectorName: null },
			'Vendido en 6 cuotas. Pagó 1 cuota y debe $ 50.000, de los cuales $ 40.000 están vencidos.'
		],
		[
			'sold, uncollectible',
			{ uncollectible: true },
			'Vendido a Stella Rodríguez en 6 cuotas. Lo cobró Héctor Acosta. Se dio por incobrable: quedaron $ 50.000 sin cobrar.'
		],
		[
			'lost',
			{ commercialStatus: 'lost', buyerName: null, installments: [] },
			'Extraviado. Lo tenía Héctor Acosta.'
		],
		[
			'lost at the station',
			{ commercialStatus: 'lost', collectorName: null, buyerName: null, installments: [] },
			'Extraviado.'
		],
		[
			'returned',
			{ commercialStatus: 'returned', collectorName: null, buyerName: null, installments: [] },
			'Devuelto. No está en manos de ningún cobrador.'
		],
		[
			'annulled, with the reason',
			{
				commercialStatus: 'annulled',
				collectorName: null,
				buyerName: null,
				installments: [],
				annulledAt: '2026-11-20T15:00:00Z',
				annulReason: 'Se cargó dos veces'
			},
			'Anulado el 20/11/2026. Motivo: Se cargó dos veces.'
		],
		[
			'annulled, no details',
			{ commercialStatus: 'annulled', collectorName: null, buyerName: null, installments: [] },
			'Anulado.'
		],
		[
			'closed',
			{ commercialStatus: 'closed', collectorName: null, buyerName: null, installments: [] },
			'Cerrado con la campaña.'
		]
	])('%s', (_state, over, expected) => {
		expect(said(over)).toBe(expected);
	});

	it('never says «fase», «Unknown» or a status code', () => {
		for (const commercialStatus of [
			'created',
			'available',
			'delivered_to_collector',
			'sold',
			'returned',
			'lost',
			'annulled',
			'closed'
		] as const) {
			const sentence = said({ commercialStatus, collectorName: null, buyerName: null });
			expect(sentence).not.toMatch(/fase|unknown|_|undefined|null/i);
		}
	});
});

describe('bondSummary: figures and the next step', () => {
	it('adds what is owed in cents, counting what was already applied', () => {
		const summary = bondSummary(
			input({
				installments: [
					installment(1, '2026-10-22', { applied: '2500.50', status: 'overdue' }),
					installment(2, '2026-12-22')
				]
			})
		);
		expect(summary.debtCents).toBe(1_749_950);
		expect(summary.overdueCents).toBe(749_950);
		expect(summary.paidCount).toBe(0);
		expect(summary.rows.map((row) => [row.number, row.owedCents, row.overdue])).toEqual([
			[1, 749_950, true],
			[2, 1_000_000, false]
		]);
	});

	it('an unpaid installment due before today is overdue even if its status was not updated', () => {
		const summary = bondSummary(input({ installments: [installment(1, '2026-11-25')] }));
		expect(summary.overdueCents).toBe(1_000_000);
		// Due today is not overdue yet.
		expect(bondSummary(input({ installments: [installment(1, TODAY)] })).overdueCents).toBe(0);
	});

	it('ignores annulled installments and never owes a negative amount', () => {
		const summary = bondSummary(
			input({
				installments: [
					installment(1, '2026-10-22', { status: 'annulled' }),
					installment(2, '2026-12-22', { applied: '12000.00' })
				]
			})
		);
		expect(summary.rows).toHaveLength(1);
		expect(summary.debtCents).toBe(0);
	});

	it.each([
		['available', 'deliver'],
		['created', 'deliver'],
		['delivered_to_collector', 'sell'],
		['returned', null],
		['lost', null],
		['annulled', null],
		['closed', null]
	] as const)('%s: next step %s', (commercialStatus, nextStep) => {
		expect(bondSummary(input({ commercialStatus, installments: [] })).nextStep).toBe(nextStep);
	});

	it('sold: «pay» while there is debt, nothing once paid or uncollectible', () => {
		expect(bondSummary(input({})).nextStep).toBe('pay');
		expect(bondSummary(input({ uncollectible: true })).nextStep).toBeNull();
		expect(
			bondSummary(
				input({
					installments: [installment(1, '2026-10-22', { status: 'paid', applied: '10000.00' })]
				})
			).nextStep
		).toBeNull();
	});

	it('marks the names so the page can link them', () => {
		const refs = bondSummary(input({}))
			.sentences.flat()
			.filter((part) => part.ref)
			.map((part) => [part.ref, part.text]);
		expect(refs).toEqual([
			['buyer', 'Stella Rodríguez'],
			['collector', 'Héctor Acosta']
		]);
	});
});
