import { describe, expect, it } from 'vitest';
import { bondCreateSimpleSchema, bondFieldErrors } from '$lib/schemas/bond';
import { previewBaseNumber } from './bond-preview';
import { DEFAULT_NUMBERING_CONFIG, type CampaignNumberingConfig } from './numbering';

const FOUR: CampaignNumberingConfig = DEFAULT_NUMBERING_CONFIG;
const FIVE: CampaignNumberingConfig = {
	numberDigits: 5,
	maxNumber: 99999,
	associatedNumberOffset: 48710,
	associatedNumberMode: 'linear',
	overflowPolicy: 'reject'
};
const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';

describe('previewBaseNumber', () => {
	it('is empty for a blank input', () => {
		expect(previewBaseNumber('', FOUR)).toEqual({ state: 'empty' });
		expect(previewBaseNumber('   ', FOUR)).toEqual({ state: 'empty' });
	});

	it('pads the base and computes the associated number (4 digits, offset 4871)', () => {
		const expected = {
			state: 'ok',
			base: 68,
			baseFormatted: '0068',
			associated: 4939,
			associatedFormatted: '4939'
		};
		expect(previewBaseNumber('0068', FOUR)).toEqual(expected);
		expect(previewBaseNumber(' 68 ', FOUR)).toEqual(expected);
		expect(previewBaseNumber('0', FOUR)).toMatchObject({
			baseFormatted: '0000',
			associatedFormatted: '4871'
		});
		expect(previewBaseNumber('5128', FOUR)).toMatchObject({ associatedFormatted: '9999' });
	});

	it('works for a 5-digit campaign', () => {
		expect(previewBaseNumber('68', FIVE)).toMatchObject({
			state: 'ok',
			baseFormatted: '00068',
			associatedFormatted: '48778'
		});
	});

	it('explains an overflow with the highest allowed base number', () => {
		expect(previewBaseNumber('5129', FOUR)).toEqual({
			state: 'invalid',
			problem: 'overflow',
			message:
				'El número base 5129 desborda: su número asociado 10000 supera el número máximo de la campaña ' +
				'9999 (el número base más alto permitido es 5128)'
		});
	});

	it('rejects malformed input and too many digits', () => {
		for (const input of ['abc', '12345', '-1', '1.5']) {
			expect(previewBaseNumber(input, FOUR)).toMatchObject({
				state: 'invalid',
				problem: 'invalid_format'
			});
		}
		expect(previewBaseNumber('12345', FOUR)).toMatchObject({
			message: '«12345» no es un número válido (usar hasta 4 dígitos)'
		});
	});

	it('rejects a number above the campaign maximum', () => {
		const config = { ...FOUR, maxNumber: 6000, associatedNumberOffset: 100 };
		expect(previewBaseNumber('7000', config)).toEqual({
			state: 'invalid',
			problem: 'out_of_range',
			message: 'El número 7000 supera el número máximo de la campaña 6000'
		});
	});

	it('flags a number repeated in its own bond (offset 0)', () => {
		expect(previewBaseNumber('5', { ...FOUR, associatedNumberOffset: 0 })).toMatchObject({
			state: 'invalid',
			problem: 'repeated'
		});
	});

	it('says exactly what the server-side schema says', () => {
		const config = { ...FOUR, maxNumber: 6000, associatedNumberOffset: 100 };
		for (const input of ['abc', '12345', '7000', '5901', '0068']) {
			const preview = previewBaseNumber(input, config);
			const parsed = bondCreateSimpleSchema(config).safeParse({
				campaignId: CAMPAIGN_ID,
				baseNumber: input,
				internalCode: '',
				barcode: '',
				reason: ''
			});
			if (preview.state === 'ok') {
				expect(parsed.success).toBe(true);
			} else {
				expect(parsed.success).toBe(false);
				if (!parsed.success) {
					expect(bondFieldErrors(parsed.error).baseNumber).toEqual([
						(preview as { message: string }).message
					]);
				}
			}
		}
	});
});
