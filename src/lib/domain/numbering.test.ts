import { describe, it, expect } from 'vitest';
import { DomainError } from './errors';
import {
	DEFAULT_NUMBERING_CONFIG,
	MAX_NUMBER_DIGITS,
	NumberingError,
	assertValidNumberingConfig,
	calculateAssociatedNumber,
	formatCampaignNumber,
	getMaxValidBaseNumber,
	parseCampaignNumber,
	validateNoOverflow,
	validateNumberRange,
	validateNumberingConfig,
	type CampaignNumberingConfig,
	type NumberingErrorCode
} from './numbering';

const FOUR_DIGITS: CampaignNumberingConfig = { ...DEFAULT_NUMBERING_CONFIG };

const FIVE_DIGITS: CampaignNumberingConfig = {
	numberDigits: 5,
	maxNumber: 99999,
	associatedNumberOffset: 4871,
	overflowPolicy: 'reject'
};

/** Runs `fn` and asserts it throws a NumberingError with the given code. */
function expectNumberingError(fn: () => unknown, code: NumberingErrorCode): void {
	let caught: unknown;
	try {
		fn();
	} catch (err) {
		caught = err;
	}
	expect(caught).toBeInstanceOf(NumberingError);
	expect((caught as NumberingError).code).toBe(code);
}

const INVALID_NUMBERS: Array<[string, number, NumberingErrorCode]> = [
	['negative', -1, 'negative_number'],
	['non-integer', 68.5, 'not_integer'],
	['NaN', Number.NaN, 'not_integer'],
	['Infinity', Number.POSITIVE_INFINITY, 'not_integer'],
	['negative Infinity', Number.NEGATIVE_INFINITY, 'not_integer']
];

describe('DEFAULT_NUMBERING_CONFIG', () => {
	it('matches the MVP decision (4 digits, max 9999, offset 4871, reject)', () => {
		expect(DEFAULT_NUMBERING_CONFIG).toEqual({
			numberDigits: 4,
			maxNumber: 9999,
			associatedNumberOffset: 4871,
			overflowPolicy: 'reject'
		});
		expect(validateNumberingConfig(DEFAULT_NUMBERING_CONFIG)).toEqual([]);
	});

	it('is frozen so callers cannot mutate the shared default', () => {
		expect(Object.isFrozen(DEFAULT_NUMBERING_CONFIG)).toBe(true);
	});
});

describe('NumberingError', () => {
	it('is a DomainError carrying a machine-readable code', () => {
		const err = new NumberingError('overflow', 'boom');
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(DomainError);
		expect(err.code).toBe('overflow');
		expect(err.name).toBe('NumberingError');
		expect(err.message).toBe('boom');
	});
});

describe('calculateAssociatedNumber', () => {
	it('adds the offset to the base number (README examples)', () => {
		expect(calculateAssociatedNumber(68, FOUR_DIGITS)).toBe(4939);
		expect(calculateAssociatedNumber(1658, FOUR_DIGITS)).toBe(6529);
		expect(calculateAssociatedNumber(0, FOUR_DIGITS)).toBe(4871);
	});

	it('accepts the highest valid 4-digit base number (5128 + 4871 = 9999)', () => {
		expect(calculateAssociatedNumber(5128, FOUR_DIGITS)).toBe(9999);
	});

	it('rejects 5129 in a 4-digit campaign as overflow (5129 + 4871 = 10000)', () => {
		expectNumberingError(() => calculateAssociatedNumber(5129, FOUR_DIGITS), 'overflow');
		expect(() => calculateAssociatedNumber(5129, FOUR_DIGITS)).toThrow(/10000/);
	});

	it('rejects the README 7000 example as overflow', () => {
		expectNumberingError(() => calculateAssociatedNumber(7000, FOUR_DIGITS), 'overflow');
	});

	it('accepts 5129 and 7000 in a 5-digit campaign', () => {
		expect(calculateAssociatedNumber(5129, FIVE_DIGITS)).toBe(10000);
		expect(calculateAssociatedNumber(7000, FIVE_DIGITS)).toBe(11871);
		expect(calculateAssociatedNumber(95128, FIVE_DIGITS)).toBe(99999);
	});

	it('rejects overflow at the top of a 5-digit campaign', () => {
		expectNumberingError(() => calculateAssociatedNumber(95129, FIVE_DIGITS), 'overflow');
	});

	it('rejects a base number above maxNumber as out_of_range (not overflow)', () => {
		expectNumberingError(() => calculateAssociatedNumber(10000, FOUR_DIGITS), 'out_of_range');
	});

	it.each(INVALID_NUMBERS)('rejects a %s base number', (_label, value, code) => {
		expectNumberingError(() => calculateAssociatedNumber(value, FOUR_DIGITS), code);
	});

	it('works with a zero offset', () => {
		const config = { ...FOUR_DIGITS, associatedNumberOffset: 0 };
		expect(calculateAssociatedNumber(9999, config)).toBe(9999);
	});

	it('rejects an invalid config', () => {
		expectNumberingError(
			() => calculateAssociatedNumber(68, { ...FOUR_DIGITS, maxNumber: 10000 }),
			'invalid_config'
		);
	});
});

