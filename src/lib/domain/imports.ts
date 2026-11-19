/**
 * Bond import staging rules (pure, client-safe). SAN-45, docs/imports.md.
 *
 * The database owns staging and validation (migration `20261126000000_import_staging.sql`):
 * `import_session_add_items` stores rows already interpreted by the app (item type, pata group,
 * base number, barcode) and `import_session_revalidate` / `import_session_check_groups` give every
 * live row a status. This module is the app side of that contract:
 *
 * 1. {@link interpretImportRow}: a file row (`tipo_bono`, `grupo_pata`, `numero_base`, `barcode`)
 *    → the staged row `import_session_add_items` expects. Problems the database cannot express
 *    (an unknown type, a barcode that does not carry a number...) become `parse_*` errors, which
 *    the database keeps as sent. The barcode is read per `barcode_mode` exactly like
 *    `import_session_add_scan` does (`barcodes.ts`).
 * 2. {@link validateImportBatch}: an instant-preview mirror of the database validation, with the
 *    same codes, messages and precedence (first match wins):
 *    parse_* (kept) → missing_type → missing_base_number → missing_barcode (pata) → missing_group
 *    (pata) → number_out_of_range → number_conflict → number_in_use → duplicate_barcode →
 *    barcode_in_use (row barcode, then pata code) → duplicate_barcode (pata code used as a row
 *    barcode) → valid; then, when validating, incomplete_pata.
 * 3. {@link summarizeImportItems}: the counts of `import_session_summary`.
 *
 * The database never yields `warning` (the status exists for later checks) and validation never
 * leaves a row `pending`. `tests/integration/import-staging.test.ts` keeps both sides in
 * agreement.
 */
import {
	BARCODE_MAX_LENGTH,
	baseNumberRequiredMessage,
	compileBarcodePattern,
	padNumber,
	parseBaseNumberText,
	readBarcode
} from './barcodes';
import type { BarcodeRules } from './barcodes';
import type { BondKind } from './bonds';
import { MIN_PATA_SIZE } from './bonds';
import { DomainError } from './errors';
import type { CampaignNumberingConfig } from './numbering';

/** Most data rows in one file. */
export const IMPORT_MAX_ROWS = 5000;
/** Most rows `import_session_add_items` stages per call (larger files are sent in batches). */
export const IMPORT_BATCH_MAX_ROWS = 1000;
/** Largest upload accepted (CSV or .xlsx). */
export const IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Longest raw field value (each of the four columns). */
export const IMPORT_FIELD_MAX_LENGTH = 500;
/** Longest stored raw row text (longer is truncated; the database limit). */
export const IMPORT_RAW_MAX_LENGTH = 2000;

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

