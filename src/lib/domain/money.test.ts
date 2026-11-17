import { describe, expect, it } from 'vitest';
import {
	centsToDecimalString,
	formatCents,
	formatInteger,
	formatMoney,
	formatMoneyInput,
	groupThousands,
	MAX_MONEY_CENTS,
	MONEY_INPUT_FORMAT_MESSAGE,
	parseMoneyInput,
	parseMoneyToCents,
	toDecimalString
} from './money';
import {
	notExactInstallmentsMessage,
	previewInstallmentValue,
	splitIntoInstallments
} from './installments';

const NBSP = ' ';

describe('parseMoneyToCents (canonical database form)', () => {
	it.each([
		['60000', 6_000_000],
		['60000.5', 6_000_050],
		['60000.50', 6_000_050],
		[' 0.01 ', 1],
		['999999999999.99', MAX_MONEY_CENTS]
	])('parses %j into cents', (input, cents) => {
		expect(parseMoneyToCents(input)).toBe(cents);
	});

	it.each([
		'',
		'-1',
		'1e5',
		'60.000',
		'60,000',
		'60.000,50',
		'1.234',
		'.5',
		'1.',
		'abc',
		'1000000000000'
	])('rejects %j', (input) => {
		expect(parseMoneyToCents(input)).toBeNull();
	});
});

describe('parseMoneyInput (Argentine format)', () => {
	describe('with a comma: comma is the decimal separator, dots group thousands', () => {
		it.each([
			['60.000,50', 6_000_050],
			['60.000,5', 6_000_050],
			['60.000,00', 6_000_000],
			['60000,50', 6_000_050],
			['60000,5', 6_000_050],
			['0,01', 1],
			['0,5', 50],
			['1.234.567,89', 123_456_789],
			['999.999.999.999,99', MAX_MONEY_CENTS],
			['999999999999,99', MAX_MONEY_CENTS]
		])('%j → %i cents', (input, cents) => {
			expect(parseMoneyInput(input)).toBe(cents);
		});
	});

	describe('without a comma: dots grouping exactly 3 digits are thousands separators', () => {
		it.each([
			['60000', 6_000_000],
			['60.000', 6_000_000],
			['1.234', 123_400],
			['1.000.000', 100_000_000],
			['999.999.999.999', 99_999_999_999_900],
			['0', 0],
			['007', 700]
		])('%j → %i cents', (input, cents) => {
			expect(parseMoneyInput(input)).toBe(cents);
		});
	});

	describe('a single dot followed by 1-2 digits is a decimal point (unambiguous)', () => {
		it.each([
			['60000.50', 6_000_050],
			['60000.5', 6_000_050],
			['1.23', 123],
			['0.01', 1]
		])('%j → %i cents', (input, cents) => {
			expect(parseMoneyInput(input)).toBe(cents);
		});
	});

	describe('whitespace and the currency sign are ignored', () => {
		it.each([
			['  60.000,50 ', 6_000_050],
			['$60.000,50', 6_000_050],
			['$ 60.000,50', 6_000_050],
			[`$${NBSP}60.000,50`, 6_000_050],
			[`${NBSP}60000${NBSP}`, 6_000_000]
		])('%j → %i cents', (input, cents) => {
			expect(parseMoneyInput(input)).toBe(cents);
		});
	});

	it.each([
		['', 'empty'],
		['   ', 'blank'],
		['$', 'currency sign only'],
		['60,000', 'three digits after the comma (US thousands)'],
		['60.000,505', 'three decimals'],
		['1,234.56', 'US format'],
		['60000.500', 'dot followed by 3 digits after an ungrouped integer'],
		['0.500', 'grouped number with a zero first group'],
		['0.500,00', 'grouped number with a zero first group, with decimals'],
		['060.000', 'grouped number with a leading zero'],
		['1234.567', 'first group longer than 3 digits'],
		['60.00.00', 'groups of 2 digits'],
		['60.0000', 'group of 4 digits'],
		['1.5,00', 'dot followed by 1 digit before a comma'],
		['60.000.5', 'grouping mixed with a decimal dot'],
		['1.234.56', 'last group of 2 digits'],
		['1,2,3', 'several commas'],
		['60.000,', 'comma without decimals'],
		[',50', 'no integer part'],
		['.5', 'no integer part (dot)'],
		['5.', 'trailing dot'],
		['-1', 'negative'],
		['+1', 'sign'],
		['1e5', 'exponent'],
		['60 000', 'space as thousands separator'],
		['60.000 ,50', 'inner space'],
		['abc', 'letters'],
		['USD 10', 'other currency'],
		['$$10', 'double currency sign'],
		['1000000000000', '13 integer digits'],
		['1.000.000.000.000', '13 integer digits, grouped'],
		['1000000000000,00', '13 integer digits with decimals']
	])('rejects %j (%s)', (input) => {
		expect(parseMoneyInput(input)).toBeNull();
	});

	it('parses the display and input formats back to the same amount', () => {
		for (const cents of [0, 1, 50, 6_000_050, 123_456_789, MAX_MONEY_CENTS]) {
			expect(parseMoneyInput(formatCents(cents))).toBe(cents);
			expect(parseMoneyInput(formatMoneyInput(centsToDecimalString(cents)))).toBe(cents);
			expect(parseMoneyInput(centsToDecimalString(cents))).toBe(cents);
		}
	});

	it('explains the accepted format', () => {
		expect(MONEY_INPUT_FORMAT_MESSAGE).toBe(
			'Enter an amount like 60.000 or 60.000,50 (dots for thousands, comma for up to 2 decimals)'
		);
	});
});

