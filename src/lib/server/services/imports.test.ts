import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	addImportItems,
	addScanItem,
	cancelImportSession,
	createImportSession,
	getImportSessionSummary,
	IMPORT_MESSAGES,
	ImportServiceError,
	mapImportRpcError,
	mapImportSummary,
	removeImportItem,
	stageImportFile,
	validateImportSession
} from './imports';
import {
	importAddItemsSchema,
	importAddScanSchema,
	importCancelSessionSchema,
	importRemoveItemSchema,
	importSessionCreateSchema
} from '$lib/schemas/import';
import { getCampaignById } from '$lib/server/repositories/campaigns';

vi.mock('$lib/server/repositories/campaigns', () => ({ getCampaignById: vi.fn() }));

const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';
const SESSION_ID = 'c0000000-0000-0000-0000-000000000001';
const ITEM_ID = 'c0000000-0000-0000-0000-0000000000aa';

/** An `import_session_summary` jsonb. */
const SUMMARY_ROW = {
	session_id: SESSION_ID,
	campaign_id: CAMPAIGN_ID,
	source_type: 'csv_file',
	file_name: 'bonos.csv',
	status: 'draft',
	items: 4,
	live_items: 3,
	removed_items: 1,
	simple_items: 1,
	pata_rows: 2,
	pata_groups: 1,
	errors: 1,
	warnings: 0,
	pending: 0,
	duplicates: 1,
	valid: false,
	base_numbers: 3,
	participating_numbers: 6
};

const SUMMARY = {
	sessionId: SESSION_ID,
	campaignId: CAMPAIGN_ID,
	sourceType: 'csv_file',
	fileName: 'bonos.csv',
	status: 'draft',
	items: 4,
	liveItems: 3,
	removedItems: 1,
	simpleItems: 1,
	pataRows: 2,
	pataGroups: 1,
	errors: 1,
	warnings: 0,
	pending: 0,
	duplicates: 1,
	valid: false,
	baseNumbers: 3,
	participatingNumbers: 6
};

