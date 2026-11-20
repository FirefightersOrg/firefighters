import { describe, expect, it } from 'vitest';
import { buildCsv, csvCell } from './csv-export';
import { parseCsv } from './csv';

describe('csvCell', () => {
	it('quotes commas, quotes and line breaks', () => {
		expect(csvCell('a,b')).toBe('"a,b"');
		expect(csvCell('say "hi"')).toBe('"say ""hi"""');
		expect(csvCell('a\nb')).toBe('"a\nb"');
	});
	it('writes null/undefined as empty and keeps numbers', () => {
		expect(csvCell(null)).toBe('');
		expect(csvCell(undefined)).toBe('');
		expect(csvCell(-5)).toBe('-5');
	});
	it('neutralizes formulas only in text cells', () => {
		expect(csvCell('=SUM(A1)', { text: true })).toBe("'=SUM(A1)");
		expect(csvCell('@x', { text: true })).toBe("'@x");
		expect(csvCell('-12.50')).toBe('-12.50');
	});
});

describe('buildCsv', () => {
	type Row = { id: number; n: string | null };
	const columns = [
		{ header: 'id', value: (r: Row) => r.id },
		{ header: 'note', text: true, value: (r: Row) => r.n }
	];
	it('emits BOM, header and CRLF rows that the reader parses back', () => {
		const csv = buildCsv(columns, [
			{ id: 1, n: 'a, "b"' },
			{ id: 2, n: null }
		]);
		expect(csv.startsWith('﻿id,note\r\n')).toBe(true);
		expect(parseCsv(csv).map((r) => r.cells)).toEqual([
			['id', 'note'],
			['1', 'a, "b"'],
			['2', '']
		]);
	});
	it('emits only the header for no rows', () => {
		expect(buildCsv(columns, [])).toBe('﻿id,note\r\n');
	});
});
