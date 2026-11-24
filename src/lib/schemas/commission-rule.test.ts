import { describe, expect, it } from 'vitest';
import {
	commissionRuleAnnulSchema,
	commissionRuleFieldErrors,
	commissionRuleSchema,
	commissionRuleUpdateSchema,
	COMMISSION_RULE_FIELDS,
	COMMISSION_RULE_UPDATE_FIELDS,
	COMMISSION_RULE_VERSION_INVALID_MESSAGE
} from './commission-rule';
import { MONEY_INPUT_FORMAT_MESSAGE } from '$lib/domain/money';
import { PERCENT_INPUT_FORMAT_MESSAGE } from '$lib/domain/percent';

const RULE_ID = 'a0000000-0000-0000-0000-000000000001';
/** updated_at as PostgREST returns it (microseconds, explicit offset). */
const VERSION = '2026-11-17T01:02:03.123456+00:00';

const base = {
	ruleType: 'cash_full_payment',
	installmentNumber: '',
	valueKind: 'percentage',
	percentage: '25',
	fixedAmount: '',
	validFrom: '2026-01-01',
	validTo: '',
	reason: ''
};

const schema = commissionRuleSchema(10);

function errorsOf(input: Record<string, string>, s = schema) {
	const parsed = s.safeParse(input);
	expect(parsed.success).toBe(false);
	return parsed.success ? {} : commissionRuleFieldErrors(parsed.error);
}

describe('commissionRuleSchema', () => {
	it('parses a percentage rule into canonical values', () => {
		expect(schema.parse(base)).toEqual({
			ruleType: 'cash_full_payment',
			installmentNumber: null,
			percentage: '25.00',
			fixedAmount: null,
			validFrom: '2026-01-01',
			validTo: null,
			reason: null
		});
	});

	it.each([
		['12,5', '12.50'],
		['12,50', '12.50'],
		['12.5', '12.50'],
		['100', '100.00'],
		['0,01', '0.01'],
		['25 %', '25.00']
	])('percentage %j → %j', (percentage, canonical) => {
		expect(schema.parse({ ...base, percentage }).percentage).toBe(canonical);
	});

	it('parses a fixed amount in Argentine format and ignores the percentage input', () => {
		const out = schema.parse({
			...base,
			valueKind: 'fixed_amount',
			percentage: 'leftover',
			fixedAmount: '1.500,00'
		});
		expect(out).toMatchObject({ percentage: null, fixedAmount: '1500.00' });
	});

	it('ignores the fixed amount input when the percentage is chosen', () => {
		expect(schema.parse({ ...base, fixedAmount: 'garbage' }).fixedAmount).toBeNull();
	});

	it('reads the installment number only for custom rules', () => {
		expect(schema.parse({ ...base, installmentNumber: '3' }).installmentNumber).toBeNull();
		expect(
			schema.parse({ ...base, ruleType: 'custom', installmentNumber: '3' }).installmentNumber
		).toBe(3);
		expect(
			schema.parse({ ...base, ruleType: 'custom', installmentNumber: '10' }).installmentNumber
		).toBe(10);
	});

	it.each([
		['', 'El número de cuota es obligatorio para una regla de cuota específica'],
		['0', 'El número de cuota debe estar entre 1 y 10'],
		['11', 'El número de cuota debe estar entre 1 y 10'],
		['2,5', 'El número de cuota debe ser un número entero']
	])('custom installment %j is rejected', (installmentNumber, message) => {
		expect(errorsOf({ ...base, ruleType: 'custom', installmentNumber }).installmentNumber).toEqual([
			message
		]);
	});

	it('explains the single-installment case', () => {
		expect(
			errorsOf({ ...base, ruleType: 'custom', installmentNumber: '2' }, commissionRuleSchema(1))
				.installmentNumber
		).toEqual(['Esta campaña tiene una sola cuota: usar 1']);
	});

	it.each([
		['', 'El porcentaje es obligatorio'],
		['0', 'El porcentaje debe ser mayor que 0 y hasta 100'],
		['0,00', 'El porcentaje debe ser mayor que 0 y hasta 100'],
		['100,01', 'El porcentaje debe ser mayor que 0 y hasta 100'],
		['150', 'El porcentaje debe ser mayor que 0 y hasta 100'],
		['12,345', PERCENT_INPUT_FORMAT_MESSAGE],
		['-5', PERCENT_INPUT_FORMAT_MESSAGE],
		['abc', PERCENT_INPUT_FORMAT_MESSAGE]
	])('percentage %j is rejected', (percentage, message) => {
		expect(errorsOf({ ...base, percentage }).percentage).toEqual([message]);
	});

	it.each([
		['', 'El monto fijo es obligatorio'],
		['0', 'El monto fijo debe ser mayor que 0'],
		['0,00', 'El monto fijo debe ser mayor que 0'],
		['1,234.56', MONEY_INPUT_FORMAT_MESSAGE],
		['1000000000000', MONEY_INPUT_FORMAT_MESSAGE]
	])('fixed amount %j is rejected', (fixedAmount, message) => {
		expect(errorsOf({ ...base, valueKind: 'fixed_amount', fixedAmount }).fixedAmount).toEqual([
			message
		]);
	});

	it('requires a rule type and a value kind', () => {
		const errors = errorsOf({ ...base, ruleType: '', valueKind: '' });
		expect(errors.ruleType).toEqual(['Elegir un tipo de regla']);
		expect(errors.valueKind).toEqual(['Elegir un porcentaje o un monto fijo']);
	});

	it('validates the dates (inclusive, end optional)', () => {
		expect(errorsOf({ ...base, validFrom: '' }).validFrom).toEqual([
			'La fecha de inicio de vigencia es obligatoria'
		]);
		expect(errorsOf({ ...base, validFrom: '2026-02-30' }).validFrom).toEqual([
			'La fecha de inicio de vigencia debe ser una fecha válida (AAAA-MM-DD)'
		]);
		expect(errorsOf({ ...base, validTo: '2025-12-31' }).validTo).toEqual([
			'La fecha de fin de vigencia debe ser igual o posterior a la de inicio'
		]);
		expect(schema.parse({ ...base, validTo: '2026-01-01' }).validTo).toBe('2026-01-01');
	});

	it('reports every field issue at once', () => {
		const errors = errorsOf({ ...base, validFrom: 'x', percentage: '0', ruleType: 'custom' });
		expect(Object.keys(errors).sort()).toEqual(['installmentNumber', 'percentage', 'validFrom']);
	});

	it('keeps an optional trimmed reason', () => {
		expect(schema.parse({ ...base, reason: '  New agreement ' }).reason).toBe('New agreement');
	});
});

