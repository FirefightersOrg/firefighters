/**
 * Campaign form schemas (client-safe). Input is raw form data (strings); output is what the
 * campaign service sends to the `campaign_*` SQL functions.
 *
 * - Numbering rules are validated with the domain `validateNumberingConfig` (same checks as the
 *   table constraints).
 * - The installment value is derived (`simpleBondValue / installmentCount`) and must divide
 *   exactly to the cent; otherwise the form is rejected with a friendly message.
 * - Money comes out as a two-decimal string (`"60000.00"`), never a float.
 * - Dates are calendar days (`YYYY-MM-DD`) turned into timestamps in the campaign time zone.
 */
import { z } from 'zod';
import {
	BARCODE_MODES,
	CAMPAIGN_TRANSITION_TARGETS,
	campaignDayEnd,
	campaignDayStart
} from '$lib/domain/campaigns';
import { notExactInstallmentsMessage, splitIntoInstallments } from '$lib/domain/installments';
import {
	centsToDecimalString,
	MAX_MONEY_CENTS,
	MONEY_INPUT_PATTERN,
	parseMoneyToCents
} from '$lib/domain/money';
import {
	validateNumberingConfig,
	type CampaignNumberingConfig,
	type OverflowPolicy
} from '$lib/domain/numbering';

const INT4_MAX = 2_147_483_647;
export const CAMPAIGN_NAME_MAX_LENGTH = 200;
export const CAMPAIGN_REASON_MAX_LENGTH = 1000;
/** Visible digits are capped so `max_number` (a Postgres integer) can always fit them. */
export const MAX_NUMBER_DIGITS = 10;

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export const CAMPAIGN_GENERAL_FIELDS = ['name', 'startsOn', 'endsOn'] as const;
export const CAMPAIGN_NUMBERING_FIELDS = [
	'numberDigits',
	'maxNumber',
	'associatedNumberOffset',
	'overflowPolicy'
] as const;
export const CAMPAIGN_RULES_FIELDS = [
	'simpleBondValue',
	'installmentCount',
	...CAMPAIGN_NUMBERING_FIELDS,
	'barcodeMode'
] as const;
export const CAMPAIGN_CREATE_FIELDS = [
	...CAMPAIGN_GENERAL_FIELDS,
	...CAMPAIGN_RULES_FIELDS
] as const;
export const CAMPAIGN_TRANSITION_FIELDS = ['toStatus', 'reason'] as const;

export type CampaignFormField =
	(typeof CAMPAIGN_CREATE_FIELDS)[number] | (typeof CAMPAIGN_TRANSITION_FIELDS)[number];

/** Raw string values of a form (what the inputs hold). */
export type CampaignFormValues<F extends string = CampaignFormField> = Record<F, string>;

/** Reads the given fields from FormData as strings (missing or file values become `''`). */
export function readFormFields<const F extends string>(
	formData: FormData,
	fields: readonly F[]
): Record<F, string> {
	const values = {} as Record<F, string>;
	for (const field of fields) {
		const value = formData.get(field);
		values[field] = typeof value === 'string' ? value : '';
	}
	return values;
}

/** Field errors as `{ field: [messages] }` (Zod's flattened shape). */
export type CampaignFieldErrors = Partial<Record<string, string[]>>;

export function campaignFieldErrors(error: z.ZodError): CampaignFieldErrors {
	return z.flattenError(error).fieldErrors as CampaignFieldErrors;
}

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

function wholeNumber(label: string, { min, max = INT4_MAX }: { min: number; max?: number }) {
	return z
		.string()
		.trim()
		.min(1, { message: `${label} is required`, abort: true })
		.regex(/^\d+$/, `${label} must be a whole number`)
		.transform(Number)
		.pipe(
			z
				.number()
				.min(min, `${label} must be at least ${min}`)
				.max(max, `${label} must be at most ${max}`)
		);
}

