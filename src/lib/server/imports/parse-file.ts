import ExcelJS from 'exceljs';
import { CsvError, parseCsv, detectCsvDelimiter } from '$lib/domain/csv';
import {
	IMPORT_MAX_FILE_BYTES,
	IMPORT_MAX_ROWS,
	ImportFileError,
	rowsFromTable,
	type ImportFileRow,
	type ImportSourceType,
	type TableRow
} from '$lib/domain/imports';

/**
 * Bond import files → rows (server only; SAN-45, docs/imports.md "File format").
 *
 * - `.csv`: UTF-8 (with or without BOM; invalid UTF-8 falls back to Windows-1252, what Excel in
 *   Spanish saves), `,` or `;` delimiter, quoted values.
 * - `.xlsx`: the first worksheet, read with `exceljs`. Numeric cells with a zero-padding format
 *   (`0000`) keep their padding; other numbers are written plainly (68). Formulas use their cached
 *   result.
 *
 * Limits: IMPORT_MAX_FILE_BYTES per file, IMPORT_MAX_ROWS data rows. Problems throw
 * `ImportFileError` with a message that is safe to show.
 */

export interface ParsedImportFile {
	sourceType: Extract<ImportSourceType, 'csv_file' | 'excel_file'>;
	rows: ImportFileRow[];
}

export function importSourceTypeFor(
	fileName: string
): Extract<ImportSourceType, 'csv_file' | 'excel_file'> {
	const lower = fileName.trim().toLowerCase();
	if (lower.endsWith('.csv')) return 'csv_file';
	if (lower.endsWith('.xlsx')) return 'excel_file';
	throw new ImportFileError(
		'unsupported_file',
		'Tipo de archivo no admitido: subir un archivo .csv o .xlsx (el formato .xls de Excel 97-2003 no se admite)'
	);
}

function decodeText(bytes: Uint8Array): string {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return new TextDecoder('windows-1252').decode(bytes);
	}
}

function csvTable(bytes: Uint8Array): { table: TableRow[]; joiner: string } {
	const text = decodeText(bytes);
	try {
		const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
		const delimiter = detectCsvDelimiter(body);
		const records = parseCsv(body, delimiter);
		return {
			table: records.map((r) => ({ rowNumber: r.line, cells: r.cells })),
			joiner: delimiter
		};
	} catch (err) {
		if (err instanceof CsvError) throw new ImportFileError('invalid_file', err.message);
		throw err;
	}
}

/** Text of one cell as the user sees it (best effort; see the module comment). */
export function excelCellText(cell: ExcelJS.Cell): string {
	const value = cell.value;
	if (value === null || value === undefined) return '';
	if (typeof value === 'number') {
		const fmt = typeof cell.numFmt === 'string' ? cell.numFmt : '';
		const text = String(value);
		return /^0+$/.test(fmt) && Number.isInteger(value) && value >= 0
			? text.padStart(fmt.length, '0')
			: text;
	}
	if (typeof value === 'string') return value;
	if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'object') {
		if ('richText' in value) return value.richText.map((p) => p.text).join('');
		if ('result' in value) {
			const result = value.result;
			if (result === null || result === undefined) return '';
			if (typeof result === 'object' && 'error' in result) return String(result.error);
			return result instanceof Date ? result.toISOString() : String(result);
		}
		if ('text' in value && typeof value.text === 'string') return value.text;
		if ('error' in value) return String(value.error);
	}
	return cell.text ?? '';
}

async function xlsxTable(bytes: Uint8Array): Promise<TableRow[]> {
	const workbook = new ExcelJS.Workbook();
	try {
		// exceljs' typings predate the generic Buffer; any ArrayBuffer view works at runtime.
		await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
	} catch {
		throw new ImportFileError('invalid_file', 'El archivo no es un libro .xlsx válido');
	}
	const sheet = workbook.worksheets[0];
	if (!sheet) throw new ImportFileError('empty_file', 'El libro no tiene hojas');
	// Header + IMPORT_MAX_ROWS data rows (+ slack for blank rows, which are skipped later).
	if (sheet.actualRowCount > IMPORT_MAX_ROWS + 1 + 100) {
		throw new ImportFileError(
			'too_many_rows',
			`El archivo tiene unas ${sheet.actualRowCount - 1} filas; se pueden importar como máximo ${IMPORT_MAX_ROWS} a la vez`
		);
	}
	const table: TableRow[] = [];
	sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
		const cells: string[] = [];
		for (let col = 1; col <= row.cellCount; col += 1) {
			cells.push(excelCellText(row.getCell(col)));
		}
		table.push({ rowNumber, cells });
	});
	return table;
}

/**
 * Parses an uploaded CSV / .xlsx file into import rows.
 * @throws ImportFileError (`unsupported_file`, `file_too_large`, `invalid_file`, `empty_file`,
 *   `missing_columns`, `duplicate_column`, `too_many_rows`, `value_too_long`).
 */
export async function parseImportFile(file: {
	name: string;
	bytes: Uint8Array;
}): Promise<ParsedImportFile> {
	const sourceType = importSourceTypeFor(file.name);
	if (file.bytes.byteLength > IMPORT_MAX_FILE_BYTES) {
		throw new ImportFileError(
			'file_too_large',
			`El archivo es demasiado grande (máximo ${IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB)`
		);
	}
	if (file.bytes.byteLength === 0) throw new ImportFileError('empty_file', 'El archivo está vacío');

	if (sourceType === 'csv_file') {
		const { table, joiner } = csvTable(file.bytes);
		return { sourceType, rows: rowsFromTable(table, joiner) };
	}
	return { sourceType, rows: rowsFromTable(await xlsxTable(file.bytes)) };
}
