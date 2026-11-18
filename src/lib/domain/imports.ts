/**
 * Bond import staging rules (pure, client-safe). SAN-45, docs/imports.md.
 *
 * An import session stages items (file rows or scans) with four raw fields — `tipo_bono`,
 * `grupo_pata`, `numero_base`, `barcode` — and validation gives each live item a status:
 *
 * - `error` (blocking) with one `error_code` / message, chosen in this order:
 *   1. row checks ({@link interpretImportItem}): type, barcode, pata group, base number (format,
 *      read from the barcode per `barcode_mode`, consistency, range, associated overflow);
 *   2. `pata_incomplete`: a `grupo_pata` with fewer than 2 rows that pass the row checks;
 *   3. `duplicate_number_in_batch`: a participating number (base or associated) used twice in the
 *      session (also inside the same pata);
 *   4. `duplicate_barcode_in_batch`: a code used twice in the session's single namespace (row
 *      barcodes and pata group codes: the group code becomes the pata bond's barcode);
 *   5. `duplicate_number_in_campaign` / 6. `duplicate_barcode_in_campaign`: already used by a live
 *      bond of the campaign.
 * - `warning` (not blocking): `base_number_not_padded`, the base number was written with fewer
 *   digits than the campaign uses ("68" in a 4-digit campaign), e.g. a spreadsheet that dropped
 *   the leading zeros. Only explicit `numero_base` values and `base_number`-mode barcodes are
 *   checked (pattern captures are not).
 * - `valid` otherwise. The client preview can also yield `pending` when the campaign pattern
 *   cannot be applied in JavaScript (see `barcodes.ts`); the database never does.
 *
 * The database (`import_session_validate`, migration `20261126000000_import_staging_rpcs.sql`)
 * runs the same rules against the live campaign data and is the authority; codes, statuses and
 * messages are the same on both sides (cross-checked by the integration tests).
 */
import { BARCODE_MAX_LENGTH, compileBarcodePattern, isNumberText, padNumber, readBarcode } from './barcodes';
import type { BarcodeRules } from './barcodes';
import type { BondKind } from './bonds';
import { MIN_PATA_SIZE } from './bonds';
import { DomainError } from './errors';
import type { CampaignNumberingConfig } from './numbering';

/** Most rows in one file / live items in one session. */
export const IMPORT_MAX_ROWS = 5000;
/** Largest upload accepted (CSV or .xlsx). */
export const IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Longest raw field value (each of the four columns). */
export const IMPORT_FIELD_MAX_LENGTH = 500;
/** Longest stored raw row text (longer is truncated). */
export const IMPORT_RAW_MAX_LENGTH = 2000;
/** Rows listed in a duplicate message before "and N more". */
export const DUPLICATE_ROWS_LISTED = 10;

export const IMPORT_COLUMNS = ['tipo_bono', 'grupo_pata', 'numero_base', 'barcode'] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const IMPORT_SOURCE_TYPES = ['barcode_scan', 'csv_file', 'excel_file'] as const;
export type ImportSourceType = (typeof IMPORT_SOURCE_TYPES)[number];

export const IMPORT_SESSION_STATUSES = [
	'draft',
	'validated',
	'confirmed',
	'cancelled',
	'failed'
] as const;
export type ImportSessionStatus = (typeof IMPORT_SESSION_STATUSES)[number];

export const IMPORT_ITEM_STATUSES = ['pending', 'valid', 'warning', 'error'] as const;
export type ImportItemStatus = (typeof IMPORT_ITEM_STATUSES)[number];

export const IMPORT_ERROR_CODES = [
	'missing_type',
	'invalid_type',
	'missing_barcode',
	'barcode_too_long',
	'simple_with_group',
	'missing_group',
	'group_too_long',
	'invalid_barcode',
	'barcode_pattern_mismatch',
	'invalid_base_number',
	'missing_base_number',
	'base_number_mismatch',
	'out_of_range',
	'overflow',
	'pata_incomplete',
	'duplicate_number_in_batch',
	'duplicate_barcode_in_batch',
	'duplicate_number_in_campaign',
	'duplicate_barcode_in_campaign'
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

export const IMPORT_WARNING_CODES = ['base_number_not_padded'] as const;
export type ImportWarningCode = (typeof IMPORT_WARNING_CODES)[number];

/** The four raw fields of a row / scan. `null` = empty. */
export interface ImportRawItem {
	tipoBono: string | null;
	grupoPata: string | null;
	numeroBase: string | null;
	barcode: string | null;
}

export interface ImportIssue<Code extends string = string> {
	code: Code;
	message: string;
}

export type ImportRules = BarcodeRules &
	Pick<CampaignNumberingConfig, 'maxNumber' | 'associatedNumberOffset'>;

/**
 * Trims spaces, tabs and line breaks (the same set as SQL `btrim(x, E' \t\r\n')`); blank → null.
 */
export function normalizeField(value: string | null | undefined): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
	return trimmed === '' ? null : trimmed;
}

