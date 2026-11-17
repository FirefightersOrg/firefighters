/**
 * Bond form schemas (client-safe). Input is raw form data (strings); output is what the bond
 * service sends to the `bond_*` SQL functions.
 *
 * - Numbers are typed as the campaign shows them (`0068` or `68`) and parsed with the campaign's
 *   numbering config (`parseCampaignNumber`), so the digit count is never hardcoded. Range,
 *   overflow and numbers repeated inside the same bond are checked here with the bond domain
 *   (`validateBondNumbers`); duplicates against other bonds are checked by the database.
 * - A printed pata takes N >= 2 base numbers, as several form values or one text with the
 *   numbers separated by commas, semicolons or whitespace. Blank entries are ignored.
 * - Codes (internal code, barcode) are optional: trimmed, blank = none.
 * - Ungrouping and annulling require a reason; creating and grouping accept an optional one
 *   (stored in the audit row).
 */
import { z } from 'zod';
import { BondError, MIN_PATA_SIZE, validateBondNumbers } from '$lib/domain/bonds';
import {
	NumberingError,
	parseCampaignNumber,
	type CampaignNumberingConfig
} from '$lib/domain/numbering';

export const BOND_CODE_MAX_LENGTH = 100;
export const BOND_REASON_MAX_LENGTH = 1000;

export const BOND_CREATE_SIMPLE_FIELDS = [
	'campaignId',
	'baseNumber',
	'internalCode',
	'barcode',
	'reason'
] as const;
export const BOND_CREATE_PATA_FIELDS = [
	'campaignId',
	'baseNumbers',
	'internalCode',
	'barcode',
	'reason'
] as const;
export const BOND_GROUP_FIELDS = [
	'campaignId',
	'memberBondIds',
	'internalCode',
	'barcode',
	'reason'
] as const;
export const BOND_UNGROUP_FIELDS = ['pataBondId', 'reason'] as const;
export const BOND_ANNUL_FIELDS = ['bondId', 'reason'] as const;

export type BondFormField =
	| (typeof BOND_CREATE_SIMPLE_FIELDS)[number]
	| (typeof BOND_CREATE_PATA_FIELDS)[number]
	| (typeof BOND_GROUP_FIELDS)[number]
	| (typeof BOND_UNGROUP_FIELDS)[number]
	| (typeof BOND_ANNUL_FIELDS)[number];

/** Field errors as `{ field: [messages] }` (Zod's flattened shape). */
export type BondFieldErrors = Partial<Record<string, string[]>>;

export function bondFieldErrors(error: z.ZodError): BondFieldErrors {
	return z.flattenError(error).fieldErrors as BondFieldErrors;
}

const campaignIdField = z.guid({ message: 'Unknown campaign' });
const bondIdField = z.guid({ message: 'Unknown bond' });

const codeField = (label: string) =>
	z
		.string()
		.trim()
		.max(BOND_CODE_MAX_LENGTH, `${label} must be at most ${BOND_CODE_MAX_LENGTH} characters`)
		.transform((value) => (value === '' ? null : value));

const optionalReasonField = z
	.string()
	.trim()
	.max(BOND_REASON_MAX_LENGTH, `Reason must be at most ${BOND_REASON_MAX_LENGTH} characters`)
	.transform((value) => (value === '' ? null : value));

const requiredReasonField = (action: string) =>
	z
		.string()
		.trim()
		.min(1, `A reason is required to ${action}`)
		.max(BOND_REASON_MAX_LENGTH, `Reason must be at most ${BOND_REASON_MAX_LENGTH} characters`);

/** Several form values, or one text with values separated by commas, semicolons or whitespace. */
const listField = z.union([z.string(), z.array(z.string())]).transform((value) =>
	(Array.isArray(value) ? value : [value])
		.flatMap((entry) => entry.split(/[\s,;]+/))
		.map((entry) => entry.trim())
		.filter((entry) => entry !== '')
);

export interface BondCreateInput {
	campaignId: string;
	/** Integer values (not padded), in the order typed. */
	baseNumbers: number[];
	internalCode: string | null;
	barcode: string | null;
	reason: string | null;
}

