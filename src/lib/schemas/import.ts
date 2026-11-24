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

const campaignIdField = z.guid({ message: 'Campaña desconocida' });
const sessionIdField = z.guid({ message: 'Sesión de importación desconocida' });
const itemIdField = z.guid({ message: 'Fila de importación desconocida' });

const optionalText = (label: string, max: number) =>
	z
		.string()
		.nullish()
		.transform((value) => normalizeField(value))
		.refine((value) => value === null || value.length <= max, {
			message: `${label} admite hasta ${max} caracteres`
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
			ctx.addIssue({ code: 'custom', message: 'El número base debe ser un número entero' });
			return z.NEVER;
		}
		return Number(text);
	});

export const importSessionCreateSchema = z
	.object({
		campaignId: campaignIdField,
		sourceType: z.enum(['barcode_scan', 'csv_file', 'excel_file'], {
			message: 'Elegir cómo se cargan los bonos'
		}),
		fileName: optionalText('El nombre del archivo', IMPORT_FILE_NAME_MAX_LENGTH),
		notes: optionalText('Las notas', IMPORT_NOTES_MAX_LENGTH)
	})
	.superRefine((value, ctx) => {
		if (value.sourceType === 'barcode_scan' && value.fileName !== null) {
			ctx.addIssue({ code: 'custom', path: ['fileName'], message: 'Una sesión de escaneo no tiene archivo' });
		}
		if (value.sourceType !== 'barcode_scan' && value.fileName === null) {
			ctx.addIssue({ code: 'custom', path: ['fileName'], message: 'El nombre del archivo es obligatorio' });
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
		barcode: codeField('El código de barras'),
		itemType: z.enum(['simple', 'pata']).nullable(),
		groupKey: codeField('El grupo de pata'),
		baseNumber: baseNumberField,
		errorCode: z
			.string()
			.regex(/^parse_[a-z0-9_]{1,56}$/, 'Solo se pueden cargar errores del lector (parse_*)')
			.nullish()
			.transform((value) => value ?? null),
		errorMessage: optionalText('El mensaje de error', 500)
	})
	.superRefine((row, ctx) => {
		if (row.itemType === 'pata' && row.groupKey === null) {
			ctx.addIssue({
				code: 'custom',
				path: ['groupKey'],
				message: 'Una fila de pata necesita su grupo_pata'
			});
		}
		if (row.itemType !== 'pata' && row.groupKey !== null) {
			ctx.addIssue({
				code: 'custom',
				path: ['groupKey'],
				message: 'Solo las filas de pata tienen grupo_pata'
			});
		}
		if ((row.errorCode === null) !== (row.errorMessage === null)) {
			ctx.addIssue({
				code: 'custom',
				path: ['errorMessage'],
				message: 'Un error del lector necesita su código y su mensaje'
			});
		}
	});
export type StagedImportRowInput = z.output<typeof stagedImportRowSchema>;

/** File rows in bulk: unique row numbers, at most IMPORT_MAX_ROWS (sent in batches). */
export const importAddItemsSchema = z.object({
	sessionId: sessionIdField,
	rows: z
		.array(stagedImportRowSchema)
		.min(1, 'El archivo no tiene filas')
		.max(IMPORT_MAX_ROWS, `Se pueden importar como máximo ${IMPORT_MAX_ROWS} filas a la vez`)
		.refine((rows) => new Set(rows.map((r) => r.rowNumber)).size === rows.length, {
			message: 'Los números de fila deben ser únicos'
		})
});
export type ImportAddItemsInput = z.output<typeof importAddItemsSchema>;

/**
 * One scan: the code, the pata group (a scan with a group is a pata row) and the base number
 * typed by the operator (manual mapping, or a campaign without pattern).
 */
export const importAddScanSchema = z.object({
	sessionId: sessionIdField,
	barcode: codeField('El código de barras').refine((value) => value !== null, {
		message: 'Escanear o ingresar un código de barras'
	}),
	groupKey: codeField('El grupo de pata'),
	baseNumber: baseNumberField,
	rawValue: optionalText('El valor original', IMPORT_RAW_MAX_LENGTH)
});
export type ImportAddScanInput = z.output<typeof importAddScanSchema>;

export const importRemoveItemSchema = z.object({
	itemId: itemIdField,
	reason: optionalText('El motivo', IMPORT_REASON_MAX_LENGTH)
});
export type ImportRemoveItemInput = z.output<typeof importRemoveItemSchema>;

export const importCancelSessionSchema = z.object({
	sessionId: sessionIdField,
	reason: optionalText('El motivo', IMPORT_REASON_MAX_LENGTH)
});
export type ImportCancelSessionInput = z.output<typeof importCancelSessionSchema>;

export const importSessionIdSchema = z.object({ sessionId: sessionIdField });

/**
 * SAN-46: retype a staged row from the preview (`import_session_update_item`). Unlike staging,
 * the base number is required: the operator is correcting the row by hand.
 */
export const importUpdateItemSchema = z
	.object({
		itemId: itemIdField,
		itemType: z.enum(['simple', 'pata'], { message: 'Elegir bono simple o pata' }),
		groupKey: codeField('El grupo de pata'),
		baseNumber: baseNumberField.refine((value) => value !== null, {
			message: 'Ingresar el número base'
		}),
		barcode: codeField('El código de barras')
	})
	.superRefine((row, ctx) => {
		if (row.itemType === 'pata' && row.groupKey === null) {
			ctx.addIssue({
				code: 'custom',
				path: ['groupKey'],
				message: 'Una fila de pata necesita su grupo_pata'
			});
		}
		if (row.itemType === 'simple' && row.groupKey !== null) {
			ctx.addIssue({
				code: 'custom',
				path: ['groupKey'],
				message: 'Solo las filas de pata tienen grupo_pata'
			});
		}
	});
export type ImportUpdateItemInput = z.output<typeof importUpdateItemSchema>;

/** SAN-47 rollback of a confirmed import: the reason is required. */
export const importRollbackSchema = z.object({
	sessionId: sessionIdField,
	reason: optionalText('El motivo', IMPORT_REASON_MAX_LENGTH).refine((value) => value !== null, {
		message: 'Se requiere un motivo'
	})
});
export type ImportRollbackInput = z.output<typeof importRollbackSchema>;
