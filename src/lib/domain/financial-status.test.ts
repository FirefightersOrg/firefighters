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
	it('returns annulled for an annulled sale', () =>
		expect(calculateFinancialStatus({ ...base, saleStatus: 'annulled' })).toBe('annulled'));
	it('returns annulled for an annulled plan', () =>
		expect(calculateFinancialStatus({ ...base, planStatus: 'annulled' })).toBe('annulled'));
	it('returns uncollectible', () =>
		expect(calculateFinancialStatus({ ...base, markedUncollectible: true })).toBe('uncollectible'));
	it('returns fully paid', () =>
		expect(
			calculateFinancialStatus({
				...base,
				installments: [{ ...base.installments[0], status: 'paid' }]
			})
		).toBe('fully_paid'));
	it('returns overdue', () =>
		expect(
			calculateFinancialStatus({
				...base,
				installments: [{ ...base.installments[0], dueDate: '2026-06-09' }]
			})
		).toBe('overdue'));
	it('returns no payments', () => expect(calculateFinancialStatus(base)).toBe('no_payments'));
	it('returns partial payments', () =>
		expect(
			calculateFinancialStatus({
				...base,
				installments: [{ ...base.installments[0], appliedAmount: '10.00' }]
			})
		).toBe('partial_payments'));
	it('returns up to date', () =>
		expect(
			calculateFinancialStatus({
				...base,
				installments: [
					{ ...base.installments[0], status: 'paid', appliedAmount: '100.00' },
					{ ...base.installments[0], number: 2, dueDate: '2026-06-11' }
				]
			})
		).toBe('up_to_date'));
	it('does not call an unpaid installment due today overdue', () =>
		expect(calculateFinancialStatus(base)).not.toBe('overdue'));
	it('counts paid in advance as paid', () =>
		expect(
			calculateFinancialStatus({
				...base,
				installments: [{ ...base.installments[0], status: 'paid_advance', dueDate: '2026-06-11' }]
			})
		).toBe('fully_paid'));
	it('ignores annulled installments', () =>
		expect(
			calculateFinancialStatus({
				...base,
				installments: [{ ...base.installments[0], status: 'annulled' }]
			})
		).toBe('no_payments'));
	it('gives uncollectible precedence over fully paid', () =>
		expect(
			calculateFinancialStatus({
				...base,
				markedUncollectible: true,
				installments: [{ ...base.installments[0], status: 'paid' }]
			})
		).toBe('uncollectible'));
});
