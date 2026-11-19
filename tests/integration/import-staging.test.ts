import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readBarcode, type BarcodeRules } from '$lib/domain/barcodes';
import {
	batchItemsFromStaged,
	interpretImportRow,
	validateImportBatch,
	type ImportItemResult,
	type ImportSummary
} from '$lib/domain/imports';
import { parseImportFile } from '$lib/server/imports/parse-file';
import { listBondNumbersByCampaign } from '$lib/server/repositories/bonds';
import { loadPermissions } from './permissions';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	getExistingCampaignData,
	getImportSession,
	importItemsToBatch,
	listImportItems
} from '$lib/server/repositories/imports';
import {
	addScanItem,
	cancelImportSession,
	createImportSession,
	IMPORT_MESSAGES,
	ImportServiceError,
	removeImportItem,
	stageImportFile,
	validateImportSession
} from '$lib/server/services/imports';
import {
	importAddScanSchema,
	importCancelSessionSchema,
	importRemoveItemSchema,
	importSessionCreateSchema
} from '$lib/schemas/import';
import { resolveSeedConfig } from '../../scripts/seed-admin';

/**
 * SAN-45: import staging against the local Supabase with the seeded operator and read-only users:
 * a CSV with simple and pata rows goes through parsing, the app's row interpretation, the
 * `import_session_*` functions (migration 20261126000000_import_staging.sql) and the database
 * validation (duplicates against an existing bond included), and the client validator
 * (`validateImportBatch`) gives the same statuses, codes, messages and counts as
 * `import_session_validate`. No bonds are created.
 *
 * Campaigns cannot be deleted: each run creates its own `[it-imports <run id>]` campaign.
 */

const { supabaseUrl, anonKey, seedEnv } = inject('integrationEnv');
const seedConfig = resolveSeedConfig(seedEnv);
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;

interface Caller {
	client: SupabaseClient;
	permissions: string[];
}

