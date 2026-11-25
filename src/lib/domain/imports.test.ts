import { describe, expect, it } from 'vitest';
import {
	IMPORT_MAX_ROWS,
	ImportFileError,
	batchItemsFromStaged,
	interpretImportRow,
	normalizeField,
	rowsFromTable,
	summarizeImportItems,
	validateImportBatch,
	type ExistingCampaignData,
	type ImportBatchItem,
	type ImportRules
} from './imports';

const rules: ImportRules = {
	barcodeMode: 'base_number',
	barcodePattern: null,
	numberDigits: 4,
	maxNumber: 9999,
	associatedNumberOffset: 4871,
	associatedNumberMode: 'linear'
};

const row = (
	rowNumber: number,
	tipoBono: string | null,
	grupoPata: string | null,
	numeroBase: string | null,
	barcode: string | null,
	r: ImportRules = rules
) => interpretImportRow({ rowNumber, tipoBono, grupoPata, numeroBase, barcode }, r);

/** A staged row as `import_session_add_items` takes it (like the pgTAP payloads). */
const staged = (
	rowNumber: number,
	fields: Partial<Omit<ImportBatchItem, 'key' | 'rowNumber'>>
): ImportBatchItem => ({
	key: String(rowNumber),
	rowNumber,
	itemType: null,
	groupKey: null,
	baseNumber: null,
	barcode: null,
	errorCode: null,
	errorMessage: null,
	...fields
});

const codes = (result: ReturnType<typeof validateImportBatch>) =>
	result.items.map((i) => [i.rowNumber, i.status, i.errorCode]);

describe('normalizeField', () => {
	it('trims spaces, tabs and line breaks; blank is null', () => {
		expect(normalizeField(' \t0068\r\n')).toBe('0068');
		expect(normalizeField('   ')).toBeNull();
		expect(normalizeField(undefined)).toBeNull();
		expect(normalizeField('\u00a0x')).toBe('\u00a0x'); // same set as SQL btrim(x, E' \t\r\n')
	});
});