describe('formatCampaignNumber', () => {
	it('pads to the campaign digit count', () => {
		expect(formatCampaignNumber(0, FOUR_DIGITS)).toBe('0000');
		expect(formatCampaignNumber(68, FOUR_DIGITS)).toBe('0068');
		expect(formatCampaignNumber(4939, FOUR_DIGITS)).toBe('4939');
		expect(formatCampaignNumber(9999, FOUR_DIGITS)).toBe('9999');

		expect(formatCampaignNumber(0, FIVE_DIGITS)).toBe('00000');
		expect(formatCampaignNumber(68, FIVE_DIGITS)).toBe('00068');
		expect(formatCampaignNumber(10000, FIVE_DIGITS)).toBe('10000');
		expect(formatCampaignNumber(99999, FIVE_DIGITS)).toBe('99999');
	});

	it('uses the configured digit count rather than a fixed width', () => {
		const sixDigits = { ...FOUR_DIGITS, numberDigits: 6 };
		expect(formatCampaignNumber(68, sixDigits)).toBe('000068');
	});

	it('rejects 10000 in a 4-digit campaign', () => {
		expectNumberingError(() => formatCampaignNumber(10000, FOUR_DIGITS), 'out_of_range');
	});

	it('rejects values above a maxNumber lower than the digit capacity', () => {
		const capped = { ...FOUR_DIGITS, maxNumber: 5000, associatedNumberOffset: 100 };
		expect(formatCampaignNumber(5000, capped)).toBe('5000');
		expectNumberingError(() => formatCampaignNumber(5001, capped), 'out_of_range');
	});

	it.each(INVALID_NUMBERS)('rejects a %s value', (_label, value, code) => {
		expectNumberingError(() => formatCampaignNumber(value, FOUR_DIGITS), code);
	});

	it('formats -0 as zero', () => {
		expect(formatCampaignNumber(-0, FOUR_DIGITS)).toBe('0000');
	});

	it('rejects an invalid config', () => {
		expectNumberingError(
			() => formatCampaignNumber(68, { ...FOUR_DIGITS, numberDigits: 0 }),
			'invalid_config'
		);
	});

	it.each([
		['4-digit', FOUR_DIGITS],
		['5-digit', FIVE_DIGITS]
	])('always produces exactly numberDigits characters (%s, full sweep)', (_label, config) => {
		// Collect mismatches and assert once, rather than calling expect() 100k times.
		const mismatches: Array<{ value: number; formatted: string }> = [];
		for (let value = 0; value <= config.maxNumber; value++) {
			const formatted = formatCampaignNumber(value, config);
			if (formatted.length !== config.numberDigits || Number(formatted) !== value) {
				mismatches.push({ value, formatted });
			}
		}
		expect(mismatches).toEqual([]);
	});
});

