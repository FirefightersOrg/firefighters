import { describe, expect, it } from 'vitest';
import {
	formatHundredths,
	formatHundredthsAsInput,
	formatPercent,
	formatPercentInput,
	hundredthsToDecimalString,
	MAX_PERCENT_HUNDREDTHS,
	parsePercentInput,
	parsePercentToHundredths,
	toPercentString
} from './percent';

const NBSP = ' ';

describe('parsePercentToHundredths (canonical database form)', () => {
	it.each([
		['25', 2500],
		['25.00', 2500],
		['12.5', 1250],
		['12.50', 1250],
		['0.01', 1],
		['100.00', MAX_PERCENT_HUNDREDTHS],
		[' 7.25 ', 725]
	])('parses %j into hundredths', (input, hundredths) => {
		expect(parsePercentToHundredths(input)).toBe(hundredths);
	});

	it.each(['', '12,5', '12.345', '1000', '-1', '1e2', '.5', '5.', '12 %', 'abc'])(
		'rejects %j',
		(input) => {
			expect(parsePercentToHundredths(input)).toBeNull();
		}
	);
});

describe('parsePercentInput (Argentine format)', () => {
	it.each([
		['25', 2500],
		['12,5', 1250],
		['12,50', 1250],
		['12,05', 1205],
		['0,01', 1],
		['0,5', 50],
		['100', 10_000],
		['100,00', 10_000],
		['007', 700],
		['  25  ', 2500]
	])('comma decimals: %j → %i', (input, hundredths) => {
		expect(parsePercentInput(input)).toBe(hundredths);
	});

	it.each([
		['12.5', 1250],
		['12.50', 1250],
		['0.25', 25]
	])('accepts an unambiguous dot decimal: %j → %i', (input, hundredths) => {
		expect(parsePercentInput(input)).toBe(hundredths);
	});

	it.each([
		['25%', 2500],
		['25 %', 2500],
		[`25${NBSP}%`, 2500],
		[`12,5${NBSP}%`, 1250],
		['12,5 % ', 1250]
	])('ignores a trailing percent sign: %j', (input, hundredths) => {
		expect(parsePercentInput(input)).toBe(hundredths);
	});

	it('parses the display format back to the same value', () => {
		for (const hundredths of [1, 50, 1250, 1205, 2500, 3333, 10_000]) {
			expect(parsePercentInput(formatHundredths(hundredths))).toBe(hundredths);
			expect(parsePercentInput(formatHundredthsAsInput(hundredths))).toBe(hundredths);
		}
	});

	it('does not check the range (the schema reports it with its own message)', () => {
		expect(parsePercentInput('0')).toBe(0);
		expect(parsePercentInput('0,00')).toBe(0);
		expect(parsePercentInput('150')).toBe(15_000);
	});

	it.each([
		'',
		'   ',
		'%',
		'12,345',
		'12.345',
		'1.000',
		'1.000,5',
		'1.2,5',
		'12,5,0',
		'12..5',
		',5',
		'.5',
		'5,',
		'5.',
		'-5',
		'+5',
		'1e2',
		'12 5',
		'12, 5',
		'%25',
		'25%%',
		'abc',
		'1234567',
		'Infinity',
		'NaN'
	])('rejects %j', (input) => {
		expect(parsePercentInput(input)).toBeNull();
	});
});

describe('hundredthsToDecimalString / toPercentString', () => {
	it.each([
		[0, '0.00'],
		[1, '0.01'],
		[1250, '12.50'],
		[2500, '25.00'],
		[10_000, '100.00']
	])('%i → %j', (hundredths, canonical) => {
		expect(hundredthsToDecimalString(hundredths)).toBe(canonical);
	});

	it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %d', (value) => {
		expect(() => hundredthsToDecimalString(value)).toThrow(RangeError);
	});

	it('normalizes database values (text cast or JSON number)', () => {
		expect(toPercentString('12.5')).toBe('12.50');
		expect(toPercentString('25.00')).toBe('25.00');
		expect(toPercentString(12.5)).toBe('12.50');
		expect(toPercentString(33.33)).toBe('33.33');
		expect(() => toPercentString('12,5')).toThrow(RangeError);
		expect(() => toPercentString(-1)).toThrow(RangeError);
	});
});

describe('formatPercent (display, es-AR)', () => {
	it.each([
		['25.00', `25${NBSP}%`],
		['12.50', `12,5${NBSP}%`],
		['12.05', `12,05${NBSP}%`],
		['33.33', `33,33${NBSP}%`],
		['0.01', `0,01${NBSP}%`],
		['100.00', `100${NBSP}%`],
		['7', `7${NBSP}%`]
	])('%j → %j', (value, display) => {
		expect(formatPercent(value)).toBe(display);
	});

	it('separates the number from % with a non-breaking space (never wraps)', () => {
		expect(formatPercent('25.00')).not.toContain(' ');
		expect(formatPercent('25.00').at(-2)).toBe(NBSP);
	});

	it('returns a malformed value unchanged', () => {
		expect(formatPercent('n/a')).toBe('n/a');
	});
});

describe('formatPercentInput (prefill)', () => {
	it.each([
		['25.00', '25'],
		['12.50', '12,5'],
		['12.05', '12,05'],
		['100.00', '100']
	])('%j → %j', (value, input) => {
		expect(formatPercentInput(value)).toBe(input);
	});

	it('returns a malformed value unchanged', () => {
		expect(formatPercentInput('x')).toBe('x');
	});
});
