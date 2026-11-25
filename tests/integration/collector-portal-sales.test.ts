import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isHttpError } from '@sveltejs/kit';
import { createAdminManagedUser } from '$lib/server/services/user-admin';
import { createBuyer, createCollector } from '$lib/server/services/parties';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';
import type { UserProfile } from '../../src/app';
import { load as salesLoadRaw } from '../../src/routes/portal/ventas/+page.server';
import { load as saleLoadRaw } from '../../src/routes/portal/ventas/[saleId]/+page.server';
import { load as buyersLoadRaw } from '../../src/routes/portal/compradores/+page.server';
import { load as buyerLoadRaw } from '../../src/routes/portal/compradores/[buyerId]/+page.server';
import { load as dueLoadRaw } from '../../src/routes/portal/por-cobrar/+page.server';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Loader = (event: never) => any;
const salesLoad = salesLoadRaw as unknown as Loader;
const saleLoad = saleLoadRaw as unknown as Loader;
const buyersLoad = buyersLoadRaw as unknown as Loader;
const buyerLoad = buyerLoadRaw as unknown as Loader;
const dueLoad = dueLoadRaw as unknown as Loader;
vi.mock('$env/dynamic/private', async () => {
	const { inject } = await import('vitest');
	const env = inject('integrationEnv');
	return { env: { SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey, APP_ENV: 'local' } };
});
vi.mock('$env/dynamic/public', async () => {
	const { inject } = await import('vitest');
	const env = inject('integrationEnv');
	return { env: { PUBLIC_SUPABASE_URL: env.supabaseUrl, PUBLIC_SUPABASE_ANON_KEY: env.anonKey } };
});

const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seed = resolveSeedConfig(seedEnv);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'CollectorSales123!';
const rid = (label: string) => `it-psales-${label}-${RUN_ID}`;

interface Caller {
	user: User;
	client: SupabaseClient;
	profile: UserProfile;
	permissions: string[] | null;
}

