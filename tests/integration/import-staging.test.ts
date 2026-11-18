import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validateImportBatch } from '$lib/domain/imports';
import { getUserPermissions } from '$lib/server/auth/permissions';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	getExistingCampaignData,
	getImportSession,
	listImportItems
} from '$lib/server/repositories/imports';
import {
	addScanItem,
	createImportSession,
	ImportServiceError,
	removeImportItem,
	stageImportFile,
	validateImportSession
} from '$lib/server/services/imports';
import {
	importAddScanSchema,
	importRemoveItemSchema,
	importSessionCreateSchema
} from '$lib/schemas/import';
import { resolveSeedConfig } from '../../scripts/seed-admin';

/**
 * SAN-45: import staging against the local Supabase with the seeded operator and read-only users:
 * a CSV with simple and pata rows goes through parsing, the `import_session_*` functions and the
 * database validation (duplicates against existing bonds included), and the client validator
 * (`validateImportBatch`) gives the same statuses, codes and messages. No bonds are created.
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
	return { client, permissions: await getUserPermissions(client) };
}

function fixture(role: string) {
	const found = seedConfig.fixtures.find((f) => f.roleNames.includes(role));
	if (!found) throw new Error(`resolveSeedConfig returned no ${role} fixture`);
	return found;
}

let operator: Caller;
let readOnly: Caller;
let campaignId: string;
let existingBondId: string;

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
	existingBondId = bond.data as string;
});

const CSV = [
	'tipo_bono;grupo_pata;numero_base;barcode',
	'simple;;0068;0068',
	'simple;;;77',
	'pata;P1;1200;1200',
	'pata;P1;1315;1315',
	'pata;P2;;1400',
	'simple;;;0100',
	'pata;EXIST-1;;1500',
	'pata;EXIST-1;;1501',
	'simple;;0071;0070',
	'simple;;;0050',
	'simple;;;4921',
	'simple;;;0700',
	'pata;0700;;0701',
	'pata;0700;;0702',
	''
].join('\r\n');

describe('import staging (local Supabase)', () => {
	it('stages a CSV, reports every problem and agrees with the client validator', async () => {
		const ctx = { requestId: `it-imports-${RUN_ID}-stage`, permissions: operator.permissions };
		const staged = await stageImportFile(
			operator.client,
			{ campaignId, fileName: 'bonos.csv', bytes: new TextEncoder().encode(CSV) },
			ctx
		);
		expect(staged).toMatchObject({
			rowCount: 14,
			status: 'draft',
			summary: {
				totalItems: 14,
				valid: 3,
				warnings: 1,
				errors: 10,
				pending: 0,
				simpleBonds: 2,
				patas: 1,
				baseNumbers: 4,
				participatingNumbers: 8,
				duplicates: 8
			}
		});

		const items = (await listImportItems(operator.client, staged.sessionId)).data ?? [];
		expect(items.map((i) => [i.rowNumber, i.status, i.errorCode])).toEqual([
			[2, 'valid', null],
			[3, 'warning', 'base_number_not_padded'],
			[4, 'valid', null],
			[5, 'valid', null],
			[6, 'error', 'pata_incomplete'],
			[7, 'error', 'duplicate_number_in_campaign'],
			[8, 'error', 'duplicate_barcode_in_campaign'],
			[9, 'error', 'duplicate_barcode_in_campaign'],
			[10, 'error', 'base_number_mismatch'],
			[11, 'error', 'duplicate_number_in_batch'],
			[12, 'error', 'duplicate_number_in_batch'],
			[13, 'error', 'duplicate_barcode_in_batch'],
			[14, 'error', 'duplicate_barcode_in_batch'],
			[15, 'error', 'duplicate_barcode_in_batch']
		]);
		expect(items.find((i) => i.rowNumber === 7)?.errorMessage).toBe(
			`Number 0100 is already used by bond ${existingBondId}`
		);

		// Cross-check: the client validator, fed the same rows and live campaign data, agrees.
		const campaign = (await getCampaignById(operator.client, campaignId)).data;
		const existing = (await getExistingCampaignData(operator.client, campaignId)).data;
		expect(campaign && existing).toBeTruthy();
		const client = validateImportBatch(
			items.map((i) => ({ key: i.id, rowNumber: i.rowNumber, raw: i.fields })),
			campaign!,
			existing!
		);
		expect(
			client.items.map((i) => [i.rowNumber, i.status, i.errorCode, i.errorMessage, i.baseNumber])
		).toEqual(items.map((i) => [i.rowNumber, i.status, i.errorCode, i.errorMessage, i.baseNumber]));
		expect(client.summary).toEqual(staged.summary);

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
			summary: { totalItems: 4, errors: 0, simpleBonds: 2, patas: 1, baseNumbers: 4 }
		});
		expect((await getImportSession(operator.client, staged.sessionId)).data?.status).toBe(
			'validated'
		);
		const { count } = await operator.client
			.from('bonds')
			.select('id', { count: 'exact', head: true })
			.eq('import_session_id', staged.sessionId);
		expect(count).toBe(0);
	});

	it('scans one code at a time and enforces permissions', async () => {
		const sessionId = await createImportSession(
			operator.client,
			importSessionCreateSchema.parse({ campaignId, sourceType: 'barcode_scan' }),
			{ permissions: operator.permissions }
		);
		await addScanItem(
			operator.client,
			importAddScanSchema.parse({ sessionId, tipoBono: 'simple', barcode: '0900' })
		);
		await expect(validateImportSession(operator.client, sessionId)).resolves.toMatchObject({
			status: 'validated',
			summary: { simpleBonds: 1 }
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
	});
});
