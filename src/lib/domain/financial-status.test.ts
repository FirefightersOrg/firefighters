import { describe, expect, it } from 'vitest';
import { calculateFinancialStatus } from './financial-status';

const base = {
	saleStatus: 'active' as const,
	planStatus: 'active' as const,
	markedUncollectible: false,
	today: '2026-06-10',
	installments: [
		{
			number: 1,
			dueDate: '2026-06-10',
			amount: '100.00',
			appliedAmount: '0.00',
			status: 'pending' as const
		}
	]
};
describe('calculateFinancialStatus', () => {
	it.each([
		[{ ...base, saleStatus: 'annulled' as const }, 'annulled'],
		[{ ...base, planStatus: 'annulled' as const }, 'annulled'],
		[{ ...base, markedUncollectible: true }, 'uncollectible'],
		[
			{ ...base, installments: [{ ...base.installments[0], status: 'paid' as const }] },
			'fully_paid'
		],
		[{ ...base, installments: [{ ...base.installments[0], dueDate: '2026-06-09' }] }, 'overdue'],
		[base, 'no_payments'],
		[
			{ ...base, installments: [{ ...base.installments[0], appliedAmount: '100.00' }] },
			'fully_paid'
		],
		[
			{ ...base, installments: [{ ...base.installments[0], appliedAmount: '10.00' }] },
			'partial_payments'
		],
		[
			{
				...base,
				installments: [
					{ ...base.installments[0], status: 'paid_advance' as const, dueDate: '2026-06-11' }
				]
			},
			'fully_paid'
		],
		[
			{ ...base, installments: [{ ...base.installments[0], status: 'annulled' as const }] },
			'no_payments'
		]
	])('returns %s', (input, expected) => expect(calculateFinancialStatus(input)).toBe(expected));
	it('is up to date when all installments due today are paid', () => {
		expect(
			calculateFinancialStatus({
				...base,
				installments: [
					{ ...base.installments[0], status: 'paid', appliedAmount: '100.00' },
					{ ...base.installments[0], number: 2, dueDate: '2026-06-11' }
				]
			})
		).toBe('up_to_date');
	});
});