async function signIn(email: string, password: string): Promise<Caller> {
	const anon = createClient(supabaseUrl, anonKey, options);
	const { data, error } = await anon.auth.signInWithPassword({ email, password });
	if (error || !data.session || !data.user) throw new Error(`Unable to sign in as ${email}`);
	const client = createClient(supabaseUrl, anonKey, {
		...options,
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
	const { data: profile, error: profileError } = await client
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

function event(caller: Caller, path: string, params: Record<string, string> = {}) {
	return {
		locals: {
			supabase: caller.client,
			session: null,
			user: caller.user,
			profile: caller.profile,
			permissions: caller.permissions,
			requestId: rid('req')
		},
		params,
		url: new URL(`http://localhost${path}`)
	} as never;
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

async function rpcId(client: SupabaseClient, name: string, args: Record<string, unknown>) {
	const { data, error } = await client.rpc(name, args);
	if (error || typeof data !== 'string') throw new Error(`${name}: ${error?.message}`);
	return data;
}

const today = () =>
	new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const daysFromToday = (days: number) => {
	const d = new Date(`${today()}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
};

let admin: Caller;
let collectorA: Caller;
let collectorB: Caller;
let unlinked: Caller;
let operator: Caller;
let collectorAId: string;
let campaignId: string;
let buyerOnlyA: string;
let buyerOnlyB: string;
let buyerShared: string;
let saleA1: string; // A -> buyerOnlyA, installments, first one overdue with a payment pending in settlement
let saleA2: string; // A -> buyerShared, full payment due in 3 days
let saleB1: string; // B -> buyerOnlyB
let saleB2: string; // B -> buyerShared

async function linkedCollector(label: string) {
	const service = createClient(supabaseUrl, serviceRoleKey, options);
	const email = `psales_${label}_${RUN_ID}@firefighters.local`;
	await createAdminManagedUser(service, {
		email,
		password: PASSWORD,
		fullName: `Portal sales ${label} ${RUN_ID}`,
		roleNames: ['collector'],
		requestId: rid(`user-${label}`)
	});
	const caller = await signIn(email, PASSWORD);
	const id = await createCollector(
		admin.client,
		{
			displayName: `Portal sales ${label} ${RUN_ID}`,
			phone: null,
			email: null,
			address: null,
			userProfileId: caller.profile.id,
			status: 'active'
		},
		{ requestId: rid(`collector-${label}`), permissions: admin.permissions ?? [] }
	);
	return { caller, id };
}

async function newBuyer(first: string, phone: string) {
	return createBuyer(
		admin.client,
		{
			type: 'individual',
			firstName: first,
			lastName: RUN_ID,
			businessName: null,
			documentNumber: `9${Math.floor(Math.random() * 1e7)}`,
			taxId: null,
			phone,
			address: `Calle ${first} 1`,
			usualCollectorId: null,
			notes: 'private note'
		},
		{ requestId: rid(`buyer-${first}`), permissions: admin.permissions ?? [] }
	);
}

let nextBase = 100 + Math.floor(Math.random() * 2000) * 8;
async function sell(
	collectorId: string,
	buyerId: string,
	mode: string,
	firstDue: string,
	label: string
) {
	const bond = await rpcId(admin.client, 'bond_create', {
		p_campaign_id: campaignId,
		p_base_numbers: [nextBase],
		p_request_id: rid(`bond-${label}`)
	});
	nextBase += 3;
	const { error } = await admin.client.rpc('bond_deliver', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId,
		p_bond_ids: [bond],
		p_notes: null,
		p_request_id: rid(`deliver-${label}`)
	});
	if (error) throw new Error(error.message);
	return rpcId(admin.client, 'sale_register', {
		p_campaign_id: campaignId,
		p_bond_id: bond,
		p_buyer_id: buyerId,
		p_payment_mode: mode,
		p_first_due_date: firstDue,
		p_request_id: rid(`sale-${label}`)
	});
}

beforeAll(async () => {
	admin = await signIn(seed.admin.email, seed.admin.password);
	// A fresh collector-role login with no collector record (the seeded fixture may be linked by other suites).
	const unlinkedEmail = `psales_free_${RUN_ID}@firefighters.local`;
	await createAdminManagedUser(createClient(supabaseUrl, serviceRoleKey, options), {
		email: unlinkedEmail,
		password: PASSWORD,
		fullName: `Portal sales free ${RUN_ID}`,
		roleNames: ['collector'],
		requestId: rid('user-free')
	});
	const operatorFixture = seed.fixtures.find((f) => f.roleNames.includes('operator'))!;
	unlinked = await signIn(unlinkedEmail, PASSWORD);
	operator = await signIn(operatorFixture.email, operatorFixture.password);
	const a = await linkedCollector('a');
	const b = await linkedCollector('b');
	collectorA = a.caller;
	collectorB = b.caller;
	collectorAId = a.id;

	campaignId = await rpcId(admin.client, 'campaign_create', {
		p_name: `[it-psales ${RUN_ID}]`,
		p_simple_bond_value: '300.00',
		p_installment_count: 3,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 1,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_starts_at: '2026-01-01T03:00:00Z',
		p_ends_at: '2099-12-31T03:00:00Z',
		p_request_id: rid('campaign')
	});
	const { error } = await admin.client.rpc('campaign_transition', {
		p_id: campaignId,
		p_to_status: 'active',
		p_request_id: rid('activate')
	});
	if (error) throw new Error(error.message);

	buyerOnlyA = await newBuyer('Ana', '1111');
	buyerOnlyB = await newBuyer('Beto', '2222');
	buyerShared = await newBuyer('Comun', '3333');

	saleA1 = await sell(a.id, buyerOnlyA, 'installments', daysFromToday(-10), 'a1');
	saleA2 = await sell(a.id, buyerShared, 'full_payment', daysFromToday(3), 'a2');
	saleB1 = await sell(b.id, buyerOnlyB, 'installments', daysFromToday(-10), 'b1');
	saleB2 = await sell(b.id, buyerShared, 'full_payment', daysFromToday(3), 'b2');

	// A collection of 100 on the first installment of saleA1, left pending in a settlement.
	const { data: plan } = await admin.client
		.from('payment_plans')
		.select('id')
		.eq('sale_id', saleA1)
		.single();
	const { data: first } = await admin.client
		.from('installments')
		.select('id')
		.eq('payment_plan_id', plan!.id)
		.eq('installment_number', 1)
		.single();
	const settlementId = await rpcId(admin.client, 'settlement_open', {
		p_campaign_id: campaignId,
		p_collector_id: a.id,
		p_notes: null,
		p_request_id: rid('settlement')
	});
	await rpcId(admin.client, 'settlement_add_payment', {
		p_settlement_id: settlementId,
		p_sale_id: saleA1,
		p_amount: 40,
		p_payment_method: 'cash',
		p_applications: [{ installment_id: first!.id, amount_applied: 40 }],
		p_request_id: rid('payment')
	});
});

describe('collector portal: buyers and sales (local Supabase)', () => {
	it('lists only the own sales, newest first, with their totals', async () => {
		const a = (await salesLoad(event(collectorA, '/portal/ventas')))!;
		expect(a.sales.map((s: any) => s.saleId)).toEqual([saleA2, saleA1]);
		const b = (await salesLoad(event(collectorB, '/portal/ventas')))!;
		expect(b.sales.map((s: any) => s.saleId)).toEqual([saleB2, saleB1]);
		const own = a.sales.find((s: any) => s.saleId === saleA1)!;
		expect(own).toMatchObject({
			pendingAmount: '40.00',
			paidAmount: '0.00',
			overdueCount: 1,
			buyerName: `Ana ${RUN_ID}`
		});
	});

	it('paginates with a stable order and an exact total', async () => {
		const { data: first } = await collectorA.client.rpc('portal_my_sales', {
			p_limit: 1,
			p_offset: 0
		});
		const { data: second } = await collectorA.client.rpc('portal_my_sales', {
			p_limit: 1,
			p_offset: 1
		});
		expect(first[0].sale_id).toBe(saleA2);
		expect(second[0].sale_id).toBe(saleA1);
		expect(Number(first[0].total_count)).toBe(2);
		expect(await salesLoad(event(collectorA, '/portal/ventas?page=9'))).toMatchObject({
			sales: []
		});
	});

	it('shows the installments with the pending-in-settlement payment identified', async () => {
		const data = (await saleLoad(
			event(collectorA, `/portal/ventas/${saleA1}`, { saleId: saleA1 })
		))!;
		expect(data.installments.map((i: any) => i.status)).toEqual(['overdue', 'pending', 'pending']);
		expect(data.installments[0]).toMatchObject({ pendingAmount: '40.00', balance: '60.00' });
		expect(data.payments).toMatchObject([{ status: 'pending_in_settlement', amount: '40.00' }]);
		expect(data.sale.buyerAddress).toBe(`Calle Ana 1`);
	});

	it('answers 404 for the sale of another collector, and for an unknown or malformed id', async () => {
		for (const id of [saleB1, randomUUID(), 'not-a-uuid']) {
			expect(
				await status(() => saleLoad(event(collectorA, `/portal/ventas/${id}`, { saleId: id })))
			).toBe(404);
		}
		expect(
			await status(() =>
				saleLoad(event(collectorB, `/portal/ventas/${saleA1}`, { saleId: saleA1 }))
			)
		).toBe(404);
	});

	it('lists the buyers of the own sales only, with bounded columns', async () => {
		const a = (await buyersLoad(event(collectorA, '/portal/compradores')))!;
		expect(a.buyers.map((b: any) => b.id).sort()).toEqual([buyerOnlyA, buyerShared].sort());
		expect(Object.keys(a.buyers[0]).sort()).toEqual(
			['address', 'balance', 'displayName', 'id', 'phone', 'saleCount'].sort()
		);
		const direct = await collectorA.client.from('buyers').select('id');
		expect(direct.data).toEqual([]);
	});

	it('answers 404 for a buyer that only another collector sold to; a shared buyer shows only own sales', async () => {
		const own = (await buyerLoad(
			event(collectorA, `/portal/compradores/${buyerShared}`, { buyerId: buyerShared })
		))!;
		expect(own.sales.map((s: any) => s.saleId)).toEqual([saleA2]);
		expect(
			await status(() =>
				buyerLoad(event(collectorA, `/portal/compradores/${buyerOnlyB}`, { buyerId: buyerOnlyB }))
			)
		).toBe(404);
	});

	it('"Por cobrar" holds the own overdue and soon-due installments only', async () => {
		const a = (await dueLoad(event(collectorA, '/portal/por-cobrar')))!;
		expect(a.due.map((d: any) => [d.saleId, d.installmentNumber, d.status])).toEqual([
			[saleA1, 1, 'overdue'],
			[saleA2, 1, 'pending']
		]);
		expect(a.due[0].balance).toBe('60.00');
		const b = (await dueLoad(event(collectorB, '/portal/por-cobrar')))!;
		expect(b.due.every((d: any) => [saleB1, saleB2].includes(d.saleId))).toBe(true);
	});

	it('an unlinked collector sees empty lists and 404 on any sale; others are denied', async () => {
		expect(await salesLoad(event(unlinked, '/portal/ventas'))).toMatchObject({
			collector: null,
			sales: []
		});
		expect(
			await status(() => saleLoad(event(unlinked, `/portal/ventas/${saleA1}`, { saleId: saleA1 })))
		).toBe(404);
		expect(await status(() => salesLoad(event(operator, '/portal/ventas')))).toBe(403);
		const unavailable = { ...collectorA, permissions: null };
		expect(await status(() => salesLoad(event(unavailable, '/portal/ventas')))).toBe(500);
		expect(collectorAId).toBeTruthy();
	});
});
