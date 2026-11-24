/**
 * Minimal RFC 4180 CSV reader (pure, client-safe). SAN-45.
 *
 * - Strips a leading UTF-8 BOM.
 * - Delimiter `,` or `;`, detected from the first line (the one with more delimiters outside
 *   quotes; `,` on a tie). Spreadsheets in Spanish locales export with `;`.
 * - Quoted fields (`"a, b"`), doubled quotes inside them (`"say ""hi"""`) and line breaks inside
 *   quoted fields. Line endings CRLF, LF or CR.
 * - A quote in the middle of an unquoted field is kept as a literal character.
 * - An unterminated quoted field is an error (`CsvError`), reported with the line it starts on.
 *
 * Cells are returned as written (not trimmed); empty trailing lines are dropped.
 */
import { DomainError } from './errors';

export class CsvError extends DomainError<'unterminated_quote'> {}

export type CsvDelimiter = ',' | ';';

function countOutsideQuotes(line: string, ch: string): number {
	let inQuotes = false;
	let count = 0;
	for (const c of line) {
		if (c === '"') inQuotes = !inQuotes;
		else if (c === ch && !inQuotes) count += 1;
	}
	return count;
}

export function detectCsvDelimiter(text: string): CsvDelimiter {
	const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? '';
	return countOutsideQuotes(firstLine, ';') > countOutsideQuotes(firstLine, ',') ? ';' : ',';
}

export interface CsvRecord {
	/** 1-based line where the record starts (differs from the record index with quoted breaks). */
	line: number;
	cells: string[];
}

export function parseCsv(input: string, delimiter?: CsvDelimiter): CsvRecord[] {
	const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
	const delim = delimiter ?? detectCsvDelimiter(text);
	const records: CsvRecord[] = [];
	let cells: string[] = [];
	let cell = '';
	let line = 1;
	let recordLine = 1;
	let quoteLine = 0;
	let inQuotes = false;
	let fieldStart = true;

	const endRecord = () => {
		cells.push(cell);
		records.push({ line: recordLine, cells });
		cells = [];
		cell = '';
		fieldStart = true;
	};

	for (let i = 0; i < text.length; i += 1) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					cell += '"';
					i += 1;
				} else {
					inQuotes = false;
				}
			} else {
				if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line += 1;
				cell += c;
			}
			continue;
		}
		if (c === '"' && fieldStart) {
			inQuotes = true;
			quoteLine = line;
			fieldStart = false;
		} else if (c === delim) {
			cells.push(cell);
			cell = '';
			fieldStart = true;
		} else if (c === '\r' || c === '\n') {
			if (c === '\r' && text[i + 1] === '\n') i += 1;
			endRecord();
			line += 1;
			recordLine = line;
		} else {
			cell += c;
			fieldStart = false;
		}
	}
	if (inQuotes) {
		throw new CsvError(
			'unterminated_quote',
			`Línea ${quoteLine}: un valor entre comillas no se cierra`
		);
	}
	if (cell !== '' || cells.length > 0) endRecord();

	// Drop trailing empty lines.
	while (records.length > 0 && records[records.length - 1].cells.every((v) => v === '')) {
		records.pop();
	}
	return records;
}
