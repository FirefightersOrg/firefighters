import { describe, expect, it } from 'vitest';
import {
	bondAnnulSchema,
	bondCreatePataSchema,
	bondCreateSimpleSchema,
	bondFieldErrors,
	bondGroupSchema,
	bondUngroupSchema
} from './bond';
import { DEFAULT_NUMBERING_CONFIG, type CampaignNumberingConfig } from '$lib/domain/numbering';

const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';
const BOND_A = 'e0000000-0000-0000-0000-00000000000a';
const BOND_B = 'e0000000-0000-0000-0000-00000000000b';
const FOUR = DEFAULT_NUMBERING_CONFIG;
const FIVE: CampaignNumberingConfig = {
	...DEFAULT_NUMBERING_CONFIG,
	numberDigits: 5,
	maxNumber: 99999
};

const base = { campaignId: CAMPAIGN_ID, internalCode: '', barcode: '', reason: '' };

function errorsOf(result: { success: boolean; error?: import('zod').ZodError }) {
	expect(result.success).toBe(false);
	return bondFieldErrors(result.error!);
}

describe('bondCreateSimpleSchema', () => {
	it('parses a padded number and normalizes codes', () => {
		expect(
			bondCreateSimpleSchema(FOUR).parse({
				...base,
				baseNumber: ' 0068 ',
				internalCode: '  INT-1 ',
				barcode: 'BC-1'
			})
		).toEqual({
			campaignId: CAMPAIGN_ID,
			baseNumbers: [68],
			internalCode: 'INT-1',
			barcode: 'BC-1',
			reason: null
		});
	});

	it('uses the campaign digit count (5 digits accepts 00068 and 95128)', () => {
		expect(
			bondCreateSimpleSchema(FIVE).parse({ ...base, baseNumber: '00068' }).baseNumbers
		).toEqual([68]);
		expect(
			bondCreateSimpleSchema(FIVE).parse({ ...base, baseNumber: '95128' }).baseNumbers
		).toEqual([95128]);
		expect(
			errorsOf(bondCreateSimpleSchema(FOUR).safeParse({ ...base, baseNumber: '00068' })).baseNumber
		).toEqual(['«00068» no es un número válido (usar hasta 4 dígitos)']);
	});

	it.each([
		['', 'El número base es obligatorio'],
		['abc', '«abc» no es un número válido (usar hasta 4 dígitos)'],
		['-1', '«-1» no es un número válido (usar hasta 4 dígitos)'],
		[
			'5129',
			'El número base 5129 desborda: su número asociado 10000 supera el número máximo de la campaña 9999 (el número base más alto permitido es 5128)'
		]
	])('rejects base number %j', (baseNumber, message) => {
		expect(
			errorsOf(bondCreateSimpleSchema(FOUR).safeParse({ ...base, baseNumber })).baseNumber
		).toEqual([message]);
	});

	it('rejects a number above max_number for a narrower max', () => {
		const config = { ...FOUR, maxNumber: 5000, associatedNumberOffset: 100 };
		expect(
			errorsOf(bondCreateSimpleSchema(config).safeParse({ ...base, baseNumber: '6000' })).baseNumber
		).toEqual(['El número 6000 supera el número máximo de la campaña 5000']);
	});

	it('rejects an unknown campaign id and long codes', () => {
		const errors = errorsOf(
			bondCreateSimpleSchema(FOUR).safeParse({
				...base,
				campaignId: 'nope',
				baseNumber: '1',
				barcode: 'x'.repeat(101)
			})
		);
		expect(errors.campaignId).toEqual(['Campaña desconocida']);
		expect(errors.barcode).toEqual(['El código de barras admite hasta 100 caracteres']);
	});
});

