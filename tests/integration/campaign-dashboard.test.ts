import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isHttpError } from '@sveltejs/kit';
import { todayInBuenosAires } from '$lib/domain/reports';
import { createBuyer, createCollector } from '$lib/server/services/parties';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';
import type { UserProfile } from '../../src/app';
import { load } from '../../src/routes/campaigns/[id]/+page.server';

const { supabaseUrl, anonKey, seedEnv } = inject('integrationEnv');
const seed = resolveSeedConfig(seedEnv);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = randomUUID().slice(0, 8);
let sequence = 0;
const rid = (label: string) => `it-dash-${RUN_ID}-${String(++sequence).padStart(3, '0')}-${label}`;

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
let soldBondId: string;

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
		url: new URL(`http://localhost/campaigns/${id}/${opts.search ?? ''}`)
	} as unknown as Parameters<typeof load>[0];
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
		p_name: `[it-dash ${RUN_ID}] ${label}`,
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
	campaignId = await createCampaign('dashboard');
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

	// Monthly draw: installment 2 required before the end of today (cutoff day inclusive).
	const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
	await rpcId(users.admin.client, 'draw_create', {
		p_campaign_id: campaignId,
		p_draw_type: 'monthly',
		p_name: 'Dashboard monthly',
		p_draw_date: tomorrow,
		p_payment_cutoff_at: new Date(Date.now() + 3_600_000).toISOString(),
		p_required_installment_number: 2,
		p_eligibility_rule: {},
		p_request_id: rid('draw')
	});
	soldBondId = sold;
});

describe('campaign dashboard (local Supabase)', () => {
	it('shows every group to an administrator, from confirmed payments and closed settlements', async () => {
		const data = (await load(event(users.admin)))!;
		const { operational, financial } = data.dashboard;
		expect(operational!.bonds).toMatchObject({ total: 3, sold: 1, available: 1, delivered: 1 });
		expect(operational!.revenue).toMatchObject({
			expected: '300.00',
			collected: '100.00',
			pending: '200.00',
			collectedPercent: 33
		});
		expect(financial!.cash).toEqual({ cash: '100.00', transfer: '0.00', total: '100.00' });
		expect(financial!.commissions).toMatchObject({
			closedSettlements: 1,
			openSettlements: 0,
			settledCash: '100.00',
			generated: '0.00'
		});
		// No commission rule in this campaign: the current accounts are empty.
		expect(financial!.balances).toMatchObject({ creditors: 0, net: '0.00', top: [] });
	});

	it('lists the sold bond as at risk for the next draw, linked to its record', async () => {
		const { operational } = (await load(event(users.admin)))!.dashboard;
		expect(operational!.nextDraw).toMatchObject({
			name: 'Dashboard monthly',
			requiredInstallmentNumber: 2,
			atRiskCount: 1
		});
		expect(operational!.atRisk).toMatchObject([
			{ bondId: soldBondId, baseNumber: 7, missingInstallments: 1, requiredInstallments: 2 }
		]);
	});

	it('shows the operational groups only to an operator', async () => {
		const { operational, financial } = (await load(event(users.operator)))!.dashboard;
		expect(operational!.bonds.total).toBe(3);
		expect(financial).toBeNull();
	});

	it('shows the financial groups only to a treasurer without operational reports', async () => {
		const permissions = users.treasurer.permissions.filter((p) => p !== 'report.view_operational');
		const { operational, financial } = (await load(event(users.treasurer, { permissions })))!
			.dashboard;
		expect(operational).toBeNull();
		expect(financial!.cash.cash).toBe('100.00');
	});

	it('shows both to read-only users and none to a collector', async () => {
		const readOnly = (await load(event(users['read-only'])))!.dashboard;
		expect(readOnly.operational).not.toBeNull();
		expect(readOnly.financial).not.toBeNull();
		const collector = (await load(event(users.collector)))!.dashboard;
		expect(collector).toEqual({ operational: null, financial: null });
	});

	it('shows an empty campaign with zeros and no draw', async () => {
		const { operational, financial } = (await load(event(users.admin, { id: emptyCampaignId })))!
			.dashboard;
		expect(operational!.bonds.total).toBe(0);
		expect(operational!.revenue).toMatchObject({ expected: '0.00', collectedPercent: 0 });
		expect(operational!.nextDraw).toBeNull();
		expect(operational!.atRisk).toEqual([]);
		expect(financial!.cash.total).toBe('0.00');
	});

	it('answers 404 for an unknown campaign and 500 when permissions are unavailable', async () => {
		const missing = '00000000-0000-4000-8000-00000000dead';
		expect(await status(() => load(event(users.admin, { id: missing })))).toBe(404);
		expect(await status(() => load(event(users.admin, { permissions: null })))).toBe(500);
	});
});
