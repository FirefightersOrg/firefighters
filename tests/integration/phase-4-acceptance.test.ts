import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isRedirect } from '@sveltejs/kit';
import {
	actions as importActions,
	load as importLoad
} from '../../src/routes/campaigns/[id]/bonds/import/+page.server';
import {
	actions as previewActions,
	load as previewLoad
} from '../../src/routes/campaigns/[id]/bonds/import/[sessionId]/+page.server';
import {
	actions as scanActions,
	load as scanLoad
} from '../../src/routes/campaigns/[id]/bonds/scan/+page.server';
import { getUserPermissions } from '$lib/server/auth/permissions';
import type { ImportItem } from '$lib/server/repositories/imports';
import type { ImportSessionSummary as ImportSummary } from '$lib/server/services/imports';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import type { UserProfile } from '../../src/app';

/**
 * SAN-46: file import, barcode scanning and the import preview through the real route code
 * (`/campaigns/[id]/bonds/import`, `/import/[sessionId]`, `/scan`) against the local Supabase,
 * with the seeded admin, operator and read-only users and their real permission lists.
 *
 * Imports and bonds cannot be deleted: each run creates its own campaign named
 * `[it-bond-import <run id>]`, so numbers never collide with a previous run.
 */

const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seedConfig = resolveSeedConfig(seedEnv);
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
let seq = 0;
const rid = (label: string) =>
	`it-bond-import-${RUN_ID}-${String(++seq).padStart(3, '0')}-${label}`;

interface Caller {
	user: User;
	client: SupabaseClient;
	profile: UserProfile;
	permissions: string[];
}

let serviceClient: SupabaseClient;

