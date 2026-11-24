/**
 * Commission rule form schemas (client-safe). Input is raw form data (strings); output is what
 * the commission rule service sends to the `commission_rule_*` SQL functions.
 *
 * - The value is either a percentage (typed `25`, `12,5`, `12,50`; see `parsePercentInput`) or a
 *   fixed amount (Argentine money format, see `parseMoneyInput`), chosen with `valueKind`. Only
 *   the chosen field is read: the other input may still hold text when JavaScript is off.
 * - `installmentNumber` is only read for `custom` rules (1..the campaign installment count).
 * - Dates are calendar days (`YYYY-MM-DD`), both inclusive; an empty end date = open-ended.
 * - Edits carry `expectedUpdatedAt`: the rule's `updated_at` as loaded (optimistic concurrency),
 *   kept as the exact string PostgREST returned (microseconds), never parsed into a `Date`.
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
/** Hidden field of the edit form: the rule's `updated_at` as loaded (its version). */
export const COMMISSION_RULE_VERSION_FIELD = 'expectedUpdatedAt';
export const COMMISSION_RULE_UPDATE_FIELDS = [
	'ruleId',
	COMMISSION_RULE_VERSION_FIELD,
	...COMMISSION_RULE_FIELDS
] as const;
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
		`El motivo admite hasta ${COMMISSION_REASON_MAX_LENGTH} caracteres`
	)
	.transform((value) => (value === '' ? null : value));

const day = (label: string) =>
	z
		.string()
		.trim()
		.refine((value) => value === '' || z.iso.date().safeParse(value).success, {
			message: `${label} debe ser una fecha válida (AAAA-MM-DD)`
		});

const ruleIdField = z.guid({ message: 'Regla de comisión desconocida' });

/** Shown when the hidden version field is missing or malformed (e.g. a form from an old page). */
export const COMMISSION_RULE_VERSION_INVALID_MESSAGE =
	'El formulario está desactualizado. Recargar la página y volver a intentar.';

/** The rule version as loaded: ISO 8601 with an offset, exactly as PostgREST returned it. */
const versionField = z.iso.datetime({
	offset: true,
	message: COMMISSION_RULE_VERSION_INVALID_MESSAGE
});

export type CommissionRuleUpdateInput = CommissionRuleInput & {
	ruleId: string;
	/** `updated_at` the edit is based on (sent unchanged to `commission_rule_update`). */
	expectedUpdatedAt: string;
};

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
	ruleType: z.enum(COMMISSION_RULE_TYPES, { message: 'Elegir un tipo de regla' }),
	installmentNumber: z.string().trim(),
	valueKind: z.enum(COMMISSION_VALUE_KINDS, {
		message: 'Elegir un porcentaje o un monto fijo'
	}),
	percentage: z.string().trim(),
	fixedAmount: z.string().trim(),
	validFrom: day('La fecha de inicio de vigencia'),
	validTo: day('La fecha de fin de vigencia'),
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
			issue(
				'installmentNumber',
				'El número de cuota es obligatorio para una regla de cuota específica'
			);
		} else if (!/^\d+$/.test(value.installmentNumber)) {
			issue('installmentNumber', 'El número de cuota debe ser un número entero');
		} else {
			const n = Number(value.installmentNumber);
			if (n < 1 || n > installmentCount) {
				issue(
					'installmentNumber',
					installmentCount === 1
						? 'Esta campaña tiene una sola cuota: usar 1'
						: `El número de cuota debe estar entre 1 y ${installmentCount}`
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
			issue('percentage', 'El porcentaje es obligatorio');
		} else if (hundredths === null) {
			issue('percentage', PERCENT_INPUT_FORMAT_MESSAGE);
		} else if (hundredths <= 0 || hundredths > MAX_PERCENT_HUNDREDTHS) {
			issue('percentage', 'El porcentaje debe ser mayor que 0 y hasta 100');
		} else {
			percentage = hundredthsToDecimalString(hundredths);
		}
	} else if (value.valueKind === 'fixed_amount') {
		const cents = parseMoneyInput(value.fixedAmount);
		if (value.fixedAmount === '') {
			issue('fixedAmount', 'El monto fijo es obligatorio');
		} else if (cents === null) {
			issue('fixedAmount', MONEY_INPUT_FORMAT_MESSAGE);
		} else if (cents <= 0) {
			issue('fixedAmount', 'El monto fijo debe ser mayor que 0');
		} else if (cents > MAX_MONEY_CENTS) {
			issue('fixedAmount', 'El monto fijo es demasiado grande');
		} else {
			fixedAmount = centsToDecimalString(cents);
		}
	}

	if (value.validFrom === '') issue('validFrom', 'La fecha de inicio de vigencia es obligatoria');
	const validTo = value.validTo === '' ? null : value.validTo;
	if (isDay(value.validFrom) && validTo && isDay(validTo) && validTo < value.validFrom) {
		issue('validTo', 'La fecha de fin de vigencia debe ser igual o posterior a la de inicio');
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

/** Edit: the rule id, the version the edit is based on, plus the rule fields. */
export function commissionRuleUpdateSchema(installmentCount: number) {
	return z
		.object({ ruleId: ruleIdField, expectedUpdatedAt: versionField, ...ruleShape })
		.superRefine((value, ctx) => addIssues(value, ctx, installmentCount))
		.transform(({ ruleId, expectedUpdatedAt, ...rule }): CommissionRuleUpdateInput => ({
			ruleId,
			expectedUpdatedAt,
			...analyzeRule(rule, installmentCount).output
		}));
}

/** Annul: the rule id and a mandatory reason. */
export const commissionRuleAnnulSchema = z.object({
	ruleId: ruleIdField,
	reason: z
		.string()
		.trim()
		.min(1, 'Se requiere un motivo para anular una regla de comisión')
		.max(
			COMMISSION_REASON_MAX_LENGTH,
			`El motivo admite hasta ${COMMISSION_REASON_MAX_LENGTH} caracteres`
		)
});

export type CommissionRuleAnnulInput = z.output<typeof commissionRuleAnnulSchema>;
