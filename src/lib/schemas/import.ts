/**
 * Import staging schemas (client-safe, SAN-45). Output is what the import service sends to the
 * `import_session_*` SQL functions (migration `20261126000000_import_staging.sql`), which re-check
 * everything (the database is the authority).
 *
 * A staged row is already interpreted (`interpretImportRow`): the shape rules here are the ones
 * `import_session_add_items` raises 22023 for (so a bad payload fails before the call). Whether a
 * row makes sense for the campaign (range, duplicates, numbers in use...) is decided by the
 * database validation, not here: a row in error is still staged so the operator can see it.
 */
import { z } from 'zod';
import { BARCODE_MAX_LENGTH, IMPORT_MAX_BASE_NUMBER } from '$lib/domain/barcodes';
import { IMPORT_MAX_ROWS, IMPORT_RAW_MAX_LENGTH, normalizeField } from '$lib/domain/imports';

export const IMPORT_REASON_MAX_LENGTH = 500;
export const IMPORT_NOTES_MAX_LENGTH = 2000;
export const IMPORT_FILE_NAME_MAX_LENGTH = 255;

const campaignIdField = z.guid({ message: 'Unknown campaign' });
const sessionIdField = z.guid({ message: 'Unknown import session' });
const itemIdField = z.guid({ message: 'Unknown import item' });

const optionalText = (label: string, max: number) =>
	z
		.string()
		.nullish()
		.transform((value) => normalizeField(value))
		.refine((value) => value === null || value.length <= max, {
			message: `${label} must be at most ${max} characters`
		});

const codeField = (label: string) => optionalText(label, BARCODE_MAX_LENGTH);

const baseNumberField = z
	.union([z.number(), z.string()])
	.nullish()
	.transform((value, ctx) => {
		if (value === null || value === undefined) return null;
		const text = typeof value === 'number' ? String(value) : normalizeField(value);
		if (text === null) return null;
		if (!/^[0-9]{1,10}$/.test(text) || Number(text) > IMPORT_MAX_BASE_NUMBER) {
			ctx.addIssue({ code: 'custom', message: 'The base number must be a whole number' });
			return z.NEVER;
		}
		return Number(text);
	});

export const importSessionCreateSchema = z
	.object({
		campaignId: campaignIdField,
		sourceType: z.enum(['barcode_scan', 'csv_file', 'excel_file'], {
			message: 'Choose how the bonds are loaded'
		}),
		fileName: optionalText('File name', IMPORT_FILE_NAME_MAX_LENGTH),
		notes: optionalText('Notes', IMPORT_NOTES_MAX_LENGTH)
	})
	.superRefine((value, ctx) => {
		if (value.sourceType === 'barcode_scan' && value.fileName !== null) {
			ctx.addIssue({ code: 'custom', path: ['fileName'], message: 'A scan session has no file' });
		}
		if (value.sourceType !== 'barcode_scan' && value.fileName === null) {
			ctx.addIssue({ code: 'custom', path: ['fileName'], message: 'A file name is required' });
		}
	});
export type ImportSessionCreateInput = z.output<typeof importSessionCreateSchema>;

/** One staged row (`import_session_add_items` JSON object, camelCase). */
export const stagedImportRowSchema = z
	.object({
		rowNumber: z.number().int().min(1).max(IMPORT_MAX_BASE_NUMBER),
		rawValue: z
			.string()
			.nullish()
			.transform((value) => (value == null ? null : value.slice(0, IMPORT_RAW_MAX_LENGTH))),
		parsedValue: z.record(z.string(), z.unknown()).nullish(),
		barcode: codeField('Barcode'),
		itemType: z.enum(['simple', 'pata']).nullable(),
		groupKey: codeField('Pata group'),
		baseNumber: baseNumberField,
		errorCode: z
			.string()
			.regex(/^parse_[a-z0-9_]{1,56}$/, 'Only parser errors (parse_*) can be staged')
			.nullish()
			.transform((value) => value ?? null),
		errorMessage: optionalText('Error message', 500)
	})
	.superRefine((row, ctx) => {
		if (row.itemType === 'pata' && row.groupKey === null) {
			ctx.addIssue({
				code: 'custom',
				path: ['groupKey'],
				message: 'A pata row needs its grupo_pata'
			});
		}
		if (row.itemType !== 'pata' && row.groupKey !== null) {
			ctx.addIssue({
				code: 'custom',
				path: ['groupKey'],
				message: 'Only pata rows have a grupo_pata'
			});
		}
		if ((row.errorCode === null) !== (row.errorMessage === null)) {
			ctx.addIssue({
				code: 'custom',
				path: ['errorMessage'],
				message: 'A parser error needs both its code and its message'
			});
		}
	});
export type StagedImportRowInput = z.output<typeof stagedImportRowSchema>;

/** File rows in bulk: unique row numbers, at most IMPORT_MAX_ROWS (sent in batches). */
export const importAddItemsSchema = z.object({
	sessionId: sessionIdField,
	rows: z
		.array(stagedImportRowSchema)
		.min(1, 'The file has no rows')
		.max(IMPORT_MAX_ROWS, `At most ${IMPORT_MAX_ROWS} rows can be imported at once`)
		.refine((rows) => new Set(rows.map((r) => r.rowNumber)).size === rows.length, {
			message: 'Row numbers must be unique'
		})
});
export type ImportAddItemsInput = z.output<typeof importAddItemsSchema>;

/**
 * One scan: the code, the pata group (a scan with a group is a pata row) and the base number
 * typed by the operator (manual mapping, or a campaign without pattern).
 */
export const importAddScanSchema = z.object({
	sessionId: sessionIdField,
	barcode: codeField('Barcode').refine((value) => value !== null, {
		message: 'Scan or type a barcode'
	}),
	groupKey: codeField('Pata group'),
	baseNumber: baseNumberField,
	rawValue: optionalText('Raw value', IMPORT_RAW_MAX_LENGTH)
});
export type ImportAddScanInput = z.output<typeof importAddScanSchema>;

export const importRemoveItemSchema = z.object({
	itemId: itemIdField,
	reason: optionalText('Reason', IMPORT_REASON_MAX_LENGTH)
});
export type ImportRemoveItemInput = z.output<typeof importRemoveItemSchema>;

export const importCancelSessionSchema = z.object({
	sessionId: sessionIdField,
	reason: optionalText('Reason', IMPORT_REASON_MAX_LENGTH)
});
export type ImportCancelSessionInput = z.output<typeof importCancelSessionSchema>;

export const importSessionIdSchema = z.object({ sessionId: sessionIdField });
