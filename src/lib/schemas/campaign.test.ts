import { describe, expect, it } from 'vitest';
import {
	campaignCreateSchema,
	campaignFieldErrors,
	campaignGeneralSchema,
	campaignNumberingSchema,
	campaignRulesSchema,
	campaignTransitionSchema,
	readFormFields,
	CAMPAIGN_CREATE_FIELDS
} from './campaign';

const rules = {
	simpleBondValue: '60000',
	installmentCount: '10',
	numberDigits: '4',
	maxNumber: '9999',
	associatedNumberOffset: '4871',
	overflowPolicy: 'reject',
	barcodeMode: 'base_number'
};
const general = { name: '  Campaign 2027 ', startsOn: '2027-03-01', endsOn: '2027-12-31' };

function errorsOf(result: { success: boolean; error?: unknown }) {
	expect(result.success).toBe(false);
	return campaignFieldErrors(result.error as Parameters<typeof campaignFieldErrors>[0]);
}

describe('campaignCreateSchema', () => {
	it('parses a valid form into RPC-ready values', () => {
		const result = campaignCreateSchema.parse({ ...general, ...rules });
		expect(result).toEqual({
			name: 'Campaign 2027',
			startsAt: '2027-03-01T00:00:00-03:00',
			endsAt: '2027-12-31T23:59:59-03:00',
			simpleBondValue: '60000.00',
			installmentCount: 10,
			installmentValue: '6000.00',
			numberDigits: 4,
			maxNumber: 9999,
			associatedNumberOffset: 4871,
			overflowPolicy: 'reject',
			barcodeMode: 'base_number'
		});
	});

	it('allows a draft without dates', () => {
		const result = campaignCreateSchema.parse({ ...general, startsOn: '', endsOn: '', ...rules });
		expect(result.startsAt).toBeNull();
		expect(result.endsAt).toBeNull();
	});

	it('keeps cents exact', () => {
		const result = campaignCreateSchema.parse({
			...general,
			...rules,
			simpleBondValue: '100.02',
			installmentCount: '2'
		});
		expect(result.simpleBondValue).toBe('100.02');
		expect(result.installmentValue).toBe('50.01');
	});

	it('rejects a value that does not divide exactly into the installments', () => {
		const errors = errorsOf(
			campaignCreateSchema.safeParse({ ...general, ...rules, installmentCount: '7' })
		);
		expect(errors.installmentCount).toEqual([
			'60,000.00 cannot be split into 7 equal installments. ' +
				'Choose a value and a number of installments that divide exactly (to the cent).'
		]);
	});

	it('rejects 100 in 3 installments (33.33 x 3 != 100)', () => {
		const errors = errorsOf(
			campaignCreateSchema.safeParse({
				...general,
				...rules,
				simpleBondValue: '100',
				installmentCount: '3'
			})
		);
		expect(errors.installmentCount?.[0]).toMatch(/cannot be split into 3 equal installments/);
	});

	it.each([
		['simpleBondValue', '0', 'Simple bond value must be greater than 0'],
		[
			'simpleBondValue',
			'60000.001',
			'Enter an amount with at most 2 decimals, e.g. 60000 or 60000.50'
		],
		[
			'simpleBondValue',
			'60.000',
			'Enter an amount with at most 2 decimals, e.g. 60000 or 60000.50'
		],
		['simpleBondValue', '', 'Simple bond value is required'],
		['installmentCount', '0', 'Number of installments must be at least 1'],
		['installmentCount', '2.5', 'Number of installments must be a whole number'],
		['numberDigits', '11', 'Number of digits must be at most 10'],
		['maxNumber', '-1', 'Maximum number must be a whole number'],
		['barcodeMode', '', 'Choose how barcodes are read'],
		['barcodeMode', 'qr', 'Choose how barcodes are read']
	])('rejects %s = %j', (field, value, message) => {
		const errors = errorsOf(
			campaignCreateSchema.safeParse({ ...general, ...rules, [field]: value })
		);
		expect(errors[field]).toEqual([message]);
	});

	it('validates numbering with the domain rules', () => {
		const tooWide = errorsOf(
			campaignCreateSchema.safeParse({ ...general, ...rules, maxNumber: '10000' })
		);
		expect(tooWide.maxNumber).toEqual(['Maximum number must fit in 4 digits (at most 9999)']);

		const offset = errorsOf(
			campaignCreateSchema.safeParse({
				...general,
				...rules,
				associatedNumberOffset: '10000',
				maxNumber: '9999'
			})
		);
		expect(offset.associatedNumberOffset).toEqual([
			'Associated number offset must not exceed maximum number (9999)'
		]);

		const policy = errorsOf(
			campaignCreateSchema.safeParse({ ...general, ...rules, overflowPolicy: 'wrap' })
		);
		expect(policy.overflowPolicy).toEqual(['Overflow policy must be one of: reject']);
	});

	it('accepts a 5-digit configuration', () => {
		const result = campaignCreateSchema.parse({
			...general,
			...rules,
			numberDigits: '5',
			maxNumber: '99999'
		});
		expect(result.numberDigits).toBe(5);
		expect(result.maxNumber).toBe(99999);
	});

	it('rejects a blank name and reversed dates', () => {
		const errors = errorsOf(
			campaignCreateSchema.safeParse({
				...rules,
				name: '   ',
				startsOn: '2027-12-31',
				endsOn: '2027-03-01'
			})
		);
		expect(errors.name).toEqual(['Name is required']);
	});
});