export function normalizeRawItem(raw: Partial<ImportRawItem>): ImportRawItem {
	return {
		tipoBono: normalizeField(raw.tipoBono),
		grupoPata: normalizeField(raw.grupoPata),
		numeroBase: normalizeField(raw.numeroBase),
		barcode: normalizeField(raw.barcode)
	};
}

// ---------------------------------------------------------------------------
// Row interpretation
// ---------------------------------------------------------------------------

export interface ItemInterpretation {
	/** Trimmed barcode, null when missing or too long. */
	barcode: string | null;
	/** Stored item type: `simple`, or `pata` only with a valid group. */
	itemType: BondKind | null;
	/** Pata group code (pata rows only). */
	groupKey: string | null;
	/** The base number when it could be determined and is within the campaign maximum. */
	baseNumber: number | null;
	/** First row-level blocking problem. */
	error: ImportIssue<ImportErrorCode> | null;
	warning: ImportIssue<ImportWarningCode> | null;
	/** The pattern cannot be applied in JavaScript: only the database can read this barcode. */
	undetermined: boolean;
}

/**
 * Row-level checks of one item (see the module comment for the order). `compiled` is the
 * campaign pattern compiled once per batch (`compileBarcodePattern`).
 */
export function interpretImportItem(
	input: ImportRawItem,
	rules: ImportRules,
	compiled: RegExp | null = compileBarcodePattern(rules.barcodePattern)
): ItemInterpretation {
	const raw = normalizeRawItem(input);
	const digits = rules.numberDigits;
	const pad = (v: number) => padNumber(v, digits);

	const type = raw.tipoBono?.toLowerCase() ?? null;
	const kind: BondKind | null = type === 'simple' || type === 'pata' ? type : null;
	const group = raw.grupoPata;
	const b = raw.barcode;
	const n = raw.numeroBase;

	const barcode = b !== null && b.length <= BARCODE_MAX_LENGTH ? b : null;
	const groupKey = kind === 'pata' && group !== null && group.length <= BARCODE_MAX_LENGTH ? group : null;
	const itemType: BondKind | null = kind === 'simple' ? 'simple' : groupKey !== null ? 'pata' : null;

	let error: ImportIssue<ImportErrorCode> | null = null;
	const fail = (code: ImportErrorCode, message: string) => {
		error ??= { code, message };
	};

	if (raw.tipoBono === null) fail('missing_type', 'Bond type is required (simple or pata)');
	else if (kind === null) fail('invalid_type', `Unknown bond type "${raw.tipoBono}" (use simple or pata)`);

	if (b === null) fail('missing_barcode', 'Barcode is required');
	else if (b.length > BARCODE_MAX_LENGTH)
		fail('barcode_too_long', `Barcode must be at most ${BARCODE_MAX_LENGTH} characters`);

	if (kind === 'simple' && group !== null) {
		fail('simple_with_group', `A simple bond cannot belong to a pata group ("${group}")`);
	} else if (kind === 'pata' && group === null) {
		fail('missing_group', 'A pata row needs a pata group (grupo_pata)');
	} else if (kind === 'pata' && group !== null && group.length > BARCODE_MAX_LENGTH) {
		fail('group_too_long', `Pata group must be at most ${BARCODE_MAX_LENGTH} characters`);
	}

	let baseNumber: number | null = null;
	let warning: ImportIssue<ImportWarningCode> | null = null;
	let undetermined = false;

	if (barcode !== null) {
		const reading = readBarcode(barcode, rules, compiled);
		if (reading.kind === 'error') {
			fail(reading.code, reading.message);
		} else if (reading.kind === 'undetermined') {
			undetermined = true;
		} else if (n !== null && !isNumberText(n, digits)) {
			fail('invalid_base_number', `Base number "${n}" must be a number of up to ${digits} digits`);
		} else if (reading.kind === 'none' && n === null) {
			fail('missing_base_number', "Base number is required: this campaign's barcodes do not carry it");
		} else {
			const typed = n === null ? null : Number(n);
			const read = reading.kind === 'number' ? reading.value : null;
			if (typed !== null && read !== null && typed !== read) {
				fail(
					'base_number_mismatch',
					`Base number ${pad(typed)} does not match the number in barcode "${barcode}" (${pad(read)})`
				);
			} else {
				const value = (read ?? typed) as number;
				if (value > rules.maxNumber) {
					fail(
						'out_of_range',
						`Number ${pad(value)} exceeds the campaign maximum number ${pad(rules.maxNumber)}`
					);
				} else {
					baseNumber = value;
					if (value + rules.associatedNumberOffset > rules.maxNumber) {
						fail(
							'overflow',
							`Base number ${pad(value)} overflows: its associated number ` +
								`${pad(value + rules.associatedNumberOffset)} exceeds the campaign maximum number ` +
								`${pad(rules.maxNumber)} (the highest allowed base number is ` +
								`${pad(rules.maxNumber - rules.associatedNumberOffset)})`
						);
					}
					const written = n ?? (rules.barcodeMode === 'base_number' ? barcode : null);
					if (written !== null && written.length < digits) {
						warning = {
							code: 'base_number_not_padded',
							message: `Base number "${written}" is not padded to ${digits} digits (read as ${pad(value)})`
						};
					}
				}
			}
		}
	}

	return {
		barcode,
		itemType,
		groupKey,
		baseNumber,
		error,
		warning: error ? null : warning,
		undetermined: error ? false : undetermined
	};
}

