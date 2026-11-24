import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isHttpError } from '@sveltejs/kit';
import { todayInBuenosAires } from '$lib/domain/reports';
import { createBuyer, createCollector } from '$lib/server/services/parties';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';
import type { UserProfile } from '../../src/app';
import { load } from '../../src/routes/campaigns/[id]/reports/+page.server';

const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seed = resolveSeedConfig(seedEnv);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = randomUUID().slice(0, 8);
let sequence = 0;
const rid = (label: string) => `it-rep-${RUN_ID}-${String(++sequence).padStart(3, '0')}-${label}`;

interface Caller {
	user: User;
	client: SupabaseClient;
	profile: UserProfile;
	permissions: string[];
}
type Role = 'admin' | 'operator' | 'treasurer' | 'read-only' | 'collector';

let service: SupabaseClient;
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
	const { data: profile, error: profileError } = await service
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
		url: new URL(`http://localhost/campaigns/${id}/reports${opts.search ?? ''}`)
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
		p_name: `[it-rep ${RUN_ID}] ${label}`,
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
	service = createClient(supabaseUrl, serviceRoleKey, options);
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
	if (planError || !plan) throw new Error(`payment plan read failed: ${planError?.message}`);
	const { data: installment, error: installmentError } = await users.admin.client
		.from('installments')
		.select('id')
		.eq('payment_plan_id', plan.id)
		.eq('installment_number', 1)
		.single();
	if (installmentError || !installment) {
		throw new Error(`installment read failed: ${installmentError?.message}`);
	}
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

describe('operational reports route (local Supabase)', () => {
	it('shows the four reports to an administrator', async () => {
		const data = (await load(event(users.admin)))!;
		expect(data.bondsByStatus.cells.available).toEqual({ no_payments: 1 });
		expect(data.bondsByStatus.cells.delivered_to_collector).toEqual({ no_payments: 1 });
		expect(data.bondsByStatus.bondCount).toBe(3);
		expect(data.bondsByStatus.totalValue).toBe('900.00');

		const ours = data.bondsByCollector.rows.find(
			(r: { collectorId: string | null }) => r.collectorId === collectorId
		)!;
		expect(ours).toMatchObject({ bondCount: 2, deliveredCount: 1, soldCount: 1 });
		expect(
			data.bondsByCollector.rows.find((r: { collectorId: string | null }) => r.collectorId === null)
				?.bondCount
		).toBe(1);

		const mine = data.installments.collectors.find(
			(c: { collectorId: string }) => c.collectorId === collectorId
		)!;
		expect(mine.buckets.paid).toEqual({ count: 1, amount: '100.00' });
		expect(mine.buckets.pending).toEqual({ count: 2, amount: '200.00' });
		expect(mine.buckets.overdue.count).toBe(0);

		const month = data.monthly.rows.find(
			(r: { collectorId: string | null }) => r.collectorId === collectorId
		)!;
		expect(month).toMatchObject({
			assignedBonds: 1,
			soldBonds: 1,
			soldValue: '300.00',
			paymentsCount: 1,
			paymentsTotal: '100.00',
			paymentsCash: '100.00',
			paymentsTransfer: '0.00'
		});
	});

	it('applies the filters', async () => {
		const sold = (await load(event(users.admin, { search: '?status=sold' })))!;
		expect(sold.bondsByStatus.bondCount).toBe(1);
		const other = (await load(event(users.admin, { search: `?collector=${randomUUID()}` })))!;
		expect(other.bondsByStatus.bondCount).toBe(0);
		const pata = (await load(event(users.admin, { search: '?kind=pata' })))!;
		expect(pata.bondsByCollector.rows).toHaveLength(0);
		const oldMonth = (await load(event(users.admin, { search: '?month=2020-01' })))!;
		expect(
			oldMonth.monthly.rows.find(
				(r: { collectorId: string | null }) => r.collectorId === collectorId
			)
		).toMatchObject({
			soldBonds: 0,
			paymentsCount: 0
		});
	});

	it('is scoped to the campaign', async () => {
		const data = (await load(event(users.admin, { id: emptyCampaignId })))!;
		expect(data.bondsByStatus.bondCount).toBe(0);
		expect(data.bondsByCollector.rows).toHaveLength(0);
		expect(data.installments.collectors).toHaveLength(0);
		expect(data.monthly.rows).toHaveLength(0);
	});

	it('is open to operator, treasurer and read-only (the report permission is the rule)', async () => {
		for (const role of ['operator', 'treasurer', 'read-only'] as const) {
			const data = (await load(event(users[role])))!;
			expect(data.bondsByStatus.bondCount, role).toBe(3);
			expect(data.monthly.totals.paymentsTotal, role).toBe('100.00');
		}
	});

	it('is 403 for a role without report.view_operational', async () => {
		expect(await status(() => load(event(users.collector)))).toBe(403);
	});

	it('is 500 when the permissions could not be loaded (null)', async () => {
		expect(await status(() => load(event(users.admin, { permissions: null })))).toBe(500);
	});

	it('is 404 for an unknown campaign id', async () => {
		expect(await status(() => load(event(users.admin, { id: randomUUID() })))).toBe(404);
		expect(await status(() => load(event(users.admin, { id: 'nope' })))).toBe(404);
	});

	it('the SQL functions deny a caller whose permissions were forged in locals', async () => {
		// Same route, but the real database role (collector) lacks the permission.
		const forged = event(users.collector, {
			permissions: ['campaign.view', 'report.view_operational']
		});
		expect(await status(() => load(forged))).toBe(500);
		const denied = await users.collector.client.rpc('report_bonds_by_status', {
			p_campaign_id: campaignId
		});
		expect(denied.error?.code).toBe('42501');
	});
});
