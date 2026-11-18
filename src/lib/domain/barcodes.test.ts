import { describe, expect, it } from 'vitest';
import {
	barcodeNeedsManualNumber,
	compileBarcodePattern,
	isBarcodePatternPortable,
	isNumberText,
	padNumber,
	readBarcode,
	type BarcodeRules
} from './barcodes';

const base: BarcodeRules = { barcodeMode: 'base_number', barcodePattern: null, numberDigits: 4 };
const pattern: BarcodeRules = {
	barcodeMode: 'internal_code',
	barcodePattern: '^BC-(\\d+)$',
	numberDigits: 4
};

describe('padNumber / isNumberText', () => {
	it('pads like bond_format_number', () => {
		expect(padNumber(68, 4)).toBe('0068');
		expect(padNumber(10871, 4)).toBe('10871');
		expect(padNumber(-1, 4)).toBe('-1');
	});
	it('accepts ASCII digits up to the digit count', () => {
		expect(isNumberText('0068', 4)).toBe(true);
		expect(isNumberText('68', 4)).toBe(true);
		expect(isNumberText('00068', 4)).toBe(false);
		expect(isNumberText('6 8', 4)).toBe(false);
		expect(isNumberText('-1', 4)).toBe(false);
		expect(isNumberText('١٢', 4)).toBe(false);
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

describe('readBarcode', () => {
	it('base_number: the barcode is the base number', () => {
		expect(readBarcode('0068', base)).toEqual({ kind: 'number', text: '0068', value: 68 });
		expect(readBarcode('68', base)).toEqual({ kind: 'number', text: '68', value: 68 });
		expect(readBarcode('PATA1200-1200', base)).toEqual({
			kind: 'error',
			code: 'invalid_barcode',
			message: 'Barcode "PATA1200-1200" is not a base number of up to 4 digits'
		});
		expect(readBarcode('12345', base)).toMatchObject({ kind: 'error', code: 'invalid_barcode' });
	});

	it('manual_mapping and pattern modes without a pattern read nothing', () => {
		expect(readBarcode('X', { ...base, barcodeMode: 'manual_mapping' })).toEqual({ kind: 'none' });
		expect(readBarcode('X', { ...pattern, barcodePattern: null })).toEqual({ kind: 'none' });
		expect(barcodeNeedsManualNumber({ barcodeMode: 'external_legacy_code', barcodePattern: null })).toBe(
			true
		);
		expect(barcodeNeedsManualNumber(pattern)).toBe(false);
		expect(barcodeNeedsManualNumber(base)).toBe(false);
	});

	it('pattern modes: the first capture group is the base number', () => {
		expect(readBarcode('BC-0042', pattern)).toEqual({ kind: 'number', text: '0042', value: 42 });
		expect(readBarcode('XX-0042', pattern)).toEqual({
			kind: 'error',
			code: 'barcode_pattern_mismatch',
			message: 'Barcode "XX-0042" does not match the campaign barcode pattern'
		});
		expect(readBarcode('BC-123456', pattern)).toEqual({
			kind: 'error',
			code: 'invalid_barcode',
			message:
				'The base number read from barcode "BC-123456" ("123456") is not a number of up to 4 digits'
		});
		// A group that does not take part in the match is a mismatch (NULL in Postgres).
		const optional = { ...pattern, barcodePattern: '^BC(?:-(\\d+))?$' };
		expect(readBarcode('BC', optional)).toMatchObject({ code: 'barcode_pattern_mismatch' });
		// Unanchored patterns match anywhere, like regexp_match.
		expect(readBarcode('LOT 7 N-0099 X', { ...pattern, barcodePattern: 'N-(\\d{4})' })).toEqual({
			kind: 'number',
			text: '0099',
			value: 99
		});
	});

	it('non-portable patterns are left to the database', () => {
		expect(readBarcode('BC-1', { ...pattern, barcodePattern: '\\mBC-(\\d+)' })).toEqual({
			kind: 'undetermined'
		});
	});
});
