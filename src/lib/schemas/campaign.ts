/**
 * Campaign form schemas (client-safe). Input is raw form data (strings); output is what the
 * campaign service sends to the `campaign_*` SQL functions.
 *
 * - Numbering rules are validated with the domain `validateNumberingConfig` (same checks as the
 *   table constraints).
 * - The installment value is derived (`simpleBondValue / installmentCount`) and must divide
 *   exactly to the cent; otherwise the form is rejected with a friendly message.
 * - Money is typed in Argentine format (`60.000,50`, see `parseMoneyInput`) and comes out as a
 *   canonical two-decimal string (`"60000.50"`), never a float.
 * - Dates are calendar days (`YYYY-MM-DD`) turned into timestamps in the campaign time zone.
 * - Edits of an existing campaign carry `expectedUpdatedAt`: the campaign's `updated_at` as loaded
 *   (optimistic concurrency). It is kept as the exact string PostgREST returned (microseconds), never
 *   parsed into a `Date`, so the database can compare it exactly.
 */
import { z } from 'zod';
import {
	BARCODE_MODES,
	BARCODE_PATTERN_MAX_LENGTH,
	barcodeModeUsesPattern,
	CAMPAIGN_TRANSITION_TARGETS,
	campaignDayEnd,
	campaignDayStart
} from '$lib/domain/campaigns';
import { notExactInstallmentsMessage, splitIntoInstallments } from '$lib/domain/installments';
import {
	centsToDecimalString,
	MAX_MONEY_CENTS,
	MONEY_INPUT_FORMAT_MESSAGE,
	parseMoneyInput
} from '$lib/domain/money';
import {
	MAX_CAMPAIGN_NUMBER,
	MAX_NUMBER_DIGITS,
	validateNumberingConfig,
	type CampaignNumberingConfig,
	type OverflowPolicy
} from '$lib/domain/numbering';
import { buildNumberingPreview, type NumberingPreview } from '$lib/domain/numbering-preview';

/** Re-exported for the form components; defined (and enforced) by the numbering domain. */
export { MAX_CAMPAIGN_NUMBER, MAX_NUMBER_DIGITS };

/** Upper bound of the other integer fields (Postgres `integer`, same as the numbering cap). */
const INT4_MAX = MAX_CAMPAIGN_NUMBER;
export const CAMPAIGN_NAME_MAX_LENGTH = 200;
export const CAMPAIGN_REASON_MAX_LENGTH = 1000;

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
	'barcodeMode',
	'barcodePattern'
] as const;
export const CAMPAIGN_CREATE_FIELDS = [
	...CAMPAIGN_GENERAL_FIELDS,
	...CAMPAIGN_RULES_FIELDS
] as const;
/**
 * Editing the rules of an existing campaign also needs an explicit confirmation (a checkbox the
 * form only submits when ticked), so a rule change is never saved by accident.
 */
export const CAMPAIGN_RULES_CONFIRM_FIELD = 'confirmRulesChange';
export const CAMPAIGN_RULES_CONFIRM_VALUE = 'yes';
/** Optional reason for a rule change, stored in the audit row (`audit_log.reason`). */
export const CAMPAIGN_RULES_REASON_FIELD = 'changeReason';
export const CAMPAIGN_RULES_REASON_MAX_LENGTH = 500;
/** Hidden field of the edit forms: the campaign's `updated_at` as loaded (its version). */
export const CAMPAIGN_VERSION_FIELD = 'expectedUpdatedAt';
/** Fields posted by the rules edit form (`?/rules`). */
export const CAMPAIGN_RULES_UPDATE_FIELDS = [
	...CAMPAIGN_RULES_FIELDS,
	CAMPAIGN_RULES_REASON_FIELD,
	CAMPAIGN_RULES_CONFIRM_FIELD,
	CAMPAIGN_VERSION_FIELD
] as const;
/** Fields posted by the general-data edit form (`?/update`). */
export const CAMPAIGN_GENERAL_UPDATE_FIELDS = [
	...CAMPAIGN_GENERAL_FIELDS,
	CAMPAIGN_VERSION_FIELD
] as const;
export const CAMPAIGN_TRANSITION_FIELDS = ['toStatus', 'reason'] as const;

