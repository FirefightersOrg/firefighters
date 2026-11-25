import { describe, expect, it } from 'vitest';
import {
	canManageCommissionRules,
	commissionRuleTiming,
	compareCommissionRules,
	describeCommissionRuleType,
	describeCommissionValue,
	describeValidity,
	todayInArgentina,
	calculateApplicationCommission,
	selectCommissionRule,
	type CommissionRule
} from './commissions';

const NBSP = ' ';

function rule(overrides: Partial<CommissionRule> = {}): CommissionRule {
	return {
		id: 'r1',
		campaignId: 'c1',
		ruleType: 'cash_full_payment',
		installmentNumber: null,
		percentage: '25.00',
		fixedAmount: null,
		appliesToCollectorId: null,
		validFrom: '2026-01-01',
		validTo: null,
		status: 'active',
		annulledAt: null,
		annulledBy: null,
		annulReason: null,
		createdBy: null,
		createdAt: '2026-11-16T12:00:00Z',
		updatedAt: '2026-11-16T12:00:00Z',
		...overrides
	};
}

describe('canManageCommissionRules', () => {
	it.each([
		['draft', true],
		['active', true],
		['closing', false],
		['closed', false],
		['annulled', false]
	] as const)('%s → %s', (status, expected) => {
		expect(canManageCommissionRules(status)).toBe(expected);
	});
});

describe('formatting (Spanish, docs/copy.md)', () => {
	it('formats percentages and fixed amounts in es-AR', () => {
		expect(describeCommissionValue(rule())).toBe(`25${NBSP}%`);
		expect(describeCommissionValue(rule({ percentage: '12.50' }))).toBe(`12,5${NBSP}%`);
		expect(describeCommissionValue(rule({ percentage: null, fixedAmount: '1500.00' }))).toBe(
			`$${NBSP}1.500`
		);
		expect(describeCommissionValue(rule({ percentage: null, fixedAmount: '2000.50' }))).toBe(
			`$${NBSP}2.000,50`
		);
		expect(describeCommissionValue(rule({ percentage: null }))).toBe('—');
	});

	it('labels the type, with the installment for custom rules', () => {
		expect(describeCommissionRuleType(rule())).toBe('Pago al contado');
		expect(describeCommissionRuleType(rule({ ruleType: 'custom', installmentNumber: 4 }))).toBe(
			'Cuota específica: #4'
		);
	});

	it('formats validity as calendar days, with no time zone shift', () => {
		expect(describeValidity(rule({ validFrom: '2026-03-01' }))).toBe('Desde el 01/03/2026');
		expect(describeValidity(rule({ validFrom: '2026-03-01', validTo: '2026-03-31' }))).toBe(
			'01/03/2026 – 31/03/2026'
		);
	});
});

describe('commissionRuleTiming', () => {
	const r = rule({ validFrom: '2026-03-01', validTo: '2026-03-31' });
	it.each([
		['2026-02-28', 'upcoming'],
		['2026-03-01', 'current'],
		['2026-03-31', 'current'],
		['2026-04-01', 'ended']
	])('%s → %s (both ends inclusive)', (today, timing) => {
		expect(commissionRuleTiming(r, today)).toBe(timing);
	});

	it('an open-ended rule never ends', () => {
		expect(commissionRuleTiming(rule({ validFrom: '2026-03-01' }), '2099-01-01')).toBe('current');
	});
});

describe('todayInArgentina', () => {
	it('uses UTC-03:00', () => {
		expect(todayInArgentina(new Date('2026-03-01T02:59:59Z'))).toBe('2026-02-28');
		expect(todayInArgentina(new Date('2026-03-01T03:00:00Z'))).toBe('2026-03-01');
	});
});

describe('compareCommissionRules', () => {
	it('orders active first, then by type, installment and validity', () => {
		const rules = [
			rule({ id: 'annulled', status: 'annulled' }),
			rule({ id: 'custom-5', ruleType: 'custom', installmentNumber: 5 }),
			rule({ id: 'custom-2', ruleType: 'custom', installmentNumber: 2 }),
			rule({ id: 'last', ruleType: 'installment_last' }),
			rule({ id: 'cash-later', validFrom: '2026-06-01' }),
			rule({ id: 'cash' }),
			rule({ id: 'first', ruleType: 'installment_first' })
		];
		expect(rules.sort(compareCommissionRules).map((r) => r.id)).toEqual([
			'cash',
			'cash-later',
			'first',
			'last',
			'custom-2',
			'custom-5',
			'annulled'
		]);
	});
});

describe('settlement commission calculation', () => {
	it('treats binary half-cent rounding as a preview, not authoritative numeric money', () => {
		// PostgreSQL round(10.075::numeric, 2) is 10.08 (covered by pgTAP 031).
		expect(
			calculateApplicationCommission([rule({ percentage: '50.00' })], {
				collectorId: 'collector',
				paymentDate: '2026-06-15',
				paymentMode: 'full_payment',
				installmentNumber: 1,
				installmentCount: 1,
				amountApplied: 20.15,
				installmentAmount: 20.15
			})
		).toBe(10.07);
	});
	const application = {
		collectorId: 'collector',
		paymentDate: '2026-06-15',
		paymentMode: 'installments' as const,
		installmentNumber: 1,
		installmentCount: 3,
		amountApplied: 25,
		installmentAmount: 50
	};
	it('uses collector-specific before general, then custom before type rules', () => {
		expect(
			selectCommissionRule(
				[
					rule({ id: 'general-custom', ruleType: 'custom', installmentNumber: 1 }),
					rule({
						id: 'specific-first',
						appliesToCollectorId: 'collector',
						ruleType: 'installment_first'
					})
				],
				application
			)?.id
		).toBe('specific-first');
		expect(
			selectCommissionRule(
				[
					rule({ id: 'first', ruleType: 'installment_first' }),
					rule({ id: 'custom', ruleType: 'custom', installmentNumber: 1 })
				],
				application
			)?.id
		).toBe('custom');
	});
	it('uses newest valid_from then id and prorates fixed amounts', () => {
		expect(
			selectCommissionRule(
				[
					rule({ id: 'a', ruleType: 'installment_first', validFrom: '2026-06-01' }),
					rule({ id: 'z', ruleType: 'installment_first', validFrom: '2026-06-01' }),
					rule({ id: 'old', ruleType: 'installment_first', validFrom: '2026-01-01' })
				],
				application
			)?.id
		).toBe('z');
		expect(
			calculateApplicationCommission(
				[rule({ percentage: null, fixedAmount: '10.00', ruleType: 'installment_first' })],
				application
			)
		).toBe(5);
	});
});
