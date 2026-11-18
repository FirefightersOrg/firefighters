import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { ImportFileError } from '$lib/domain/imports';
import { importSourceTypeFor, parseImportFile } from './parse-file';

const encode = (text: string) => new TextEncoder().encode(text);

async function xlsx(rows: unknown[][], format?: (sheet: ExcelJS.Worksheet) => void) {
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet('Bonos');
	for (const row of rows) sheet.addRow(row);
	format?.(sheet);
	workbook.addWorksheet('Other').addRow(['ignored']);
	return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function fileError(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (err) {
		expect(err).toBeInstanceOf(ImportFileError);
		return (err as ImportFileError).code;
	}
	throw new Error('expected an ImportFileError');
}

describe('importSourceTypeFor', () => {
	it('accepts .csv and .xlsx only', () => {
		expect(importSourceTypeFor('Bonos.CSV')).toBe('csv_file');
		expect(importSourceTypeFor('bonos.xlsx')).toBe('excel_file');
		expect(() => importSourceTypeFor('bonos.xls')).toThrow(ImportFileError);
	});
});

describe('parseImportFile (CSV)', () => {
	it('reads the documented format', async () => {
		const parsed = await parseImportFile({
			name: 'bonos.csv',
			bytes: encode(
				'﻿tipo_bono,grupo_pata,numero_base,barcode\r\nsimple,,1658,1658\r\nsimple,,0068,0068\r\n' +
					'pata,PATA1200,1200,PATA1200-1200\r\npata,PATA1200,1315,PATA1200-1315\r\n'
			)
		});
		expect(parsed.sourceType).toBe('csv_file');
		expect(parsed.rows.map((r) => [r.rowNumber, r.tipoBono, r.grupoPata, r.numeroBase, r.barcode])).toEqual([
			[2, 'simple', null, '1658', '1658'],
			[3, 'simple', null, '0068', '0068'],
			[4, 'pata', 'PATA1200', '1200', 'PATA1200-1200'],
			[5, 'pata', 'PATA1200', '1315', 'PATA1200-1315']
		]);
	});

	it('falls back to Windows-1252 for non UTF-8 files', async () => {
		// "Número base" in Windows-1252: ú = 0xFA.
		const header = [...'tipo;grupo;N'].map((c) => c.charCodeAt(0));
		const bytes = new Uint8Array([
			...header,
			0xfa,
			...[...'mero base;barcode\nsimple;;1;1\n'].map((c) => c.charCodeAt(0))
		]);
		const parsed = await parseImportFile({ name: 'a.csv', bytes });
		expect(parsed.rows).toHaveLength(1);
		expect(parsed.rows[0]).toMatchObject({ numeroBase: '1', barcode: '1', raw: 'simple;;1;1' });
	});

	it('rejects empty, oversized and malformed files', async () => {
		expect(await fileError(parseImportFile({ name: 'a.csv', bytes: new Uint8Array() }))).toBe('empty_file');
		expect(
			await fileError(parseImportFile({ name: 'a.csv', bytes: new Uint8Array(5 * 1024 * 1024 + 1) }))
		).toBe('file_too_large');
		expect(
			await fileError(
				parseImportFile({ name: 'a.csv', bytes: encode('tipo_bono,grupo_pata,numero_base,barcode\nsimple,,"1,1\n') })
			)
		).toBe('invalid_file');
	});
});

describe('parseImportFile (.xlsx)', () => {
	it('reads the first sheet, keeping zero-padded number formats', async () => {
		const bytes = await xlsx(
			[
				['tipo_bono', 'grupo_pata', 'numero_base', 'barcode'],
				['simple', null, 68, '0068'],
				[],
				['pata', 'P1', 1200, 1200],
				['pata', 'P1', { formula: '1300+15', result: 1315 }, { richText: [{ text: '13' }, { text: '15' }] }]
			],
			(sheet) => {
				sheet.getCell('C2').numFmt = '0000';
			}
		);
		const parsed = await parseImportFile({ name: 'bonos.xlsx', bytes });
		expect(parsed.sourceType).toBe('excel_file');
		expect(parsed.rows.map((r) => [r.rowNumber, r.tipoBono, r.grupoPata, r.numeroBase, r.barcode])).toEqual([
			[2, 'simple', null, '0068', '0068'],
			[4, 'pata', 'P1', '1200', '1200'],
			[5, 'pata', 'P1', '1315', '1315']
		]);
	});

	it('rejects a file that is not a workbook', async () => {
		expect(await fileError(parseImportFile({ name: 'a.xlsx', bytes: encode('not a zip') }))).toBe(
			'invalid_file'
		);
	});
});
