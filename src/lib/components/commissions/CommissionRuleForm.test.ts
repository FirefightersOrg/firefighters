import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { CommissionRule } from '$lib/domain/commissions';
import { formatPercentInput } from '$lib/domain/percent';
import CommissionRuleForm from './CommissionRuleForm.svelte';

const V1 = '2026-11-17T10:00:00.123456+00:00';
const V2 = '2026-11-17T10:05:00.654321+00:00';

function rule(overrides: Partial<CommissionRule> = {}): CommissionRule {
	return {
		id: 'c0000000-0000-0000-0000-000000000001',
		campaignId: 'f0000000-0000-0000-0000-000000000001',
		ruleType: 'cash_full_payment',
		installmentNumber: null,
		percentage: '10.00',
		fixedAmount: null,
		appliesToCollectorId: null,
		validFrom: '2026-11-01',
		validTo: null,
		status: 'active',
		annulledAt: null,
		annulledBy: null,
		annulReason: null,
		createdBy: null,
		createdAt: V1,
		updatedAt: V1,
		...overrides
	};
}

/** A failed edit (e.g. a validation error) whose values were based on `expectedUpdatedAt`. */
function failedEdit(expectedUpdatedAt: string) {
	return {
		success: false,
		message: 'Please fix the highlighted fields.',
		errors: { validTo: ['End date must be on or after the start date'] },
		values: {
			ruleId: rule().id,
			expectedUpdatedAt,
			ruleType: 'cash_full_payment',
			installmentNumber: '',
			valueKind: 'percentage',
			percentage: '15',
			fixedAmount: '',
			validFrom: '2026-11-01',
			validTo: '2026-10-01',
			reason: 'Typo'
		}
	};
}

function renderForm(edited: CommissionRule, result: ReturnType<typeof failedEdit> | null = null) {
	const { body } = render(CommissionRuleForm, {
		props: { rule: edited, installmentCount: 10, result, campaignId: edited.campaignId }
	});
	const input = (name: string) =>
		body.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0]?.match(/value="([^"]*)"/)?.[1];
	return { body, input };
}

describe('CommissionRuleForm (edit): values and version come from the same load', () => {
	it('posts the loaded rule version with the loaded values', () => {
		const { input } = renderForm(rule());
		expect(input('expectedUpdatedAt')).toBe(V1);
		expect(input('percentage')).toBe(formatPercentInput('10.00'));
	});

	it('refills a failed submit based on the loaded version (its errors stay)', () => {
		const { body, input } = renderForm(rule(), failedEdit(V1));
		expect(input('percentage')).toBe('15');
		expect(input('validTo')).toBe('2026-10-01');
		expect(input('expectedUpdatedAt')).toBe(V1);
		expect(body).toContain('End date must be on or after the start date');
	});

	it('never pairs values submitted at an older version with the newer loaded version', () => {
		// The rule was changed elsewhere (V2) and reloaded while an older failed result is shown.
		const { input } = renderForm(rule({ percentage: '20.00', updatedAt: V2 }), failedEdit(V1));
		expect(input('percentage')).toBe(formatPercentInput('20.00'));
		expect(input('validTo')).toBe('');
		expect(input('expectedUpdatedAt')).toBe(V2);
	});
});
