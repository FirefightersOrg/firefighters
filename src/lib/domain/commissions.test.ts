import { describe, expect, it } from 'vitest';
import {
	canManageCommissionRules,
	commissionRuleTiming,
	compareCommissionRules,
	formatCommissionRuleType,
	formatCommissionValue,
	formatDay,
	formatValidity,
	todayInArgentina,
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

describe('formatting', () => {
	it('formats percentages and fixed amounts in es-AR', () => {
		expect(formatCommissionValue(rule())).toBe(`25${NBSP}%`);
		expect(formatCommissionValue(rule({ percentage: '12.50' }))).toBe(`12,5${NBSP}%`);
		expect(formatCommissionValue(rule({ percentage: null, fixedAmount: '1500.00' }))).toBe(
			`$${NBSP}1.500,00`
		);
		expect(formatCommissionValue(rule({ percentage: null }))).toBe('—');
	});

	it('labels the type, with the installment for custom rules', () => {
		expect(formatCommissionRuleType(rule())).toBe('Cash (full payment)');
		expect(formatCommissionRuleType(rule({ ruleType: 'custom', installmentNumber: 4 }))).toBe(
			'Specific installment: #4'
		);
	});

	it('formats days and validity (calendar days, no time zone shift)', () => {
		expect(formatDay('2026-03-01')).toBe('Mar 1, 2026');
		expect(formatDay('nope')).toBe('nope');
		expect(formatValidity(rule({ validFrom: '2026-03-01' }))).toBe('From Mar 1, 2026');
		expect(formatValidity(rule({ validFrom: '2026-03-01', validTo: '2026-03-31' }))).toBe(
			'Mar 1, 2026 – Mar 31, 2026'
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
