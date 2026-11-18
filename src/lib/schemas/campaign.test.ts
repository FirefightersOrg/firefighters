import { describe, expect, it } from 'vitest';
import {
	campaignCreateSchema,
	campaignFieldErrors,
	campaignGeneralSchema,
	campaignNumberingSchema,
	campaignRulesSchema,
	campaignRulesUpdateSchema,
	campaignTransitionSchema,
	campaignVersionSchema,
	previewNumberingInput,
	readFormFields,
	CAMPAIGN_CREATE_FIELDS,
	CAMPAIGN_GENERAL_UPDATE_FIELDS,
	CAMPAIGN_RULES_UPDATE_FIELDS,
	CAMPAIGN_REASON_MAX_LENGTH,
	CAMPAIGN_VERSION_INVALID_MESSAGE,
	MAX_CAMPAIGN_NUMBER,
	MAX_NUMBER_DIGITS
} from './campaign';
import {
	MAX_CAMPAIGN_NUMBER as DOMAIN_MAX_CAMPAIGN_NUMBER,
	MAX_NUMBER_DIGITS as DOMAIN_MAX_NUMBER_DIGITS
} from '$lib/domain/numbering';

const NBSP = '\u00a0';
const MONEY_FORMAT_ERROR =
	'Enter an amount like 60.000 or 60.000,50 (dots for thousands, comma for up to 2 decimals)';

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
/** updated_at as PostgREST returns it (microseconds, explicit offset). */
const VERSION = '2026-11-17T01:02:03.123456+00:00';

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
			barcodeMode: 'base_number',
			barcodePattern: null
		});
	});

	it('takes a barcode pattern only for the internal / external code modes (SAN-44)', () => {
		const withPattern = campaignCreateSchema.parse({
			...general,
			...rules,
			barcodeMode: 'external_legacy_code',
			barcodePattern: '  ^LEG(\\d+)$ '
		});
		expect(withPattern.barcodePattern).toBe('^LEG(\\d+)$');
		const blank = campaignCreateSchema.parse({
			...general,
			...rules,
			barcodeMode: 'internal_code',
			barcodePattern: '   '
		});
		expect(blank.barcodePattern).toBeNull();
		const wrongMode = campaignCreateSchema.safeParse({
			...general,
			...rules,
			barcodePattern: '^(\\d+)$'
		});
		expect(wrongMode.success).toBe(false);
		if (!wrongMode.success) {
			expect(campaignFieldErrors(wrongMode.error).barcodePattern?.[0]).toMatch(
				/only used with the internal or external\/legacy code modes/
			);
		}
	});

	it('counts the barcode pattern in code points, like Postgres (SAN-44)', () => {
		// 101 emoji + "(\d+)" is 106 code points but 209 UTF-16 units: the database accepts it,
		// so the client must accept it too.
		const emojiHeavy = `${'😀'.repeat(101)}(\\d+)`;
		expect([...emojiHeavy].length).toBe(106);
		const parsed = campaignCreateSchema.parse({
			...general,
			...rules,
			barcodeMode: 'internal_code',
			barcodePattern: emojiHeavy
		});
		expect(parsed.barcodePattern).toBe(emojiHeavy);
		const atLimit = `${'😀'.repeat(195)}(\\d+)`;
		expect([...atLimit].length).toBe(200);
		expect(
			campaignCreateSchema.parse({
				...general,
				...rules,
				barcodeMode: 'internal_code',
				barcodePattern: atLimit
			}).barcodePattern
		).toBe(atLimit);
		const overLimit = `${'😀'.repeat(196)}(\\d+)`;
		expect([...overLimit].length).toBe(201);
		const tooLong = campaignCreateSchema.safeParse({
			...general,
			...rules,
			barcodeMode: 'internal_code',
			barcodePattern: overLimit
		});
		expect(tooLong.success).toBe(false);
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

	it.each([
		['60.000,00', '60000.00', '6000.00'],
		['60.000', '60000.00', '6000.00'],
		['60000,50', '60000.50', '6000.05'],
		['60.000,5', '60000.50', '6000.05'],
		['60000.50', '60000.50', '6000.05'],
		[`$${NBSP}60.000,00`, '60000.00', '6000.00']
	])('accepts Argentine money input %j (canonical %s, installment %s)', (input, total, each) => {
		const result = campaignCreateSchema.parse({ ...general, ...rules, simpleBondValue: input });
		expect(result.simpleBondValue).toBe(total);
		expect(result.installmentValue).toBe(each);
	});

	it('rejects 60.000,00 in 7 installments (not exact to the cent)', () => {
		const errors = errorsOf(
			campaignCreateSchema.safeParse({
				...general,
				...rules,
				simpleBondValue: '60.000,00',
				installmentCount: '7'
			})
		);
		expect(errors.installmentCount?.[0]).toMatch(/^\$\u00a060\.000,00 cannot be split into 7/);
	});

	it('rejects a value that does not divide exactly into the installments', () => {
		const errors = errorsOf(
			campaignCreateSchema.safeParse({ ...general, ...rules, installmentCount: '7' })
		);
		expect(errors.installmentCount).toEqual([
			`$${NBSP}60.000,00 cannot be split into 7 equal installments. ` +
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
		['simpleBondValue', '60000.001', MONEY_FORMAT_ERROR],
		['simpleBondValue', '60,000', MONEY_FORMAT_ERROR],
		['simpleBondValue', '60.000,505', MONEY_FORMAT_ERROR],
		['simpleBondValue', '1,234.56', MONEY_FORMAT_ERROR],
		['simpleBondValue', '0,00', 'Simple bond value must be greater than 0'],
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
			campaignGeneralSchema.parse({
				name: 'One day',
				startsOn: '2027-03-01',
				endsOn: '2027-03-01',
				expectedUpdatedAt: VERSION
			})
		).toEqual({
			name: 'One day',
			startsAt: '2027-03-01T00:00:00-03:00',
			endsAt: '2027-03-01T23:59:59-03:00',
			expectedUpdatedAt: VERSION
		});
		const errors = errorsOf(
			campaignGeneralSchema.safeParse({
				name: 'X',
				startsOn: '2027-03-02',
				endsOn: '2027-03-01',
				expectedUpdatedAt: VERSION
			})
		);
		expect(errors.endsOn).toEqual(['End date must be on or after the start date']);
	});

	it('rejects malformed dates', () => {
		const errors = errorsOf(
			campaignGeneralSchema.safeParse({
				name: 'X',
				startsOn: '2027-02-30',
				endsOn: 'tomorrow',
				expectedUpdatedAt: VERSION
			})
		);
		expect(errors.startsOn).toEqual(['Start date must be a valid date (YYYY-MM-DD)']);
		expect(errors.endsOn).toEqual(['End date must be a valid date (YYYY-MM-DD)']);
	});
});

describe('campaignRulesSchema / campaignNumberingSchema', () => {
	it('recomputes the installment value', () => {
		const result = campaignRulesSchema.parse({
			...rules,
			installmentCount: '12',
			expectedUpdatedAt: VERSION
		});
		expect(result.installmentValue).toBe('5000.00');
		expect(result.expectedUpdatedAt).toBe(VERSION);
	});

	it('parses Argentine money input like the create schema', () => {
		const result = campaignRulesSchema.parse({
			...rules,
			simpleBondValue: '72.000,00',
			installmentCount: '12',
			expectedUpdatedAt: VERSION
		});
		expect(result.simpleBondValue).toBe('72000.00');
		expect(result.installmentValue).toBe('6000.00');
		const errors = errorsOf(campaignRulesSchema.safeParse({ ...rules, simpleBondValue: '72,000' }));
		expect(errors.simpleBondValue).toEqual([MONEY_FORMAT_ERROR]);
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

describe('campaignRulesUpdateSchema (existing campaign)', () => {
	const confirmed = {
		...rules,
		simpleBondValue: '60.000,00',
		changeReason: '',
		confirmRulesChange: 'yes',
		expectedUpdatedAt: VERSION
	};

	it('requires the explicit confirmation', () => {
		expect(campaignRulesUpdateSchema.parse(confirmed)).toEqual({
			...campaignRulesSchema.parse({ ...rules, expectedUpdatedAt: VERSION }),
			reason: null
		});
		for (const confirmRulesChange of ['', 'on', 'no', 'YES']) {
			const errors = errorsOf(
				campaignRulesUpdateSchema.safeParse({ ...confirmed, confirmRulesChange })
			);
			expect(errors).toEqual({
				confirmRulesChange: ['Confirm that you reviewed the rule changes']
			});
		}
	});

	it('reports field errors and the missing confirmation together', () => {
		const errors = errorsOf(
			campaignRulesUpdateSchema.safeParse({
				...confirmed,
				installmentCount: '7',
				confirmRulesChange: ''
			})
		);
		expect(Object.keys(errors).sort()).toEqual(['confirmRulesChange', 'installmentCount']);
	});

	it('reads the confirmation and reason fields from the form', () => {
		expect(CAMPAIGN_RULES_UPDATE_FIELDS).toContain('confirmRulesChange');
		expect(CAMPAIGN_RULES_UPDATE_FIELDS).toContain('changeReason');
	});

	it('takes an optional audit reason: trimmed, blank → null, at most 500 characters', () => {
		const parse = (changeReason: string) =>
			campaignRulesUpdateSchema.parse({ ...confirmed, changeReason }).reason;
		expect(parse('  Board decision  ')).toBe('Board decision');
		expect(parse('')).toBeNull();
		expect(parse('   ')).toBeNull();
		expect(parse('x'.repeat(500))).toHaveLength(500);
		const errors = errorsOf(
			campaignRulesUpdateSchema.safeParse({ ...confirmed, changeReason: 'x'.repeat(501) })
		);
		expect(errors).toEqual({ changeReason: ['Reason must be at most 500 characters'] });
	});
});

describe('previewNumberingInput (live preview)', () => {
	const numbering = {
		numberDigits: '4',
		maxNumber: '9999',
		associatedNumberOffset: '4871',
		overflowPolicy: 'reject'
	};

	it('is incomplete while a numeric field is empty', () => {
		expect(previewNumberingInput({ ...numbering, maxNumber: ' ' })).toEqual({
			state: 'incomplete'
		});
		expect(previewNumberingInput({ ...numbering, numberDigits: '' })).toEqual({
			state: 'incomplete'
		});
	});

	it('builds the 4-digit preview (0068 → 4939)', () => {
		const result = previewNumberingInput(numbering);
		expect(result.state).toBe('ok');
		if (result.state !== 'ok') return;
		expect(result.preview.examples[1]).toMatchObject({
			baseFormatted: '0068',
			associatedFormatted: '4939'
		});
		expect(result.preview.maxValidBase.base).toBe(5128);
		expect(result.preview.usableBaseCount).toBe(5129);
		expect(result.preview.overflowExample).toMatchObject({ base: 5129, associated: 10000 });
	});

	it('builds the 5-digit preview (00068 → 04939)', () => {
		const result = previewNumberingInput({ ...numbering, numberDigits: '5', maxNumber: '99999' });
		expect(result.state === 'ok' && result.preview.examples[1]).toMatchObject({
			baseFormatted: '00068',
			associatedFormatted: '04939'
		});
	});

	it('lists the same problems the server reports, one per field', () => {
		expect(previewNumberingInput({ ...numbering, maxNumber: '10000' })).toEqual({
			state: 'invalid',
			issues: [
				{ field: 'maxNumber', message: 'Maximum number must fit in 4 digits (at most 9999)' }
			]
		});
		expect(
			previewNumberingInput({ ...numbering, numberDigits: '11', associatedNumberOffset: 'x' })
		).toEqual({
			state: 'invalid',
			issues: [
				{ field: 'numberDigits', message: 'Number of digits must be at most 10' },
				{
					field: 'associatedNumberOffset',
					message: 'Associated number offset must be a whole number'
				}
			]
		});
		expect(previewNumberingInput({ ...numbering, associatedNumberOffset: '10000' })).toMatchObject({
			state: 'invalid',
			issues: [{ field: 'associatedNumberOffset' }]
		});
		expect(previewNumberingInput({ ...numbering, overflowPolicy: 'wrap' })).toEqual({
			state: 'invalid',
			issues: [{ field: 'overflowPolicy', message: 'Overflow policy must be one of: reject' }]
		});
	});
});

describe('expectedUpdatedAt (campaign version)', () => {
	it('keeps the exact PostgREST string (microseconds are not truncated)', () => {
		for (const version of [
			VERSION,
			'2026-11-17T01:02:03+00:00',
			'2026-11-17T01:02:03.1+00:00',
			'2026-11-17T01:02:03.123456Z',
			'2026-11-16T22:02:03.123456-03:00'
		]) {
			expect(campaignVersionSchema.parse(version)).toBe(version);
		}
	});

	it.each([
		['missing', undefined],
		['empty', ''],
		['not a date', 'yesterday'],
		['date only', '2026-11-17'],
		['no offset', '2026-11-17T01:02:03.123456']
	])('rejects a %s version', (_label, version) => {
		expect(campaignVersionSchema.safeParse(version).success).toBe(false);
	});

	it('is required by the general and rules edit schemas, with a reload message', () => {
		const general = errorsOf(
			campaignGeneralSchema.safeParse({
				name: 'X',
				startsOn: '',
				endsOn: '',
				expectedUpdatedAt: ''
			})
		);
		expect(general.expectedUpdatedAt).toEqual([CAMPAIGN_VERSION_INVALID_MESSAGE]);
		const rulesErrors = errorsOf(campaignRulesSchema.safeParse({ ...rules }));
		expect(rulesErrors.expectedUpdatedAt).toEqual([CAMPAIGN_VERSION_INVALID_MESSAGE]);
		// The confirmed rules form (reason + confirmation) needs it too.
		const updateErrors = errorsOf(
			campaignRulesUpdateSchema.safeParse({
				...rules,
				changeReason: 'Board decision',
				confirmRulesChange: 'yes'
			})
		);
		expect(updateErrors).toEqual({ expectedUpdatedAt: [CAMPAIGN_VERSION_INVALID_MESSAGE] });
		expect(
			campaignRulesUpdateSchema.parse({
				...rules,
				changeReason: '',
				confirmRulesChange: 'yes',
				expectedUpdatedAt: VERSION
			}).expectedUpdatedAt
		).toBe(VERSION);
	});

	it('is not part of the create form', () => {
		expect(campaignCreateSchema.safeParse({ ...general, ...rules }).success).toBe(true);
		expect(CAMPAIGN_CREATE_FIELDS).not.toContain('expectedUpdatedAt');
		expect(CAMPAIGN_GENERAL_UPDATE_FIELDS).toContain('expectedUpdatedAt');
		expect(CAMPAIGN_RULES_UPDATE_FIELDS).toContain('expectedUpdatedAt');
	});
});

describe('MAX_NUMBER_DIGITS', () => {
	it('comes from the numbering domain (single source of truth)', () => {
		expect(MAX_NUMBER_DIGITS).toBe(DOMAIN_MAX_NUMBER_DIGITS);
	});
});

describe('MAX_CAMPAIGN_NUMBER', () => {
	const tenDigits = {
		numberDigits: '10',
		maxNumber: '2147483647',
		associatedNumberOffset: '0',
		overflowPolicy: 'reject'
	};

	it('comes from the numbering domain (single source of truth)', () => {
		expect(MAX_CAMPAIGN_NUMBER).toBe(DOMAIN_MAX_CAMPAIGN_NUMBER);
	});

	it('caps maxNumber and the offset at the Postgres integer maximum, with one message each', () => {
		expect(campaignNumberingSchema.safeParse(tenDigits).success).toBe(true);
		for (const maxNumber of ['2147483648', '9999999999']) {
			const errors = errorsOf(campaignNumberingSchema.safeParse({ ...tenDigits, maxNumber }));
			expect(errors.maxNumber).toEqual([`Maximum number must be at most ${MAX_CAMPAIGN_NUMBER}`]);
		}
		const errors = errorsOf(
			campaignNumberingSchema.safeParse({ ...tenDigits, associatedNumberOffset: '2147483648' })
		);
		expect(errors.associatedNumberOffset).toContain(
			`Associated number offset must be at most ${MAX_CAMPAIGN_NUMBER}`
		);
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

	it('keeps an optional reason for the other transitions', () => {
		for (const toStatus of ['active', 'closing', 'closed']) {
			expect(campaignTransitionSchema.parse({ toStatus, reason: ' Season over ' })).toEqual({
				toStatus,
				reason: 'Season over'
			});
		}
	});

	it('limits the reason length for every transition', () => {
		const reason = 'x'.repeat(CAMPAIGN_REASON_MAX_LENGTH + 1);
		for (const toStatus of ['active', 'annulled']) {
			const errors = errorsOf(campaignTransitionSchema.safeParse({ toStatus, reason }));
			expect(errors.reason).toEqual([
				`Reason must be at most ${CAMPAIGN_REASON_MAX_LENGTH} characters`
			]);
		}
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
