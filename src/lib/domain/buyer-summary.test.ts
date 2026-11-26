import { describe, expect, it } from 'vitest';
import {
	buyerSummary,
	buyerSummaryText as rawText,
	type BuyerSaleInput,
	type BuyerSummaryInput
} from './buyer-summary';
import { saleSummary, saleSummaryText } from './sale-summary';

/** Amounts keep the `$` and the figure together with a no-break space; the tests read plain text. */
const plain = (value: string) => value.replace(/\u00a0/g, ' ');
const text = (summary: Parameters<typeof rawText>[0]) => plain(rawText(summary));

const TODAY = '2026-11-26';
const installment = (
	number: number,
	dueDate: string,
	applied = '0.00',
	status: 'pending' | 'paid' | 'overdue' | 'annulled' = 'pending'
) => ({ number, dueDate, amount: '10000.00', applied, status });
const sale = (extra: Partial<BuyerSaleInput> = {}): BuyerSaleInput => ({
	saleId: 's1',
	status: 'active',
	bond: '0190',
	collectorId: 'c1',
	collectorName: 'Héctor Acosta',
	soldAt: '2026-09-12T15:00:00Z',
	totalAmount: '30000.00',
	installments: [
		installment(1, '2026-10-10', '10000.00', 'paid'),
		installment(2, '2026-11-10'),
		installment(3, '2026-12-10')
	],
	...extra
});
const input = (sales: BuyerSaleInput[]): BuyerSummaryInput => ({
	name: 'Ada Lovelace',
	sales,
	today: TODAY
});