describe('canonical conversions', () => {
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
		// The es-AR input/display formats are not database values.
		expect(() => toDecimalString('60.000,00')).toThrow(RangeError);
	});
});

describe('es-AR display', () => {
	it('formats amounts as "$ 60.000,50" with a non-breaking space', () => {
		expect(formatMoney('60000.50')).toBe(`$${NBSP}60.000,50`);
		expect(formatMoney('60000.5')).toBe(`$${NBSP}60.000,50`);
		expect(formatMoney('60000.00')).toBe(`$${NBSP}60.000,00`);
		expect(formatMoney('6000')).toBe(`$${NBSP}6.000,00`);
		expect(formatMoney('999')).toBe(`$${NBSP}999,00`);
		expect(formatMoney('0.05')).toBe(`$${NBSP}0,05`);
		expect(formatMoney('0')).toBe(`$${NBSP}0,00`);
		expect(formatMoney('1234567.89')).toBe(`$${NBSP}1.234.567,89`);
		expect(formatMoney('999999999999.99')).toBe(`$${NBSP}999.999.999.999,99`);
	});

	it('returns a malformed value unchanged', () => {
		expect(formatMoney('not money')).toBe('not money');
		expect(formatMoney('60.000,00')).toBe('60.000,00');
	});

	it('matches Intl.NumberFormat es-AR currency output (whitespace normalized)', () => {
		const intl = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
		const normalize = (text: string) => text.replace(/\s/g, ' ');
		const cases = [
			['60000.50', 60000.5],
			['6000.00', 6000],
			['0.05', 0.05],
			['1234567.89', 1234567.89]
		] as const;
		for (const [canonical, value] of cases) {
			expect(normalize(formatMoney(canonical))).toBe(normalize(intl.format(value)));
		}
	});

	it('formats cents directly', () => {
		expect(formatCents(6_000_050)).toBe(`$${NBSP}60.000,50`);
		expect(() => formatCents(-1)).toThrow(RangeError);
	});

	it('formats canonical amounts for inputs (no currency sign)', () => {
		expect(formatMoneyInput('60000.00')).toBe('60.000,00');
		expect(formatMoneyInput('100.02')).toBe('100,02');
		expect(formatMoneyInput('garbage')).toBe('garbage');
	});

	it('groups integers with dots', () => {
		expect(groupThousands('1234567')).toBe('1.234.567');
		expect(groupThousands('123')).toBe('123');
		expect(formatInteger(5129)).toBe('5.129');
		expect(formatInteger(0)).toBe('0');
		expect(formatInteger(-1234)).toBe('-1.234');
		expect(formatInteger(1.5)).toBe('1.5');
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

	it('previews the installment value from raw es-AR input', () => {
		expect(previewInstallmentValue('', '10')).toEqual({ state: 'incomplete' });
		expect(previewInstallmentValue('60000', '')).toEqual({ state: 'incomplete' });
		const ok = {
			state: 'ok',
			simpleBondValue: '60000.00',
			installmentCount: 10,
			installmentValue: '6000.00'
		};
		expect(previewInstallmentValue('60000', '10')).toEqual(ok);
		expect(previewInstallmentValue('60.000', '10')).toEqual(ok);
		expect(previewInstallmentValue('60.000,00', ' 10 ')).toEqual(ok);
		expect(previewInstallmentValue('100,02', '2')).toMatchObject({
			state: 'ok',
			installmentValue: '50.01'
		});
		expect(previewInstallmentValue('60.000,00', '7')).toEqual({
			state: 'error',
			field: 'installmentCount',
			message: notExactInstallmentsMessage('60000.00', 7)
		});
	});

	it('attributes preview errors to the input they belong to', () => {
		expect(previewInstallmentValue('abc', '7')).toEqual({
			state: 'error',
			field: 'simpleBondValue',
			message: `${MONEY_INPUT_FORMAT_MESSAGE}.`
		});
		expect(previewInstallmentValue('60,000', '10')).toMatchObject({ field: 'simpleBondValue' });
		expect(previewInstallmentValue('0', '10')).toEqual({
			state: 'error',
			field: 'simpleBondValue',
			message: 'Enter a simple bond value greater than 0.'
		});
		for (const count of ['0', '2.5', '-1', '99999999999999999999']) {
			expect(previewInstallmentValue('60000', count)).toEqual({
				state: 'error',
				field: 'installmentCount',
				message: 'Enter a whole number of installments greater than 0.'
			});
		}
	});

	it('explains a non-exact split in user terms, with the amount in es-AR format', () => {
		expect(notExactInstallmentsMessage('60000.00', 7)).toBe(
			`$${NBSP}60.000,00 cannot be split into 7 equal installments. ` +
				'Choose a value and a number of installments that divide exactly (to the cent).'
		);
	});
});