describe('commissionRuleUpdateSchema', () => {
	it('adds the rule id and the exact version string', () => {
		expect(
			commissionRuleUpdateSchema(10).parse({ ...base, ruleId: RULE_ID, expectedUpdatedAt: VERSION })
		).toMatchObject({
			ruleId: RULE_ID,
			expectedUpdatedAt: VERSION,
			percentage: '25.00'
		});
	});

	it('rejects a malformed rule id', () => {
		expect(
			errorsOf(
				{ ...base, ruleId: 'nope', expectedUpdatedAt: VERSION },
				commissionRuleUpdateSchema(10) as never
			).ruleId
		).toEqual(['Regla de comisión desconocida']);
	});

	it.each([
		['missing', undefined],
		['empty', ''],
		['date only', '2026-11-17'],
		['no offset', '2026-11-17T01:02:03.123456']
	])('requires a valid version (%s)', (_label, expectedUpdatedAt) => {
		const input: Record<string, string> = { ...base, ruleId: RULE_ID };
		if (expectedUpdatedAt !== undefined) input.expectedUpdatedAt = expectedUpdatedAt;
		expect(errorsOf(input, commissionRuleUpdateSchema(10) as never)).toEqual({
			expectedUpdatedAt: [COMMISSION_RULE_VERSION_INVALID_MESSAGE]
		});
	});

	it('reads the version only from the edit form', () => {
		expect(COMMISSION_RULE_UPDATE_FIELDS).toContain('expectedUpdatedAt');
		expect(COMMISSION_RULE_FIELDS).not.toContain('expectedUpdatedAt');
	});
});

describe('commissionRuleAnnulSchema', () => {
	it('requires a reason', () => {
		expect(commissionRuleAnnulSchema.parse({ ruleId: RULE_ID, reason: ' Mistake ' })).toEqual({
			ruleId: RULE_ID,
			reason: 'Mistake'
		});
		const parsed = commissionRuleAnnulSchema.safeParse({ ruleId: RULE_ID, reason: '   ' });
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(commissionRuleFieldErrors(parsed.error).reason).toEqual([
				'Se requiere un motivo para anular una regla de comisión'
			]);
		}
	});
});
