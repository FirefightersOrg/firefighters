import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isHttpError } from '@sveltejs/kit';
import { todayInBuenosAires } from '$lib/domain/reports';
import { createBuyer, createCollector } from '$lib/server/services/parties';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';
import type { UserProfile } from '../../src/app';
import { load } from '../../src/routes/campaigns/[id]/reports/financial/+page.server';
import { GET as exportReport } from '../../src/routes/campaigns/[id]/reports/export/[report]/+server';
import ExcelJS from 'exceljs';

const { supabaseUrl, anonKey, seedEnv } = inject('integrationEnv');
const seed = resolveSeedConfig(seedEnv);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = randomUUID().slice(0, 8);
let sequence = 0;
const rid = (label: string) => `it-frep-${RUN_ID}-${String(++sequence).padStart(3, '0')}-${label}`;

interface Caller {
	user: User;
	client: SupabaseClient;
	profile: UserProfile;
	permissions: string[];
}
type Role = 'admin' | 'operator' | 'treasurer' | 'read-only' | 'collector';

const users = {} as Record<Role, Caller>;
let campaignId: string;
let emptyCampaignId: string;
let collectorId: string;
let buyerId: string;
let nextBase = 1;

async function signIn(role: Role, email: string, password: string): Promise<Caller> {
	const anon = createClient(supabaseUrl, anonKey, options);
	const { data, error } = await anon.auth.signInWithPassword({ email, password });
	if (error || !data.session || !data.user) throw new Error(`Unable to sign in as ${role}`);
	const client = createClient(supabaseUrl, anonKey, {
		...options,
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
	const { data: profile, error: profileError } = await client
		.from('profiles')
		.select('*')
		.eq('auth_user_id', data.user.id)
		.single();
	if (profileError || !profile) throw new Error(`No profile for ${role}`);
	return {
		user: data.user,
		client,
		profile: profile as UserProfile,
		permissions: await loadPermissions(client)
	};
}

async function rpcId(client: SupabaseClient, name: string, args: Record<string, unknown>) {
	const { data, error } = await client.rpc(name, args);
	if (error || typeof data !== 'string') throw new Error(error?.message ?? `${name} failed`);
	return data;
}

async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>) {
	const { error } = await client.rpc(name, args);
	if (error) throw new Error(`${name}: ${error.message}`);
}

function event(
	caller: Caller,
	opts: { id?: string; search?: string; permissions?: string[] | null } = {}
) {
	const id = opts.id ?? campaignId;
	return {
		locals: {
			supabase: caller.client,
			safeGetSession: async () => ({ session: null, user: caller.user }),
			session: null,
			user: caller.user,
			profile: caller.profile,
			permissions: opts.permissions === undefined ? caller.permissions : opts.permissions,
			requestId: rid('route')
		},
		params: { id },
		url: new URL(`http://localhost/campaigns/${id}/reports/financial${opts.search ?? ''}`)
	} as unknown as Parameters<typeof load>[0];
}

function exportEvent(
	caller: Caller,
	report: string,
	opts: { id?: string; search?: string; permissions?: string[] | null } = {}
) {
	const id = opts.id ?? campaignId;
	const base = event(caller, opts) as unknown as {
		locals: unknown;
	};
	return {
		locals: base.locals,
		params: { id, report },
		url: new URL(`http://localhost/campaigns/${id}/reports/export/${report}${opts.search ?? ''}`)
	} as unknown as Parameters<typeof exportReport>[0];
}

async function status(fn: () => unknown) {
	try {
		await fn();
		return 200;
	} catch (err) {
		if (isHttpError(err)) return err.status;
		throw err;
	}
}

async function createCampaign(label: string) {
	const id = await rpcId(users.admin.client, 'campaign_create', {
		p_name: `[it-frep ${RUN_ID}] ${label}`,
		p_simple_bond_value: '300.00',
		p_installment_count: 3,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 1,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_starts_at: '2026-01-01T03:00:00Z',
		p_ends_at: '2099-12-31T03:00:00Z',
		p_request_id: rid(`campaign-${label}`)
	});
	await rpc(users.admin.client, 'campaign_transition', {
		p_id: id,
		p_to_status: 'active',
		p_request_id: rid(`activate-${label}`)
	});
	return id;
}

async function newBond(label: string) {
	const id = await rpcId(users.admin.client, 'bond_create', {
		p_campaign_id: campaignId,
		p_base_numbers: [nextBase],
		p_request_id: rid(`bond-${label}`)
	});
	nextBase += 3;
	return id;
}

beforeAll(async () => {
	users.admin = await signIn('admin', seed.admin.email, seed.admin.password);
	for (const role of ['operator', 'treasurer', 'read-only', 'collector'] as const) {
		const fixture = seed.fixtures.find((item) => item.roleNames.includes(role))!;
		users[role] = await signIn(role, fixture.email, fixture.password);
	}
	campaignId = await createCampaign('reports');
	emptyCampaignId = await createCampaign('empty');
	collectorId = await createCollector(
		users.admin.client,
		{
			displayName: `Reports ${RUN_ID}`,
			phone: null,
			email: null,
			address: null,
			userProfileId: null,
			status: 'active'
		},
		{ requestId: rid('collector'), permissions: users.admin.permissions }
	);
	buyerId = await createBuyer(
		users.admin.client,
		{
			type: 'individual',
			firstName: 'Rep',
			lastName: RUN_ID,
			businessName: null,
			documentNumber: null,
			taxId: null,
			phone: null,
			address: null,
			usualCollectorId: null,
			notes: null
		},
		{ requestId: rid('buyer'), permissions: users.admin.permissions }
	);

	// One available bond, one delivered, one sold and paid (first installment, cash).
	await newBond('available');
	const delivered = await newBond('delivered');
	const sold = await newBond('sold');
	await rpc(users.admin.client, 'bond_deliver', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId,
		p_bond_ids: [delivered, sold],
		p_notes: null,
		p_request_id: rid('deliver')
	});
	const saleId = await rpcId(users.admin.client, 'sale_register', {
		p_campaign_id: campaignId,
		p_bond_id: sold,
		p_buyer_id: buyerId,
		p_payment_mode: 'installments',
		p_first_due_date: todayInBuenosAires(),
		p_request_id: rid('sale')
	});
	const { data: plan, error: planError } = await users.admin.client
		.from('payment_plans')
		.select('id')
		.eq('sale_id', saleId)
		.single();
	if (planError || !plan) throw new Error(`Unable to read the payment plan: ${planError?.message}`);
	const { data: installment, error: installmentError } = await users.admin.client
		.from('installments')
		.select('id')
		.eq('payment_plan_id', plan.id)
		.eq('installment_number', 1)
		.single();
	if (installmentError || !installment)
		throw new Error(`Unable to read the installment: ${installmentError?.message}`);
	const settlementId = await rpcId(users.admin.client, 'settlement_open', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId,
		p_notes: null,
		p_request_id: rid('settlement')
	});
	await rpcId(users.admin.client, 'settlement_add_payment', {
		p_settlement_id: settlementId,
		p_sale_id: saleId,
		p_amount: 100,
		p_payment_method: 'cash',
		p_applications: [{ installment_id: installment.id, amount_applied: 100 }],
		p_request_id: rid('payment')
	});
	await rpc(users.admin.client, 'settlement_close', {
		p_settlement_id: settlementId,
		p_request_id: rid('close')
	});
});