describe('interpretImportRow', () => {
	it('reads simple and pata rows into the add_items payload', () => {
		expect(
			interpretImportRow(
				{
					rowNumber: 2,
					raw: 'simple,,0068,0068',
					tipoBono: ' Simple ',
					grupoPata: '',
					numeroBase: '0068',
					barcode: '0068'
				},
				rules
			)
		).toEqual({
			rowNumber: 2,
			rawValue: 'simple,,0068,0068',
			parsedValue: { tipo_bono: 'Simple', grupo_pata: null, numero_base: '0068', barcode: '0068' },
			barcode: '0068',
			itemType: 'simple',
			groupKey: null,
			baseNumber: 68,
			errorCode: null,
			errorMessage: null
		});
		expect(row(3, 'pata', 'P1', null, '1200')).toMatchObject({
			itemType: 'pata',
			groupKey: 'P1',
			baseNumber: 1200,
			barcode: '1200',
			rawValue: null
		});
	});

	it('leaves a missing type or base number to the database', () => {
		expect(row(2, null, null, '10', null)).toMatchObject({
			itemType: null,
			baseNumber: 10,
			errorCode: null
		});
		expect(row(2, 'simple', null, null, null)).toMatchObject({
			itemType: 'simple',
			baseNumber: null,
			errorCode: null
		});
	});

	it.each([
		[
			['bundle', null, '10', '10'],
			'parse_invalid_type',
			'Unknown bond type bundle (use simple or pata).'
		],
		[
			['simple', null, null, 'x'.repeat(201)],
			'parse_barcode_too_long',
			'The barcode is longer than 200 characters.'
		],
		[
			['simple', 'P1', null, '10'],
			'parse_simple_with_group',
			'A simple bond cannot belong to the pata P1.'
		],
		[
			['pata', null, null, '10'],
			'parse_missing_group',
			'Every row of a pata needs its grupo_pata.'
		],
		[
			['pata', 'G'.repeat(201), null, '10'],
			'parse_group_too_long',
			'The grupo_pata is longer than 200 characters.'
		],
		[
			['simple', null, '-1', null],
			'parse_invalid_base_number',
			'Base number -1 is not a whole number.'
		],
		[['simple', null, null, 'ABC'], 'parse_code_not_a_number', 'Barcode ABC is not a base number.'],
		[
			['simple', null, '0071', '0070'],
			'parse_base_number_mismatch',
			'Base number 0071 does not match barcode 0070 (70).'
		]
	] as const)('%j → %s', (fields, code, message) => {
		const [tipo, grupo, numero, barcode] = fields;
		const r = row(2, tipo, grupo, numero, barcode);
		expect(r).toMatchObject({ errorCode: code, errorMessage: message, baseNumber: null });
		// Never a payload the database rejects (22023): pata ⇔ group, lengths <= 200.
		expect(r.itemType === 'pata').toBe(r.groupKey !== null);
		expect((r.barcode ?? '').length).toBeLessThanOrEqual(200);
	});

	it('reports the first problem only', () => {
		expect(row(2, 'bundle', null, 'x', 'ABC')).toMatchObject({ errorCode: 'parse_invalid_type' });
	});

	it('manual mapping and pattern modes use the same codes as import_session_add_scan', () => {
		const manual: ImportRules = { ...rules, barcodeMode: 'manual_mapping' };
		expect(row(2, 'simple', null, '700', 'M-2', manual)).toMatchObject({
			baseNumber: 700,
			errorCode: null
		});
		expect(row(2, 'simple', null, null, 'M-1', manual)).toMatchObject({
			errorCode: 'parse_base_number_required',
			errorMessage: 'This campaign needs the base number typed with the barcode.'
		});
		const internal: ImportRules = {
			...rules,
			barcodeMode: 'internal_code',
			barcodePattern: '^IT-([0-9]{4})$'
		};
		expect(row(2, 'simple', null, null, 'IT-0800', internal)).toMatchObject({ baseNumber: 800 });
		expect(row(2, 'simple', null, null, 'XX-1', internal)).toMatchObject({
			errorCode: 'parse_code_not_recognized',
			errorMessage: 'Barcode XX-1 does not match the campaign pattern.'
		});
		const noPattern: ImportRules = { ...internal, barcodePattern: null };
		expect(row(2, 'simple', null, null, 'IT-0800', noPattern)).toMatchObject({
			errorCode: 'parse_base_number_required',
			errorMessage: 'This campaign has no barcode pattern: type the base number.'
		});
	});

	it('a pattern JavaScript cannot apply needs numero_base', () => {
		const odd: ImportRules = {
			...rules,
			barcodeMode: 'internal_code',
			barcodePattern: '\\mIT-([0-9]{4})'
		};
		expect(row(2, 'simple', null, '800', 'IT-0800', odd)).toMatchObject({
			baseNumber: 800,
			errorCode: null
		});
		expect(row(2, 'simple', null, null, 'IT-0800', odd)).toMatchObject({
			errorCode: 'parse_pattern_not_supported'
		});
	});
});

