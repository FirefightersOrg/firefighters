/**
 * Commission rule form schemas (client-safe). Input is raw form data (strings); output is what
 * the commission rule service sends to the `commission_rule_*` SQL functions.
 *
 * - The value is either a percentage (typed `25`, `12,5`, `12,50`; see `parsePercentInput`) or a
 *   fixed amount (Argentine money format, see `parseMoneyInput`), chosen with `valueKind`. Only
 *   the chosen field is read: the other input may still hold text when JavaScript is off.
 * - `installmentNumber` is only read for `custom` rules (1..the campaign installment count).
 * - Dates are calendar days (`YYYY-MM-DD`), both inclusive; an empty end date = open-ended.
 */
import { z } from 'zod';
import {
	COMMISSION_RULE_TYPES,
	COMMISSION_VALUE_KINDS,
	type CommissionRuleType
} from '$lib/domain/commissions';
import {
	centsToDecimalString,
	MAX_MONEY_CENTS,
	MONEY_INPUT_FORMAT_MESSAGE,
	parseMoneyInput
} from '$lib/domain/money';
import {
	hundredthsToDecimalString,
	MAX_PERCENT_HUNDREDTHS,
	PERCENT_INPUT_FORMAT_MESSAGE,
	parsePercentInput
} from '$lib/domain/percent';

export const COMMISSION_REASON_MAX_LENGTH = 1000;

export const COMMISSION_RULE_FIELDS = [
	'ruleType',
	'installmentNumber',
	'valueKind',
	'percentage',
	'fixedAmount',
	'validFrom',
	'validTo',
	'reason'
] as const;
export const COMMISSION_RULE_UPDATE_FIELDS = ['ruleId', ...COMMISSION_RULE_FIELDS] as const;
export const COMMISSION_RULE_ANNUL_FIELDS = ['ruleId', 'reason'] as const;

export type CommissionRuleFormField = (typeof COMMISSION_RULE_UPDATE_FIELDS)[number];

/** Field errors as `{ field: [messages] }` (Zod's flattened shape). */
export type CommissionRuleFieldErrors = Partial<Record<string, string[]>>;

export function commissionRuleFieldErrors(error: z.ZodError): CommissionRuleFieldErrors {
	return z.flattenError(error).fieldErrors as CommissionRuleFieldErrors;
}

const reasonField = z
	.string()
	.trim()
	.max(
		COMMISSION_REASON_MAX_LENGTH,
		`Reason must be at most ${COMMISSION_REASON_MAX_LENGTH} characters`
	)
	.transform((value) => (value === '' ? null : value));

const day = (label: string) =>
	z
		.string()
		.trim()
		.refine((value) => value === '' || z.iso.date().safeParse(value).success, {
			message: `${label} must be a valid date (YYYY-MM-DD)`
		});

const ruleIdField = z.guid({ message: 'Unknown commission rule' });

export type CommissionRuleUpdateInput = CommissionRuleInput & { ruleId: string };

export interface CommissionRuleInput {
	ruleType: CommissionRuleType;
	installmentNumber: number | null;
	/** Canonical two-decimal strings; exactly one is set. */
	percentage: string | null;
	fixedAmount: string | null;
	validFrom: string;
	validTo: string | null;
	reason: string | null;
}

const ruleShape = {
	ruleType: z.enum(COMMISSION_RULE_TYPES, { message: 'Choose a rule type' }),
	installmentNumber: z.string().trim(),
	valueKind: z.enum(COMMISSION_VALUE_KINDS, {
		message: 'Choose a percentage or a fixed amount'
	}),
	percentage: z.string().trim(),
	fixedAmount: z.string().trim(),
	validFrom: day('Valid from'),
	validTo: day('Valid to'),
	reason: reasonField
};

type RawRule = {
	ruleType: CommissionRuleType;
	installmentNumber: string;
	valueKind: (typeof COMMISSION_VALUE_KINDS)[number];
	percentage: string;
	fixedAmount: string;
	validFrom: string;
	validTo: string;
	reason: string | null;
};

const isDay = (value: string) => z.iso.date().safeParse(value).success;

interface RuleIssue {
	path: [CommissionRuleFormField];
	message: string;
}

/**
 * Cross-field rules and conversion, as a pure function so the schema can report every issue
 * (in `superRefine`, which Zod still runs when a field failed a non-fatal check) and then convert
 * (in `transform`, which only runs when there are no issues).
 */
