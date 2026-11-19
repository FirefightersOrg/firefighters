import { randomUUID } from 'node:crypto';
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
import { loadPermissions } from './permissions';
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
		permissions: await loadPermissions(client)
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
	session: { status: string; rolledBackAt: string | null };
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

describe('bond imports (local Supabase)', () => {
	it('read-only users cannot open the import or scan pages, nor upload', async () => {
		await expect(
			importLoad(event(readOnly, { id: campaignId }, '/bonds/import'))
		).rejects.toMatchObject({ status: 403 });
		await expect(
			scanLoad(event(readOnly, { id: campaignId }, '/bonds/scan'))
		).rejects.toMatchObject({ status: 403 });
		const result = await upload(
			readOnly,
			'bonds.csv',
			'tipo_bono,grupo_pata,numero_base,barcode\n'
		);
		expect(result.status).toBe(403);
	});

	it('a file with a broken header is refused without opening a session', async () => {
		const result = await upload(operator, 'bad.csv', 'type,number\nsimple,1\n');
		expect(result).toMatchObject({ status: 400 });
		expect(String(result.data?.message)).toMatch(/missing columns/i);
		const page = (await importLoad(event(operator, { id: campaignId }, '/bonds/import'))) as {
			sessions: unknown[];
		};
		expect(page.sessions).toHaveLength(0);
	});

	let fileSession: string;

	it('uploading stages every row and shows the seven metrics with the errors', async () => {
		const csv = [
			'tipo_bono,grupo_pata,numero_base,barcode',
			'simple,,0010,',
			'simple,,abc,',
			'simple,,6000,',
			'pata,P-1,0020,0020',
			'pata,P-1,0021,0021',
			'simple,,0030,',
			'simple,,0030,'
		].join('\n');
		const result = await upload(operator, 'march.csv', csv);
		fileSession = sessionIdOf(result.redirect);

		const page = await preview(operator, fileSession);
		expect(page.canEdit).toBe(true);
		expect(page.summary).toMatchObject({
			status: 'draft',
			liveItems: 7,
			simpleItems: 5,
			pataGroups: 1,
			errors: 4
		});
		const errors = await preview(operator, fileSession, '?status=error');
		expect(errors.items.map((i) => [i.rowNumber, i.errorCode])).toEqual([
			[3, 'parse_invalid_base_number'],
			[4, 'number_out_of_range'],
			[7, 'number_conflict'],
			[8, 'number_conflict']
		]);
	});

	it('confirm is refused while there are errors', async () => {
		const result = await previewAction(operator, fileSession, 'confirm');
		expect(result.status).toBe(409);
	});

	it('the operator corrects and removes rows, validates and confirms', async () => {
		const page = await preview(operator, fileSession, '?status=error');
		const byRow = new Map(page.items.map((i) => [i.rowNumber, i.id]));

		const invalid = await previewAction(operator, fileSession, 'update', {
			itemId: byRow.get(3)!,
			itemType: 'simple',
			baseNumber: '12a',
			barcode: ''
		});
		expect(invalid).toMatchObject({
			status: 400,
			data: { errors: { baseNumber: expect.any(Array) } }
		});

		const fixed = await previewAction(operator, fileSession, 'update', {
			itemId: byRow.get(3)!,
			itemType: 'simple',
			baseNumber: '0012',
			barcode: ''
		});
		expect(fixed).toMatchObject({ success: true, summary: { errors: 3 } });

		await previewAction(operator, fileSession, 'update', {
			itemId: byRow.get(4)!,
			itemType: 'simple',
			baseNumber: '0040',
			barcode: ''
		});
		const removed = await previewAction(operator, fileSession, 'remove', {
			itemId: byRow.get(8)!,
			reason: 'duplicate card'
		});
		expect(removed).toMatchObject({ success: true, summary: { errors: 0, removedItems: 1 } });

		const validated = await previewAction(operator, fileSession, 'validate');
		expect(validated).toMatchObject({ success: true, summary: { status: 'validated' } });

		const confirmed = await previewAction(operator, fileSession, 'confirm');
		expect(confirmed.redirect).toMatch(/\?confirmed=1$/);

		const after = await preview(operator, fileSession);
		expect(after.session.status).toBe('confirmed');
		expect(after.canEdit).toBe(false);
		expect(after.canRollBack).toBe(false); // the operator has no bond.annul

		const { data: bonds } = await serviceClient
			.from('bonds')
			.select('kind, commercial_status')
			.eq('import_session_id', fileSession);
		expect(bonds).toHaveLength(5);
		expect(new Set(bonds?.map((b) => b.commercial_status))).toEqual(new Set(['available']));
	});

	it('a confirmed import is read-only and the admin can roll it back', async () => {
		const page = await preview(operator, fileSession, '?status=valid');
		const edit = await previewAction(operator, fileSession, 'update', {
			itemId: page.items[0].id,
			itemType: 'simple',
			baseNumber: '0099',
			barcode: 'X'
		});
		expect(edit.status).toBe(409);

		const denied = await previewAction(operator, fileSession, 'rollback', { reason: 'mistake' });
		expect(denied.status).toBe(403);
		const noReason = await previewAction(admin, fileSession, 'rollback', { reason: ' ' });
		expect(noReason.status).toBe(400);

		const rolledBack = await previewAction(admin, fileSession, 'rollback', {
			reason: 'wrong file'
		});
		expect(rolledBack).toMatchObject({ success: true });
		const after = await preview(admin, fileSession);
		expect(after.session.rolledBackAt).not.toBeNull();
		expect(after.canRollBack).toBe(false);
	});

	it('scanning: start a batch, stage codes with instant feedback, then confirm', async () => {
		const started = await run(
			scanActions.start as (e: never) => unknown,
			event(operator, { id: campaignId }, '/bonds/scan', { action: 'start', body: form({}) })
		);
		const scanSession = /session=([0-9a-f-]{36})$/.exec(started.redirect ?? '')?.[1];
		expect(scanSession).toBeDefined();

		const scan = (fields: Record<string, string>) =>
			run(
				scanActions.scan as (e: never) => unknown,
				event(operator, { id: campaignId }, '/bonds/scan', {
					action: 'scan',
					body: form({ sessionId: scanSession!, ...fields })
				})
			);

		// Base numbers freed by the rollback can be scanned again.
		const ok = await scan({ barcode: '0010' });
		expect(ok).toMatchObject({
			success: true,
			scanned: { baseNumber: 10, status: 'valid' },
			summary: { simpleItems: 1, errors: 0 }
		});
		const bad = await scan({ barcode: 'NOT-A-NUMBER' });
		expect(bad).toMatchObject({
			success: false,
			scanned: { errorCode: 'parse_code_not_a_number' },
			summary: { errors: 1 }
		});
		await scan({ barcode: '0050', groupKey: 'SCAN-P' });
		await scan({ barcode: '0051', groupKey: 'SCAN-P' });

		const page = (await scanLoad(
			event(operator, { id: campaignId }, '/bonds/scan', { search: `?session=${scanSession}` })
		)) as { summary: ImportSummary; recent: ImportItem[] };
		expect(page.summary).toMatchObject({ simpleItems: 2, pataGroups: 1, errors: 1 });
		expect(page.recent[0].barcode).toBe('0051');

		const errors = await preview(operator, scanSession!, '?status=error');
		await previewAction(operator, scanSession!, 'remove', { itemId: errors.items[0].id });
		expect(await previewAction(operator, scanSession!, 'validate')).toMatchObject({
			success: true
		});
		const confirmed = await previewAction(operator, scanSession!, 'confirm');
		expect(confirmed.redirect).toMatch(/\?confirmed=1$/);

		// A confirmed scan batch is reviewed on its preview page.
		await expect(
			scanLoad(
				event(operator, { id: campaignId }, '/bonds/scan', { search: `?session=${scanSession}` })
			)
		).rejects.toSatisfy((err) => isRedirect(err));
	});

	it('a scan session cannot be fed from another campaign', async () => {
		const { data: other } = await admin.client.rpc('campaign_create', {
			p_name: `[it-bond-import ${RUN_ID}] Other`,
			p_simple_bond_value: '60000.00',
			p_installment_count: 10,
			p_number_digits: 4,
			p_max_number: 9999,
			p_associated_number_offset: 4871,
			p_overflow_policy: 'reject',
			p_barcode_mode: 'base_number',
			p_request_id: rid('other-campaign')
		});
		const started = await run(
			scanActions.start as (e: never) => unknown,
			event(operator, { id: campaignId }, '/bonds/scan', { action: 'start', body: form({}) })
		);
		const scanSession = /session=([0-9a-f-]{36})$/.exec(started.redirect ?? '')![1];
		const result = await run(
			scanActions.scan as (e: never) => unknown,
			event(operator, { id: other as string }, '/bonds/scan', {
				action: 'scan',
				body: form({ sessionId: scanSession, barcode: '0077' })
			})
		);
		expect(result.status).toBe(404);
	});

	// Review on #39 ---------------------------------------------------------------------------

	async function newCampaign(label: string): Promise<string> {
		const { data, error } = await admin.client.rpc('campaign_create', {
			p_name: `[it-bond-import ${RUN_ID}] ${label}`,
			p_simple_bond_value: '60000.00',
			p_installment_count: 10,
			p_number_digits: 4,
			p_max_number: 9999,
			p_associated_number_offset: 4871,
			p_overflow_policy: 'reject',
			p_barcode_mode: 'base_number',
			p_request_id: rid(`campaign-${label}`)
		});
		if (error) throw new Error(`campaign_create failed: ${error.message}`);
		return data as string;
	}

	function scanIn(caller: Caller, campaign: string, sessionId: string, barcode: string) {
		return run(
			scanActions.scan as (e: never) => unknown,
			event(caller, { id: campaign }, '/bonds/scan', {
				action: 'scan',
				body: form({ sessionId, barcode })
			})
		);
	}

	async function startScanIn(campaign: string): Promise<string> {
		const started = await run(
			scanActions.start as (e: never) => unknown,
			event(operator, { id: campaign }, '/bonds/scan', { action: 'start', body: form({}) })
		);
		return /session=([0-9a-f-]{36})$/.exec(started.redirect ?? '')![1];
	}

	it('concurrent scans each report their own staged row', async () => {
		const campaign = await newCampaign('Concurrent scans');
		const session = await startScanIn(campaign);
		const results = await Promise.all(
			['0201', 'BAD-1', '0202', 'BAD-2', '0203'].map((code) =>
				scanIn(operator, campaign, session, code)
			)
		);
		for (const [i, code] of ['0201', 'BAD-1', '0202', 'BAD-2', '0203'].entries()) {
			const scanned = results[i].scanned as { barcode: string; status: string } | null;
			expect(scanned?.barcode).toBe(code);
			expect(results[i].success).toBe(!code.startsWith('BAD'));
		}
	});

	it('a correction keeps the campaign barcode rule', async () => {
		const campaign = await newCampaign('Correction rule');
		const file = new File(
			['tipo_bono,grupo_pata,numero_base,barcode\nsimple,,0300,0300\n'],
			'r.csv'
		);
		const uploaded = await run(
			importActions.upload as (e: never) => unknown,
			event(operator, { id: campaign }, '/bonds/import', {
				action: 'upload',
				body: form({ file, notes: '' })
			})
		);
		const sessionId = /\/bonds\/import\/([0-9a-f-]{36})$/.exec(uploaded.redirect ?? '')![1];
		const act = (action: keyof typeof previewActions, fields: Record<string, string>) =>
			run(
				previewActions[action] as (e: never) => unknown,
				event(operator, { id: campaign, sessionId }, `/bonds/import/${sessionId}`, {
					action,
					body: form(fields)
				})
			);
		const { data: items } = await serviceClient
			.from('import_session_items')
			.select('id')
			.eq('import_session_id', sessionId);
		const itemId = items![0].id as string;

		// base_number campaign: barcode 0300 with base 301 is a mismatch, not a valid row.
		const mismatch = await act('update', {
			itemId,
			itemType: 'simple',
			baseNumber: '0301',
			barcode: '0300'
		});
		expect(mismatch).toMatchObject({ success: true, summary: { errors: 1 } });
		const { data: row } = await serviceClient
			.from('import_session_items')
			.select('error_code')
			.eq('id', itemId)
			.single();
		expect(row?.error_code).toBe('parse_base_number_mismatch');

		// A row of another session cannot be corrected or removed from this URL.
		const other = await startScanIn(campaign);
		await scanIn(operator, campaign, other, '0400');
		const { data: foreign } = await serviceClient
			.from('import_session_items')
			.select('id')
			.eq('import_session_id', other)
			.single();
		const crossUpdate = await act('update', {
			itemId: foreign!.id as string,
			itemType: 'simple',
			baseNumber: '0401',
			barcode: '0401'
		});
		expect(crossUpdate.status).toBe(404);
		const crossRemove = await act('remove', { itemId: foreign!.id as string });
		expect(crossRemove.status).toBe(404);
	});

	it('scanning and row edits stop once the campaign no longer accepts bonds', async () => {
		const campaign = await newCampaign('Closing scans');
		const session = await startScanIn(campaign);
		await scanIn(operator, campaign, session, '0500');
		// Activating needs both dates (campaign rule), then active -> closing.
		for (const change of [
			{ starts_at: '2026-03-01T03:00:00Z', ends_at: '2026-12-31T03:00:00Z' },
			{ status: 'active' },
			{ status: 'closing' }
		]) {
			const { error } = await serviceClient.from('campaigns').update(change).eq('id', campaign);
			if (error) throw new Error(`campaign update failed: ${error.message}`);
		}
		const scan = await scanIn(operator, campaign, session, '0501');
		expect(scan.status).toBe(409);
		const { data: item } = await serviceClient
			.from('import_session_items')
			.select('id')
			.eq('import_session_id', session)
			.single();
		const remove = await run(
			previewActions.remove as (e: never) => unknown,
			event(operator, { id: campaign, sessionId: session }, `/bonds/import/${session}`, {
				action: 'remove',
				body: form({ itemId: item!.id as string })
			})
		);
		expect(remove.status).toBe(409);
	});
});
