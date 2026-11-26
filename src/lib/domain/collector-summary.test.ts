import { describe, expect, it } from 'vitest';
import {
	collectorSummary,
	collectorSummaryText as rawText,
	type CollectorSummaryInput
} from './collector-summary';

/** Amounts keep the `$` and the figure together with a no-break space; the tests read plain text. */
const text = (summary: Parameters<typeof rawText>[0]) => rawText(summary).replace(/\u00a0/g, ' ');

const TODAY = '2026-11-26';
const bonds = (sold: number, unsold: number, lost = 0) => [
	...Array.from({ length: sold }, () => ({ commercialStatus: 'sold' as const })),
	...Array.from({ length: unsold }, () => ({
		commercialStatus: 'delivered_to_collector' as const
	})),
	...Array.from({ length: lost }, () => ({ commercialStatus: 'lost' as const }))
];
const debt = (dueDate: string, owed = '10000.00', status = 'pending') => ({
	dueDate,
	owed,
	status
});
const input = (extra: Partial<CollectorSummaryInput> = {}): CollectorSummaryInput => ({
	name: 'Jorge Medina',
	bondsTotal: 35,
	bonds: bonds(22, 13),
	debts: [debt('2026-10-10', '120000.00', 'overdue'), debt('2026-12-10', '420000.00')],
	balance: 17000,
	today: TODAY,
	...extra
});

describe('collectorSummary', () => {
	it('says the bonds, what is left to collect, what is overdue and the balance', () => {
		const summary = collectorSummary(input());
		expect(text(summary)).toBe(
			'Jorge Medina tiene 35 bonos: 22 vendidos y 13 sin vender. Le falta cobrar $ 540.000, de los cuales $ 120.000 están vencidos. Tiene $ 17.000 a su favor en la cuenta corriente.'
		);
		expect(summary).toMatchObject({
			soldCount: 22,
			unsoldCount: 13,
			debtCents: 54_000_000,
			overdueCents: 12_000_000,
			debtCount: 2,
			balanceCents: 1_700_000,
			nextStep: 'pay'
		});
	});

	it('marks the current account so the page can link it', () => {
		const refs = collectorSummary(input())
			.sentences.flat()
			.filter((part) => part.ref);
		expect(refs).toEqual([{ text: 'cuenta corriente', ref: 'ledger' }]);
	});

	it.each([
		[bonds(0, 0), 0, 'Jorge Medina no tiene bonos de esta campaña.'],
		[bonds(0, 1), 1, 'Jorge Medina tiene 1 bono, sin vender.'],
		[bonds(1, 0), 1, 'Jorge Medina tiene 1 bono, vendido.'],
		[bonds(0, 9), 9, 'Jorge Medina tiene 9 bonos, todos sin vender.'],
		[bonds(9, 0), 9, 'Jorge Medina tiene 9 bonos, todos vendidos.'],
		[bonds(3, 2, 1), 6, 'Jorge Medina tiene 6 bonos: 3 vendidos, 2 sin vender y 1 extraviado.'],
		[bonds(1, 1), 2, 'Jorge Medina tiene 2 bonos: 1 vendido y 1 sin vender.']
	])('counts the bonds by state (%#)', (list, total, sentence) => {
		const summary = collectorSummary(
			input({ bonds: list, bondsTotal: total, debts: [], balance: null })
		);
		expect(text(summary).startsWith(sentence)).toBe(true);
	});

	it('does not split by state a list that is only the first bonds of more', () => {
		const summary = collectorSummary(input({ bondsTotal: 350, bonds: bonds(150, 50) }));
		expect(text(summary).startsWith('Jorge Medina tiene 350 bonos. Le falta cobrar')).toBe(true);
		expect(summary.soldCount).toBeNull();
		expect(summary.unsoldCount).toBeNull();
	});

	it('says when everything that is owed is overdue, and when nothing is', () => {
		expect(text(collectorSummary(input({ debts: [debt('2026-11-01')], balance: null })))).toContain(
			'Le falta cobrar $ 10.000, todo vencido.'
		);
		expect(text(collectorSummary(input({ debts: [debt('2026-12-01')], balance: null })))).toContain(
			'Le falta cobrar $ 10.000.'
		);
	});

	it('takes an installment as overdue by its status or by its date', () => {
		const summary = collectorSummary(
			input({
				debts: [
					debt('2026-12-01', '5000.00', 'overdue'),
					debt('2026-11-25', '2500.50'),
					debt(TODAY, '1000.00')
				]
			})
		);
		expect(summary.debtCents).toBe(850_050);
		expect(summary.overdueCents).toBe(750_050);
	});

	it('with nothing to collect, the next step is to deliver bonds', () => {
		const summary = collectorSummary(input({ debts: [], balance: null }));
		expect(text(summary)).toBe(
			'Jorge Medina tiene 35 bonos: 22 vendidos y 13 sin vender. No le falta cobrar nada.'
		);
		expect(summary.nextStep).toBe('deliver');
		const empty = collectorSummary(input({ bonds: [], bondsTotal: 0, debts: [], balance: null }));
		expect(text(empty)).toBe('Jorge Medina no tiene bonos de esta campaña.');
		expect(empty.nextStep).toBe('deliver');
	});

	it('counts apart what was given up as uncollectible', () => {
		const summary = collectorSummary(
			input({
				debts: [debt('2026-12-01'), { ...debt('2026-09-01', '50000.00'), uncollectible: true }],
				balance: null
			})
		);
		expect(text(summary)).toContain(
			'Le falta cobrar $ 10.000. Otros $ 50.000 se dieron por incobrables.'
		);
		expect(summary.debtCents).toBe(1_000_000);
		expect(summary.overdueCents).toBe(0);
		expect(summary.debtCount).toBe(1);
		expect(summary.uncollectibleCents).toBe(5_000_000);
	});

	it('says whom the balance favours, and never prints one it does not know as zero', () => {
		const tail = (balance: number | null) =>
			text(collectorSummary(input({ debts: [], bonds: [], bondsTotal: 0, balance })));
		expect(tail(17000.5)).toContain('Tiene $ 17.000,50 a su favor en la cuenta corriente.');
		expect(tail(-5000)).toContain('Su cuenta corriente tiene $ 5.000 a favor de Bomberos.');
		expect(tail(-5000)).not.toMatch(/-|−/);
		expect(tail(0)).toContain('Su cuenta corriente no tiene saldo.');
		expect(tail(null)).toBe('Jorge Medina no tiene bonos de esta campaña.');
		expect(collectorSummary(input({ balance: null })).balanceCents).toBeNull();
	});

	it('says nothing about a debt it could not read', () => {
		const summary = collectorSummary(input({ debts: null, balance: null }));
		expect(text(summary)).toBe('Jorge Medina tiene 35 bonos: 22 vendidos y 13 sin vender.');
		expect(summary.debtCents).toBe(0);
	});
});
