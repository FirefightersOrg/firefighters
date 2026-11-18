import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	addImportItems,
	addScanItem,
	cancelImportSession,
	createImportSession,
	IMPORT_MESSAGES,
	ImportServiceError,
	mapImportRpcError,
	mapValidationResult,
	removeImportItem,
	stageImportFile,
	updateImportItem,
	validateImportSession
} from './imports';
import {
	importAddItemsSchema,
	importAddScanSchema,
	importCancelSessionSchema,
	importRemoveItemSchema,
	importSessionCreateSchema,
	importUpdateItemSchema
} from '$lib/schemas/import';

const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';
const SESSION_ID = 'c0000000-0000-0000-0000-000000000001';
const ITEM_ID = 'c0000000-0000-0000-0000-0000000000aa';

const SUMMARY_ROW = {
	status: 'draft',
	total_items: 3,
	valid: 1,
	warnings: 1,
	errors: 1,
	pending: 0,
	simple_bonds: 2,
	patas: 0,
	base_numbers: 2,
	participating_numbers: 4,
	duplicates: 1
};

function rpcClient(responses: Record<string, { data?: unknown; error?: unknown }> | Error) {
	const rpc = vi.fn().mockImplementation((fn: string) => {
		if (responses instanceof Error) return Promise.reject(responses);
		const r = responses[fn] ?? { data: null };
		return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
	});
	return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

describe('mapImportRpcError', () => {
	it.each([
		[
			'42501',
			'permission denied: bond.import is required',
			'permission',
			IMPORT_MESSAGES.permission
		],
		['P0002', 'campaign x not found', 'not_found', IMPORT_MESSAGES.campaignNotFound],
		['P0002', 'import session x not found', 'not_found', IMPORT_MESSAGES.sessionNotFound],
		['P0002', 'import session item x not found', 'not_found', IMPORT_MESSAGES.itemNotFound],
		[
			'22023',
			'row 2 is already in this import session',
			'validation',
			'Row 2 is already in this import session.'
		],
		[
			'55000',
			'imports can only be staged or validated while the campaign is draft or active (status: closed)',
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
			'import session item x was removed and cannot be changed',
			'conflict',
			IMPORT_MESSAGES.itemRemoved
		],
		[
			'55000',
			'import session x has no items to validate',
			'conflict',
			IMPORT_MESSAGES.nothingToValidate
		],
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

	it('sends bulk rows with snake_case fields', async () => {
		const { supabase, rpc } = rpcClient({ import_session_add_items: { data: 1 } });
		const input = importAddItemsSchema.parse({
			sessionId: SESSION_ID,
			items: [
				{
					rowNumber: 2,
					raw: 'simple,,0068,0068',
					tipoBono: 'simple',
					grupoPata: '',
					numeroBase: '0068',
					barcode: '0068'
				}
			]
		});
		await expect(addImportItems(supabase, input)).resolves.toBe(1);
		expect(rpc.mock.calls[0][1]).toEqual({
			p_session_id: SESSION_ID,
			p_items: [
				{
					row_number: 2,
					raw: 'simple,,0068,0068',
					tipo_bono: 'simple',
					grupo_pata: null,
					numero_base: '0068',
					barcode: '0068'
				}
			],
			p_request_id: null
		});
	});

	it('adds scans, corrects, removes and cancels', async () => {
		const { supabase, rpc } = rpcClient({
			import_session_add_scan: { data: ITEM_ID },
			import_session_update_item: { data: true }
		});
		await expect(
			addScanItem(
				supabase,
				importAddScanSchema.parse({ sessionId: SESSION_ID, tipoBono: 'simple', barcode: ' BC-1 ' })
			)
		).resolves.toBe(ITEM_ID);
		expect(rpc.mock.calls[0][1]).toMatchObject({
			p_item: { tipo_bono: 'simple', grupo_pata: null, numero_base: null, barcode: 'BC-1' }
		});
		await expect(
			updateImportItem(
				supabase,
				importUpdateItemSchema.parse({ itemId: ITEM_ID, tipoBono: 'simple', barcode: '0068' })
			)
		).resolves.toBe(true);
		await removeImportItem(
			supabase,
			importRemoveItemSchema.parse({ itemId: ITEM_ID, reason: ' dup ' })
		);
		expect(rpc.mock.calls[2]).toEqual([
			'import_session_remove_item',
			{ p_item_id: ITEM_ID, p_reason: 'dup', p_request_id: null }
		]);
		await cancelImportSession(supabase, importCancelSessionSchema.parse({ sessionId: SESSION_ID }));
		expect(rpc.mock.calls[3][0]).toBe('import_session_cancel');
	});

	it('maps the validation summary', async () => {
		const { supabase } = rpcClient({ import_session_validate: { data: SUMMARY_ROW } });
		await expect(validateImportSession(supabase, SESSION_ID)).resolves.toEqual({
			status: 'draft',
			summary: {
				totalItems: 3,
				valid: 1,
				warnings: 1,
				errors: 1,
				pending: 0,
				simpleBonds: 2,
				patas: 0,
				baseNumbers: 2,
				participatingNumbers: 4,
				duplicates: 1
			}
		});
		expect(mapValidationResult({ status: 'bogus' })).toBeNull();
		expect(mapValidationResult({ ...SUMMARY_ROW, errors: '1' })).toBeNull();
	});

	it('turns database errors and thrown errors into ImportServiceError', async () => {
		const failing = rpcClient({
			import_session_validate: {
				error: { code: '55000', message: 'import session x has no items to validate' }
			}
		});
		await expect(validateImportSession(failing.supabase, SESSION_ID)).rejects.toMatchObject({
			kind: 'conflict',
			message: IMPORT_MESSAGES.nothingToValidate
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
		errorSpy.mockRestore();
	});
});

describe('stageImportFile', () => {
	const csv = new TextEncoder().encode(
		'tipo_bono;grupo_pata;numero_base;barcode\nsimple;;0068;0068\npata;P1;;1200\npata;P1;;1315\n'
	);

	it('parses, creates the session, stages the rows and validates', async () => {
		const { supabase, rpc } = rpcClient({
			import_session_create: { data: SESSION_ID },
			import_session_add_items: { data: 3 },
			import_session_validate: { data: { ...SUMMARY_ROW, status: 'validated' } }
		});
		const result = await stageImportFile(supabase, {
			campaignId: CAMPAIGN_ID,
			fileName: 'bonos.csv',
			bytes: csv
		});
		expect(result).toMatchObject({ sessionId: SESSION_ID, rowCount: 3, status: 'validated' });
		expect(rpc.mock.calls.map((c) => c[0])).toEqual([
			'import_session_create',
			'import_session_add_items',
			'import_session_validate'
		]);
		expect(rpc.mock.calls[0][1]).toMatchObject({
			p_source_type: 'csv_file',
			p_file_name: 'bonos.csv'
		});
		expect((rpc.mock.calls[1][1] as { p_items: unknown[] }).p_items[1]).toEqual({
			row_number: 3,
			raw: 'pata;P1;;1200',
			tipo_bono: 'pata',
			grupo_pata: 'P1',
			numero_base: null,
			barcode: '1200'
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
		expect(rpc).not.toHaveBeenCalled();
	});
});
