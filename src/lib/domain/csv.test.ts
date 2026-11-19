import { describe, expect, it } from 'vitest';
import { CsvError, detectCsvDelimiter, parseCsv } from './csv';

const cells = (text: string) => parseCsv(text).map((r) => r.cells);

describe('parseCsv', () => {
	it('reads comma separated rows with LF, CRLF or CR endings', () => {
		expect(cells('a,b\n1,2\n')).toEqual([
			['a', 'b'],
			['1', '2']
		]);
		expect(cells('a,b\r\n1,2\r\n')).toEqual([
			['a', 'b'],
			['1', '2']
		]);
		expect(cells('a,b\r1,2')).toEqual([
			['a', 'b'],
			['1', '2']
		]);
	});

	it('detects ; and strips the BOM', () => {
		expect(detectCsvDelimiter('tipo_bono;grupo_pata;numero_base;barcode')).toBe(';');
		expect(detectCsvDelimiter('a,b;c,d')).toBe(',');
		expect(cells('﻿tipo;barcode\nsimple;0068')).toEqual([
			['tipo', 'barcode'],
			['simple', '0068']
		]);
	});

	it('handles quotes, doubled quotes, delimiters and line breaks inside quotes', () => {
		const records = parseCsv('a,b\n"x, y","say ""hi"""\n"multi\nline",z\nlast,1');
		expect(records.map((r) => r.cells)).toEqual([
			['a', 'b'],
			['x, y', 'say "hi"'],
			['multi\nline', 'z'],
			['last', '1']
		]);
		expect(records.map((r) => r.line)).toEqual([1, 2, 3, 5]);
	});

	it('keeps empty cells and a quote inside an unquoted value', () => {
		expect(cells('simple,,0068,ab"c')).toEqual([['simple', '', '0068', 'ab"c']]);
		expect(cells('a,b\n\n1,2\n\n\n')).toEqual([['a', 'b'], [''], ['1', '2']]);
	});

	it('reports an unterminated quote with its line', () => {
		expect(() => parseCsv('a,b\n1,"oops\n')).toThrow(CsvError);
		expect(() => parseCsv('a,b\n1,"oops\n')).toThrow('Line 2: a quoted value is never closed');
	});
});