describe('financial and draw reports (local Supabase)', () => {
	const today = todayInBuenosAires();

	it('shows the financial reports to an administrator', async () => {
		const data = (await load(event(users.admin)))!;
		expect(data.payments.days).toEqual([
			{ paymentDate: today, cash: '100.00', transfer: '0.00', total: '100.00', count: 1 }
		]);
		const settlement = data.settlements.rows.find(
			(r: { collectorId: string }) => r.collectorId === collectorId
		)!;
		expect(settlement).toMatchObject({
			status: 'closed',
			settlementCount: 1,
			totalCash: '100.00',
			totalAmount: '100.00'
		});
		// No commission rule exists in this campaign, so the current account has no entries.
		expect(data.accounts.rows).toEqual([]);
		expect(data.draws).toEqual([]);
		expect(data.prizes.rows).toEqual([]);
		expect(data.ledger).toBeNull();
		expect(data.canExport).toBe(true);
	});

	it('loads the account detail when a collector is chosen and applies filters', async () => {
		const detail = (await load(event(users.admin, { search: `?collector=${collectorId}` })))!;
		expect(detail.ledger).toEqual([]);
		const transfer = (await load(event(users.admin, { search: '?method=transfer' })))!;
		expect(transfer.payments.days).toEqual([]);
		const past = (await load(event(users.admin, { search: '?to=2000-01-01' })))!;
		expect(past.payments.days).toEqual([]);
	});

	it('is scoped to the campaign', async () => {
		const data = (await load(event(users.admin, { id: emptyCampaignId })))!;
		expect(data.payments.days).toEqual([]);
		expect(data.settlements.rows).toEqual([]);
		expect(data.accounts.rows).toEqual([]);
	});

	it('lets treasurer and read-only read, and denies operator and collector (403)', async () => {
		expect((await load(event(users.treasurer)))!.payments.totals.total).toBe('100.00');
		expect((await load(event(users['read-only'])))!.payments.totals.total).toBe('100.00');
		expect(await status(() => load(event(users.operator)))).toBe(403);
		expect(await status(() => load(event(users.collector)))).toBe(403);
	});

	it('is 500 when the permissions could not be loaded, 404 for a missing campaign, 400 for bad filters', async () => {
		expect(await status(() => load(event(users.admin, { permissions: null })))).toBe(500);
		expect(await status(() => load(event(users.admin, { id: randomUUID() })))).toBe(404);
		expect(await status(() => load(event(users.admin, { id: 'nope' })))).toBe(404);
		expect(await status(() => load(event(users.admin, { search: '?method=card' })))).toBe(400);
		expect(await status(() => load(event(users.admin, { search: '?from=2027-02-31' })))).toBe(400);
	});

	it('exports a financial report as CSV and Excel with the same rows', async () => {
		const csv = await exportReport(exportEvent(users.admin, 'payments-by-date'));
		expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8');
		const bytes = new Uint8Array(await csv.arrayBuffer());
		expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		const text = new TextDecoder().decode(bytes);
		expect(text).toContain('Payment date,Method,Payments,Total');
		expect(text).toContain(`${today},Cash,1,100.00`);

		const xlsx = await exportReport(
			exportEvent(users.treasurer, 'payments-by-date', { search: '?format=xlsx' })
		);
		const workbook = new ExcelJS.Workbook();
		await workbook.xlsx.load((await xlsx.arrayBuffer()) as ArrayBuffer);
		const row = (workbook.worksheets[0]!.getRow(2).values as unknown[]).slice(1);
		expect(row).toEqual([today, 'Cash', 1, 100]);
	});

	it('exports the account detail, the roster and the prizes', async () => {
		const ledger = await exportReport(
			exportEvent(users.admin, 'collector-ledger', { search: `?collector=${collectorId}` })
		);
		expect(await ledger.text()).toContain('Running balance');
		const prizes = await exportReport(exportEvent(users.admin, 'prizes'));
		expect(prizes.status).toBe(200);
		expect(await status(() => exportReport(exportEvent(users.admin, 'collector-ledger')))).toBe(
			400
		);
		expect(
			await status(() =>
				exportReport(exportEvent(users.admin, 'draw-roster', { search: `?draw=${randomUUID()}` }))
			)
		).toBe(404);
	});

	it('enforces the export permissions: operator exports operational only, collector nothing', async () => {
		const operational = await exportReport(exportEvent(users.operator, 'bonds-by-status'));
		expect(operational.status).toBe(200);
		expect(await operational.text()).toContain('Commercial status,Financial status');
		expect(await status(() => exportReport(exportEvent(users.operator, 'payments-by-date')))).toBe(
			403
		);
		expect(await status(() => exportReport(exportEvent(users.collector, 'bonds-by-status')))).toBe(
			403
		);
		expect(await status(() => exportReport(exportEvent(users['read-only'], 'prizes')))).toBe(200);
	});

	it('exports answer 500 without permissions and 404 for a missing campaign or report', async () => {
		expect(
			await status(() => exportReport(exportEvent(users.admin, 'prizes', { permissions: null })))
		).toBe(500);
		expect(
			await status(() => exportReport(exportEvent(users.admin, 'prizes', { id: randomUUID() })))
		).toBe(404);
		expect(await status(() => exportReport(exportEvent(users.admin, 'nope')))).toBe(404);
	});
});
