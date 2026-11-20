/**
 * CSV writer for the operational backup exports (pure, client-safe). SAN-90.
 *
 * Counterpart of `csv.ts` (reader). Output: RFC 4180 quoting, `,` delimiter, CRLF line endings,
 * UTF-8 BOM so spreadsheets in Spanish locales open accents correctly. Free-text cells that start
 * with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` (spreadsheet formula injection);
 * numeric columns use {@link CsvValue} numbers/null and are never prefixed.
 */
export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvValue, opts: { text?: boolean } = {}): string {
	if (value === null || value === undefined) return '';
	let s = String(value);
	if (opts.text && FORMULA_START.test(s)) s = `'${s}`;
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface CsvColumn<Row> {
	header: string;
	/** Free text (neutralized against formula injection). Amounts and dates are not text. */
	text?: boolean;
	value: (row: Row) => CsvValue;
}

export const CSV_BOM = '﻿';

export function csvHeaderLine<Row>(columns: readonly CsvColumn<Row>[]): string {
	return columns.map((c) => csvCell(c.header)).join(',') + '\r\n';
}

export function csvRowLines<Row>(columns: readonly CsvColumn<Row>[], rows: readonly Row[]): string {
	return rows
		.map((r) => columns.map((c) => csvCell(c.value(r), { text: c.text })).join(',') + '\r\n')
		.join('');
}

export function buildCsv<Row>(columns: readonly CsvColumn<Row>[], rows: readonly Row[]): string {
	return CSV_BOM + csvHeaderLine(columns) + csvRowLines(columns, rows);
}