export type CampaignFormField =
	| (typeof CAMPAIGN_CREATE_FIELDS)[number]
	| (typeof CAMPAIGN_TRANSITION_FIELDS)[number]
	| typeof CAMPAIGN_RULES_REASON_FIELD
	| typeof CAMPAIGN_RULES_CONFIRM_FIELD
	| typeof CAMPAIGN_VERSION_FIELD;

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

/** Shown when the hidden version field is missing or malformed (e.g. a form from an old page). */
export const CAMPAIGN_VERSION_INVALID_MESSAGE =
	'This form is out of date. Reload the page and try again.';

/**
 * The campaign version as loaded: an ISO 8601 timestamp with an offset, exactly as PostgREST
 * returned it (e.g. `2026-11-17T01:02:03.123456+00:00`). Required; output unchanged.
 */
export const campaignVersionSchema = z.iso.datetime({
	offset: true,
	message: CAMPAIGN_VERSION_INVALID_MESSAGE
});

const versionShape = { expectedUpdatedAt: campaignVersionSchema };

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
	maxNumber: wholeNumber('Maximum number', { min: 1, max: MAX_CAMPAIGN_NUMBER }),
	associatedNumberOffset: wholeNumber('Associated number offset', {
		min: 0,
		max: MAX_CAMPAIGN_NUMBER
	}),
	overflowPolicy: z.string().trim().min(1, 'Overflow policy is required')
};