// ---------------------------------------------------------------------------
// Batch validation
// ---------------------------------------------------------------------------

export interface ImportBatchItem {
	/** Caller's identifier (item id, or the row number as a string). */
	key: string;
	rowNumber: number;
	raw: ImportRawItem;
}

/** Live data of the campaign: participating numbers and codes held by live bonds. */
export interface ExistingCampaignData {
	/** number value → bond id. */
	numbers: ReadonlyMap<number, string>;
	/** barcode (bonds.barcode or bond_numbers.barcode) → bond id. */
	barcodes: ReadonlyMap<string, string>;
}

export interface ImportItemResult extends ItemInterpretation {
	key: string;
	rowNumber: number;
	status: ImportItemStatus;
	errorCode: string | null;
	/** Message of the error or warning. */
	errorMessage: string | null;
}

export interface ImportSummary {
	totalItems: number;
	valid: number;
	warnings: number;
	errors: number;
	pending: number;
	/** Accepted (valid or warning) simple rows: the simple bonds confirmation would create. */
	simpleBonds: number;
	/** Distinct pata groups among accepted pata rows. */
	patas: number;
	/** Accepted rows (each one base number). */
	baseNumbers: number;
	/** Base + associated numbers of the accepted rows. */
	participatingNumbers: number;
	/** Items whose error is a duplicate (in the batch or in the campaign). */
	duplicates: number;
}

/** "row 4" / "rows 2, 5" / "rows 1, 2, ... and 3 more" (same as SQL `import_rows_label`). */
export function rowsLabel(rows: readonly number[]): string {
	const sorted = [...new Set(rows)].sort((a, b) => a - b);
	const shown = sorted.slice(0, DUPLICATE_ROWS_LISTED).join(', ');
	const more = sorted.length - DUPLICATE_ROWS_LISTED;
	return `${sorted.length === 1 ? 'row' : 'rows'} ${shown}${more > 0 ? ` and ${more} more` : ''}`;
}

/**
 * Validates every live item of a session (see the module comment). Without `existing`, campaign
 * duplicates are not checked (instant client feedback); the database always checks them.
 */
