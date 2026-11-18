import { describe, expect, it } from 'vitest';
import {
	IMPORT_MAX_ROWS,
	ImportFileError,
	interpretImportItem,
	normalizeField,
	rowsFromTable,
	rowsLabel,
	summarizeImportItems,
	validateImportBatch,
	type ImportBatchItem,
	type ImportRawItem,
	type ImportRules
} from './imports';

const rules: ImportRules = {
	barcodeMode: 'base_number',
	barcodePattern: null,
	numberDigits: 4,
	maxNumber: 9999,
	associatedNumberOffset: 4871
};

const raw = (
	tipoBono: string | null,
	grupoPata: string | null,
	numeroBase: string | null,
	barcode: string | null
): ImportRawItem => ({ tipoBono, grupoPata, numeroBase, barcode });

const batch = (rows: [number, ImportRawItem][]): ImportBatchItem[] =>
	rows.map(([rowNumber, r]) => ({ key: String(rowNumber), rowNumber, raw: r }));

describe('normalizeField', () => {
	it('trims spaces, tabs and line breaks; blank is null', () => {
		expect(normalizeField(' \t0068\r\n')).toBe('0068');
		expect(normalizeField('   ')).toBeNull();
		expect(normalizeField(undefined)).toBeNull();
		expect(normalizeField(' x')).toBe(' x'); // same set as SQL btrim(x, E' \t\r\n')
	});
});

describe('interpretImportItem', () => {
	it('reads simple rows and pata rows', () => {
		expect(interpretImportItem(raw('simple', null, '0068', '0068'), rules)).toEqual({
			barcode: '0068',
			itemType: 'simple',
			groupKey: null,
			baseNumber: 68,
			error: null,
			warning: null,
			undetermined: false
		});
		expect(interpretImportItem(raw(' PATA ', 'P1', null, '1200'), rules)).toMatchObject({
			itemType: 'pata',
			groupKey: 'P1',
			baseNumber: 1200,
			error: null
		});
	});

	it.each([
		[raw(null, null, null, '1'), 'missing_type', 'Bond type is required (simple or pata)'],
		[raw('doble', null, null, '1'), 'invalid_type', 'Unknown bond type "doble" (use simple or pata)'],
		[raw('simple', null, '1', null), 'missing_barcode', 'Barcode is required'],
		[raw('simple', null, null, 'x'.repeat(201)), 'barcode_too_long', 'Barcode must be at most 200 characters'],
		[raw('simple', 'P1', null, '1'), 'simple_with_group', 'A simple bond cannot belong to a pata group ("P1")'],
		[raw('pata', null, null, '1'), 'missing_group', 'A pata row needs a pata group (grupo_pata)'],
		[raw('pata', 'g'.repeat(201), null, '1'), 'group_too_long', 'Pata group must be at most 200 characters'],
		[raw('simple', null, null, 'ABC'), 'invalid_barcode', 'Barcode "ABC" is not a base number of up to 4 digits'],
		[raw('simple', null, '68x', '0068'), 'invalid_base_number', 'Base number "68x" must be a number of up to 4 digits'],
		[
			raw('simple', null, '0069', '0068'),
			'base_number_mismatch',
			'Base number 0069 does not match the number in barcode "0068" (0068)'
		],
		[
			raw('simple', null, null, '5129'),
			'overflow',
			'Base number 5129 overflows: its associated number 10000 exceeds the campaign maximum number 9999 (the highest allowed base number is 5128)'
		]
	])('row error %#: %s', (input, code, message) => {
		expect(interpretImportItem(input, rules).error).toEqual({ code, message });
	});

	it('reports the first problem in a fixed order and keeps what it could read', () => {
		const r = interpretImportItem(raw('bogus', null, null, '5129'), rules);
		expect(r.error?.code).toBe('invalid_type');
		expect(r.baseNumber).toBe(5129);
		expect(r.itemType).toBeNull();
		expect(interpretImportItem(raw('simple', 'P1', null, '1'), rules)).toMatchObject({
			itemType: 'simple',
			groupKey: null
		});
		expect(interpretImportItem(raw('pata', null, null, '1'), rules).itemType).toBeNull();
	});

	it('out_of_range when the maximum is below the digit capacity', () => {
		const small = { ...rules, maxNumber: 5000, associatedNumberOffset: 0 };
		expect(interpretImportItem(raw('simple', null, null, '6000'), small)).toMatchObject({
			baseNumber: null,
			error: { code: 'out_of_range', message: 'Number 6000 exceeds the campaign maximum number 5000' }
		});
	});

	it('warns when the base number is not zero padded', () => {
		expect(interpretImportItem(raw('simple', null, null, '68'), rules).warning).toEqual({
			code: 'base_number_not_padded',
			message: 'Base number "68" is not padded to 4 digits (read as 0068)'
		});
		expect(interpretImportItem(raw('simple', null, '68', '0068'), rules).warning?.code).toBe(
			'base_number_not_padded'
		);
		// Pattern captures are not checked.
		const pattern = { ...rules, barcodeMode: 'internal_code' as const, barcodePattern: '^BC-(\\d+)$' };
		expect(interpretImportItem(raw('simple', null, null, 'BC-68'), pattern)).toMatchObject({
			baseNumber: 68,
			warning: null
		});
	});

	it('manual mapping needs numero_base', () => {
		const manual = { ...rules, barcodeMode: 'manual_mapping' as const };
		expect(interpretImportItem(raw('simple', null, null, 'ANY'), manual).error).toEqual({
			code: 'missing_base_number',
			message: "Base number is required: this campaign's barcodes do not carry it"
		});
		expect(interpretImportItem(raw('simple', null, '0042', 'ANY'), manual)).toMatchObject({
			baseNumber: 42,
			error: null
		});
	});

	it('leaves non-portable patterns undetermined', () => {
		const are = { ...rules, barcodeMode: 'internal_code' as const, barcodePattern: '\\mBC-(\\d+)' };
		expect(interpretImportItem(raw('simple', null, null, 'BC-1'), are)).toMatchObject({
			undetermined: true,
			error: null,
			baseNumber: null
		});
		expect(interpretImportItem(raw(null, null, null, 'BC-1'), are)).toMatchObject({
			undetermined: false,
			error: { code: 'missing_type' }
		});
	});
});