describe('parseCampaignNumber', () => {
	it('parses padded and unpadded input', () => {
		expect(parseCampaignNumber('0068', FOUR_DIGITS)).toBe(68);
		expect(parseCampaignNumber('68', FOUR_DIGITS)).toBe(68);
		expect(parseCampaignNumber('0000', FOUR_DIGITS)).toBe(0);
		expect(parseCampaignNumber('9999', FOUR_DIGITS)).toBe(9999);
		expect(parseCampaignNumber('00068', FIVE_DIGITS)).toBe(68);
		expect(parseCampaignNumber('0068', FIVE_DIGITS)).toBe(68);
	});

	it('trims surrounding whitespace', () => {
		expect(parseCampaignNumber('  0068 ', FOUR_DIGITS)).toBe(68);
	});

	it('round-trips with formatCampaignNumber', () => {
		for (const value of [0, 1, 68, 1658, 4871, 5128, 9999]) {
			expect(parseCampaignNumber(formatCampaignNumber(value, FOUR_DIGITS), FOUR_DIGITS)).toBe(
				value
			);
		}
	});

	it('rejects more digits than the campaign allows, even with leading zeros', () => {
		expectNumberingError(() => parseCampaignNumber('00068', FOUR_DIGITS), 'invalid_format');
		expectNumberingError(() => parseCampaignNumber('10000', FOUR_DIGITS), 'invalid_format');
	});

	it('rejects values above a maxNumber lower than the digit capacity', () => {
		const capped = { ...FOUR_DIGITS, maxNumber: 5000, associatedNumberOffset: 100 };
		expectNumberingError(() => parseCampaignNumber('5001', capped), 'out_of_range');
	});

	it.each(['', '   ', '-1', '+1', '1.5', '1e3', '6 8', 'abc', '0x10', '٦٨'])(
		'rejects malformed input %j',
		(input) => {
			expectNumberingError(() => parseCampaignNumber(input, FOUR_DIGITS), 'invalid_format');
		}
	);
});

describe('validateNumberRange', () => {
	it('accepts integers from 0 to maxNumber inclusive', () => {
		expect(validateNumberRange(0, FOUR_DIGITS)).toBe(true);
		expect(validateNumberRange(68, FOUR_DIGITS)).toBe(true);
		expect(validateNumberRange(9999, FOUR_DIGITS)).toBe(true);
		expect(validateNumberRange(99999, FIVE_DIGITS)).toBe(true);
	});

	it('rejects values outside the range or non-integers', () => {
		expect(validateNumberRange(10000, FOUR_DIGITS)).toBe(false);
		expect(validateNumberRange(100000, FIVE_DIGITS)).toBe(false);
		for (const [, value] of INVALID_NUMBERS) {
			expect(validateNumberRange(value, FOUR_DIGITS)).toBe(false);
		}
	});

	it('throws on an invalid config instead of answering', () => {
		expectNumberingError(
			() => validateNumberRange(1, { ...FOUR_DIGITS, maxNumber: 0 }),
			'invalid_config'
		);
	});
});

describe('validateNoOverflow / getMaxValidBaseNumber', () => {
	it('computes the highest valid base number', () => {
		expect(getMaxValidBaseNumber(FOUR_DIGITS)).toBe(5128);
		expect(getMaxValidBaseNumber(FIVE_DIGITS)).toBe(95128);
	});

	it('returns 0 when the offset equals maxNumber', () => {
		const config = { ...FOUR_DIGITS, associatedNumberOffset: 9999 };
		expect(getMaxValidBaseNumber(config)).toBe(0);
		expect(validateNoOverflow(0, config)).toBe(true);
		expect(validateNoOverflow(1, config)).toBe(false);
	});

	it('accepts base numbers up to the limit and rejects beyond it', () => {
		expect(validateNoOverflow(0, FOUR_DIGITS)).toBe(true);
		expect(validateNoOverflow(5128, FOUR_DIGITS)).toBe(true);
		expect(validateNoOverflow(5129, FOUR_DIGITS)).toBe(false);
		expect(validateNoOverflow(5129, FIVE_DIGITS)).toBe(true);
		expect(validateNoOverflow(95129, FIVE_DIGITS)).toBe(false);
	});

	it('returns false for invalid base numbers', () => {
		expect(validateNoOverflow(10000, FOUR_DIGITS)).toBe(false);
		for (const [, value] of INVALID_NUMBERS) {
			expect(validateNoOverflow(value, FOUR_DIGITS)).toBe(false);
		}
	});

	it('agrees with calculateAssociatedNumber for every 4-digit value', () => {
		for (let base = 0; base <= FOUR_DIGITS.maxNumber; base++) {
			const ok = validateNoOverflow(base, FOUR_DIGITS);
			if (ok) {
				expect(calculateAssociatedNumber(base, FOUR_DIGITS)).toBeLessThanOrEqual(9999);
			} else {
				expect(() => calculateAssociatedNumber(base, FOUR_DIGITS)).toThrow(NumberingError);
			}
		}
	});
});