const optionalDay = (label: string) =>
	z
		.string()
		.trim()
		.refine((value) => value === '' || z.iso.date().safeParse(value).success, {
			message: `${label} must be a valid date (YYYY-MM-DD)`
		})
		.transform((value) => (value === '' ? null : value));

const generalShape = {
	name: z
		.string()
		.trim()
		.min(1, 'Name is required')
		.max(CAMPAIGN_NAME_MAX_LENGTH, `Name must be at most ${CAMPAIGN_NAME_MAX_LENGTH} characters`),
	startsOn: optionalDay('Start date'),
	endsOn: optionalDay('End date')
};

const numberingShape = {
	numberDigits: wholeNumber('Number of digits', { min: 1, max: MAX_NUMBER_DIGITS }),
	maxNumber: wholeNumber('Maximum number', { min: 1 }),
	associatedNumberOffset: wholeNumber('Associated number offset', { min: 0 }),
	overflowPolicy: z.string().trim().min(1, 'Overflow policy is required')
};

const rulesShape = {
	simpleBondValue: z
		.string()
		.trim()
		.min(1, { message: 'Simple bond value is required', abort: true })
		.regex(MONEY_INPUT_PATTERN, 'Enter an amount with at most 2 decimals, e.g. 60000 or 60000.50')
		// Safe: the regex above guarantees parseMoneyToCents succeeds.
		.transform((value) => parseMoneyToCents(value) as number)
		.pipe(
			z
				.number()
				.min(1, 'Simple bond value must be greater than 0')
				.max(MAX_MONEY_CENTS, 'Simple bond value is too large')
		),
	installmentCount: wholeNumber('Number of installments', { min: 1 }),
	...numberingShape,
	barcodeMode: z.enum(BARCODE_MODES, { message: 'Choose how barcodes are read' })
};

// ---------------------------------------------------------------------------
// Cross-field rules
// ---------------------------------------------------------------------------

type RefinementCtx = z.RefinementCtx;

const NUMBERING_FIELD_LABELS: Record<keyof CampaignNumberingConfig, string> = {
	numberDigits: 'number of digits',
	maxNumber: 'maximum number',
	associatedNumberOffset: 'associated number offset',
	overflowPolicy: 'overflow policy'
};

/** Rewrites a domain message ("maxNumber must ...") with form labels ("Maximum number must ..."). */
function humanizeNumberingMessage(message: string): string {
	const text = Object.entries(NUMBERING_FIELD_LABELS).reduce(
		(acc, [key, label]) => acc.replace(new RegExp(`\\b${key}\\b`, 'g'), label),
		message
	);
	return text.charAt(0).toUpperCase() + text.slice(1);
}

interface ParsedNumbering {
	numberDigits: number;
	maxNumber: number;
	associatedNumberOffset: number;
	overflowPolicy: string;
}

// Zod still runs object refinements when a field failed a non-fatal check (e.g. a regex), with
// that field's raw input. Cross-field rules only run once their fields parsed into integers.
const isInt = (value: unknown): value is number => Number.isSafeInteger(value);

function refineNumbering(value: ParsedNumbering, ctx: RefinementCtx) {
	if (![value.numberDigits, value.maxNumber, value.associatedNumberOffset].every(isInt)) return;
	const issues = validateNumberingConfig({
		numberDigits: value.numberDigits,
		maxNumber: value.maxNumber,
		associatedNumberOffset: value.associatedNumberOffset,
		overflowPolicy: value.overflowPolicy as OverflowPolicy
	});
	for (const issue of issues) {
		ctx.addIssue({
			code: 'custom',
			path: [issue.field],
			message: humanizeNumberingMessage(issue.message)
		});
	}
}

function refineInstallments(
	value: { simpleBondValue: number; installmentCount: number },
	ctx: RefinementCtx
) {
	if (!isInt(value.simpleBondValue) || !isInt(value.installmentCount)) return;
	const split = splitIntoInstallments(value.simpleBondValue, value.installmentCount);
	if (!split.ok && split.reason === 'not_exact') {
		ctx.addIssue({
			code: 'custom',
			path: ['installmentCount'],
			message: notExactInstallmentsMessage(
				centsToDecimalString(value.simpleBondValue),
				value.installmentCount
			)
		});
	}
}