describe('validateImportBatch', () => {
	// Same rows, existing data and expectations as supabase/tests/database/012_import_staging.test.sql.
	const existing = {
		numbers: new Map([
			[100, 'bond-100'],
			[4971, 'bond-100'],
			[300, 'bond-300']
		]),
		barcodes: new Map([
			['EXIST-1', 'bond-100'],
			['NUM-CODE', 'bond-300']
		])
	};
	const items = batch([
		[2, raw('simple', null, '0068', '0068')],
		[3, raw(' Simple ', null, null, '77')],
		[4, raw('pata', 'P1', '1200', '1200')],
		[5, raw('pata', 'P1', '1315', '1315')],
		[6, raw('pata', 'P2', '1400', '1400')],
		[7, raw('simple', null, null, '0100')],
		[8, raw('pata', 'EXIST-1', null, '1500')],
		[9, raw('pata', 'EXIST-1', null, '1501')],
		[10, raw('simple', null, null, '6000')],
		[11, raw('simple', null, '0071', '0070')],
		[12, raw('simple', null, null, '0200')],
		[13, raw('bogus', null, null, '0001')],
		[14, raw('simple', null, null, '0050')],
		[15, raw('simple', null, null, '4921')],
		[16, raw('simple', null, null, '0700')],
		[17, raw('pata', '0700', null, '0701')],
		[18, raw('pata', '0700', null, '0702')]
	]);

	it('gives every row the same status, code and message as the database', () => {
		const { items: results, summary } = validateImportBatch(items, rules, existing);
		expect(results.map((r) => [r.rowNumber, r.status, r.errorCode])).toEqual([
			[2, 'valid', null],
			[3, 'warning', 'base_number_not_padded'],
			[4, 'valid', null],
			[5, 'valid', null],
			[6, 'error', 'pata_incomplete'],
			[7, 'error', 'duplicate_number_in_campaign'],
			[8, 'error', 'duplicate_barcode_in_campaign'],
			[9, 'error', 'duplicate_barcode_in_campaign'],
			[10, 'error', 'overflow'],
			[11, 'error', 'base_number_mismatch'],
			[12, 'valid', null],
			[13, 'error', 'invalid_type'],
			[14, 'error', 'duplicate_number_in_batch'],
			[15, 'error', 'duplicate_number_in_batch'],
			[16, 'error', 'duplicate_barcode_in_batch'],
			[17, 'error', 'duplicate_barcode_in_batch'],
			[18, 'error', 'duplicate_barcode_in_batch']
		]);
		const message = (row: number) => results.find((r) => r.rowNumber === row)?.errorMessage;
		expect(message(3)).toBe('Base number "77" is not padded to 4 digits (read as 0077)');
		expect(message(6)).toBe('Pata "P2" needs at least 2 valid rows (it has 1)');
		expect(message(7)).toBe('Number 0100 is already used by bond bond-100');
		expect(message(8)).toBe('Barcode "EXIST-1" is already used by bond bond-100');
		expect(message(14)).toBe('Number 4921 is repeated in this import (rows 14, 15)');
		expect(message(16)).toBe('Barcode "0700" is repeated in this import (rows 16, 17, 18)');
		expect(summary).toEqual({
			totalItems: 17,
			valid: 4,
			warnings: 1,
			errors: 12,
			pending: 0,
			simpleBonds: 3,
			patas: 1,
			baseNumbers: 5,
			participatingNumbers: 10,
			duplicates: 8
		});
	});

	it('skips campaign checks without existing data', () => {
		const { items: results } = validateImportBatch(items, rules);
		expect(results.find((r) => r.rowNumber === 7)?.status).toBe('valid');
		expect(results.find((r) => r.rowNumber === 8)?.status).toBe('valid');
	});

	it('detects numbers repeated inside a pata and a row barcode equal to its group code', () => {
		const { items: results } = validateImportBatch(
			batch([
				[1, raw('pata', 'G', null, '0010')],
				[2, raw('pata', 'G', null, '4881')],
				[3, raw('pata', '0003', null, '0003')],
				[4, raw('pata', '0003', null, '0004')]
			]),
			rules
		);
		expect(results.map((r) => [r.status, r.errorMessage])).toEqual([
			['error', 'Number 4881 is repeated in this import (rows 1, 2)'],
			['error', 'Number 4881 is repeated in this import (rows 1, 2)'],
			['error', 'Barcode "0003" is repeated in this import (rows 3, 4)'],
			['error', 'Barcode "0003" is repeated in this import (rows 3, 4)']
		]);
	});

	it('offset 0: every number is its own associated number', () => {
		const { items: results } = validateImportBatch(batch([[1, raw('simple', null, null, '0001')]]), {
			...rules,
			associatedNumberOffset: 0
		});
		expect(results[0].errorMessage).toBe('Number 0001 is repeated in this import (row 1)');
	});

	it('marks undetermined rows pending', () => {
		const are = { ...rules, barcodeMode: 'internal_code' as const, barcodePattern: '\\mBC-(\\d+)' };
		const { items: results, summary } = validateImportBatch(
			batch([[1, raw('simple', null, null, 'BC-1')]]),
			are
		);
		expect(results[0].status).toBe('pending');
		expect(summary.pending).toBe(1);
	});
});