describe('validateImportBatch (mirror of import_session_revalidate / _check_groups)', () => {
	// The live bond of 012_import_staging.test.sql: base 100 (barcode LIVE-100), associated 4971,
	// bond barcode LIVE-BOND.
	const existing: ExistingCampaignData = {
		numbers: new Map([
			[100, 'b-live'],
			[4971, 'b-live']
		]),
		barcodes: new Map([
			['LIVE-BOND', 'b-live'],
			['LIVE-100', 'b-live']
		])
	};

	it('gives the pgTAP staging batch the same codes as the database', () => {
		const result = validateImportBatch(
			[
				staged(2, { itemType: 'simple', baseNumber: 10, barcode: 'B-10' }),
				staged(3, { itemType: 'simple', baseNumber: 5129, barcode: 'B-5129' }),
				staged(4, { itemType: 'simple', baseNumber: 20, barcode: 'B-20' }),
				staged(5, { itemType: 'simple', baseNumber: 20, barcode: 'B-20b' }),
				staged(6, { itemType: 'simple', baseNumber: 100, barcode: 'X-100' }),
				staged(7, { itemType: 'simple', baseNumber: 30, barcode: 'B-30' }),
				staged(8, { itemType: 'simple', baseNumber: 40, barcode: 'LIVE-100' }),
				staged(9, { itemType: 'pata', groupKey: 'P1', baseNumber: 50 }),
				staged(10, { itemType: 'pata', groupKey: 'P1', baseNumber: 51, barcode: 'P1' }),
				staged(11, { itemType: 'simple' }),
				staged(12, {
					itemType: 'simple',
					baseNumber: 60,
					errorCode: 'parse_bad_number',
					errorMessage: 'Row 12 has no numeric base.'
				})
			],
			rules,
			existing,
			{ checkGroups: false }
		);
		expect(codes(result)).toEqual([
			[2, 'valid', null],
			[3, 'error', 'number_out_of_range'],
			[4, 'error', 'duplicate_number'],
			[5, 'error', 'duplicate_number'],
			[6, 'error', 'number_in_use'],
			[7, 'valid', null],
			[8, 'error', 'barcode_in_use'],
			[9, 'error', 'missing_barcode'],
			[10, 'error', 'duplicate_barcode'],
			[11, 'error', 'missing_base_number'],
			[12, 'error', 'parse_bad_number']
		]);
		expect(result.items.map((i) => i.errorMessage)).toEqual([
			null,
			'Number 5129 does not fit the campaign (maximum 9999).',
			'Base number 0020 is repeated in the import.',
			'Base number 0020 is repeated in the import.',
			'Number 0100 is already used by a bond of this campaign.',
			null,
			'Barcode LIVE-100 is already used in this campaign.',
			'Every row of a pata needs its barcode.',
			'The pata code P1 is also used as a row barcode in this import.',
			'The row has no base number.',
			'Row 12 has no numeric base.'
		]);
		expect(result.summary).toEqual({
			liveItems: 11,
			simpleItems: 9,
			pataRows: 2,
			pataGroups: 1,
			errors: 9,
			warnings: 0,
			pending: 0,
			duplicates: 5,
			valid: false,
			baseNumbers: 9,
			participatingNumbers: 18
		});
	});

	it('a removed twin frees its pair (the caller passes live rows only)', () => {
		const result = validateImportBatch(
			[staged(5, { itemType: 'simple', baseNumber: 20, barcode: 'B-20b' })],
			rules,
			existing
		);
		expect(codes(result)).toEqual([[5, 'valid', null]]);
	});

	it('a number repeated through the associated number conflicts', () => {
		expect(
			codes(
				validateImportBatch(
					[
						staged(2, { itemType: 'simple', baseNumber: 10, barcode: 'A' }),
						staged(3, { itemType: 'simple', baseNumber: 4881, barcode: 'B' })
					],
					{ ...rules, maxNumber: 99999 }
				)
			)
		).toEqual([
			[2, 'error', 'number_conflict'],
			[3, 'error', 'number_conflict']
		]);
	});

	it('offset 0: every number is its own associated number', () => {
		expect(
			codes(
				validateImportBatch([staged(2, { itemType: 'simple', baseNumber: 10 })], {
					...rules,
					associatedNumberOffset: 0,
					associatedNumberMode: 'linear'
				})
			)
		).toEqual([[2, 'error', 'number_conflict']]);
	});

	it('parse rows keep their error, still hold numbers, and do not count as barcodes', () => {
		const result = validateImportBatch(
			[
				staged(2, {
					itemType: 'simple',
					baseNumber: 10,
					barcode: 'X',
					errorCode: 'parse_x',
					errorMessage: 'x'
				}),
				staged(3, { itemType: 'simple', baseNumber: 10, barcode: 'X' })
			],
			rules
		);
		expect(codes(result)).toEqual([
			[2, 'error', 'parse_x'],
			[3, 'error', 'duplicate_number']
		]);
		const barcodes = validateImportBatch(
			[
				staged(2, { itemType: 'simple', barcode: 'X', errorCode: 'parse_x', errorMessage: 'x' }),
				staged(3, { itemType: 'simple', baseNumber: 11, barcode: 'X' })
			],
			rules
		);
		expect(codes(barcodes)).toEqual([
			[2, 'error', 'parse_x'],
			[3, 'valid', null]
		]);
	});

	it('pata codes are checked against live codes; groups need two rows when validating', () => {
		const pata = [
			staged(2, { itemType: 'pata', groupKey: 'LIVE-BOND', baseNumber: 300, barcode: 'P-300' }),
			staged(3, { itemType: 'pata', groupKey: 'LIVE-BOND', baseNumber: 301, barcode: 'P-301' }),
			staged(4, { itemType: 'pata', groupKey: 'P3', baseNumber: 400, barcode: 'P3-400' })
		];
		expect(codes(validateImportBatch(pata, rules, existing))).toEqual([
			[2, 'error', 'barcode_in_use'],
			[3, 'error', 'barcode_in_use'],
			[4, 'error', 'incomplete_pata']
		]);
		expect(validateImportBatch(pata, rules, existing).items[2].errorMessage).toBe(
			'A pata needs at least 2 rows (this group has 1).'
		);
		expect(validateImportBatch(pata, rules, existing).items[0].errorMessage).toBe(
			'The pata code LIVE-BOND is already used in this campaign.'
		);
		// Staging (no group check) leaves the lone row valid; without live data nothing is in use.
		expect(codes(validateImportBatch(pata, rules, undefined, { checkGroups: false }))).toEqual([
			[2, 'valid', null],
			[3, 'valid', null],
			[4, 'valid', null]
		]);
	});

	it('works on interpreted file rows', () => {
		const result = validateImportBatch(
			batchItemsFromStaged([
				row(2, 'simple', null, null, '0068'),
				row(3, 'pata', 'P1', null, '1200'),
				row(4, 'pata', 'P1', null, '1315'),
				row(5, 'pata', null, null, '1400')
			]),
			rules
		);
		expect(codes(result)).toEqual([
			[2, 'valid', null],
			[3, 'valid', null],
			[4, 'valid', null],
			[5, 'error', 'parse_missing_group']
		]);
		expect(result.summary).toMatchObject({
			simpleItems: 1,
			pataRows: 2,
			pataGroups: 1,
			valid: false
		});
	});
});