describe('validateNumberingConfig', () => {
	const fieldsOf = (config: CampaignNumberingConfig) =>
		validateNumberingConfig(config).map((issue) => issue.field);

	it('accepts the MVP 4-digit and the 5-digit configs', () => {
		expect(validateNumberingConfig(FOUR_DIGITS)).toEqual([]);
		expect(validateNumberingConfig(FIVE_DIGITS)).toEqual([]);
	});

	it('accepts boundary values (offset 0, offset = maxNumber, maxNumber below capacity)', () => {
		expect(fieldsOf({ ...FOUR_DIGITS, associatedNumberOffset: 0 })).toEqual([]);
		expect(fieldsOf({ ...FOUR_DIGITS, associatedNumberOffset: 9999 })).toEqual([]);
		expect(fieldsOf({ ...FOUR_DIGITS, maxNumber: 5000, associatedNumberOffset: 100 })).toEqual([]);
		expect(
			fieldsOf({
				numberDigits: 1,
				maxNumber: 1,
				associatedNumberOffset: 0,
				overflowPolicy: 'reject'
			})
		).toEqual([]);
	});

	it.each([0, -1, 4.5, Number.NaN])('rejects numberDigits = %s', (numberDigits) => {
		expect(fieldsOf({ ...FOUR_DIGITS, numberDigits })).toContain('numberDigits');
	});

	it('caps numberDigits at MAX_NUMBER_DIGITS (10: max_number is a Postgres integer)', () => {
		expect(MAX_NUMBER_DIGITS).toBe(10);
		const tenDigits: CampaignNumberingConfig = {
			numberDigits: 10,
			maxNumber: 2147483647,
			associatedNumberOffset: 0,
			overflowPolicy: 'reject'
		};
		expect(validateNumberingConfig(tenDigits)).toEqual([]);
		expect(fieldsOf({ ...tenDigits, numberDigits: 11 })).toEqual(['numberDigits']);
		expect(validateNumberingConfig({ ...tenDigits, numberDigits: 11 })).toEqual([
			{ field: 'numberDigits', message: 'numberDigits must not exceed 10' }
		]);
	});

	it('rejects a huge numberDigits instead of accepting any maxNumber (reviewer case)', () => {
		const config: CampaignNumberingConfig = {
			numberDigits: 2147483647,
			maxNumber: 1,
			associatedNumberOffset: 0,
			overflowPolicy: 'reject'
		};
		expect(fieldsOf(config)).toEqual(['numberDigits']);
		expectNumberingError(() => formatCampaignNumber(1, config), 'invalid_config');
	});

	it.each([0, -1, 99.5, Number.NaN])('rejects maxNumber = %s', (maxNumber) => {
		expect(fieldsOf({ ...FOUR_DIGITS, maxNumber, associatedNumberOffset: 0 })).toContain(
			'maxNumber'
		);
	});

	it('rejects a maxNumber that does not fit in numberDigits (max_number < 10^number_digits)', () => {
		expect(fieldsOf({ ...FOUR_DIGITS, maxNumber: 10000 })).toEqual(['maxNumber']);
		expect(fieldsOf({ ...FIVE_DIGITS, maxNumber: 100000 })).toEqual(['maxNumber']);
	});

	it.each([-1, 1.5, Number.NaN])('rejects associatedNumberOffset = %s', (offset) => {
		expect(fieldsOf({ ...FOUR_DIGITS, associatedNumberOffset: offset })).toEqual([
			'associatedNumberOffset'
		]);
	});

	it('rejects an offset greater than maxNumber', () => {
		expect(fieldsOf({ ...FOUR_DIGITS, associatedNumberOffset: 10000 })).toEqual([
			'associatedNumberOffset'
		]);
	});

	it('rejects an unknown overflow policy', () => {
		const config = { ...FOUR_DIGITS, overflowPolicy: 'wrap' } as unknown as CampaignNumberingConfig;
		expect(fieldsOf(config)).toEqual(['overflowPolicy']);
	});

	it('reports every problem at once', () => {
		const config = {
			numberDigits: 0,
			maxNumber: -5,
			associatedNumberOffset: -1,
			overflowPolicy: 'truncate'
		} as unknown as CampaignNumberingConfig;
		expect(fieldsOf(config)).toEqual([
			'numberDigits',
			'maxNumber',
			'associatedNumberOffset',
			'overflowPolicy'
		]);
	});

	it('assertValidNumberingConfig throws invalid_config with all messages', () => {
		expect(() => assertValidNumberingConfig(FOUR_DIGITS)).not.toThrow();
		const bad = { ...FOUR_DIGITS, maxNumber: 10000, associatedNumberOffset: -1 };
		expectNumberingError(() => assertValidNumberingConfig(bad), 'invalid_config');
		expect(() => assertValidNumberingConfig(bad)).toThrow(/maxNumber.*associatedNumberOffset/);
	});
});
