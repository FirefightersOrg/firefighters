import { describe, expect, it } from 'vitest';
import { DEFAULT_NUMBERING_CONFIG, type CampaignNumberingConfig } from './numbering';
import { buildNumberingPreview } from './numbering-preview';

const config = (overrides: Partial<CampaignNumberingConfig>): CampaignNumberingConfig => ({
	...DEFAULT_NUMBERING_CONFIG,
	...overrides
});

function okPreview(c: CampaignNumberingConfig) {
	const preview = buildNumberingPreview(c);
	if (!preview.ok) throw new Error(`expected a valid preview: ${JSON.stringify(preview.issues)}`);
	return preview;
}

const rows = (preview: ReturnType<typeof okPreview>) =>
	preview.examples.map((e) => `${e.baseFormatted} → ${e.associatedFormatted}`);

describe('buildNumberingPreview', () => {
	it('MVP config (4 digits, max 9999, offset 4871)', () => {
		const preview = okPreview(DEFAULT_NUMBERING_CONFIG);
		expect(rows(preview)).toEqual(['0000 → 4871', '0068 → 4939', '1658 → 6529', '5128 → 9999']);
		expect(preview.maxValidBase).toEqual({
			base: 5128,
			baseFormatted: '5128',
			associated: 9999,
			associatedFormatted: '9999'
		});
		expect(preview.usableBaseCount).toBe(5129);
		expect(preview.overflowExample).toEqual({
			base: 5129,
			baseFormatted: '5129',
			associated: 10000,
			maxNumber: 9999
		});
	});

	it('5 digits keeps the same offset but pads to 5 (00068 → 04939)', () => {
		const preview = okPreview(config({ numberDigits: 5, maxNumber: 99999 }));
		expect(rows(preview)).toEqual([
			'00000 → 04871',
			'00068 → 04939',
			'01658 → 06529',
			'95128 → 99999'
		]);
		expect(preview.usableBaseCount).toBe(95129);
		expect(preview.overflowExample).toMatchObject({
			base: 95129,
			baseFormatted: '95129',
			associated: 100000
		});
	});

	it('5 digits with a 4-digit maximum', () => {
		const preview = okPreview(config({ numberDigits: 5, maxNumber: 9999 }));
		expect(rows(preview)).toEqual([
			'00000 → 04871',
			'00068 → 04939',
			'01658 → 06529',
			'05128 → 09999'
		]);
	});

	it('drops sample bases above the highest usable base', () => {
		const preview = okPreview(
			config({ numberDigits: 3, maxNumber: 999, associatedNumberOffset: 900 })
		);
		expect(rows(preview)).toEqual(['000 → 900', '068 → 968', '099 → 999']);
		expect(preview.usableBaseCount).toBe(100);
		expect(preview.overflowExample).toMatchObject({ base: 100, associated: 1000 });
	});

	it('shows the highest base once when it equals a sample', () => {
		const preview = okPreview(config({ maxNumber: 9999, associatedNumberOffset: 9999 - 68 }));
		expect(rows(preview)).toEqual(['0000 → 9931', '0068 → 9999']);
	});

	it('offset equal to the maximum: only base 0 is usable', () => {
		const preview = okPreview(
			config({ numberDigits: 2, maxNumber: 50, associatedNumberOffset: 50 })
		);
		expect(rows(preview)).toEqual(['00 → 50']);
		expect(preview.usableBaseCount).toBe(1);
		expect(preview.overflowExample).toEqual({
			base: 1,
			baseFormatted: '01',
			associated: 51,
			maxNumber: 50
		});
	});

	it('offset 0: every number is usable and nothing overflows', () => {
		const preview = okPreview(config({ associatedNumberOffset: 0 }));
		expect(rows(preview)).toEqual(['0000 → 0000', '0068 → 0068', '1658 → 1658', '9999 → 9999']);
		expect(preview.usableBaseCount).toBe(10000);
		expect(preview.overflowExample).toBeNull();
	});

	it('returns the configuration problems instead of throwing', () => {
		expect(buildNumberingPreview(config({ maxNumber: 10000 }))).toEqual({
			ok: false,
			issues: [{ field: 'maxNumber', message: 'maxNumber must fit in 4 digits (at most 9999)' }]
		});
		expect(buildNumberingPreview(config({ associatedNumberOffset: 10000 }))).toEqual({
			ok: false,
			issues: [
				{
					field: 'associatedNumberOffset',
					message: 'associatedNumberOffset must not exceed maxNumber (9999)'
				}
			]
		});
		const many = buildNumberingPreview({
			numberDigits: 0,
			maxNumber: Number.NaN,
			associatedNumberOffset: -1,
			overflowPolicy: 'wrap' as 'reject'
		});
		expect(many.ok).toBe(false);
		expect(many.ok ? [] : many.issues.map((issue) => issue.field)).toEqual([
			'numberDigits',
			'maxNumber',
			'associatedNumberOffset',
			'overflowPolicy'
		]);
	});
});