export function validateImportBatch(
	items: readonly ImportBatchItem[],
	rules: ImportRules,
	existing?: ExistingCampaignData
): { items: ImportItemResult[]; summary: ImportSummary } {
	const compiled = compileBarcodePattern(rules.barcodePattern);
	const pad = (v: number) => padNumber(v, rules.numberDigits);
	const rows = items.map((item) => ({
		item,
		r: interpretImportItem(item.raw, rules, compiled)
	}));

	// 2. Pata groups with fewer than MIN_PATA_SIZE rows that pass the row checks.
	const groups = new Map<string, { rows: number[]; ok: number }>();
	for (const { item, r } of rows) {
		if (r.itemType !== 'pata' || r.groupKey === null) continue;
		const g = groups.get(r.groupKey) ?? { rows: [], ok: 0 };
		g.rows.push(item.rowNumber);
		if (r.error === null) g.ok += 1;
		groups.set(r.groupKey, g);
	}

	// Rows whose numbers take part in the duplicate checks: row checks passed, number known.
	const numbered = rows.filter(({ r }) => r.error === null && r.baseNumber !== null);

	// 3. Participating numbers repeated in the batch.
	const numberRows = new Map<number, number[]>();
	for (const { item, r } of numbered) {
		const base = r.baseNumber as number;
		for (const v of [base, base + rules.associatedNumberOffset]) {
			numberRows.set(v, [...(numberRows.get(v) ?? []), item.rowNumber]);
		}
	}

	// 4. One code namespace: row barcodes (owner = the row) and group codes (owner = the group).
	const codeOwners = new Map<string, Set<string>>();
	const codeRows = new Map<string, number[]>();
	const addCode = (code: string, owner: string, rowNumber: number) => {
		codeOwners.set(code, (codeOwners.get(code) ?? new Set()).add(owner));
		codeRows.set(code, [...(codeRows.get(code) ?? []), rowNumber]);
	};
	for (const { item, r } of rows) {
		if (r.barcode !== null) addCode(r.barcode, `r:${item.rowNumber}`, item.rowNumber);
		if (r.itemType === 'pata' && r.groupKey !== null) {
			addCode(r.groupKey, `g:${r.groupKey}`, item.rowNumber);
		}
	}
	const codeRepeated = (code: string | null) =>
		code !== null && (codeOwners.get(code)?.size ?? 0) > 1;

	const results: ImportItemResult[] = rows.map(({ item, r }) => {
		let issue: ImportIssue | null = r.error;
		const isNumbered = r.error === null && r.baseNumber !== null;

		if (!issue && r.itemType === 'pata' && r.groupKey !== null) {
			const g = groups.get(r.groupKey);
			if (g && g.ok < MIN_PATA_SIZE) {
				issue = {
					code: 'pata_incomplete',
					message: `Pata "${r.groupKey}" needs at least ${MIN_PATA_SIZE} valid rows (it has ${g.ok})`
				};
			}
		}

		const values = isNumbered
			? [r.baseNumber as number, (r.baseNumber as number) + rules.associatedNumberOffset]
			: [];

		if (!issue) {
			const repeated = values
				.filter((v) => (numberRows.get(v)?.length ?? 0) > 1)
				.sort((a, b) => a - b)[0];
			if (repeated !== undefined) {
				issue = {
					code: 'duplicate_number_in_batch',
					message: `Number ${pad(repeated)} is repeated in this import (${rowsLabel(numberRows.get(repeated) ?? [])})`
				};
			}
		}

		if (!issue) {
			const code = codeRepeated(r.barcode)
				? r.barcode
				: r.itemType === 'pata' && codeRepeated(r.groupKey)
					? r.groupKey
					: null;
			if (code !== null) {
				issue = {
					code: 'duplicate_barcode_in_batch',
					message: `Barcode "${code}" is repeated in this import (${rowsLabel(codeRows.get(code) ?? [])})`
				};
			}
		}

		if (!issue && existing) {
			const used = values.filter((v) => existing.numbers.has(v)).sort((a, b) => a - b)[0];
			if (used !== undefined) {
				issue = {
					code: 'duplicate_number_in_campaign',
					message: `Number ${pad(used)} is already used by bond ${existing.numbers.get(used)}`
				};
			}
		}

		if (!issue && existing) {
			const code =
				r.barcode !== null && existing.barcodes.has(r.barcode)
					? r.barcode
					: r.itemType === 'pata' && r.groupKey !== null && existing.barcodes.has(r.groupKey)
						? r.groupKey
						: null;
			if (code !== null) {
				issue = {
					code: 'duplicate_barcode_in_campaign',
					message: `Barcode "${code}" is already used by bond ${existing.barcodes.get(code)}`
				};
			}
		}

		const status: ImportItemStatus = issue
			? 'error'
			: r.undetermined
				? 'pending'
				: r.warning
					? 'warning'
					: 'valid';
		const shown = issue ?? (status === 'warning' ? r.warning : null);
		return {
			...r,
			key: item.key,
			rowNumber: item.rowNumber,
			status,
			errorCode: shown?.code ?? null,
			errorMessage: shown?.message ?? null
		};
	});

	return { items: results, summary: summarizeImportItems(results) };
}

/** Preview metrics over live items (same definitions as `import_session_validate`). */
export function summarizeImportItems(
	items: readonly Pick<ImportItemResult, 'status' | 'itemType' | 'groupKey' | 'errorCode'>[]
): ImportSummary {
	const accepted = items.filter((i) => i.status === 'valid' || i.status === 'warning');
	const baseNumbers = accepted.length;
	return {
		totalItems: items.length,
		valid: items.filter((i) => i.status === 'valid').length,
		warnings: items.filter((i) => i.status === 'warning').length,
		errors: items.filter((i) => i.status === 'error').length,
		pending: items.filter((i) => i.status === 'pending').length,
		simpleBonds: accepted.filter((i) => i.itemType === 'simple').length,
		patas: new Set(accepted.filter((i) => i.itemType === 'pata').map((i) => i.groupKey)).size,
		baseNumbers,
		participatingNumbers: baseNumbers * 2,
		duplicates: items.filter((i) => i.status === 'error' && i.errorCode?.startsWith('duplicate_'))
			.length
	};
}