function analyzeRule(
	value: RawRule,
	installmentCount: number
): { issues: RuleIssue[]; output: CommissionRuleInput } {
	const issues: RuleIssue[] = [];
	const issue = (field: CommissionRuleFormField, message: string) =>
		issues.push({ path: [field], message });

	let installmentNumber: number | null = null;
	if (value.ruleType === 'custom') {
		if (value.installmentNumber === '') {
			issue('installmentNumber', 'Installment number is required for a specific installment rule');
		} else if (!/^\d+$/.test(value.installmentNumber)) {
			issue('installmentNumber', 'Installment number must be a whole number');
		} else {
			const n = Number(value.installmentNumber);
			if (n < 1 || n > installmentCount) {
				issue(
					'installmentNumber',
					installmentCount === 1
						? 'This campaign has a single installment: use 1'
						: `Installment number must be between 1 and ${installmentCount}`
				);
			} else {
				installmentNumber = n;
			}
		}
	}

	let percentage: string | null = null;
	let fixedAmount: string | null = null;
	if (value.valueKind === 'percentage') {
		const hundredths = parsePercentInput(value.percentage);
		if (value.percentage === '') {
			issue('percentage', 'Percentage is required');
		} else if (hundredths === null) {
			issue('percentage', PERCENT_INPUT_FORMAT_MESSAGE);
		} else if (hundredths <= 0 || hundredths > MAX_PERCENT_HUNDREDTHS) {
			issue('percentage', 'Percentage must be greater than 0 and at most 100');
		} else {
			percentage = hundredthsToDecimalString(hundredths);
		}
	} else if (value.valueKind === 'fixed_amount') {
		const cents = parseMoneyInput(value.fixedAmount);
		if (value.fixedAmount === '') {
			issue('fixedAmount', 'Fixed amount is required');
		} else if (cents === null) {
			issue('fixedAmount', MONEY_INPUT_FORMAT_MESSAGE);
		} else if (cents <= 0) {
			issue('fixedAmount', 'Fixed amount must be greater than 0');
		} else if (cents > MAX_MONEY_CENTS) {
			issue('fixedAmount', 'Fixed amount is too large');
		} else {
			fixedAmount = centsToDecimalString(cents);
		}
	}

	if (value.validFrom === '') issue('validFrom', 'Valid from is required');
	const validTo = value.validTo === '' ? null : value.validTo;
	if (isDay(value.validFrom) && validTo && isDay(validTo) && validTo < value.validFrom) {
		issue('validTo', 'Valid to must be on or after the valid from date');
	}

	return {
		issues,
		output: {
			ruleType: value.ruleType,
			installmentNumber,
			percentage,
			fixedAmount,
			validFrom: value.validFrom,
			validTo,
			reason: value.reason
		}
	};
}

function addIssues(value: RawRule, ctx: z.RefinementCtx, installmentCount: number) {
	for (const { path, message } of analyzeRule(value, installmentCount).issues) {
		ctx.addIssue({ code: 'custom', path, message });
	}
}

/**
 * Create / edit a general rule of a campaign with `installmentCount` installments (bounds the
 * installment number of `custom` rules; the database checks it too).
 */
export function commissionRuleSchema(installmentCount: number) {
	return z
		.object(ruleShape)
		.superRefine((value, ctx) => addIssues(value, ctx, installmentCount))
		.transform((value): CommissionRuleInput => analyzeRule(value, installmentCount).output);
}

/** Edit: the rule id plus the rule fields. */
export function commissionRuleUpdateSchema(installmentCount: number) {
	return z
		.object({ ruleId: ruleIdField, ...ruleShape })
		.superRefine((value, ctx) => addIssues(value, ctx, installmentCount))
		.transform(({ ruleId, ...rule }): CommissionRuleUpdateInput => ({
			ruleId,
			...analyzeRule(rule, installmentCount).output
		}));
}

/** Annul: the rule id and a mandatory reason. */
export const commissionRuleAnnulSchema = z.object({
	ruleId: ruleIdField,
	reason: z
		.string()
		.trim()
		.min(1, 'A reason is required to annul a commission rule')
		.max(
			COMMISSION_REASON_MAX_LENGTH,
			`Reason must be at most ${COMMISSION_REASON_MAX_LENGTH} characters`
		)
});

export type CommissionRuleAnnulInput = z.output<typeof commissionRuleAnnulSchema>;