describe('bondCreatePataSchema', () => {
	it('accepts several values or one separated text, ignoring blanks', () => {
		const expected = [100, 200, 300];
		expect(
			bondCreatePataSchema(FOUR).parse({ ...base, baseNumbers: ['0100', '', '200', '0300'] })
				.baseNumbers
		).toEqual(expected);
		expect(
			bondCreatePataSchema(FOUR).parse({ ...base, baseNumbers: '0100, 0200;\n300' }).baseNumbers
		).toEqual(expected);
	});

	it('requires at least two base numbers', () => {
		expect(
			errorsOf(bondCreatePataSchema(FOUR).safeParse({ ...base, baseNumbers: ['0068', ' '] }))
				.baseNumbers
		).toEqual(['Una pata necesita al menos 2 números base']);
	});

	it('rejects numbers repeated inside the pata (base or associated)', () => {
		expect(
			errorsOf(bondCreatePataSchema(FOUR).safeParse({ ...base, baseNumbers: '5 5' })).baseNumbers
		).toEqual([
			'El número 0005 aparece más de una vez en este bono (2 como base, 0 como asociado)'
		]);
		expect(
			errorsOf(bondCreatePataSchema(FOUR).safeParse({ ...base, baseNumbers: '10 4881' }))
				.baseNumbers
		).toEqual([
			'El número 4881 aparece más de una vez en este bono (1 como base, 1 como asociado)'
		]);
	});

	it('reports every malformed number', () => {
		expect(
			errorsOf(bondCreatePataSchema(FOUR).safeParse({ ...base, baseNumbers: 'x 1 y' })).baseNumbers
		).toEqual([
			'«x» no es un número válido (usar hasta 4 dígitos)',
			'«y» no es un número válido (usar hasta 4 dígitos)'
		]);
	});
});

describe('bondGroupSchema', () => {
	it('parses two member ids', () => {
		expect(
			bondGroupSchema.parse({ ...base, memberBondIds: [BOND_A, BOND_B], reason: ' Together ' })
		).toEqual({
			campaignId: CAMPAIGN_ID,
			memberBondIds: [BOND_A, BOND_B],
			internalCode: null,
			barcode: null,
			reason: 'Together'
		});
	});

	it.each([
		[[BOND_A], 'Una pata necesita al menos 2 bonos simples'],
		[[BOND_A, BOND_A.toUpperCase()], 'Un bono figura más de una vez']
	])('rejects %j', (memberBondIds, message) => {
		expect(errorsOf(bondGroupSchema.safeParse({ ...base, memberBondIds })).memberBondIds).toEqual([
			message
		]);
	});

	it('rejects malformed ids', () => {
		expect(bondGroupSchema.safeParse({ ...base, memberBondIds: [BOND_A, 'nope'] }).success).toBe(
			false
		);
	});
});

describe('bondUngroupSchema / bondAnnulSchema', () => {
	it('require a reason', () => {
		expect(
			errorsOf(bondUngroupSchema.safeParse({ pataBondId: BOND_A, reason: '  ' })).reason
		).toEqual(['Se requiere un motivo para desagrupar una pata']);
		expect(errorsOf(bondAnnulSchema.safeParse({ bondId: BOND_A, reason: '' })).reason).toEqual([
			'Se requiere un motivo para anular un bono'
		]);
	});

	it('trim the reason', () => {
		expect(bondUngroupSchema.parse({ pataBondId: BOND_A, reason: ' Mistake ' })).toEqual({
			pataBondId: BOND_A,
			reason: 'Mistake'
		});
		expect(bondAnnulSchema.parse({ bondId: BOND_B, reason: ' Mistake ' })).toEqual({
			bondId: BOND_B,
			reason: 'Mistake'
		});
	});

	it('reject long reasons and unknown ids', () => {
		const errors = errorsOf(bondAnnulSchema.safeParse({ bondId: 'x', reason: 'r'.repeat(1001) }));
		expect(errors.bondId).toEqual(['Bono desconocido']);
		expect(errors.reason).toEqual(['El motivo admite hasta 1000 caracteres']);
	});
});
