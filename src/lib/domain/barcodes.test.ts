import { describe, expect, it } from 'vitest';
import {
	barcodeNeedsManualNumber,
	compileBarcodePattern,
	isBarcodePatternPortable,
	baseNumberRequiredMessage,
	padNumber,
	parseBaseNumberText,
	readBarcode,
	type BarcodeRules
} from './barcodes';

const base: BarcodeRules = { barcodeMode: 'base_number', barcodePattern: null, numberDigits: 4 };
const pattern: BarcodeRules = {
	barcodeMode: 'internal_code',
	barcodePattern: '^BC-(\\d+)$',
	numberDigits: 4
};

describe('padNumber / parseBaseNumberText', () => {
	it('pads like bond_format_number', () => {
		expect(padNumber(68, 4)).toBe('0068');
		expect(padNumber(10871, 4)).toBe('10871');
		expect(padNumber(-1, 4)).toBe('-1');
	});
	it('accepts 1 to 10 ASCII digits that fit an integer (like ^[0-9]{1,10}$)', () => {
		expect(parseBaseNumberText('0068')).toBe(68);
		expect(parseBaseNumberText('68')).toBe(68);
		expect(parseBaseNumberText('00068')).toBe(68);
		expect(parseBaseNumberText('2147483647')).toBe(2147483647);
		expect(parseBaseNumberText('2147483648')).toBeNull();
		expect(parseBaseNumberText('00000000001')).toBeNull();
		expect(parseBaseNumberText('6 8')).toBeNull();
		expect(parseBaseNumberText('-1')).toBeNull();
		expect(parseBaseNumberText('١٢')).toBeNull();
		expect(parseBaseNumberText('')).toBeNull();
	});
});

describe('compileBarcodePattern', () => {
	it('compiles the portable subset', () => {
		expect(compileBarcodePattern('^BC-(\\d+)$')).toBeInstanceOf(RegExp);
		expect(compileBarcodePattern('^(?:LEG|OLD)[0-9]{2}-([0-9]{1,4})$')).toBeInstanceOf(RegExp);
		expect(compileBarcodePattern('^A\\\\b(\\d+)$')).toBeInstanceOf(RegExp); // literal backslash + b
		expect(compileBarcodePattern(null)).toBeNull();
	});
	it.each([
		['\\b(\\d+)\\b', 'ARE \\b is a backspace'],
		['\\y(\\d+)', 'ARE word boundary'],
		['\\m(\\d+)\\M', 'ARE word start/end'],
		['\\A(\\d+)\\Z', 'ARE anchors'],
		['([[:digit:]]+)', 'POSIX class'],
		['***=(x)', 'director'],
		['(?i)bc-(\\d+)', 'embedded options'],
		['(?<=BC-)(\\d+)', 'lookbehind'],
		['^(\\d+?)0*$', 'lazy quantifier'],
		['^(\\d)\\1$', 'back reference'],
		['(unclosed', 'invalid in JavaScript']
	])('rejects %s (%s)', (source) => {
		expect(compileBarcodePattern(source)).toBeNull();
		expect(isBarcodePatternPortable(source)).toBe(false);
	});
});

describe('readBarcode (same codes and messages as import_session_add_scan)', () => {
	it('base_number: the barcode is the base number', () => {
		expect(readBarcode('0068', base)).toEqual({ kind: 'number', value: 68 });
		expect(readBarcode('68', base)).toEqual({ kind: 'number', value: 68 });
		// Range is checked later (number_out_of_range), not here.
		expect(readBarcode('12345', base)).toEqual({ kind: 'number', value: 12345 });
		expect(readBarcode('PATA1200-1200', base)).toEqual({
			kind: 'error',
			code: 'parse_code_not_a_number',
			message: 'Barcode PATA1200-1200 is not a base number.'
		});
		expect(readBarcode('99999999999', base)).toMatchObject({ code: 'parse_code_not_a_number' });
	});

	it('manual_mapping and pattern modes without a pattern read nothing', () => {
		const manual = { ...base, barcodeMode: 'manual_mapping' } as const;
		expect(readBarcode('X', manual)).toEqual({ kind: 'none' });
		expect(readBarcode('X', { ...pattern, barcodePattern: null })).toEqual({ kind: 'none' });
		expect(
			barcodeNeedsManualNumber({ barcodeMode: 'external_legacy_code', barcodePattern: null })
		).toBe(true);
		expect(barcodeNeedsManualNumber(pattern)).toBe(false);
		expect(barcodeNeedsManualNumber(base)).toBe(false);
		expect(baseNumberRequiredMessage(manual)).toBe(
			'This campaign needs the base number typed with the barcode.'
		);
		expect(baseNumberRequiredMessage({ ...pattern, barcodePattern: null })).toBe(
			'This campaign has no barcode pattern: type the base number.'
		);
	});

	it('pattern modes: the first capture group is the base number', () => {
		expect(readBarcode('BC-0042', pattern)).toEqual({ kind: 'number', value: 42 });
		const mismatch = {
			kind: 'error',
			code: 'parse_code_not_recognized',
			message: 'Barcode XX-0042 does not match the campaign pattern.'
		};
		expect(readBarcode('XX-0042', pattern)).toEqual(mismatch);
		// A capture that is not a number is reported the same way.
		expect(readBarcode('BC-1A', { ...pattern, barcodePattern: '^BC-(.+)$' })).toMatchObject({
			code: 'parse_code_not_recognized'
		});
		// A group that does not take part in the match is a mismatch (NULL in Postgres).
		const optional = { ...pattern, barcodePattern: '^BC(?:-(\\d+))?$' };
		expect(readBarcode('BC', optional)).toMatchObject({ code: 'parse_code_not_recognized' });
		// Unanchored patterns match anywhere, like regexp_match.
		expect(readBarcode('LOT 7 N-0099 X', { ...pattern, barcodePattern: 'N-(\\d{4})' })).toEqual({
			kind: 'number',
			value: 99
		});
	});

	it('non-portable patterns cannot be read by the app', () => {
		expect(readBarcode('BC-1', { ...pattern, barcodePattern: '\\mBC-(\\d+)' })).toEqual({
			kind: 'undetermined'
		});
	});
});