function rpcClient(responses: Record<string, { data?: unknown; error?: unknown }> | Error) {
	const rpc = vi.fn().mockImplementation((fn: string) => {
		if (responses instanceof Error) return Promise.reject(responses);
		const r = responses[fn] ?? { data: null };
		return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
	});
	return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

describe('mapImportRpcError (messages of 20261126000000_import_staging.sql)', () => {
	it.each([
		[
			'42501',
			'permission denied: bond.import is required',
			'permission',
			IMPORT_MESSAGES.permission
		],
		[
			'42501',
			'an active profile is required to import bonds',
			'permission',
			IMPORT_MESSAGES.permission
		],
		['P0002', 'campaign x not found', 'not_found', IMPORT_MESSAGES.campaignNotFound],
		['P0002', 'import session x not found', 'not_found', IMPORT_MESSAGES.sessionNotFound],
		['P0002', 'import session item x not found', 'not_found', IMPORT_MESSAGES.itemNotFound],
		[
			'22023',
			'row 1: a pata row needs its grupo_pata',
			'validation',
			'Row 1: a pata row needs its grupo_pata.'
		],
		[
			'22023',
			'a row_number of the batch is already used in this session',
			'conflict',
			IMPORT_MESSAGES.duplicateRow
		],
		[
			'55000',
			'bonds can only be changed while the campaign is draft or active (status: closed)',
			'conflict',
			`${IMPORT_MESSAGES.campaignLocked} This campaign is closed.`
		],
		[
			'55000',
			'import session x is cancelled and cannot be changed',
			'conflict',
			IMPORT_MESSAGES.sessionClosed
		],
		[
			'55000',
			'items cannot be added to a confirmed import session',
			'conflict',
			IMPORT_MESSAGES.sessionClosed
		],
		['55000', 'import session item x was already removed', 'conflict', IMPORT_MESSAGES.itemRemoved],
		[
			'55000',
			'import session item x is linked to a bond and cannot be removed',
			'conflict',
			IMPORT_MESSAGES.itemLinked
		],
		[
			'55000',
			'scans can only be added to a barcode_scan session (this one is csv_file)',
			'conflict',
			IMPORT_MESSAGES.notScanSession
		],
		['23505', 'duplicate key value', 'conflict', IMPORT_MESSAGES.duplicateRow],
		['23514', 'new row violates check constraint', 'validation', IMPORT_MESSAGES.invalid],
		['XX000', 'boom', 'internal', IMPORT_MESSAGES.internal]
	])('%s %s', (code, message, kind, text) => {
		const err = mapImportRpcError({ code, message });
		expect(err).toBeInstanceOf(ImportServiceError);
		expect(err.kind).toBe(kind);
		expect(err.message).toBe(text);
	});

	it('maps kinds to HTTP statuses', () => {
		expect(mapImportRpcError({ code: '42501', message: '' }).status).toBe(403);
		expect(mapImportRpcError({ code: 'P0002', message: '' }).status).toBe(404);
		expect(mapImportRpcError({ code: '55000', message: '' }).status).toBe(409);
		expect(mapImportRpcError({ code: '22023', message: 'x' }).status).toBe(400);
	});
});

describe('mapImportSummary', () => {
	it('maps the summary jsonb (and validated)', () => {
		expect(mapImportSummary(SUMMARY_ROW)).toEqual(SUMMARY);
		expect(mapImportSummary({ ...SUMMARY_ROW, validated: true })).toEqual({
			...SUMMARY,
			validated: true
		});
		expect(mapImportSummary({ ...SUMMARY_ROW, file_name: null })).toMatchObject({ fileName: null });
	});
	it.each([
		null,
		[],
		{ ...SUMMARY_ROW, status: 'bogus' },
		{ ...SUMMARY_ROW, source_type: 'legacy_system_export' },
		{ ...SUMMARY_ROW, errors: '1' },
		{ ...SUMMARY_ROW, valid: 'false' },
		{ ...SUMMARY_ROW, validated: 1 }
	])('rejects a malformed summary %#', (data) => {
		expect(mapImportSummary(data)).toBeNull();
	});
});

describe('import service calls', () => {
	it('creates a file session with the right permission and arguments', async () => {
		const { supabase, rpc } = rpcClient({ import_session_create: { data: SESSION_ID } });
		const input = importSessionCreateSchema.parse({
			campaignId: CAMPAIGN_ID,
			sourceType: 'csv_file',
			fileName: ' bonos.csv ',
			notes: ''
		});
		await expect(
			createImportSession(supabase, input, { requestId: 'r1', permissions: ['bond.import'] })
		).resolves.toBe(SESSION_ID);
		expect(rpc).toHaveBeenCalledWith('import_session_create', {
			p_campaign_id: CAMPAIGN_ID,
			p_source_type: 'csv_file',
			p_file_name: 'bonos.csv',
			p_notes: null,
			p_request_id: 'r1'
		});
	});

	it('checks the permission up front without calling the database', async () => {
		const { supabase, rpc } = rpcClient({});
		const input = importSessionCreateSchema.parse({
			campaignId: CAMPAIGN_ID,
			sourceType: 'barcode_scan'
		});
		await expect(
			createImportSession(supabase, input, { permissions: ['bond.import'] })
		).rejects.toMatchObject({ kind: 'permission' });
		expect(rpc).not.toHaveBeenCalled();
	});

	it('sends staged rows as the add_items JSON objects', async () => {
		const { supabase, rpc } = rpcClient({ import_session_add_items: { data: SUMMARY_ROW } });
		const input = importAddItemsSchema.parse({
			sessionId: SESSION_ID,
			rows: [
				{
					rowNumber: 2,
					rawValue: 'simple,,0068,0068',
					parsedValue: { tipo_bono: 'simple', barcode: '0068' },
					barcode: '0068',
					itemType: 'simple',
					groupKey: null,
					baseNumber: 68,
					errorCode: null,
					errorMessage: null
				},
				{
					rowNumber: 3,
					barcode: 'ABC',
					itemType: 'simple',
					groupKey: null,
					baseNumber: null,
					errorCode: 'parse_code_not_a_number',
					errorMessage: 'Barcode ABC is not a base number.'
				}
			]
		});
		await expect(addImportItems(supabase, input)).resolves.toEqual(SUMMARY);
		expect(rpc.mock.calls[0][1]).toEqual({
			p_session_id: SESSION_ID,
			p_rows: [
				{
					row_number: 2,
					raw_value: 'simple,,0068,0068',
					parsed_value: { tipo_bono: 'simple', barcode: '0068' },
					barcode: '0068',
					item_type: 'simple',
					group_key: null,
					base_number: 68,
					error_code: null,
					error_message: null
				},
				{
					row_number: 3,
					raw_value: null,
					parsed_value: {},
					barcode: 'ABC',
					item_type: 'simple',
					group_key: null,
					base_number: null,
					error_code: 'parse_code_not_a_number',
					error_message: 'Barcode ABC is not a base number.'
				}
			],
			p_request_id: null
		});
	});

	it('stages large files in batches of 1000 rows', async () => {
		const { supabase, rpc } = rpcClient({ import_session_add_items: { data: SUMMARY_ROW } });
		const rows = Array.from({ length: 2500 }, (_, i) => ({
			rowNumber: i + 2,
			itemType: 'simple' as const,
			groupKey: null,
			baseNumber: i,
			barcode: String(i)
		}));
		await addImportItems(supabase, importAddItemsSchema.parse({ sessionId: SESSION_ID, rows }));
		expect(rpc.mock.calls.map((c) => (c[1] as { p_rows: unknown[] }).p_rows.length)).toEqual([
			1000, 1000, 500
		]);
	});

	it('adds scans, removes, cancels and reads the summary', async () => {
		const { supabase, rpc } = rpcClient({
			import_session_add_scan: {
				data: { ...SUMMARY_ROW, source_type: 'barcode_scan', file_name: null }
			},
			import_session_remove_item: { data: SUMMARY_ROW },
			import_session_cancel: { data: { ...SUMMARY_ROW, status: 'cancelled' } },
			import_session_summary: { data: SUMMARY_ROW }
		});
		await expect(
			addScanItem(
				supabase,
				importAddScanSchema.parse({ sessionId: SESSION_ID, barcode: ' M-2 ', baseNumber: '0700' })
			)
		).resolves.toMatchObject({ sourceType: 'barcode_scan' });
		expect(rpc.mock.calls[0]).toEqual([
			'import_session_add_scan',
			{
				p_session_id: SESSION_ID,
				p_barcode: 'M-2',
				p_group_key: null,
				p_base_number: 700,
				p_raw_value: null,
				p_request_id: null
			}
		]);
		await removeImportItem(
			supabase,
			importRemoveItemSchema.parse({ itemId: ITEM_ID, reason: ' dup ' })
		);
		expect(rpc.mock.calls[1]).toEqual([
			'import_session_remove_item',
			{ p_item_id: ITEM_ID, p_reason: 'dup', p_request_id: null }
		]);
		await expect(
			cancelImportSession(supabase, importCancelSessionSchema.parse({ sessionId: SESSION_ID }))
		).resolves.toMatchObject({ status: 'cancelled' });
		await expect(getImportSessionSummary(supabase, SESSION_ID)).resolves.toEqual(SUMMARY);
		expect(rpc.mock.calls[3]).toEqual(['import_session_summary', { p_session_id: SESSION_ID }]);
	});

	it('maps the validation result', async () => {
		const { supabase } = rpcClient({
			import_session_validate: { data: { ...SUMMARY_ROW, validated: false } }
		});
		await expect(validateImportSession(supabase, SESSION_ID)).resolves.toEqual({
			...SUMMARY,
			validated: false
		});
	});

	it('turns database errors and thrown errors into ImportServiceError', async () => {
		const failing = rpcClient({
			import_session_validate: {
				error: { code: '55000', message: 'import session x is confirmed and cannot be changed' }
			}
		});
		await expect(validateImportSession(failing.supabase, SESSION_ID)).rejects.toMatchObject({
			kind: 'conflict',
			message: IMPORT_MESSAGES.sessionClosed
		});
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const thrown = rpcClient(new Error('network'));
		await expect(validateImportSession(thrown.supabase, SESSION_ID)).rejects.toMatchObject({
			kind: 'internal'
		});
		const odd = rpcClient({ import_session_create: { data: 42 } });
		await expect(
			createImportSession(
				odd.supabase,
				importSessionCreateSchema.parse({ campaignId: CAMPAIGN_ID, sourceType: 'barcode_scan' })
			)
		).rejects.toMatchObject({ kind: 'internal' });
		const malformed = rpcClient({ import_session_validate: { data: { status: 'draft' } } });
		await expect(validateImportSession(malformed.supabase, SESSION_ID)).rejects.toMatchObject({
			kind: 'internal'
		});
		errorSpy.mockRestore();
	});
});

describe('import schemas', () => {
	it('rejects payloads add_items would reject (22023)', () => {
		const base = { rowNumber: 2, barcode: 'B', baseNumber: 1 };
		const parse = (row: Record<string, unknown>) =>
			importAddItemsSchema.safeParse({ sessionId: SESSION_ID, rows: [row] }).success;
		expect(parse({ ...base, itemType: 'simple', groupKey: null })).toBe(true);
		expect(parse({ ...base, itemType: 'pata', groupKey: null })).toBe(false);
		expect(parse({ ...base, itemType: 'simple', groupKey: 'P1' })).toBe(false);
		expect(parse({ ...base, itemType: 'bundle', groupKey: null })).toBe(false);
		expect(parse({ ...base, itemType: 'simple', groupKey: null, baseNumber: -1 })).toBe(false);
		expect(
			parse({
				...base,
				itemType: 'simple',
				groupKey: null,
				errorCode: 'missing_type',
				errorMessage: 'x'
			})
		).toBe(false);
		expect(parse({ ...base, itemType: 'simple', groupKey: null, errorCode: 'parse_x' })).toBe(
			false
		);
		expect(parse({ ...base, itemType: 'simple', groupKey: null, barcode: 'x'.repeat(201) })).toBe(
			false
		);
		expect(
			importAddItemsSchema.safeParse({
				sessionId: SESSION_ID,
				rows: [
					{ ...base, itemType: 'simple', groupKey: null },
					{ ...base, itemType: 'simple', groupKey: null }
				]
			}).success
		).toBe(false);
	});

	it('scans need a barcode; the typed base number is a whole number', () => {
		expect(importAddScanSchema.safeParse({ sessionId: SESSION_ID, barcode: ' ' }).success).toBe(
			false
		);
		expect(
			importAddScanSchema.safeParse({ sessionId: SESSION_ID, barcode: 'X', baseNumber: '1.5' })
				.success
		).toBe(false);
		expect(
			importAddScanSchema.parse({ sessionId: SESSION_ID, barcode: 'X', baseNumber: '' })
		).toMatchObject({
			baseNumber: null,
			groupKey: null
		});
	});
});

describe('stageImportFile', () => {
	const csv = new TextEncoder().encode(
		'tipo_bono;grupo_pata;numero_base;barcode\nsimple;;0068;0068\npata;P1;;1200\npata;P1;;1315\npata;;;1400\n'
	);

	beforeEach(() => {
		vi.mocked(getCampaignById).mockResolvedValue({
			data: {
				barcodeMode: 'base_number',
				barcodePattern: null,
				numberDigits: 4,
				maxNumber: 9999,
				associatedNumberOffset: 4871
			} as never,
			error: null
		});
	});

	it('parses, interprets with the campaign rules, creates, stages and validates', async () => {
		const { supabase, rpc } = rpcClient({
			import_session_create: { data: SESSION_ID },
			import_session_add_items: { data: SUMMARY_ROW },
			import_session_validate: { data: { ...SUMMARY_ROW, validated: false } }
		});
		const result = await stageImportFile(supabase, {
			campaignId: CAMPAIGN_ID,
			fileName: 'bonos.csv',
			bytes: csv
		});
		expect(result).toMatchObject({ sessionId: SESSION_ID, rowCount: 4, validated: false });
		expect(rpc.mock.calls.map((c) => c[0])).toEqual([
			'import_session_create',
			'import_session_add_items',
			'import_session_validate'
		]);
		expect(rpc.mock.calls[0][1]).toMatchObject({
			p_source_type: 'csv_file',
			p_file_name: 'bonos.csv'
		});
		const rows = (rpc.mock.calls[1][1] as { p_rows: Record<string, unknown>[] }).p_rows;
		expect(rows[1]).toEqual({
			row_number: 3,
			raw_value: 'pata;P1;;1200',
			parsed_value: { tipo_bono: 'pata', grupo_pata: 'P1', numero_base: null, barcode: '1200' },
			barcode: '1200',
			item_type: 'pata',
			group_key: 'P1',
			base_number: 1200,
			error_code: null,
			error_message: null
		});
		expect(rows[3]).toMatchObject({
			item_type: null,
			group_key: null,
			error_code: 'parse_missing_group'
		});
	});

	it('rejects unreadable files before writing anything', async () => {
		const { supabase, rpc } = rpcClient({});
		await expect(
			stageImportFile(supabase, { campaignId: CAMPAIGN_ID, fileName: 'bonos.xls', bytes: csv })
		).rejects.toMatchObject({ kind: 'validation', fileErrorCode: 'unsupported_file' });
		await expect(
			stageImportFile(supabase, {
				campaignId: CAMPAIGN_ID,
				fileName: 'bonos.csv',
				bytes: new TextEncoder().encode('tipo_bono,barcode\nsimple,1\n')
			})
		).rejects.toMatchObject({ kind: 'validation', fileErrorCode: 'missing_columns' });
		await expect(
			stageImportFile(
				supabase,
				{ campaignId: CAMPAIGN_ID, fileName: 'bonos.csv', bytes: csv },
				{ permissions: ['bond.scan'] }
			)
		).rejects.toMatchObject({ kind: 'permission' });
		expect(rpc).not.toHaveBeenCalled();
	});

	it('reports an unknown campaign before creating the session', async () => {
		vi.mocked(getCampaignById).mockResolvedValue({ data: null, error: null });
		const { supabase, rpc } = rpcClient({});
		await expect(
			stageImportFile(supabase, { campaignId: CAMPAIGN_ID, fileName: 'bonos.csv', bytes: csv })
		).rejects.toMatchObject({ kind: 'not_found', message: IMPORT_MESSAGES.campaignNotFound });
		expect(rpc).not.toHaveBeenCalled();
	});
});
