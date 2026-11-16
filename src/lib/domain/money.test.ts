import { describe, expect, it } from 'vitest';
import {
	centsToDecimalString,
	formatMoney,
	MAX_MONEY_CENTS,
	parseMoneyToCents,
	toDecimalString
} from './money';
import {
	notExactInstallmentsMessage,
	previewInstallmentValue,
	splitIntoInstallments
} from './installments';

describe('money', () => {
	it.each([
		['60000', 6_000_000],
		['60000.5', 6_000_050],
		['60000.50', 6_000_050],
		[' 0.01 ', 1],
		['999999999999.99', MAX_MONEY_CENTS]
	])('parses %j into cents', (input, cents) => {
		expect(parseMoneyToCents(input)).toBe(cents);
	});

	it.each(['', '-1', '1e5', '60.000', '60,000', '1.234', '.5', '1.', 'abc', '1000000000000'])(
		'rejects %j',
		(input) => {
			expect(parseMoneyToCents(input)).toBeNull();
		}
	);

	it('formats cents as a two-decimal string without float rounding', () => {
		expect(centsToDecimalString(6_000_000)).toBe('60000.00');
		expect(centsToDecimalString(5)).toBe('0.05');
		expect(centsToDecimalString(MAX_MONEY_CENTS)).toBe('999999999999.99');
		expect(() => centsToDecimalString(1.5)).toThrow(RangeError);
		expect(() => centsToDecimalString(-1)).toThrow(RangeError);
	});

	it('normalizes database values (text cast or JSON number)', () => {
		expect(toDecimalString('60000.00')).toBe('60000.00');
		expect(toDecimalString('8571.4')).toBe('8571.40');
		expect(toDecimalString(60000)).toBe('60000.00');
		expect(toDecimalString(0.1 + 0.2)).toBe('0.30');
		expect(() => toDecimalString('abc')).toThrow(RangeError);
	});

	it('formats for display with thousands separators', () => {
		expect(formatMoney('60000.00')).toBe('60,000.00');
		expect(formatMoney('999999999999.99')).toBe('999,999,999,999.99');
		expect(formatMoney('5')).toBe('5.00');
		expect(formatMoney('not money')).toBe('not money');
	});
});

describe('installments', () => {
	it('splits exactly when the total divides to the cent', () => {
		expect(splitIntoInstallments(6_000_000, 10)).toEqual({
			ok: true,
			installmentValueCents: 600_000
		});
		expect(splitIntoInstallments(10_002, 2)).toEqual({ ok: true, installmentValueCents: 5_001 });
	});

	it('rejects a split that is not exact instead of rounding', () => {
		expect(splitIntoInstallments(6_000_000, 7)).toEqual({ ok: false, reason: 'not_exact' });
		expect(splitIntoInstallments(10_000, 3)).toEqual({ ok: false, reason: 'not_exact' });
	});

	it('rejects invalid totals and counts', () => {
		expect(splitIntoInstallments(0, 10)).toEqual({ ok: false, reason: 'invalid_total' });
		expect(splitIntoInstallments(100, 0)).toEqual({ ok: false, reason: 'invalid_count' });
		expect(splitIntoInstallments(100, 1.5)).toEqual({ ok: false, reason: 'invalid_count' });
	});

	it('previews the installment value from raw input', () => {
		expect(previewInstallmentValue('', '10')).toEqual({ state: 'incomplete' });
		expect(previewInstallmentValue('60000', '')).toEqual({ state: 'incomplete' });
		expect(previewInstallmentValue('60000', '10')).toEqual({
			state: 'ok',
			installmentValue: '6000.00'
		});
		expect(previewInstallmentValue('60000', '7')).toEqual({
			state: 'error',
			message: notExactInstallmentsMessage('60000.00', 7)
		});
		expect(previewInstallmentValue('abc', '7')).toMatchObject({ state: 'error' });
		expect(previewInstallmentValue('60000', '0')).toMatchObject({ state: 'error' });
		expect(previewInstallmentValue('60000', '2.5')).toMatchObject({ state: 'error' });
	});

	it('explains a non-exact split in user terms', () => {
		expect(notExactInstallmentsMessage('60000.00', 7)).toBe(
			'60,000.00 cannot be split into 7 equal installments. ' +
				'Choose a value and a number of installments that divide exactly (to the cent).'
		);
	});
});