const rulesShape = {
	simpleBondValue: z
		.string()
		.trim()
		.min(1, { message: 'Simple bond value is required', abort: true })
		// Argentine format (`60.000,50`), parsed exactly like the live preview in the browser.
		.transform((value, ctx) => {
			const cents = parseMoneyInput(value);
			if (cents === null) {
				ctx.addIssue({ code: 'custom', message: MONEY_INPUT_FORMAT_MESSAGE });
				return z.NEVER;
			}
			return cents;
		})
		.pipe(
			z
				.number()
				.min(1, 'Simple bond value must be greater than 0')
				.max(MAX_MONEY_CENTS, 'Simple bond value is too large')
		),
	installmentCount: wholeNumber('Number of installments', { min: 1 }),
	...numberingShape,
	barcodeMode: z.enum(BARCODE_MODES, { message: 'Choose how barcodes are read' }),
	// Optional regex (blank = none). Whether it compiles as a Postgres regex is checked by the
	// database (JavaScript and Postgres regex syntax differ). The field is only rendered for the
	// modes that use it, so it may be missing: missing or blank = no pattern.
	barcodePattern: z
		.string()
		.trim()
		// Count code points, like Postgres `char_length`, not UTF-16 code units: an emoji is one
		// character in the database but two in JavaScript.
		.refine(
			(value) => [...value].length <= BARCODE_PATTERN_MAX_LENGTH,
			`Barcode pattern must be at most ${BARCODE_PATTERN_MAX_LENGTH} characters`
		)
		.optional()
		.transform((value) => (value ? value : null))
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
		// The field schemas already report a numberDigits above MAX_NUMBER_DIGITS ("at most 10")
		// and a maxNumber above MAX_CAMPAIGN_NUMBER ("at most 2147483647").
		if (issue.field === 'numberDigits' && value.numberDigits > MAX_NUMBER_DIGITS) continue;
		if (issue.field === 'maxNumber' && value.maxNumber > MAX_CAMPAIGN_NUMBER) continue;
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

function refineBarcodePattern(
	value: { barcodeMode: string; barcodePattern: string | null },
	ctx: RefinementCtx
) {
	if (value.barcodePattern !== null && !barcodeModeUsesPattern(value.barcodeMode)) {
		ctx.addIssue({
			code: 'custom',
			path: ['barcodePattern'],
			message: 'A barcode pattern is only used with the internal or external/legacy code modes'
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
	barcodePattern: string | null;
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
		barcodeMode: value.barcodeMode,
		/** Regex whose first capture group is the base number, or null. */
		barcodePattern: value.barcodePattern
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

/**
 * General data edit: name, start and end dates (`campaign.update`), plus the version the edit is
 * based on (`expectedUpdatedAt`).
 */
export const campaignGeneralSchema = z
	.object({ ...generalShape, ...versionShape })
	.superRefine(refineDates)
	.transform((value) => ({
		...toGeneralOutput(value),
		expectedUpdatedAt: value.expectedUpdatedAt
	}));

/**
 * Rules edit: installments, numbering, overflow policy and barcode mode (`campaign.update_rules`),
 * plus the version the edit is based on (`expectedUpdatedAt`).
 */
export const campaignRulesSchema = z
	.object({ ...rulesShape, ...versionShape })
	.superRefine((value, ctx) => {
		refineNumbering(value, ctx);
		refineInstallments(value, ctx);
		refineBarcodePattern(value, ctx);
	})
	.transform((value) => ({
		...toRulesOutput(value),
		expectedUpdatedAt: value.expectedUpdatedAt
	}));

/**
 * Rules of an existing (draft) campaign: the rules, an optional reason for the audit log (trimmed,
 * blank → null), the explicit confirmation and the version the edit is based on
 * (`expectedUpdatedAt`).
 */
export const campaignRulesUpdateSchema = z
	.object({
		...rulesShape,
		...versionShape,
		[CAMPAIGN_RULES_REASON_FIELD]: z
			.string()
			.trim()
			.max(
				CAMPAIGN_RULES_REASON_MAX_LENGTH,
				`Reason must be at most ${CAMPAIGN_RULES_REASON_MAX_LENGTH} characters`
			)
			.transform((value) => (value === '' ? null : value)),
		// A non-fatal check (not z.literal), so the rule errors are still reported with it.
		[CAMPAIGN_RULES_CONFIRM_FIELD]: z
			.string()
			.refine((value) => value === CAMPAIGN_RULES_CONFIRM_VALUE, {
				message: 'Confirm that you reviewed the rule changes'
			})
	})
	.superRefine((value, ctx) => {
		refineNumbering(value, ctx);
		refineInstallments(value, ctx);
		refineBarcodePattern(value, ctx);
	})
	.transform((value) => ({
		...toRulesOutput(value),
		expectedUpdatedAt: value.expectedUpdatedAt,
		/** Audit reason (`campaign_update_rules(p_reason)`), or null. */
		reason: value[CAMPAIGN_RULES_REASON_FIELD]
	}));

/** New campaign: general data + rules. */
export const campaignCreateSchema = z
	.object({ ...generalShape, ...rulesShape })
	.superRefine((value, ctx) => {
		refineDates(value, ctx);
		refineNumbering(value, ctx);
		refineInstallments(value, ctx);
		refineBarcodePattern(value, ctx);
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

// ---------------------------------------------------------------------------
// Live numbering preview
// ---------------------------------------------------------------------------

export type CampaignNumberingInputPreview =
	| { state: 'incomplete' }
	| { state: 'invalid'; issues: { field: string; message: string }[] }
	| { state: 'ok'; preview: Extract<NumberingPreview, { ok: true }> };

/**
 * Live preview of the raw numbering inputs. Parses them with {@link campaignNumberingSchema}, so
 * the problems listed are exactly the messages the server returns on submit; a valid config is
 * turned into examples by `buildNumberingPreview`. Never throws. Returns `incomplete` while a
 * numeric field is still empty (no "required" noise while typing).
 */
export function previewNumberingInput(
	values: Record<(typeof CAMPAIGN_NUMBERING_FIELDS)[number], string>
): CampaignNumberingInputPreview {
	if (
		[values.numberDigits, values.maxNumber, values.associatedNumberOffset].some((v) => !v.trim())
	) {
		return { state: 'incomplete' };
	}
	const parsed = campaignNumberingSchema.safeParse(values);
	if (!parsed.success) {
		// First message per field, like the field errors shown after a submit.
		const issues = Object.entries(campaignFieldErrors(parsed.error)).map(([field, messages]) => ({
			field,
			message: messages?.[0] ?? ''
		}));
		return { state: 'invalid', issues };
	}
	const preview = buildNumberingPreview(parsed.data);
	// Unreachable in practice: the schema already applied validateNumberingConfig.
	if (!preview.ok) {
		return {
			state: 'invalid',
			issues: preview.issues.map((issue) => ({
				field: issue.field,
				message: humanizeNumberingMessage(issue.message)
			}))
		};
	}
	return { state: 'ok', preview };
}

export type CampaignGeneralInput = z.output<typeof campaignGeneralSchema>;
export type CampaignRulesInput = z.output<typeof campaignRulesSchema>;
export type CampaignRulesUpdateInput = z.output<typeof campaignRulesUpdateSchema>;
export type CampaignCreateInput = z.output<typeof campaignCreateSchema>;
export type CampaignTransitionInput = z.output<typeof campaignTransitionSchema>;
