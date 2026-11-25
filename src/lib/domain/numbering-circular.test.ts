import { describe, expect, it } from 'vitest';
import {
	DEFAULT_NUMBERING_CONFIG,
	NumberingError,
	associatedNumberFor,
	associatedNumberRuleText,
	calculateAssociatedNumber,
	getMaxValidBaseNumber,
	validateNoOverflow,
	validateNumberingConfig,
	type CampaignNumberingConfig
} from './numbering';
import { buildNumberingPreview } from './numbering-preview';

// SAN-151: the real case, 5000 bonds (bases 0..4999) covering the lottery range 0000-9999.
const CIRCULAR: CampaignNumberingConfig = {
	numberDigits: 4,
	maxNumber: 9999,
	associatedNumberOffset: 4871,
	associatedNumberMode: 'circular',
	overflowPolicy: 'reject'
};
const LINEAR: CampaignNumberingConfig = { ...DEFAULT_NUMBERING_CONFIG };

function errorCode(fn: () => unknown): string | undefined {
	try {
		fn();
	} catch (error) {
		if (error instanceof NumberingError) return error.code;
		throw error;
	}
	return undefined;
}

describe('circular associated number mode', () => {
	it.each([
		[129, 5000],
		[436, 5307],
		[68, 9939],
		[0, 9871],
		[128, 9999],
		[4999, 9870]
	])('base %i gives the associated number %i', (base, associated) => {
		expect(calculateAssociatedNumber(base, CIRCULAR)).toBe(associated);
		expect(associatedNumberFor(base, CIRCULAR)).toBe(associated);
	});

	it('covers B..2B-1 exactly once for the 5000 bases, with no collision with a base', () => {
		const associated = Array.from({ length: 5000 }, (_, base) =>
			calculateAssociatedNumber(base, CIRCULAR)
		);
		expect(new Set(associated).size).toBe(5000);
		expect(Math.min(...associated)).toBe(5000);
		expect(Math.max(...associated)).toBe(9999);
	});

	it('covers the whole range for a small B and every offset', () => {
		for (let offset = 0; offset < 5; offset++) {
			const config = { ...CIRCULAR, numberDigits: 1, maxNumber: 9, associatedNumberOffset: offset };
			const all = [0, 1, 2, 3, 4].flatMap((base) => [
				base,
				calculateAssociatedNumber(base, config)
			]);
			expect([...all].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		}
	});

	it('keeps the linear mode untouched', () => {
		expect(calculateAssociatedNumber(68, LINEAR)).toBe(4939);
		expect(associatedNumberFor(5129, LINEAR)).toBe(10000);
		expect(errorCode(() => calculateAssociatedNumber(5129, LINEAR))).toBe('overflow');
	});

	it('rejects a base from B up (no associated number)', () => {
		expect(associatedNumberFor(5000, CIRCULAR)).toBeNull();
		expect(associatedNumberFor(-1, CIRCULAR)).toBeNull();
		expect(errorCode(() => calculateAssociatedNumber(5000, CIRCULAR))).toBe('out_of_range');
		expect(validateNoOverflow(4999, CIRCULAR)).toBe(true);
		expect(validateNoOverflow(5000, CIRCULAR)).toBe(false);
		expect(getMaxValidBaseNumber(CIRCULAR)).toBe(4999);
	});

	it('validates the circular limits like the table CHECKs', () => {
		expect(validateNumberingConfig(CIRCULAR)).toEqual([]);
		expect(validateNumberingConfig({ ...CIRCULAR, associatedNumberOffset: 4999 })).toEqual([]);
		expect(validateNumberingConfig({ ...CIRCULAR, maxNumber: 9998 })).toEqual([
			expect.objectContaining({ field: 'maxNumber' })
		]);
		expect(validateNumberingConfig({ ...CIRCULAR, associatedNumberOffset: 5000 })).toEqual([
			expect.objectContaining({ field: 'associatedNumberOffset' })
		]);
		expect(
			validateNumberingConfig({
				...CIRCULAR,
				associatedNumberMode: 'spiral' as CampaignNumberingConfig['associatedNumberMode']
			})
		).toEqual([expect.objectContaining({ field: 'associatedNumberMode' })]);
		// The circular limits do not apply to linear (an even max and a large offset are fine).
		expect(
			validateNumberingConfig({ ...LINEAR, maxNumber: 9998, associatedNumberOffset: 5000 })
		).toEqual([]);
	});

	it('describes the formula for the UI', () => {
		expect(associatedNumberRuleText(CIRCULAR)).toBe('5000 + ((base + 4871) mod 5000)');
		expect(associatedNumberRuleText(LINEAR)).toBe('base + 4871');
	});
});

describe('circular numbering preview', () => {
	it('shows the pairs that reach the top of the range and restart at B', () => {
		const preview = buildNumberingPreview(CIRCULAR);
		if (!preview.ok) throw new Error('expected a valid preview');
		expect(preview.examples.map((e) => `${e.baseFormatted} → ${e.associatedFormatted}`)).toEqual([
			'0000 → 9871',
			'0068 → 9939',
			'0128 → 9999',
			'0129 → 5000',
			'1658 → 6529',
			'4999 → 9870'
		]);
		expect(preview.mode).toBe('circular');
		expect(preview.blockSize).toBe(5000);
		expect(preview.usableBaseCount).toBe(5000);
		expect(preview.associatedRange).toEqual({ from: '5000', to: '9999' });
		expect(preview.overflowExample).toBeNull();
	});

	it('reports the circular problems instead of a preview', () => {
		const preview = buildNumberingPreview({ ...CIRCULAR, maxNumber: 9998 });
		expect(preview.ok).toBe(false);
	});

	it('does not change the linear preview', () => {
		const preview = buildNumberingPreview(LINEAR);
		if (!preview.ok) throw new Error('expected a valid preview');
		expect(preview.mode).toBe('linear');
		expect(preview.blockSize).toBeNull();
		expect(preview.associatedRange).toBeNull();
		expect(preview.overflowExample).not.toBeNull();
	});
});