async function signIn(email: string, password: string): Promise<Caller> {
	const anonClient = createClient(supabaseUrl, anonKey, clientOptions);
	const { data, error } = await anonClient.auth.signInWithPassword({ email, password });
	if (error || !data.session) {
		throw new Error(
			`Failed to sign in as ${email}: ${error?.message ?? 'no session'}. ` +
				'Did you run `APP_ENV=local pnpm seed:admin`?'
		);
	}
	const client = createClient(supabaseUrl, anonKey, {
		...clientOptions,
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
	const { data: profile, error: profileError } = await serviceClient
		.from('profiles')
		.select('*')
		.eq('auth_user_id', data.user.id)
		.single();
	if (profileError || !profile) throw new Error(`No profile for ${email}`);
	return {
		user: data.user,
		client,
		profile: profile as UserProfile,
		permissions: await getUserPermissions(client)
	};
}

function fixture(role: string) {
	const found = seedConfig.fixtures.find((f) => f.roleNames.includes(role));
	if (!found) throw new Error(`resolveSeedConfig returned no ${role} fixture`);
	return found;
}

/** A RequestEvent for a load or action of `/campaigns/<id><suffix>`. */
function event<E>(
	caller: Caller,
	params: Record<string, string>,
	suffix: string,
	options: { action?: string; body?: FormData; search?: string } = {}
): E {
	const action = options.body ? `?/${options.action ?? 'default'}` : (options.search ?? '');
	const url = new URL(`http://localhost/campaigns/${params.id}${suffix}${action}`);
	const request = options.body
		? new Request(url, { method: 'POST', body: options.body })
		: new Request(url);
	return {
		locals: {
			supabase: caller.client,
			safeGetSession: async () => ({ session: null, user: caller.user }),
			session: null,
			user: caller.user,
			profile: caller.profile,
			permissions: caller.permissions,
			requestId: rid('req')
		},
		params,
		url,
		request
	} as unknown as E;
}

function form(fields: Record<string, string | File>): FormData {
	const body = new FormData();
	for (const [key, value] of Object.entries(fields)) body.set(key, value);
	return body;
}

type ActionResult = {
	status?: number;
	data?: Record<string, unknown>;
	redirect?: string;
} & Record<string, unknown>;

/** Runs an action; a thrown redirect is returned as `{ redirect }`. */
async function run(action: (e: never) => unknown, e: unknown): Promise<ActionResult> {
	try {
		return (await action(e as never)) as ActionResult;
	} catch (err) {
		if (!isRedirect(err)) throw err;
		return { redirect: err.location };
	}
}

type Preview = {
	summary: ImportSummary;
	items: ImportItem[];
	session: { status: string; rolledBackAt: string | null; sourceType: string };
	canEdit: boolean;
	canRollBack: boolean;
};

async function preview(caller: Caller, sessionId: string, search = ''): Promise<Preview> {
	return (await previewLoad(
		event(caller, { id: campaignId, sessionId }, `/bonds/import/${sessionId}`, { search })
	)) as unknown as Preview;
}

function previewAction(
	caller: Caller,
	sessionId: string,
	action: keyof typeof previewActions,
	fields: Record<string, string> = {}
) {
	return run(
		previewActions[action] as (e: never) => unknown,
		event(caller, { id: campaignId, sessionId }, `/bonds/import/${sessionId}`, {
			action,
			body: form(fields)
		})
	);
}

async function upload(caller: Caller, name: string, content: string): Promise<ActionResult> {
	const file = new File([content], name, { type: 'text/csv' });
	return run(
		importActions.upload as (e: never) => unknown,
		event(caller, { id: campaignId }, '/bonds/import', {
			action: 'upload',
			body: form({ file, notes: 'integration batch' })
		})
	);
}

let admin: Caller;
let operator: Caller;
let readOnly: Caller;
let campaignId: string;

beforeAll(async () => {
	serviceClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);
	admin = await signIn(seedConfig.admin.email, seedConfig.admin.password);
	const op = fixture('operator');
	operator = await signIn(op.email, op.password);
	const ro = fixture('read-only');
	readOnly = await signIn(ro.email, ro.password);
	const { data, error } = await admin.client.rpc('campaign_create', {
		p_name: `[it-bond-import ${RUN_ID}] Imports`,
		p_simple_bond_value: '60000.00',
		p_installment_count: 10,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_request_id: rid('campaign')
	});
	if (error) throw new Error(`campaign_create failed: ${error.message}`);
	campaignId = data as string;
});

const sessionIdOf = (location: string | undefined) => {
	const match = /\/bonds\/import\/([0-9a-f-]{36})$/.exec(location ?? '');
	if (!match) throw new Error(`no session in redirect ${location}`);
	return match[1];
};

async function createCampaign(
	label: string,
	mode: 'base_number' | 'internal_code' | 'external_legacy_code' | 'manual_mapping' = 'base_number',
	pattern: string | null = null
) {
	const { data, error } = await admin.client.rpc('campaign_create', {
		p_name: `[it-p4 ${RUN_ID}] ${label}`,
		p_simple_bond_value: '60000.00',
		p_installment_count: 10,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: mode,
		p_barcode_pattern: pattern,
		p_request_id: rid(`campaign-${label}`)
	});
	if (error) throw new Error(`campaign_create: ${error.message}`);
	return data as string;
}

async function startScan(caller: Caller, id = campaignId) {
	const out = await run(
		scanActions.start as (e: never) => unknown,
		event(caller, { id }, '/bonds/scan', { action: 'start', body: form({}) })
	);
	const found = /session=([0-9a-f-]{36})$/.exec(out.redirect ?? '');
	expect(found).not.toBeNull();
	return found![1];
}
async function scan(
	caller: Caller,
	sessionId: string,
	fields: Record<string, string>,
	id = campaignId
) {
	return run(
		scanActions.scan as (e: never) => unknown,
		event(caller, { id }, '/bonds/scan', { action: 'scan', body: form({ sessionId, ...fields }) })
	);
}
async function items(sessionId: string) {
	const { data, error } = await serviceClient
		.from('import_session_items')
		.select('*')
		.eq('import_session_id', sessionId)
		.order('row_number');
	expect(error).toBeNull();
	return data ?? [];
}
async function bonds(sessionId: string) {
	const { data, error } = await serviceClient
		.from('bonds')
		.select('*')
		.eq('import_session_id', sessionId);
	expect(error).toBeNull();
	return data ?? [];
}
beforeAll(async () => {
	serviceClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);
	admin = await signIn(seedConfig.admin.email, seedConfig.admin.password);
	operator = await signIn(fixture('operator').email, fixture('operator').password);
	readOnly = await signIn(fixture('read-only').email, fixture('read-only').password);
});

