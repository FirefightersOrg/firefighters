import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RequestEvent } from '@sveltejs/kit';
import { parseCsv } from '$lib/domain/csv';
import { GET } from '../../src/routes/campaigns/[id]/backups/export/[kind]/+server';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';

const { supabaseUrl, anonKey, seedEnv } = inject('integrationEnv');
const config = resolveSeedConfig(seedEnv);
const run = randomUUID().slice(0, 8);

interface Caller {
	client: SupabaseClient;
	permissions: string[];
}
async function signIn(email: string, password: string): Promise<Caller> {
	const client = createClient(supabaseUrl, anonKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
	const { data, error } = await client.auth.signInWithPassword({ email, password });
	if (error || !data.session) throw new Error(`Unable to sign in as ${email}`);
	const scoped = createClient(supabaseUrl, anonKey, {
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
	return { client: scoped, permissions: await loadPermissions(scoped) };
}

let admin: Caller;
let operator: Caller;
let campaignId: string;

async function call(
	caller: Caller,
	kind: string,
	opts: { permissions?: string[] | null; query?: string; id?: string } = {}
) {
	const url = new URL(
		`http://localhost/campaigns/${opts.id ?? campaignId}/backups/export/${kind}${opts.query ?? ''}`
	);
	const event = {
		locals: {
			supabase: caller.client,
			user: { id: 'u' },
			profile: { id: 'p' },
			permissions: opts.permissions === undefined ? caller.permissions : opts.permissions,
			requestId: `it-backup-${run}`
		},
		params: { id: opts.id ?? campaignId, kind },
		url
	} as unknown as RequestEvent;
	try {
		return { response: (await GET(event as never)) as Response };
	} catch (thrown) {
		return { thrown: thrown as { status: number } };
	}
}

beforeAll(async () => {
	admin = await signIn(config.admin.email, config.admin.password);
	const op = config.fixtures.find((f) => f.roleNames.includes('operator'))!;
	operator = await signIn(op.email, op.password);
	const created = await admin.client.rpc('campaign_create', {
		p_name: `it backups ${run}`,
		p_simple_bond_value: '60000.00',
		p_installment_count: 10,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_starts_at: '2027-03-01T00:00:00-03:00',
		p_ends_at: '2027-12-31T23:59:59-03:00'
	});
	if (created.error) throw new Error(created.error.message);
	campaignId = created.data as string;
	for (const n of [1, 2]) {
		const bond = await admin.client.rpc('bond_create', {
			p_campaign_id: campaignId,
			p_base_numbers: [n],
			p_internal_code: n === 1 ? `=INT,${run}` : null,
			p_barcode: null
		});
		if (bond.error) throw new Error(bond.error.message);
	}
});

describe('backup export route (local Supabase)', () => {
	it('exports the campaign bonds as CSV for an administrator', async () => {
		const { response } = await call(admin, 'bonds');
		expect(response?.status).toBe(200);
		expect(response?.headers.get('content-type')).toContain('text/csv');
		expect(response?.headers.get('content-disposition')).toContain('bonds-');
		const rows = parseCsv(await response!.text()).map((r) => r.cells);
		expect(rows[0]).toContain('total_value');
		expect(rows).toHaveLength(3);
		const header = rows[0]!;
		const col = (name: string) => header.indexOf(name);
		const byCode = rows.slice(1).map((r) => r[col('internal_code')]);
		expect(byCode).toContain(`'=INT,${run}`);
		expect(rows[1]![col('total_value')]).toBe('60000.00');
		expect(rows[1]![col('numbers')]).toContain('base:1');
	});

	it('returns only the header for exports without rows', async () => {
		for (const kind of ['payments', 'settlements', 'collector-ledger', 'settlement-corrections']) {
			const { response } = await call(admin, kind, { query: '?from=2027-01-01&to=2027-12-31' });
			expect(response?.status, kind).toBe(200);
			expect(parseCsv(await response!.text())).toHaveLength(1);
		}
	});

	it('exports only frozen rosters with their entries (draw, snapshots, Buenos Aires time)', async () => {
		const draw = await admin.client.rpc('draw_create', {
			p_campaign_id: campaignId,
			p_draw_type: 'final',
			p_name: `=Final ${run}`,
			p_draw_date: '2027-12-20',
			p_payment_cutoff_at: '2027-12-15T23:59:59-03:00',
			p_required_installment_number: null,
			p_eligibility_rule: {}
		});
		expect(draw.error).toBeNull();
		const generated = await admin.client.rpc('draw_generate_roster', { p_draw_id: draw.data });
		expect(generated.error).toBeNull();
		// Generated but not frozen yet: not part of the export.
		let res = await call(admin, 'frozen-rosters');
		expect(res.response?.status).toBe(200);
		expect(parseCsv(await res.response!.text())).toHaveLength(1);

		const frozen = await admin.client.rpc('draw_freeze_roster', { p_draw_id: draw.data });
		expect(frozen.error).toBeNull();
		res = await call(admin, 'frozen-rosters');
		expect(res.response?.headers.get('content-disposition')).toContain('frozen-rosters-');
		const rows = parseCsv(await res.response!.text()).map((r) => r.cells);
		const header = rows[0]!;
		const get = (r: string[], h: string) => r[header.indexOf(h)];
		// Each bond contributes its base and associated number; ordered by number within the roster.
		const numbers = rows.slice(1).map((r) => Number(get(r!, 'number')));
		expect(numbers).toHaveLength(4);
		expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
		expect(numbers.slice(0, 2)).toEqual([1, 2]);
		// The number kind tells base numbers from associated ones (and extraordinary extras).
		expect(get(rows[1]!, 'bond_number_id')).toMatch(/^[0-9a-f-]{36}$/);
		const kinds = rows.slice(1).map((r) => get(r!, 'number_kind'));
		expect(kinds.filter((k) => k === 'base')).toHaveLength(2);
		expect(kinds.filter((k) => k === 'associated')).toHaveLength(2);
		for (const r of rows.slice(1)) {
			expect(get(r!, 'source_base_number_id') !== '').toBe(get(r!, 'number_kind') !== 'base');
		}
		expect(get(rows[1]!, 'draw_id')).toBe(draw.data);
		expect(get(rows[1]!, 'draw_name')).toBe(`'=Final ${run}`);
		expect(get(rows[1]!, 'draw_date')).toBe('2027-12-20');
		expect(get(rows[1]!, 'frozen_at')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
		expect(get(rows[1]!, 'eligible')).toBe('false');
		expect(get(rows[1]!, 'ineligibility_reason')).toBe('not_sold');
	});

	it('requires draw.view for frozen rosters and 404s for a missing campaign', async () => {
		const { thrown } = await call(admin, 'frozen-rosters', { permissions: ['report.export'] });
		expect(thrown?.status).toBe(403);
		expect((await call(admin, 'frozen-rosters', { permissions: null })).thrown?.status).toBe(500);
		expect((await call(admin, 'frozen-rosters', { id: randomUUID() })).thrown?.status).toBe(404);
		expect((await call(operator, 'frozen-rosters')).thrown?.status).toBe(403);
	});

	it('denies a user without report.export with 403', async () => {
		expect(operator.permissions).not.toContain('report.export');
		const { thrown, response } = await call(operator, 'bonds');
		expect(response).toBeUndefined();
		expect(thrown?.status).toBe(403);
	});

	it('answers 500 when the permissions could not be loaded (null)', async () => {
		const { thrown } = await call(admin, 'bonds', { permissions: null });
		expect(thrown?.status).toBe(500);
	});

	it('rejects unknown kinds, bad campaign ids and malformed periods', async () => {
		expect((await call(admin, 'winners-prizes')).thrown?.status).toBe(404);
		expect((await call(admin, 'bonds', { id: 'nope' })).thrown?.status).toBe(404);
		expect((await call(admin, 'bonds', { id: randomUUID() })).thrown?.status).toBe(404);
		expect(
			(await call(admin, 'payments', { query: '?from=2027-02-01&to=2027-01-01' })).thrown?.status
		).toBe(400);
	});
});