function refineDates(
	value: { startsOn: string | null; endsOn: string | null },
	ctx: RefinementCtx
) {
	// Same day is fine: starts_at is the start of the day and ends_at its last second.
	if (value.startsOn && value.endsOn && value.endsOn < value.startsOn) {
		ctx.addIssue({
			code: 'custom',
			path: ['endsOn'],
			message: 'End date must be on or after the start date'
		});
	}
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

function toGeneralOutput(value: { name: string; startsOn: string | null; endsOn: string | null }) {
	return {
		name: value.name,
		startsAt: value.startsOn ? campaignDayStart(value.startsOn) : null,
		endsAt: value.endsOn ? campaignDayEnd(value.endsOn) : null
	};
}

function toRulesOutput(value: {
	simpleBondValue: number;
	installmentCount: number;
	numberDigits: number;
	maxNumber: number;
	associatedNumberOffset: number;
	overflowPolicy: string;
	barcodeMode: (typeof BARCODE_MODES)[number];
}) {
	return {
		/** Two-decimal string, e.g. "60000.00". */
		simpleBondValue: centsToDecimalString(value.simpleBondValue),
		installmentCount: value.installmentCount,
		/** Derived and exact (validated above), e.g. "6000.00". */
		installmentValue: centsToDecimalString(value.simpleBondValue / value.installmentCount),
		numberDigits: value.numberDigits,
		maxNumber: value.maxNumber,
		associatedNumberOffset: value.associatedNumberOffset,
		overflowPolicy: value.overflowPolicy as OverflowPolicy,
		barcodeMode: value.barcodeMode
	};
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Numbering inputs only (for live validation/previews of the numbering fields). */
export const campaignNumberingSchema = z
	.object(numberingShape)
	.superRefine(refineNumbering)
	.transform((value) => ({ ...value, overflowPolicy: value.overflowPolicy as OverflowPolicy }));

/** General data: name, start and end dates (`campaign.update`). */
export const campaignGeneralSchema = z
	.object(generalShape)
	.superRefine(refineDates)
	.transform(toGeneralOutput);

/** Rules: installments, numbering, overflow policy and barcode mode (`campaign.update_rules`). */
export const campaignRulesSchema = z
	.object(rulesShape)
	.superRefine((value, ctx) => {
		refineNumbering(value, ctx);
		refineInstallments(value, ctx);
	})
	.transform(toRulesOutput);

/** New campaign: general data + rules. */
export const campaignCreateSchema = z
	.object({ ...generalShape, ...rulesShape })
	.superRefine((value, ctx) => {
		refineDates(value, ctx);
		refineNumbering(value, ctx);
		refineInstallments(value, ctx);
	})
	.transform((value) => ({ ...toGeneralOutput(value), ...toRulesOutput(value) }));

/** Status change. Annulling requires a reason. */
export const campaignTransitionSchema = z
	.object({
		toStatus: z.enum(CAMPAIGN_TRANSITION_TARGETS, { message: 'Unknown status change' }),
		reason: z
			.string()
			.trim()
			.max(
				CAMPAIGN_REASON_MAX_LENGTH,
				`Reason must be at most ${CAMPAIGN_REASON_MAX_LENGTH} characters`
			)
			.transform((value) => (value === '' ? null : value))
	})
	.superRefine((value, ctx) => {
		if (value.toStatus === 'annulled' && !value.reason) {
			ctx.addIssue({
				code: 'custom',
				path: ['reason'],
				message: 'A reason is required to annul a campaign'
			});
		}
	});

export type CampaignGeneralInput = z.output<typeof campaignGeneralSchema>;
export type CampaignRulesInput = z.output<typeof campaignRulesSchema>;
export type CampaignCreateInput = z.output<typeof campaignCreateSchema>;
export type CampaignTransitionInput = z.output<typeof campaignTransitionSchema>;