describe('buyerSummary', () => {
	it('says the bond, what is owed and who collects it', () => {
		const summary = buyerSummary(input([sale()]));
		expect(text(summary)).toBe(
			'Ada Lovelace compró el bono 0190 en esta campaña. Debe $ 20.000, de los cuales $ 10.000 están vencidos. Lo cobra Héctor Acosta.'
		);
		expect(summary).toMatchObject({
			bondCount: 1,
			debtCents: 2_000_000,
			overdueCents: 1_000_000,
			payCollectorId: 'c1',
			complete: true,
			totalAmount: '30000.00'
		});
		expect(summary.sentences.flat().filter((part) => part.ref)).toEqual([
			{ text: 'Héctor Acosta', ref: 'collector' }
		]);
	});

	it('says each sale with the words of the sale record', () => {
		const one = sale();
		const row = buyerSummary(input([one])).sales[0];
		expect(plain(row.terms)).toBe('Lo compró el 12/09/2026 en 3 cuotas, por $ 30.000.');
		expect(plain(row.debt!)).toBe(
			'Pagó 1 cuota y debe $ 20.000, de los cuales $ 10.000 están vencidos.'
		);
		// The same sentence the sale record ends with, from the same installments.
		const record = saleSummaryText(
			saleSummary({
				bond: one.bond,
				buyerName: 'Ada Lovelace',
				collectorName: one.collectorName,
				soldAt: one.soldAt,
				totalAmount: one.totalAmount,
				status: 'active',
				installments: one.installments!,
				today: TODAY
			})
		);
		expect(record.endsWith(row.debt!)).toBe(true);
		expect(row).toMatchObject({ debtCents: 2_000_000, overdue: true, uncollectible: false });
	});

	it('says «en un pago» for a full payment', () => {
		const row = buyerSummary(
			input([sale({ totalAmount: '10000.00', installments: [installment(1, '2026-12-01')] })])
		).sales[0];
		expect(plain(row.terms)).toBe('Lo compró el 12/09/2026 en un pago, por $ 10.000.');
		expect(plain(row.debt!)).toBe('Debe $ 10.000, que vence el 01/12/2026.');
	});

	it('adds up several bonds and lists what is unpaid by due date', () => {
		const summary = buyerSummary(
			input([
				sale(),
				sale({
					saleId: 's2',
					bond: '0024',
					installments: [installment(1, '2026-11-20'), installment(2, '2026-12-20')]
				})
			])
		);
		expect(text(summary)).toBe(
			'Ada Lovelace compró 2 bonos en esta campaña. Debe $ 40.000, de los cuales $ 20.000 están vencidos. Los cobra Héctor Acosta.'
		);
		expect(summary.pending.map((row) => [row.bond, row.number, row.overdue])).toEqual([
			['0190', 2, true],
			['0024', 1, true],
			['0190', 3, false],
			['0024', 2, false]
		]);
	});

	it('names no collector, and offers none to settle with, when the bonds have more than one', () => {
		const summary = buyerSummary(
			input([sale(), sale({ saleId: 's2', bond: '0024', collectorId: 'c2', collectorName: 'Ana' })])
		);
		expect(text(summary)).toBe(
			'Ada Lovelace compró 2 bonos en esta campaña. Debe $ 40.000, de los cuales $ 20.000 están vencidos.'
		);
		expect(summary.payCollectorId).toBeNull();
	});

	it('settles with the one collector that is still owed', () => {
		const paid = [installment(1, '2026-10-10', '10000.00', 'paid')];
		const summary = buyerSummary(
			input([sale(), sale({ saleId: 's2', bond: '0024', collectorId: 'c2', installments: paid })])
		);
		expect(summary.payCollectorId).toBe('c1');
	});

	it('never names a collector the role cannot read', () => {
		const summary = buyerSummary(input([sale({ collectorName: null })]));
		expect(text(summary)).toBe(
			'Ada Lovelace compró el bono 0190 en esta campaña. Debe $ 20.000, de los cuales $ 10.000 están vencidos.'
		);
		expect(text(summary)).not.toMatch(/Unknown|Sin acceso/);
	});

	it('says when nothing is owed', () => {
		const summary = buyerSummary(
			input([
				sale({
					totalAmount: '10000.00',
					installments: [installment(1, '2026-10-10', '10000.00', 'paid')]
				})
			])
		);
		expect(text(summary)).toBe(
			'Ada Lovelace compró el bono 0190 en esta campaña. No debe nada. Lo cobró Héctor Acosta.'
		);
		expect(summary.sales[0].debt).toBe('Está pagado.');
		expect(summary.pending).toEqual([]);
		expect(summary.payCollectorId).toBeNull();
	});

	it('says when the buyer has no bonds in the campaign', () => {
		const none = buyerSummary(input([]));
		expect(text(none)).toBe('Ada Lovelace no compró bonos en esta campaña.');
		expect(none.bondCount).toBe(0);
		// A sale that was annulled is listed, after the active ones, and is not a bond bought.
		const annulled = buyerSummary(
			input([sale({ status: 'annulled' }), sale({ saleId: 's2', bond: '0024' })])
		);
		expect(annulled.bondCount).toBe(1);
		expect(annulled.sales.map((row) => [row.bond, row.active])).toEqual([
			['0024', true],
			['0190', false]
		]);
		expect(annulled.sales[1].debt).toBe('La venta fue anulada: no se cobra.');
		expect(annulled.debtCents).toBe(2_000_000);
		const corrected = buyerSummary(input([sale({ status: 'corrected' })]));
		expect(corrected.sales[0].debt).toBe(
			'La venta fue reemplazada por una corrección: no se cobra.'
		);
		expect(text(corrected)).toBe('Ada Lovelace no compró bonos en esta campaña.');
	});

	it('counts apart a sale given up as uncollectible', () => {
		const summary = buyerSummary(input([sale({ uncollectible: true })]));
		expect(text(summary)).toBe(
			'Ada Lovelace compró el bono 0190 en esta campaña. $ 20.000 se dieron por incobrables. Lo cobró Héctor Acosta.'
		);
		expect(summary).toMatchObject({
			debtCents: 0,
			uncollectibleCents: 2_000_000,
			payCollectorId: null
		});
		expect(summary.pending).toEqual([]);
		expect(plain(summary.sales[0].debt!)).toBe(
			'Se dio por incobrable: quedaron $ 20.000 sin cobrar.'
		);
	});

	it('says so when a sale was listed without its installments', () => {
		const summary = buyerSummary(
			input([sale(), sale({ saleId: 's2', bond: '0024', installments: null })])
		);
		expect(summary.complete).toBe(false);
		expect(text(summary)).toContain('Esta cuenta no incluye sus ventas más antiguas.');
		expect(summary.sales[1]).toMatchObject({ debt: null, debtCents: 0 });
		expect(plain(summary.sales[1].terms)).toBe('Lo compró el 12/09/2026, por $ 30.000.');
	});

	it('counts a partial payment', () => {
		const summary = buyerSummary(
			input([
				sale({
					totalAmount: '10000.00',
					installments: [installment(1, '2026-12-01', '4000.00')]
				})
			])
		);
		expect(summary.debtCents).toBe(600_000);
		expect(plain(summary.sales[0].debt!)).toBe(
			'Pagó $ 4.000 y debe $ 6.000, que vence el 01/12/2026.'
		);
		expect(summary.pending[0]).toMatchObject({ owedCents: 600_000, amount: '10000.00' });
	});
});