async function signIn(email: string, password: string): Promise<Caller> {
	const anonClient = createClient(supabaseUrl, anonKey, clientOptions);
	const { data, error } = await anonClient.auth.signInWithPassword({ email, password });
	if (error || !data.session) {
		throw new Error(
			`Failed to sign in as ${email}: ${error?.message ?? 'no session'}. ` +
				'Did you run `supabase db reset` and `APP_ENV=local pnpm seed:admin`?'
		);
	}
	const client = createClient(supabaseUrl, anonKey, {
		...clientOptions,
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
	return { client, permissions: await loadPermissions(client) };
}

function fixture(role: string) {
	const found = seedConfig.fixtures.find((f) => f.roleNames.includes(role));
	if (!found) throw new Error(`resolveSeedConfig returned no ${role} fixture`);
	return found;
}

let operator: Caller;
let readOnly: Caller;
let campaignId: string;
const campaignRules: BarcodeRules = {
	barcodeMode: 'base_number',
	barcodePattern: null,
	numberDigits: 4
};

beforeAll(async () => {
	const admin = await signIn(seedConfig.admin.email, seedConfig.admin.password);
	operator = await signIn(fixture('operator').email, fixture('operator').password);
	readOnly = await signIn(fixture('read-only').email, fixture('read-only').password);

	const { data, error } = await admin.client.rpc('campaign_create', {
		p_name: `[it-imports ${RUN_ID}] Imports`,
		p_simple_bond_value: '60000.00',
		p_installment_count: 10,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_request_id: `it-imports-${RUN_ID}-campaign`
	});
	if (error) throw new Error(`campaign_create failed: ${error.message}`);
	campaignId = data as string;

	const bond = await operator.client.rpc('bond_create', {
		p_campaign_id: campaignId,
		p_base_numbers: [100],
		p_barcode: 'EXIST-1'
	});
	if (bond.error) throw new Error(`bond_create failed: ${bond.error.message}`);
});

const CSV = [
	'tipo_bono;grupo_pata;numero_base;barcode',
	'simple;;0068;0068', // 2 valid
	'simple;;;77', // 3 valid
	'pata;P1;1200;1200', // 4 valid
	'pata;P1;1315;1315', // 5 valid
	'pata;P2;;1400', // 6 incomplete_pata (one row)
	'simple;;;0100', // 7 number_in_use (the existing bond)
	'pata;EXIST-1;;1500', // 8 barcode_in_use (pata code = the existing bond's barcode)
	'pata;EXIST-1;;1501', // 9 barcode_in_use
	'simple;;0071;0070', // 10 parse_base_number_mismatch (app parser)
	'simple;;;0050', // 11 number_conflict (its associated number is row 12's base)
	'simple;;;4921', // 12 number_conflict
	'simple;;;0700', // 13 valid (the database only flags the pata rows below)
	'pata;0700;;0701', // 14 duplicate_barcode (pata code used as a row barcode)
	'pata;0700;;0702', // 15 duplicate_barcode
	';;0080;0080', // 16 missing_type
	'bundle;;;0090', // 17 parse_invalid_type (app parser)
	'simple;;;5200', // 18 number_out_of_range (associated 10071 > 9999)
	''
].join('\r\n');

const EXPECTED: [number, string, string | null][] = [
	[2, 'valid', null],
	[3, 'valid', null],
	[4, 'valid', null],
	[5, 'valid', null],
	[6, 'error', 'incomplete_pata'],
	[7, 'error', 'number_in_use'],
	[8, 'error', 'barcode_in_use'],
	[9, 'error', 'barcode_in_use'],
	[10, 'error', 'parse_base_number_mismatch'],
	[11, 'error', 'number_conflict'],
	[12, 'error', 'number_conflict'],
	[13, 'valid', null],
	[14, 'error', 'duplicate_barcode'],
	[15, 'error', 'duplicate_barcode'],
	[16, 'error', 'missing_type'],
	[17, 'error', 'parse_invalid_type'],
	[18, 'error', 'number_out_of_range']
];

type Row = Pick<
	ImportItemResult,
	| 'rowNumber'
	| 'status'
	| 'errorCode'
	| 'errorMessage'
	| 'itemType'
	| 'groupKey'
	| 'baseNumber'
	| 'barcode'
>;
const view = (items: readonly Row[]) =>
	items.map((i) => [
		i.rowNumber,
		i.status,
		i.errorCode,
		i.errorMessage,
		i.itemType,
		i.groupKey,
		i.baseNumber,
		i.barcode
	]);

/** The counts both sides compute (the database also reports session metadata). */
const counts = (s: ImportSummary) => ({
	liveItems: s.liveItems,
	simpleItems: s.simpleItems,
	pataRows: s.pataRows,
	pataGroups: s.pataGroups,
	errors: s.errors,
	warnings: s.warnings,
	pending: s.pending,
	duplicates: s.duplicates,
	valid: s.valid,
	baseNumbers: s.baseNumbers,
	participatingNumbers: s.participatingNumbers
});

describe('import staging (local Supabase)', () => {
	it('stages a CSV, reports every problem and agrees with the client validator', async () => {
		const ctx = { requestId: `it-imports-${RUN_ID}-stage`, permissions: operator.permissions };
		const bytes = new TextEncoder().encode(CSV);
		const staged = await stageImportFile(
			operator.client,
			{ campaignId, fileName: 'bonos.csv', bytes },
			ctx
		);
		expect(staged).toMatchObject({
			rowCount: 17,
			status: 'draft',
			validated: false,
			sourceType: 'csv_file',
			fileName: 'bonos.csv',
			items: 17,
			liveItems: 17,
			removedItems: 0,
			simpleItems: 8,
			pataRows: 7,
			pataGroups: 4,
			errors: 12,
			warnings: 0,
			pending: 0,
			duplicates: 7,
			valid: false
		});

		const items = (await listImportItems(operator.client, staged.sessionId)).data ?? [];
		expect(items.map((i) => [i.rowNumber, i.status, i.errorCode])).toEqual(EXPECTED);
		const byRow = new Map(items.map((i) => [i.rowNumber, i]));
		expect(byRow.get(7)?.errorMessage).toBe(
			'Number 0100 is already used by a bond of this campaign.'
		);
		expect(byRow.get(8)?.errorMessage).toBe(
			'The pata code EXIST-1 is already used in this campaign.'
		);
		expect(byRow.get(6)?.errorMessage).toBe('A pata needs at least 2 rows (this group has 1).');

		// Cross-check 1: the client validator, fed the rows as stored and the live campaign data,
		// gives every row the same status, code and message, and the same counts.
		const campaign = (await getCampaignById(operator.client, campaignId)).data;
		const existing = (await getExistingCampaignData(operator.client, campaignId)).data;
		if (!campaign || !existing) throw new Error('campaign or live campaign data not readable');
		const fromDb = validateImportBatch(importItemsToBatch(items), campaign, existing);
		expect(view(fromDb.items)).toEqual(view(items));
		expect(counts(fromDb.summary)).toEqual(counts(staged));

		// Cross-check 2: the whole client pipeline (parse + interpret + validate, no database)
		// stages the same rows and predicts the same outcome.
		const parsed = await parseImportFile({ name: 'bonos.csv', bytes });
		const local = validateImportBatch(
			batchItemsFromStaged(parsed.rows.map((row) => interpretImportRow(row, campaign))),
			campaign,
			existing
		);
		expect(view(local.items)).toEqual(view(items));
		expect(counts(local.summary)).toEqual(counts(staged));

		// Removing the rows in error makes the session valid; still no bonds.
		for (const item of items.filter((i) => i.status === 'error')) {
			await removeImportItem(
				operator.client,
				importRemoveItemSchema.parse({ itemId: item.id, reason: 'Bad row' }),
				ctx
			);
		}
		const validated = await validateImportSession(operator.client, staged.sessionId, ctx);
		expect(validated).toMatchObject({
			status: 'validated',
			validated: true,
			items: 17,
			liveItems: 5,
			removedItems: 12,
			errors: 0,
			simpleItems: 3,
			pataGroups: 1,
			baseNumbers: 5,
			participatingNumbers: 10
		});
		expect((await getImportSession(operator.client, staged.sessionId)).data?.status).toBe(
			'validated'
		);
		const { count } = await operator.client
			.from('bonds')
			.select('id', { count: 'exact', head: true })
			.eq('import_session_id', staged.sessionId);
		expect(count).toBe(0);
		const after = (await listBondNumbersByCampaign(operator.client, campaignId)).data ?? [];
		expect(after.map((n) => n.numberValue)).toEqual([100, 4971]);
	});

	it('scans one code at a time and enforces permissions', async () => {
		const sessionId = await createImportSession(
			operator.client,
			importSessionCreateSchema.parse({ campaignId, sourceType: 'barcode_scan' }),
			{ permissions: operator.permissions }
		);
		await expect(
			addScanItem(operator.client, importAddScanSchema.parse({ sessionId, barcode: '0900' }))
		).resolves.toMatchObject({ simpleItems: 1, valid: true, baseNumbers: 1 });
		await expect(
			addScanItem(operator.client, importAddScanSchema.parse({ sessionId, barcode: 'ABC' }))
		).resolves.toMatchObject({ errors: 1, valid: false });
		const items = (await listImportItems(operator.client, sessionId)).data ?? [];
		expect(items.map((i) => [i.rowNumber, i.baseNumber, i.errorCode, i.errorMessage])).toEqual([
			[1, 900, null, null],
			[2, null, 'parse_code_not_a_number', 'Barcode ABC is not a base number.']
		]);
		// The app reads codes like import_session_add_scan does.
		expect(readBarcode('ABC', campaignRules)).toMatchObject({
			code: items[1].errorCode,
			message: items[1].errorMessage
		});
		await removeImportItem(operator.client, importRemoveItemSchema.parse({ itemId: items[1].id }));
		await expect(validateImportSession(operator.client, sessionId)).resolves.toMatchObject({
			status: 'validated',
			validated: true,
			simpleItems: 1
		});

		const err = await createImportSession(
			readOnly.client,
			importSessionCreateSchema.parse({ campaignId, sourceType: 'csv_file', fileName: 'x.csv' })
		).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ImportServiceError);
		expect(err).toMatchObject({ kind: 'permission', status: 403 });
		await expect(validateImportSession(readOnly.client, sessionId)).rejects.toMatchObject({
			kind: 'permission'
		});
		await expect(
			cancelImportSession(operator.client, importCancelSessionSchema.parse({ sessionId }))
		).resolves.toMatchObject({ status: 'cancelled' });
		await expect(
			addScanItem(operator.client, importAddScanSchema.parse({ sessionId, barcode: '0901' }))
		).rejects.toMatchObject({ kind: 'conflict', message: IMPORT_MESSAGES.sessionClosed });
	});
});