/**
 * Parses each typed number with the campaign config and validates the bond as a whole (range,
 * overflow, repetitions). Adds issues to `field` and returns null when anything is wrong.
 */
function parseBaseNumbers(
	inputs: readonly string[],
	config: CampaignNumberingConfig,
	ctx: z.RefinementCtx,
	field: 'baseNumber' | 'baseNumbers'
): number[] | null {
	const values: number[] = [];
	let ok = true;
	for (const input of inputs) {
		try {
			values.push(parseCampaignNumber(input, config));
		} catch (err) {
			if (!(err instanceof NumberingError)) throw err;
			ok = false;
			ctx.addIssue({
				code: 'custom',
				path: [field],
				message:
					err.code === 'out_of_range'
						? `Number ${input.trim()} exceeds the campaign maximum number ${String(config.maxNumber).padStart(config.numberDigits, '0')}`
						: `"${input.trim()}" is not a valid number (use up to ${config.numberDigits} digits)`
			});
		}
	}
	if (!ok) return null;
	try {
		validateBondNumbers(values, config);
	} catch (err) {
		if (!(err instanceof BondError)) throw err;
		ctx.addIssue({ code: 'custom', path: [field], message: err.message });
		return null;
	}
	return values;
}

/** New simple bond: one base number, typed as the campaign shows it. */
export function bondCreateSimpleSchema(config: CampaignNumberingConfig) {
	return z
		.object({
			campaignId: campaignIdField,
			baseNumber: z.string().trim().min(1, 'Base number is required'),
			internalCode: codeField('Internal code'),
			barcode: codeField('Barcode'),
			reason: optionalReasonField
		})
		.transform(({ baseNumber, ...rest }, ctx): BondCreateInput => {
			const baseNumbers = parseBaseNumbers([baseNumber], config, ctx, 'baseNumber');
			return { ...rest, baseNumbers: baseNumbers ?? [] };
		});
}

/** New printed pata: N >= 2 base numbers. */
export function bondCreatePataSchema(config: CampaignNumberingConfig) {
	return z
		.object({
			campaignId: campaignIdField,
			baseNumbers: listField,
			internalCode: codeField('Internal code'),
			barcode: codeField('Barcode'),
			reason: optionalReasonField
		})
		.transform((value, ctx): BondCreateInput => {
			if (value.baseNumbers.length < MIN_PATA_SIZE) {
				ctx.addIssue({
					code: 'custom',
					path: ['baseNumbers'],
					message: `A pata needs at least ${MIN_PATA_SIZE} base numbers`
				});
				return { ...value, baseNumbers: [] };
			}
			const baseNumbers = parseBaseNumbers(value.baseNumbers, config, ctx, 'baseNumbers');
			return { ...value, baseNumbers: baseNumbers ?? [] };
		});
}

/** Manual pata: N >= 2 distinct simple bonds of the campaign. */
export const bondGroupSchema = z.object({
	campaignId: campaignIdField,
	memberBondIds: listField.pipe(
		z
			.array(bondIdField)
			.min(MIN_PATA_SIZE, `A pata needs at least ${MIN_PATA_SIZE} simple bonds`)
			.refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
				message: 'A bond is listed more than once'
			})
	),
	internalCode: codeField('Internal code'),
	barcode: codeField('Barcode'),
	reason: optionalReasonField
});

export type BondGroupInput = z.output<typeof bondGroupSchema>;

/** Ungroup an available manual pata: the pata id and a mandatory reason. */
export const bondUngroupSchema = z.object({
	pataBondId: bondIdField,
	reason: requiredReasonField('ungroup a pata')
});

export type BondUngroupInput = z.output<typeof bondUngroupSchema>;

/** Annul an available bond loaded by mistake: the bond id and a mandatory reason. */
export const bondAnnulSchema = z.object({
	bondId: bondIdField,
	reason: requiredReasonField('annul a bond')
});

export type BondAnnulInput = z.output<typeof bondAnnulSchema>;
