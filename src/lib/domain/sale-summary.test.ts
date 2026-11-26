import { describe, expect, it } from 'vitest';
import { saleSummary, saleSummaryText as rawText, type SaleSummaryInput } from './sale-summary';

/** Amounts keep the `$` and the figure together with a no-break space; the tests read plain text. */
const saleSummaryText = (summary: Parameters<typeof rawText>[0]) =>
	rawText(summary).replace(/\u00a0/g, ' ');

const TODAY = '2026-11-26';
const installment = (
	number: number,
	dueDate: string,
	applied = '0.00',
	status: 'pending' | 'paid' | 'overdue' | 'annulled' = 'pending'
) => ({ number, dueDate, amount: '10000.00', applied, status });
const input = (extra: Partial<SaleSummaryInput> = {}): SaleSummaryInput => ({
	bond: '0068',
	buyerName: 'Ada Gómez',
	collectorName: 'Ana Pérez',
	soldAt: '2026-09-12T15:00:00Z',
	totalAmount: '30000.00',
	status: 'active',
	installments: [
		installment(1, '2026-10-10', '10000.00', 'paid'),
		installment(2, '2026-11-10'),
		installment(3, '2026-12-10')
	],
	today: TODAY,
	...extra
});

describe('saleSummary', () => {
	it('says who bought which bond, when, how and for how much, who collects it and the debt', () => {
		const summary = saleSummary(input());
		expect(saleSummaryText(summary)).toBe(
			'Ada Gómez compró el bono 0068 el 12/09/2026 en 3 cuotas, por $ 30.000. Lo cobra Ana Pérez. Pagó 1 cuota y debe $ 20.000, de los cuales $ 10.000 están vencidos.'
		);
		expect(summary.debtCents).toBe(2_000_000);
		expect(summary.overdueCents).toBe(1_000_000);
		expect(summary.collectable).toBe(true);
	});
	it('marks the bond, the buyer and the collector so the page can link them', () => {
		const refs = saleSummary(input())
			.sentences.flat()
			.filter((part) => part.ref)
			.map((part) => [part.ref, part.text]);
		expect(refs).toEqual([
			['buyer', 'Ada Gómez'],
			['bond', '0068'],
			['collector', 'Ana Pérez']
		]);
	});
	it('never names a party the role cannot read', () => {
		const summary = saleSummary(input({ buyerName: null, collectorName: null }));
		expect(saleSummaryText(summary)).toBe(
			'El bono 0068 se vendió el 12/09/2026 en 3 cuotas, por $ 30.000. Pagó 1 cuota y debe $ 20.000, de los cuales $ 10.000 están vencidos.'
		);
		expect(saleSummaryText(summary)).not.toMatch(/Unknown|Sin acceso/);
	});
	it('says «en un pago» for a full payment and when it is due', () => {
		const summary = saleSummary(
			input({ totalAmount: '10000.00', installments: [installment(1, '2026-12-01')] })
		);
		expect(saleSummaryText(summary)).toBe(
			'Ada Gómez compró el bono 0068 el 12/09/2026 en un pago, por $ 10.000. Lo cobra Ana Pérez. Debe $ 10.000, que vence el 01/12/2026.'
		);
	});
	it('says it is paid, in the past, once nothing is owed', () => {
		const summary = saleSummary(
			input({
				installments: [1, 2, 3].map((n) => installment(n, '2026-10-10', '10000.00', 'paid'))
			})
		);
		expect(saleSummaryText(summary)).toContain('Lo cobró Ana Pérez. Está pagado.');
		expect(summary.collectable).toBe(false);
	});
	it('counts a partial payment as money still owed on that installment', () => {
		const summary = saleSummary(
			input({
				installments: [installment(1, '2026-12-10', '4000.00'), installment(2, '2027-01-10')]
			})
		);
		expect(summary.rows.map((row) => row.owedCents)).toEqual([600_000, 1_000_000]);
		expect(summary.debtCents).toBe(1_600_000);
	});
	it('reports a written-off sale as not collectable, with what was left', () => {
		const summary = saleSummary(input({ uncollectible: true }));
		expect(saleSummaryText(summary)).toContain(
			'Lo cobró Ana Pérez. Se dio por incobrable: quedaron $ 20.000 sin cobrar.'
		);
		expect(summary.collectable).toBe(false);
	});
	it.each([
		['annulled', 'La venta fue anulada: no se cobra.'],
		['corrected', 'La venta fue reemplazada por una corrección: no se cobra.']
	] as const)('says a sale that is %s is not collected', (status, sentence) => {
		const summary = saleSummary(input({ status }));
		expect(saleSummaryText(summary)).toContain(sentence);
		expect(saleSummaryText(summary)).not.toContain('debe');
		expect(summary.collectable).toBe(false);
	});
	it('leaves annulled installments out', () => {
		const summary = saleSummary(
			input({
				installments: [
					installment(1, '2026-12-10'),
					installment(2, '2027-01-10', '0.00', 'annulled')
				]
			})
		);
		expect(summary.rows).toHaveLength(1);
	});
});