/** Codes the database stages on rows (`import_session_revalidate` / `_check_groups`). */
export const IMPORT_ERROR_CODES = [
	'missing_type',
	'missing_base_number',
	'missing_group',
	'missing_barcode',
	'number_out_of_range',
	'number_conflict',
	'duplicate_number',
	'number_in_use',
	'duplicate_barcode',
	'barcode_in_use',
	'incomplete_pata'
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

/**
 * Codes the app's file parser stages (the database keeps `parse_*` codes as sent).
 * `import_session_add_scan` uses three of them for scans: `parse_code_not_a_number`,
 * `parse_code_not_recognized`, `parse_base_number_required`.
 */
export const IMPORT_PARSE_ERROR_CODES = [
	'parse_invalid_type',
	'parse_barcode_too_long',
	'parse_simple_with_group',
	'parse_missing_group',
	'parse_group_too_long',
	'parse_invalid_base_number',
	'parse_code_not_a_number',
	'parse_code_not_recognized',
	'parse_base_number_required',
	'parse_base_number_mismatch',
	'parse_pattern_not_supported'
] as const;
export type ImportParseErrorCode = (typeof IMPORT_PARSE_ERROR_CODES)[number];

/** Codes `import_session_summary` counts as duplicates. */
export const IMPORT_DUPLICATE_CODES = [
	'duplicate_number',
	'number_conflict',
	'duplicate_barcode',
	'number_in_use',
	'barcode_in_use'
] as const;

/** Same test as the database's `error_code like 'parse\_%'`. */
export function isParseErrorCode(code: string | null | undefined): boolean {
	return code != null && code.startsWith('parse_');
}

/** The four raw fields of a file row. `null` = empty. */
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
// File row → staged row
// ---------------------------------------------------------------------------

/** A row as `import_session_add_items` takes it (camelCase of its JSON keys). */
export interface StagedImportRow {
	rowNumber: number;
	rawValue: string | null;
	/** The raw fields as read from the file (`tipo_bono`, `grupo_pata`, `numero_base`, `barcode`). */
	parsedValue: Record<string, string | null>;
	barcode: string | null;
	itemType: BondKind | null;
	groupKey: string | null;
	baseNumber: number | null;
	/** A `parse_*` code, or null (the database decides the rest). */
	errorCode: ImportParseErrorCode | null;
	errorMessage: string | null;
}

/**
 * Interprets one file row for staging. The first problem wins (type, barcode length, pata group,
 * `numero_base` format, barcode reading per `barcode_mode`); a row with a parse error carries no
 * base number. Rows without a type or a base number are staged without an error: the database
 * reports them (`missing_type`, `missing_base_number`). `compiled` is the campaign pattern
 * compiled once per batch.
 */
export function interpretImportRow(
	row: Partial<ImportRawItem> & { rowNumber: number; raw?: string | null },
	rules: BarcodeRules,
	compiled: RegExp | null = compileBarcodePattern(rules.barcodePattern)
): StagedImportRow {
	const f = normalizeRawItem(row);
	const type = f.tipoBono?.toLowerCase() ?? null;
	const kind: BondKind | null = type === 'simple' || type === 'pata' ? type : null;

	let error: ImportIssue<ImportParseErrorCode> | null = null;
	const fail = (code: ImportParseErrorCode, message: string) => {
		error ??= { code, message };
	};

	if (f.tipoBono !== null && kind === null) {
		fail('parse_invalid_type', `Unknown bond type ${f.tipoBono} (use simple or pata).`);
	}

	let barcode = f.barcode;
	if (barcode !== null && barcode.length > BARCODE_MAX_LENGTH) {
		fail('parse_barcode_too_long', `The barcode is longer than ${BARCODE_MAX_LENGTH} characters.`);
		barcode = null;
	}

	// The database rejects (22023) a pata row without group and a simple row with one: never send
	// them; stage a parse error instead.
	let itemType: BondKind | null = kind;
	let groupKey: string | null = kind === 'pata' ? f.grupoPata : null;
	if (kind === 'simple' && f.grupoPata !== null) {
		fail('parse_simple_with_group', `A simple bond cannot belong to the pata ${f.grupoPata}.`);
	} else if (kind === 'pata' && f.grupoPata === null) {
		fail('parse_missing_group', 'Every row of a pata needs its grupo_pata.');
		itemType = null;
	} else if (kind === 'pata' && (f.grupoPata as string).length > BARCODE_MAX_LENGTH) {
		fail('parse_group_too_long', `The grupo_pata is longer than ${BARCODE_MAX_LENGTH} characters.`);
		itemType = null;
		groupKey = null;
	}

	const typed = f.numeroBase === null ? null : parseBaseNumberText(f.numeroBase);
	if (f.numeroBase !== null && typed === null) {
		fail('parse_invalid_base_number', `Base number ${f.numeroBase} is not a whole number.`);
	}

	let baseNumber = typed;
	if (barcode !== null) {
		const reading = readBarcode(barcode, rules, compiled);
		if (reading.kind === 'error') {
			fail(reading.code, reading.message);
		} else if (reading.kind === 'undetermined') {
			if (f.numeroBase === null) {
				fail(
					'parse_pattern_not_supported',
					`Barcode ${barcode} cannot be read with the campaign pattern here: type the base number.`
				);
			}
		} else if (reading.kind === 'none') {
			if (f.numeroBase === null) {
				fail('parse_base_number_required', baseNumberRequiredMessage(rules));
			}
		} else if (typed !== null && typed !== reading.value) {
			fail(
				'parse_base_number_mismatch',
				`Base number ${f.numeroBase} does not match barcode ${barcode} (${reading.value}).`
			);
		} else {
			baseNumber = reading.value;
		}
	}

	const issue = error as ImportIssue<ImportParseErrorCode> | null;
	return {
		rowNumber: row.rowNumber,
		rawValue: row.raw == null ? null : row.raw.slice(0, IMPORT_RAW_MAX_LENGTH),
		parsedValue: {
			tipo_bono: f.tipoBono,
			grupo_pata: f.grupoPata,
			numero_base: f.numeroBase,
			barcode: f.barcode
		},
		barcode,
		itemType,
		groupKey,
		baseNumber: issue ? null : baseNumber,
		errorCode: issue?.code ?? null,
		errorMessage: issue?.message ?? null
	};
}

// ---------------------------------------------------------------------------
// Validation mirror
// ---------------------------------------------------------------------------

/** A live staged row as the validator sees it (from {@link interpretImportRow} or the table). */
export interface ImportBatchItem {
	/** Caller's identifier (item id, or the row number as a string). */
	key: string;
	rowNumber: number;
	itemType: BondKind | null;
	groupKey: string | null;
	baseNumber: number | null;
	barcode: string | null;
	/** Only `parse_*` codes are kept; any other code is recomputed. */
	errorCode: string | null;
	errorMessage: string | null;
}

/** Staged rows → validator input (key = row number). */
export function batchItemsFromStaged(rows: readonly StagedImportRow[]): ImportBatchItem[] {
	return rows.map((r) => ({
		key: String(r.rowNumber),
		rowNumber: r.rowNumber,
		itemType: r.itemType,
		groupKey: r.groupKey,
		baseNumber: r.baseNumber,
		barcode: r.barcode,
		errorCode: r.errorCode,
		errorMessage: r.errorMessage
	}));
}

/** Live data of the campaign: participating numbers and codes held by live bonds. */
export interface ExistingCampaignData {
	/** number value → bond id (unreleased `bond_numbers`). */
	numbers: ReadonlyMap<number, string>;
	/** barcode (live `bonds.barcode` or unreleased `bond_numbers.barcode`) → bond id. */
	barcodes: ReadonlyMap<string, string>;
}

export interface ImportItemResult extends ImportBatchItem {
	status: ImportItemStatus;
}

/** The counts of `import_session_summary` (camelCase) over the live rows. */
export interface ImportSummary {
	liveItems: number;
	simpleItems: number;
	pataRows: number;
	pataGroups: number;
	errors: number;
	warnings: number;
	pending: number;
	/** Rows in error with a duplicate / in-use code. */
	duplicates: number;
	/** At least one live row and none pending or in error. */
	valid: boolean;
	/** Distinct base numbers of the live rows. */
	baseNumbers: number;
	/** Distinct base + associated numbers of the live rows. */
	participatingNumbers: number;
}

export interface ValidateImportOptions {
	/**
	 * Mark pata groups with fewer than MIN_PATA_SIZE live rows `incomplete_pata`, as
	 * `import_session_validate` does (staging does not). Default true.
	 */
	checkGroups?: boolean;
}

/**
 * Mirrors `import_session_revalidate` (+ `import_session_check_groups` when `checkGroups`) over the
 * live rows of a session. Without `existing`, `number_in_use` / `barcode_in_use` are not checked
 * (instant client feedback); the database always checks them.
 */
export function validateImportBatch(
	items: readonly ImportBatchItem[],
	rules: Pick<ImportRules, 'numberDigits' | 'maxNumber' | 'associatedNumberOffset'>,
	existing?: ExistingCampaignData,
	options: ValidateImportOptions = {}
): { items: ImportItemResult[]; summary: ImportSummary } {
	const { checkGroups = true } = options;
	const offset = rules.associatedNumberOffset;
	const fmt = (v: number) => padNumber(v, rules.numberDigits);

	// Participating numbers of every live row with a base number (rows in error included).
	const numberOwners = new Map<number, Set<string>>();
	for (const item of items) {
		if (item.baseNumber === null) continue;
		for (const n of [item.baseNumber, item.baseNumber + offset]) {
			numberOwners.set(n, (numberOwners.get(n) ?? new Set()).add(item.key));
		}
	}
	const numberRepeated = (base: number) =>
		offset === 0 || // its base and associated numbers are the same number
		[base, base + offset].some((n) => (numberOwners.get(n)?.size ?? 0) > 1);

	// Row barcodes of the live rows without a parser error.
	const barcodeCount = new Map<string, number>();
	for (const item of items) {
		if (item.barcode === null || isParseErrorCode(item.errorCode)) continue;
		barcodeCount.set(item.barcode, (barcodeCount.get(item.barcode) ?? 0) + 1);
	}

	// Live rows per pata group (rows in error included).
	const groupSize = new Map<string, number>();
	for (const item of items) {
		if (item.itemType !== 'pata' || item.groupKey === null) continue;
		groupSize.set(item.groupKey, (groupSize.get(item.groupKey) ?? 0) + 1);
	}

	const firstIssue = (item: ImportBatchItem): ImportIssue<ImportErrorCode> | null => {
		const base = item.baseNumber;
		if (item.itemType === null) {
			return {
				code: 'missing_type',
				message: 'The row does not say whether it is a simple bond or a pata.'
			};
		}
		if (base === null) {
			return { code: 'missing_base_number', message: 'The row has no base number.' };
		}
		if (item.itemType === 'pata' && item.barcode === null) {
			return { code: 'missing_barcode', message: 'Every row of a pata needs its barcode.' };
		}
		if (item.itemType === 'pata' && item.groupKey === null) {
			return { code: 'missing_group', message: 'Every row of a pata needs its grupo_pata.' };
		}
		if (base > rules.maxNumber || base + offset > rules.maxNumber) {
			return {
				code: 'number_out_of_range',
				message: `Number ${fmt(base)} does not fit the campaign (maximum ${fmt(rules.maxNumber)}).`
			};
		}
		if (numberRepeated(base)) {
			return {
				code: 'number_conflict',
				message: 'This number (or its associated number) is repeated in the import.'
			};
		}
		const used = existing ? [base, base + offset].filter((n) => existing.numbers.has(n)) : [];
		if (used.length > 0) {
			return {
				code: 'number_in_use',
				message: `Number ${fmt(Math.min(...used))} is already used by a bond of this campaign.`
			};
		}
		if (item.barcode !== null && (barcodeCount.get(item.barcode) ?? 0) > 1) {
			return {
				code: 'duplicate_barcode',
				message: `Barcode ${item.barcode} is repeated in the import.`
			};
		}
		if (item.barcode !== null && existing?.barcodes.has(item.barcode)) {
			return {
				code: 'barcode_in_use',
				message: `Barcode ${item.barcode} is already used in this campaign.`
			};
		}
		if (item.itemType === 'pata' && item.groupKey !== null) {
			if (existing?.barcodes.has(item.groupKey)) {
				return {
					code: 'barcode_in_use',
					message: `The pata code ${item.groupKey} is already used in this campaign.`
				};
			}
			if (barcodeCount.has(item.groupKey)) {
				return {
					code: 'duplicate_barcode',
					message: `The pata code ${item.groupKey} is also used as a row barcode in this import.`
				};
			}
		}
		return null;
	};

	const results: ImportItemResult[] = items.map((item) => {
		let issue: ImportIssue | null =
			isParseErrorCode(item.errorCode) && item.errorMessage !== null
				? { code: item.errorCode as string, message: item.errorMessage }
				: firstIssue(item);
		const size = item.groupKey === null ? 0 : (groupSize.get(item.groupKey) ?? 0);
		if (!issue && checkGroups && item.itemType === 'pata' && size < MIN_PATA_SIZE) {
			issue = {
				code: 'incomplete_pata',
				message: `A pata needs at least ${MIN_PATA_SIZE} rows (this group has ${size}).`
			};
		}
		return {
			...item,
			status: issue ? 'error' : 'valid',
			errorCode: issue?.code ?? null,
			errorMessage: issue?.message ?? null
		};
	});

	return { items: results, summary: summarizeImportItems(results, offset) };
}

/** The counts of `import_session_summary` over the given live rows. */
export function summarizeImportItems(
	items: readonly Pick<
		ImportItemResult,
		'status' | 'itemType' | 'groupKey' | 'baseNumber' | 'errorCode'
	>[],
	associatedNumberOffset: number
): ImportSummary {
	const count = (pred: (i: (typeof items)[number]) => boolean) => items.filter(pred).length;
	const bases = new Set<number>();
	const participating = new Set<number>();
	for (const i of items) {
		if (i.baseNumber === null) continue;
		bases.add(i.baseNumber);
		participating.add(i.baseNumber).add(i.baseNumber + associatedNumberOffset);
	}
	return {
		liveItems: items.length,
		simpleItems: count((i) => i.itemType === 'simple'),
		pataRows: count((i) => i.itemType === 'pata'),
		pataGroups: new Set(items.filter((i) => i.itemType === 'pata').map((i) => i.groupKey)).size,
		errors: count((i) => i.status === 'error'),
		warnings: count((i) => i.status === 'warning'),
		pending: count((i) => i.status === 'pending'),
		duplicates: count(
			(i) =>
				i.status === 'error' &&
				(IMPORT_DUPLICATE_CODES as readonly string[]).includes(i.errorCode ?? '')
		),
		valid: items.length > 0 && count((i) => i.status === 'pending' || i.status === 'error') === 0,
		baseNumbers: bases.size,
		participatingNumbers: participating.size
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