describe('Phase 4 end-to-end acceptance (local Supabase)', () => {
	describe('1. Staging does not create bonds before confirmation', () => {
		it('keeps scan and CSV/XLSX batches in sessions and items only', async () => {
			campaignId = await createCampaign('staging');
			const scanSession = await startScan(operator);
			await scan(operator, scanSession, { barcode: '0010' });
			const csv = await upload(
				operator,
				'staged.csv',
				'tipo_bono,grupo_pata,numero_base,barcode\nsimple,,0011,0011'
			);
			const csvSession = sessionIdOf(csv.redirect);
			const book = new ExcelJS.Workbook();
			const sheet = book.addWorksheet('Bonds');
			sheet.addRow(['tipo_bono', 'grupo_pata', 'numero_base', 'barcode']);
			sheet.addRow(['simple', '', '0012', '0012']);
			const xlsx = await run(
				importActions.upload as (e: never) => unknown,
				event(operator, { id: campaignId }, '/bonds/import', {
					action: 'upload',
					body: form({ file: new File([await book.xlsx.writeBuffer()], 'staged.xlsx'), notes: '' })
				})
			);
			const xlsxSession = sessionIdOf(xlsx.redirect);
			for (const id of [scanSession, csvSession, xlsxSession]) {
				expect(await items(id)).toHaveLength(1);
				expect(await bonds(id)).toHaveLength(0);
			}
		});
	});

	describe('2. Barcode interpretation modes', () => {
		it('uses base, patterned and manual mappings consistently for scan and file rows', async () => {
			for (const [mode, pattern, code, base] of [
				['base_number', null, '0020', '0020'],
				['internal_code', '^IT-([0-9]{4})$', 'IT-0021', '0021'],
				['external_legacy_code', '^EX-([0-9]{4})$', 'EX-0022', '0022'],
				['external_legacy_code', null, 'LEGACY', '0023'],
				['manual_mapping', null, 'MANUAL', '0024']
			] as const) {
				campaignId = await createCampaign(`mode-${mode}-${base}`, mode, pattern);
				const session = await startScan(operator);
				const scanned = await scan(operator, session, {
					barcode: code,
					...(mode === 'manual_mapping' || (pattern === null && mode !== 'base_number')
						? { baseNumber: base }
						: {})
				});
				expect(scanned.status).not.toBe(400);
				expect((await items(session))[0].base_number).toBe(Number(base));
				const file = await upload(
					operator,
					`mode-${base}.csv`,
					`tipo_bono,grupo_pata,numero_base,barcode\nsimple,,${base},${code}`
				);
				expect((await items(sessionIdOf(file.redirect)))[0].base_number).toBe(Number(base));
			}
			campaignId = await createCampaign('base mismatch');
			const file = await upload(
				operator,
				'mismatch.csv',
				'tipo_bono,grupo_pata,numero_base,barcode\nsimple,,0026,0025'
			);
			expect((await items(sessionIdOf(file.redirect)))[0].error_code).toBe(
				'parse_base_number_mismatch'
			);
		});
	});

	describe('3. Blocking errors and preview correction', () => {
		it('refuses confirmation until range, duplicate and incomplete-pata errors are fixed or removed', async () => {
			campaignId = await createCampaign('correction');
			const result = await upload(
				operator,
				'broken.csv',
				[
					'tipo_bono,grupo_pata,numero_base,barcode',
					'simple,,6000,6000',
					'simple,,0030,0030',
					'simple,,0030,0030',
					'pata,one,0040,0040'
				].join('\n')
			);
			const id = sessionIdOf(result.redirect);
			const before = await preview(operator, id, '?status=error');
			expect(before.summary.errors).toBeGreaterThanOrEqual(4);
			expect((await previewAction(operator, id, 'confirm')).status).toBe(409);
			expect(await bonds(id)).toHaveLength(0);
			const rows = new Map(before.items.map((x) => [x.rowNumber, x.id]));
			await previewAction(operator, id, 'update', {
				itemId: rows.get(2)!,
				itemType: 'simple',
				groupKey: '',
				baseNumber: '0041',
				barcode: '0041'
			});
			await previewAction(operator, id, 'remove', { itemId: rows.get(4)!, reason: 'duplicate' });
			await previewAction(operator, id, 'remove', { itemId: rows.get(5)!, reason: 'incomplete' });
			expect(await previewAction(operator, id, 'validate')).toMatchObject({
				success: true,
				summary: { status: 'validated' }
			});
		});
	});

	describe('4. Preview metrics reflect staged rows', () => {
		it('matches service-role item counts for simples, patas, bases, participants, errors and duplicates', async () => {
			campaignId = await createCampaign('metrics');
			const result = await upload(
				operator,
				'metrics.csv',
				[
					'tipo_bono,grupo_pata,numero_base,barcode',
					'simple,,0010,0010',
					'simple,,0010,0010',
					'pata,g,0020,0020',
					'pata,g,0021,0021'
				].join('\n')
			);
			const id = sessionIdOf(result.redirect);
			const page = await preview(operator, id);
			const db = await items(id);
			const live = db.filter((x) => !x.removed_at);
			expect(page.summary.liveItems).toBe(live.length);
			expect(page.summary.simpleItems).toBe(live.filter((x) => x.item_type === 'simple').length);
			expect(page.summary.pataGroups).toBe(
				new Set(live.filter((x) => x.item_type === 'pata').map((x) => x.group_key)).size
			);
			expect(page.summary.baseNumbers).toBe(
				new Set(live.filter((x) => x.base_number !== null).map((x) => x.base_number)).size
			);
			expect(page.summary.participatingNumbers).toBe(page.summary.baseNumbers * 2);
			expect(page.summary.errors).toBe(live.filter((x) => x.status === 'error').length);
			expect(page.summary.duplicates).toBe(
				live.filter(
					(x) => x.error_code?.includes('conflict') || x.error_code?.includes('duplicate')
				).length
			);
		});
	});

	describe('5. Transactional confirmation and stale sessions', () => {
		it('creates simple and pata bonds/numbers and audits; stale confirmation creates nothing', async () => {
			campaignId = await createCampaign('confirm');
			const uploaded = await upload(
				operator,
				'confirm.csv',
				[
					'tipo_bono,grupo_pata,numero_base,barcode',
					'simple,,0050,0050',
					'pata,p,0060,0060',
					'pata,p,0061,0061'
				].join('\n')
			);
			const id = sessionIdOf(uploaded.redirect);
			const out = await run(
				previewActions.confirm as (e: never) => unknown,
				event(operator, { id: campaignId, sessionId: id }, `/bonds/import/${id}`, {
					action: 'confirm',
					body: form({})
				})
			);
			expect(out.redirect).toContain('confirmed=1');
			const made = await bonds(id);
			expect(made.map((x) => x.kind).sort()).toEqual(['pata', 'simple']);
			const ids = made.map((x) => x.id);
			const { data: nums } = await serviceClient
				.from('bond_numbers')
				.select('bond_id,number_value,number_kind')
				.in('bond_id', ids);
			expect(nums).toHaveLength(6);
			const { data: allAudit } = await serviceClient
				.from('audit_log')
				.select('*')
				.in('entity_id', [id, ...ids]);
			expect(allAudit?.filter((x) => x.action === 'import.confirm')).toHaveLength(1);
			expect(allAudit?.filter((x) => x.action === 'bond.create')).toHaveLength(2);
			const stale = await upload(
				operator,
				'stale.csv',
				'tipo_bono,grupo_pata,numero_base,barcode\nsimple,,0070,0070'
			);
			const staleId = sessionIdOf(stale.redirect);
			await operator.client.rpc('bond_create', {
				p_campaign_id: campaignId,
				p_base_numbers: [70],
				p_request_id: rid('take-stale')
			});
			const rejected = await previewAction(operator, staleId, 'confirm');
			expect(rejected.status).toBe(409);
			expect(await bonds(staleId)).toHaveLength(0);
			const { data: staleAudit } = await serviceClient
				.from('audit_log')
				.select('action')
				.eq('entity_id', staleId)
				.eq('action', 'import.confirm_rejected');
			expect(staleAudit).toHaveLength(1);
		});
	});

	describe('6. Functional rollback', () => {
		it('requires admin and reason, releases available numbers, skips hand-annulled bonds and blocks delivered bonds', async () => {
			campaignId = await createCampaign('rollback');
			const uploaded = await upload(
				operator,
				'rollback.csv',
				'tipo_bono,grupo_pata,numero_base,barcode\nsimple,,0080,0080\nsimple,,0081,0081'
			);
			const id = sessionIdOf(uploaded.redirect);
			await previewAction(operator, id, 'confirm');
			const made = await bonds(id);
			expect(
				(await previewAction(operator, id, 'rollback', { reason: 'operator denied' })).status
			).toBe(403);
			expect((await previewAction(admin, id, 'rollback', { reason: ' ' })).status).toBe(400);
			await admin.client.rpc('bond_annul', {
				p_bond_id: made[0].id,
				p_reason: 'manual',
				p_request_id: rid('manual-annul')
			});
			expect(await previewAction(admin, id, 'rollback', { reason: 'wrong batch' })).toMatchObject({
				success: true
			});
			const { data: rollbackAudit } = await serviceClient
				.from('audit_log')
				.select('action,new_value')
				.eq('entity_id', id)
				.eq('action', 'import.rollback');
			expect(rollbackAudit).toHaveLength(1);
			expect(rollbackAudit?.[0].new_value).toMatchObject({
				bonds_annulled: 1,
				bonds_skipped: 1
			});
			const { data: released } = await serviceClient
				.from('bond_numbers')
				.select('released_at')
				.eq('bond_id', made[1].id);
			expect(released?.every((x) => x.released_at)).toBe(true);
			const again = await upload(
				operator,
				'again.csv',
				'tipo_bono,grupo_pata,numero_base,barcode\nsimple,,0081,0081'
			);
			expect(
				(await previewAction(operator, sessionIdOf(again.redirect), 'confirm')).redirect
			).toContain('confirmed=1');
			const blocked = await upload(
				operator,
				'delivered.csv',
				'tipo_bono,grupo_pata,numero_base,barcode\nsimple,,0090,0090'
			);
			const blockedId = sessionIdOf(blocked.redirect);
			await previewAction(operator, blockedId, 'confirm');
			const [delivered] = await bonds(blockedId);
			await serviceClient
				.from('bonds')
				.update({ commercial_status: 'delivered_to_collector' })
				.eq('id', delivered.id);
			expect((await previewAction(admin, blockedId, 'rollback', { reason: 'cannot' })).status).toBe(
				409
			);
		});
	});

	describe('7. Permissions follow session source', () => {
		it('denies read-only and distinguishes bond.import from bond.scan', async () => {
			campaignId = await createCampaign('permissions');
			await expect(
				importLoad(event(readOnly, { id: campaignId }, '/bonds/import'))
			).rejects.toMatchObject({ status: 403 });
			await expect(
				scanLoad(event(readOnly, { id: campaignId }, '/bonds/scan'))
			).rejects.toMatchObject({ status: 403 });
			const scanId = await startScan(operator);
			const scanPreview = await preview(operator, scanId);
			expect(scanPreview.session.sourceType).toBe('barcode_scan');
			const file = await upload(
				operator,
				'permissions.csv',
				'tipo_bono,grupo_pata,numero_base,barcode\nsimple,,0100,0100'
			);
			expect((await preview(operator, sessionIdOf(file.redirect))).session.sourceType).toBe(
				'csv_file'
			);
		});
	});
});