describe('campaignGeneralSchema', () => {
	it('allows a one-day campaign and rejects an end before the start', () => {
		expect(
			campaignGeneralSchema.parse({ name: 'One day', startsOn: '2027-03-01', endsOn: '2027-03-01' })
		).toEqual({
			name: 'One day',
			startsAt: '2027-03-01T00:00:00-03:00',
			endsAt: '2027-03-01T23:59:59-03:00'
		});
		const errors = errorsOf(
			campaignGeneralSchema.safeParse({ name: 'X', startsOn: '2027-03-02', endsOn: '2027-03-01' })
		);
		expect(errors.endsOn).toEqual(['End date must be on or after the start date']);
	});

	it('rejects malformed dates', () => {
		const errors = errorsOf(
			campaignGeneralSchema.safeParse({ name: 'X', startsOn: '2027-02-30', endsOn: 'tomorrow' })
		);
		expect(errors.startsOn).toEqual(['Start date must be a valid date (YYYY-MM-DD)']);
		expect(errors.endsOn).toEqual(['End date must be a valid date (YYYY-MM-DD)']);
	});
});

describe('campaignRulesSchema / campaignNumberingSchema', () => {
	it('recomputes the installment value', () => {
		const result = campaignRulesSchema.parse({ ...rules, installmentCount: '12' });
		expect(result.installmentValue).toBe('5000.00');
	});

	it('validates the numbering inputs on their own (for previews)', () => {
		expect(
			campaignNumberingSchema.parse({
				numberDigits: '4',
				maxNumber: '9999',
				associatedNumberOffset: '4871',
				overflowPolicy: 'reject'
			})
		).toEqual({
			numberDigits: 4,
			maxNumber: 9999,
			associatedNumberOffset: 4871,
			overflowPolicy: 'reject'
		});
		expect(
			campaignNumberingSchema.safeParse({
				numberDigits: '4',
				maxNumber: '99999',
				associatedNumberOffset: '4871',
				overflowPolicy: 'reject'
			}).success
		).toBe(false);
	});
});

describe('campaignTransitionSchema', () => {
	it('accepts the four target statuses', () => {
		for (const toStatus of ['active', 'closing', 'closed']) {
			expect(campaignTransitionSchema.parse({ toStatus, reason: '' })).toEqual({
				toStatus,
				reason: null
			});
		}
		expect(campaignTransitionSchema.parse({ toStatus: 'annulled', reason: '  Mistake ' })).toEqual({
			toStatus: 'annulled',
			reason: 'Mistake'
		});
	});

	it('requires a reason to annul', () => {
		const errors = errorsOf(
			campaignTransitionSchema.safeParse({ toStatus: 'annulled', reason: '  ' })
		);
		expect(errors.reason).toEqual(['A reason is required to annul a campaign']);
	});

	it('rejects unknown targets (draft is never a target)', () => {
		const errors = errorsOf(campaignTransitionSchema.safeParse({ toStatus: 'draft', reason: '' }));
		expect(errors.toStatus).toEqual(['Unknown status change']);
	});
});

describe('readFormFields', () => {
	it('reads strings and turns missing or file values into empty strings', () => {
		const formData = new FormData();
		formData.set('name', 'Campaign');
		formData.set('barcodeMode', new Blob(['x']));
		const values = readFormFields(formData, CAMPAIGN_CREATE_FIELDS);
		expect(values.name).toBe('Campaign');
		expect(values.barcodeMode).toBe('');
		expect(values.simpleBondValue).toBe('');
		expect(Object.keys(values)).toEqual([...CAMPAIGN_CREATE_FIELDS]);
	});
});