describe('rowsLabel / summarizeImportItems', () => {
	it('lists up to 10 rows', () => {
		expect(rowsLabel([5])).toBe('row 5');
		expect(rowsLabel([5, 2, 5])).toBe('rows 2, 5');
		expect(rowsLabel(Array.from({ length: 13 }, (_, i) => 13 - i))).toBe(
			'rows 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 and 3 more'
		);
	});
	it('counts patas by group among accepted rows', () => {
		expect(
			summarizeImportItems([
				{ status: 'valid', itemType: 'pata', groupKey: 'A', errorCode: null },
				{ status: 'warning', itemType: 'pata', groupKey: 'A', errorCode: 'base_number_not_padded' },
				{ status: 'error', itemType: 'pata', groupKey: 'B', errorCode: 'duplicate_number_in_batch' }
			])
		).toMatchObject({ patas: 1, baseNumbers: 2, participatingNumbers: 4, duplicates: 1, errors: 1 });
	});
});

describe('rowsFromTable', () => {
	const t = (rows: string[][]) => rows.map((cells, i) => ({ rowNumber: i + 1, cells }));

	it('maps the columns by header (Spanish/English aliases, any order) and skips blank rows', () => {
		const rows = rowsFromTable(
			t([
				['Código de barras', 'Tipo', 'Número base', 'Grupo pata', 'notas'],
				['0068', 'simple', ' 0068 ', '', 'x'],
				['', '', '', '', ''],
				['1200', 'pata', '', 'P1', '']
			])
		);
		expect(rows).toEqual([
			{
				rowNumber: 2,
				raw: '0068,simple, 0068 ,,x',
				tipoBono: 'simple',
				grupoPata: null,
				numeroBase: '0068',
				barcode: '0068'
			},
			{
				rowNumber: 4,
				raw: '1200,pata,,P1,',
				tipoBono: 'pata',
				grupoPata: 'P1',
				numeroBase: null,
				barcode: '1200'
			}
		]);
	});

	it.each([
		[[], 'empty_file'],
		[[['tipo_bono', 'grupo_pata', 'numero_base', 'barcode']], 'empty_file'],
		[[['tipo_bono', 'barcode'], ['simple', '1']], 'missing_columns'],
		[[['tipo_bono', 'tipo', 'grupo_pata', 'numero_base', 'barcode']], 'duplicate_column']
	])('file error %#', (table, code) => {
		expect(() => rowsFromTable(t(table))).toThrow(ImportFileError);
		try {
			rowsFromTable(t(table));
		} catch (err) {
			expect((err as ImportFileError).code).toBe(code);
		}
	});

	it('names the missing columns', () => {
		expect(() => rowsFromTable(t([['tipo_bono', 'barcode'], ['simple', '1']]))).toThrow(
			'Missing columns: grupo_pata, numero_base (the header row must be tipo_bono,grupo_pata,numero_base,barcode)'
		);
	});

	it('limits rows and value length', () => {
		const header = ['tipo_bono', 'grupo_pata', 'numero_base', 'barcode'];
		const many = [header, ...Array.from({ length: IMPORT_MAX_ROWS + 1 }, () => ['simple', '', '', '1'])];
		expect(() => rowsFromTable(t(many))).toThrow(/at most 5000/);
		expect(() => rowsFromTable(t([header, ['simple', '', '', 'x'.repeat(501)]]))).toThrow(
			'Row 2: barcode is longer than 500 characters'
		);
	});
});