// ---------------------------------------------------------------------------
// Files: table → rows
// ---------------------------------------------------------------------------

export type ImportFileErrorCode =
	| 'unsupported_file'
	| 'file_too_large'
	| 'invalid_file'
	| 'empty_file'
	| 'missing_columns'
	| 'duplicate_column'
	| 'too_many_rows'
	| 'value_too_long';

export class ImportFileError extends DomainError<ImportFileErrorCode> {}

/** A data row of a file: its position in the sheet (header = row 1) and its raw fields. */
export interface ImportFileRow extends ImportRawItem {
	rowNumber: number;
	/** The row as written (cells joined with the delimiter), at most IMPORT_RAW_MAX_LENGTH. */
	raw: string;
}

export interface TableRow {
	/** 1-based row (line) number in the source. */
	rowNumber: number;
	cells: string[];
}

/** Header names accepted for each column (compared without accents, case, spaces or hyphens). */
const HEADER_ALIASES: Record<ImportColumn, readonly string[]> = {
	tipo_bono: ['tipo_bono', 'tipo', 'tipo_de_bono', 'bond_type', 'type', 'kind'],
	grupo_pata: ['grupo_pata', 'grupo', 'pata', 'grupo_de_pata', 'pata_group', 'group', 'group_key'],
	numero_base: ['numero_base', 'numero', 'nro_base', 'base_number', 'number', 'base'],
	barcode: ['barcode', 'codigo_barras', 'codigo_de_barras', 'codigo', 'bar_code', 'code']
};

export function normalizeHeader(header: string): string {
	return header
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.trim()
		.replace(/[\s-]+/g, '_');
}

function columnFor(header: string): ImportColumn | null {
	const h = normalizeHeader(header);
	return IMPORT_COLUMNS.find((c) => HEADER_ALIASES[c].includes(h)) ?? null;
}

/**
 * Turns a table (header row first) into import rows. Blank rows are skipped; unknown columns are
 * ignored. @throws ImportFileError `empty_file`, `missing_columns`, `duplicate_column`,
 * `too_many_rows`, `value_too_long`.
 */
export function rowsFromTable(table: readonly TableRow[], joiner = ','): ImportFileRow[] {
	const nonBlank = table.filter((row) => row.cells.some((c) => normalizeField(c) !== null));
	const [header, ...data] = nonBlank;
	if (!header) throw new ImportFileError('empty_file', 'The file is empty');

	const index = new Map<ImportColumn, number>();
	header.cells.forEach((cell, i) => {
		const column = columnFor(cell);
		if (!column) return;
		if (index.has(column)) {
			throw new ImportFileError('duplicate_column', `The column ${column} appears more than once`);
		}
		index.set(column, i);
	});
	const missing = IMPORT_COLUMNS.filter((c) => !index.has(c));
	if (missing.length > 0) {
		throw new ImportFileError(
			'missing_columns',
			`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')} ` +
				`(the header row must be ${IMPORT_COLUMNS.join(',')})`
		);
	}
	if (data.length === 0) throw new ImportFileError('empty_file', 'The file has no data rows');
	if (data.length > IMPORT_MAX_ROWS) {
		throw new ImportFileError(
			'too_many_rows',
			`The file has ${data.length} rows; at most ${IMPORT_MAX_ROWS} can be imported at once`
		);
	}

	return data.map((row) => {
		const cell = (column: ImportColumn) => {
			const value = row.cells[index.get(column) as number] ?? '';
			if (value.length > IMPORT_FIELD_MAX_LENGTH) {
				throw new ImportFileError(
					'value_too_long',
					`Row ${row.rowNumber}: ${column} is longer than ${IMPORT_FIELD_MAX_LENGTH} characters`
				);
			}
			return normalizeField(value);
		};
		return {
			rowNumber: row.rowNumber,
			raw: row.cells.join(joiner).slice(0, IMPORT_RAW_MAX_LENGTH),
			tipoBono: cell('tipo_bono'),
			grupoPata: cell('grupo_pata'),
			numeroBase: cell('numero_base'),
			barcode: cell('barcode')
		};
	});
}
