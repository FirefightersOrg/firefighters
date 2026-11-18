/**
 * Import staging schemas (client-safe, SAN-45). Output is what the import service sends to the
 * `import_session_*` SQL functions, which re-check everything (the database is the authority).
 *
 * Raw item fields are trimmed (spaces, tabs, line breaks; blank = null) and at most
 * IMPORT_FIELD_MAX_LENGTH characters. Whether they make sense for the campaign (type, barcode,
 * base number) is decided by validation (`validateImportBatch` / `import_session_validate`), not
 * here: an item in error is still staged so the operator can see and correct it.
 */
import { z } from 'zod';
import {
	IMPORT_FIELD_MAX_LENGTH,
	IMPORT_MAX_ROWS,
	IMPORT_RAW_MAX_LENGTH,
	normalizeField
} from '$lib/domain/imports';

export const IMPORT_REASON_MAX_LENGTH = 500;
export const IMPORT_NOTES_MAX_LENGTH = 2000;
export const IMPORT_FILE_NAME_MAX_LENGTH = 255;

const campaignIdField = z.guid({ message: 'Unknown campaign' });
const sessionIdField = z.guid({ message: 'Unknown import session' });
const itemIdField = z.guid({ message: 'Unknown import item' });

const rawField = (label: string) =>
	z
		.string()
		.nullish()
		.transform((value) => normalizeField(value))
		.refine((value) => value === null || value.length <= IMPORT_FIELD_MAX_LENGTH, {
			message: `${label} must be at most ${IMPORT_FIELD_MAX_LENGTH} characters`
		});

const optionalText = (label: string, max: number) =>
	z
		.string()
		.nullish()
		.transform((value) => normalizeField(value))
		.refine((value) => value === null || value.length <= max, {
			message: `${label} must be at most ${max} characters`
		});

/** The four raw fields of a row or a scan. */
export const importRawItemSchema = z.object({
	tipoBono: rawField('Bond type'),
	grupoPata: rawField('Pata group'),
	numeroBase: rawField('Base number'),
	barcode: rawField('Barcode')
});
export type ImportRawItemInput = z.output<typeof importRawItemSchema>;

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

/** File rows in bulk: unique positive row numbers, at most IMPORT_MAX_ROWS. */
export const importAddItemsSchema = z.object({
	sessionId: sessionIdField,
	items: z
		.array(
			importRawItemSchema.extend({
				rowNumber: z.number().int().min(1).max(999_999_999),
				raw: z
					.string()
					.nullish()
					.transform((value) => (value == null ? null : value.slice(0, IMPORT_RAW_MAX_LENGTH)))
			})
		)
		.min(1, 'The file has no rows')
		.max(IMPORT_MAX_ROWS, `At most ${IMPORT_MAX_ROWS} rows can be imported at once`)
		.refine((items) => new Set(items.map((i) => i.rowNumber)).size === items.length, {
			message: 'Row numbers must be unique'
		})
});
export type ImportAddItemsInput = z.output<typeof importAddItemsSchema>;

export const importAddScanSchema = importRawItemSchema.extend({ sessionId: sessionIdField });
export type ImportAddScanInput = z.output<typeof importAddScanSchema>;

export const importUpdateItemSchema = importRawItemSchema.extend({ itemId: itemIdField });
export type ImportUpdateItemInput = z.output<typeof importUpdateItemSchema>;

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