describe('summarizeImportItems', () => {
	it('counts like import_session_summary', () => {
		expect(summarizeImportItems([], rules)).toMatchObject({ liveItems: 0, valid: false });
		expect(
			summarizeImportItems(
				[
					{ status: 'valid', itemType: 'simple', groupKey: null, baseNumber: 1, errorCode: null },
					{ status: 'valid', itemType: 'pata', groupKey: 'P', baseNumber: 2, errorCode: null },
					{ status: 'valid', itemType: 'pata', groupKey: 'P', baseNumber: 2, errorCode: null }
				],
				rules
			)
		).toEqual({
			liveItems: 3,
			simpleItems: 1,
			pataRows: 2,
			pataGroups: 1,
			errors: 0,
			warnings: 0,
			pending: 0,
			duplicates: 0,
			valid: true,
			baseNumbers: 2,
			participatingNumbers: 4
		});
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
		[
			[
				['tipo_bono', 'barcode'],
				['simple', '1']
			],
			'missing_columns'
		],
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
		expect(() =>
			rowsFromTable(
				t([
					['tipo_bono', 'barcode'],
					['simple', '1']
				])
			)
		).toThrow(
			'Faltan las columnas: grupo_pata, numero_base (la fila de encabezado debe ser tipo_bono,grupo_pata,numero_base,barcode)'
		);
	});

	it('limits rows and value length', () => {
		const header = ['tipo_bono', 'grupo_pata', 'numero_base', 'barcode'];
		const many = [
			header,
			...Array.from({ length: IMPORT_MAX_ROWS + 1 }, () => ['simple', '', '', '1'])
		];
		expect(() => rowsFromTable(t(many))).toThrow(/como máximo 5000/);
		expect(() => rowsFromTable(t([header, ['simple', '', '', 'x'.repeat(501)]]))).toThrow(
			'Fila 2: barcode tiene más de 500 caracteres'
		);
	});
});
