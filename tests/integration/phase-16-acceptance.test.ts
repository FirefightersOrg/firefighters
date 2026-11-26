import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { createAdminManagedUser } from '$lib/server/services/user-admin';
import { createBuyer, createCollector, updateCollector } from '$lib/server/services/parties';
import {
	attachCollectorPayment,
	rejectCollectorPayment
} from '$lib/server/services/collector-payments';
import { closeSettlement } from '$lib/server/services/settlements';
import {
	getCollectorLedgerBalance,
	listCollectorLedger
} from '$lib/server/services/commission-ledger';
import { buenosAiresToday, submissionStatusLabel } from '$lib/portal/labels';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';
import type { UserProfile } from '../../src/app';
import { load as landingLoad } from '../../src/routes/portal/+page.server';
import { load as bonosLoad } from '../../src/routes/portal/[campaignId]/bonos/+page.server';
import { load as bondLoad } from '../../src/routes/portal/[campaignId]/bonos/[bondId]/+page.server';
import { load as cuentaLoad } from '../../src/routes/portal/[campaignId]/cuenta/+page.server';
import { load as ventasLoad } from '../../src/routes/portal/[campaignId]/ventas/+page.server';
import {
	actions as saleActions,
	load as saleLoad
} from '../../src/routes/portal/[campaignId]/ventas/[saleId]/+page.server';
import { load as compradoresLoad } from '../../src/routes/portal/[campaignId]/compradores/+page.server';
import { load as buyerLoad } from '../../src/routes/portal/[campaignId]/compradores/[buyerId]/+page.server';
import { load as porCobrarLoad } from '../../src/routes/portal/[campaignId]/por-cobrar/+page.server';
import { load as bondsListLoad } from '../../src/routes/campaigns/[id]/bonds/+page.server';
import { POST as adminUsersPost } from '../../src/routes/api/admin/users/+server';

/**
 * SAN-148, Phase 16 acceptance: the collector portal is isolated, denies what it must, and a collection
 * the collector submits goes through the normal settlement until it is confirmed (or rejected).
 * Two linked collectors (A, B), an unlinked collector login (U), a collector made inactive (D) and the
 * seeded operator / treasurer / read-only / admin users run against the real local Supabase.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Loader = (event: never) => Promise<any>;
const L = {
	landing: landingLoad as unknown as Loader,
	bonos: bonosLoad as unknown as Loader,
	bond: bondLoad as unknown as Loader,
	cuenta: cuentaLoad as unknown as Loader,
	ventas: ventasLoad as unknown as Loader,
	sale: saleLoad as unknown as Loader,
	compradores: compradoresLoad as unknown as Loader,
	buyer: buyerLoad as unknown as Loader,
	porCobrar: porCobrarLoad as unknown as Loader,
	bondsList: bondsListLoad as unknown as Loader
};
const registrar = (saleActions as unknown as Record<string, Loader>).registrar;

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
const PASSWORD = 'Phase16Accept123!';
const rid = (label: string) => `it-p16-${label}-${RUN_ID}`;

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

const locals = (caller: Caller, label = 'req') => ({
	supabase: caller.client,
	session: null,
	user: caller.user,
	profile: caller.profile,
	permissions: caller.permissions,
	requestId: rid(label)
});
/** A portal page event under `/portal/[campaignId]/<suffix>`; `params` can override the ids (URL tampering). */
function ev(
	caller: Caller,
	suffix: string,
	params: Record<string, string> = {},
	campaign: string = campaignId
) {
	return {
		locals: locals(caller),
		params: { campaignId: campaign, ...params },
		url: new URL(`http://localhost/portal/${campaign}/${suffix}`)
	} as never;
}
function formEvent(
	caller: Caller,
	saleId: string,
	body: Record<string, string>,
	campaign: string = campaignId
) {
	const path = `/portal/${campaign}/ventas/${saleId}`;
	const form = new FormData();
	for (const [k, v] of Object.entries(body)) form.append(k, v);
	return {
		locals: locals(caller, 'form'),
		params: { campaignId: campaign, saleId },
		url: new URL(`http://localhost${path}`),
		request: new Request(`http://localhost${path}`, { method: 'POST', body: form })
	} as never;
}
/** The form action the way the browser sees it: a redirect on success, a `fail()` otherwise. */
async function register(
	caller: Caller,
	saleId: string,
	fields: Record<string, string>,
	campaign: string = campaignId
) {
	try {
		return await registrar(formEvent(caller, saleId, fields, campaign));
	} catch (err) {
		if (isRedirect(err)) return { redirect: err.location };
		if (isHttpError(err)) return { status: err.status, httpError: true };
		throw err;
	}
}
async function status(fn: () => unknown) {
	try {
		await fn();
		return 200;
	} catch (err) {
		if (isHttpError(err)) return err.status;
		if (isRedirect(err)) return err.status;
		throw err;
	}
}

async function rpcId(client: SupabaseClient, name: string, args: Record<string, unknown>) {
	const { data, error } = await client.rpc(name, args);
	if (error || typeof data !== 'string') throw new Error(`${name}: ${error?.message}`);
	return data;
}
const today = () => buenosAiresToday();
const daysFromToday = (days: number) => {
	const d = new Date(`${today()}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
};

let admin: Caller;
let operator: Caller;
let treasurer: Caller;
let readOnly: Caller;
let collectorA: Caller;
let collectorB: Caller;
let collectorD: Caller;
let unlinked: Caller;
let idA: string;
let idB: string;
let idD: string;
let campaignId: string;
let closingCampaignId: string;
let sale: { A: string; B: string; D: string; A2: string; closing: string };
let buyer: { A: string; B: string };
let bond: { A: string; B: string };
let installments: Record<'A' | 'A2' | 'B' | 'D' | 'closing', string[]>;
let service: SupabaseClient;

async function linkedCollector(label: string) {
	const email = `p16_${label}_${RUN_ID}@firefighters.local`;
	await createAdminManagedUser(service, {
		email,
		password: PASSWORD,
		fullName: `Fase 16 ${label} ${RUN_ID}`,
		roleNames: ['collector'],
		requestId: rid(`user-${label}`)
	});
	const caller = await signIn(email, PASSWORD);
	const id = await createCollector(
		admin.client,
		{
			displayName: `Fase 16 ${label} ${RUN_ID}`,
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

async function createCampaign(label: string) {
	const id = await rpcId(admin.client, 'campaign_create', {
		p_name: `[it-p16 ${label} ${RUN_ID}]`,
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
	// 10% on the first installment: closing a settlement writes the commission to the ledger.
	await admin.client.rpc('commission_rule_create', {
		p_campaign_id: id,
		p_rule_type: 'installment_first',
		p_installment_number: null,
		p_percentage: '10',
		p_fixed_amount: null,
		p_valid_from: daysFromToday(-30),
		p_valid_to: null,
		p_request_id: rid(`rule-${label}`)
	});
	const { error } = await admin.client.rpc('campaign_transition', {
		p_id: id,
		p_to_status: 'active',
		p_request_id: rid(`activate-${label}`)
	});
	if (error) throw new Error(error.message);
	return id;
}

let nextBase = 100 + Math.floor(Math.random() * 1000) * 8;
async function newBuyer(label: string, address: string | null = 'Calle 1') {
	return createBuyer(
		admin.client,
		{
			type: 'individual',
			firstName: label,
			lastName: RUN_ID,
			businessName: null,
			documentNumber: `8${Math.floor(Math.random() * 1e7)}`,
			taxId: null,
			phone: '1111',
			address,
			usualCollectorId: null,
			notes: null
		},
		{ requestId: rid(`buyer-${label}`), permissions: admin.permissions ?? [] }
	);
}
async function sell(campaign: string, collectorId: string, buyerId: string, label: string) {
	const bondId = await rpcId(admin.client, 'bond_create', {
		p_campaign_id: campaign,
		p_base_numbers: [nextBase],
		p_request_id: rid(`bond-${label}`)
	});
	nextBase += 3;
	const { error } = await admin.client.rpc('bond_deliver', {
		p_campaign_id: campaign,
		p_collector_id: collectorId,
		p_bond_ids: [bondId],
		p_notes: null,
		p_request_id: rid(`deliver-${label}`)
	});
	if (error) throw new Error(error.message);
	const saleId = await rpcId(admin.client, 'sale_register', {
		p_campaign_id: campaign,
		p_bond_id: bondId,
		p_buyer_id: buyerId,
		p_payment_mode: 'installments',
		p_first_due_date: daysFromToday(-10),
		// SAN-106: past due dates need an earlier sale date.
		p_sale_date: daysFromToday(-10),
		p_request_id: rid(`sale-${label}`)
	});
	return { saleId, bondId };
}
async function installmentIds(saleId: string) {
	const { data: plan } = await admin.client
		.from('payment_plans')
		.select('id')
		.eq('sale_id', saleId)
		.single();
	const { data } = await admin.client
		.from('installments')
		.select('id')
		.eq('payment_plan_id', plan!.id)
		.order('installment_number');
	return (data ?? []).map((r) => r.id as string);
}
async function paymentRow(id: string) {
	const { data, error } = await admin.client.from('payments').select('*').eq('id', id).single();
	if (error) throw new Error(error.message);
	return data as any;
}
async function latestDraftId(saleId: string, amount: number) {
	const { data } = await admin.client
		.from('payments')
		.select('id')
		.eq('sale_id', saleId)
		.eq('amount', amount)
		.eq('submitted_by_collector', true)
		.order('created_at', { ascending: false })
		.limit(1)
		.single();
	return data!.id as string;
}
const fields = (installmentId: string, amount: string, extra: Record<string, string> = {}) => ({
	installmentId,
	amount,
	paymentMethod: 'cash',
	paymentDate: today(),
	note: 'Cobrado en mano',
	requestKey: randomUUID(),
	...extra
});
const submitArgs = (saleId: string, installmentId: string, amount: number, date = today()) => ({
	p_sale_id: saleId,
	p_amount: amount,
	p_payment_method: 'cash',
	p_payment_date: date,
	p_applications: [{ installment_id: installmentId, amount_applied: amount }],
	p_request_id: randomUUID(),
	p_note: null
});
async function ledgerCount(collectorId: string) {
	const { count } = await admin.client
		.from('collector_ledger_entries')
		.select('id', { count: 'exact', head: true })
		.eq('collector_id', collectorId)
		.eq('campaign_id', campaignId);
	return count ?? 0;
}

beforeAll(async () => {
	service = createClient(supabaseUrl, serviceRoleKey, options);
	admin = await signIn(seed.admin.email, seed.admin.password);
	const byRole = (role: string) => seed.fixtures.find((f) => f.roleNames.includes(role))!;
	operator = await signIn(byRole('operator').email, byRole('operator').password);
	treasurer = await signIn(byRole('treasurer').email, byRole('treasurer').password);
	readOnly = await signIn(byRole('read-only').email, byRole('read-only').password);
	const [a, b, d] = [
		await linkedCollector('a'),
		await linkedCollector('b'),
		await linkedCollector('d')
	];
	collectorA = a.caller;
	collectorB = b.caller;
	collectorD = d.caller;
	[idA, idB, idD] = [a.id, b.id, d.id];
	// A collector login that is never linked to a collector.
	const email = `p16_unlinked_${RUN_ID}@firefighters.local`;
	await createAdminManagedUser(service, {
		email,
		password: PASSWORD,
		fullName: `Fase 16 sin vínculo ${RUN_ID}`,
		roleNames: ['collector'],
		requestId: rid('user-unlinked')
	});
	unlinked = await signIn(email, PASSWORD);

	campaignId = await createCampaign('main');
	closingCampaignId = await createCampaign('closing');
	buyer = { A: await newBuyer('Ana'), B: await newBuyer('Beto', null) };
	const sA = await sell(campaignId, idA, buyer.A, 'a');
	const sA2 = await sell(campaignId, idA, buyer.A, 'a2');
	const sB = await sell(campaignId, idB, buyer.B, 'b');
	const sD = await sell(campaignId, idD, await newBuyer('Dora'), 'd');
	const sC = await sell(closingCampaignId, idA, buyer.A, 'closing');
	sale = { A: sA.saleId, A2: sA2.saleId, B: sB.saleId, D: sD.saleId, closing: sC.saleId };
	bond = { A: sA.bondId, B: sB.bondId };
	installments = {
		A: await installmentIds(sale.A),
		A2: await installmentIds(sale.A2),
		B: await installmentIds(sale.B),
		D: await installmentIds(sale.D),
		closing: await installmentIds(sale.closing)
	};
	// D becomes inactive after the sale.
	const { data: row } = await admin.client.from('collectors').select('*').eq('id', idD).single();
	await updateCollector(
		admin.client,
		idD,
		{
			displayName: row.display_name,
			phone: null,
			email: null,
			address: null,
			userProfileId: row.user_profile_id,
			status: 'inactive'
		},
		row.updated_at,
		{ requestId: rid('deactivate-d'), permissions: admin.permissions ?? [] }
	);
	// The campaign of the last sale leaves "active": no collection can be registered there.
	const closing = await admin.client.rpc('campaign_transition', {
		p_id: closingCampaignId,
		p_to_status: 'closing',
		p_request_id: rid('closing')
	});
	if (closing.error) throw new Error(closing.error.message);
	// B has a pending collection of its own so submissions exist on both sides.
	const own = await register(collectorB, sale.B, fields(installments.B[0], '20'));
	expect(own).toMatchObject({ redirect: `/portal/${campaignId}/ventas/${sale.B}?enviado=1` });
}, 120_000);

describe('1. isolation between two collectors', () => {
	it('each sees only its own bonds, sales, buyers and due installments', async () => {
		const bonosA = await L.bonos(ev(collectorA, 'bonos'));
		const bonosB = await L.bonos(ev(collectorB, 'bonos'));
		expect(bonosA.bonds.map((x: any) => x.id).sort()).toEqual(expect.arrayContaining([bond.A]));
		expect(bonosA.bonds.map((x: any) => x.id)).not.toContain(bond.B);
		expect(bonosB.bonds.map((x: any) => x.id)).toEqual([bond.B]);

		const ventasA = await L.ventas(ev(collectorA, 'ventas'));
		const ventasB = await L.ventas(ev(collectorB, 'ventas'));
		expect(ventasA.sales.map((s: any) => s.saleId)).toEqual(
			expect.arrayContaining([sale.A, sale.A2])
		);
		expect(ventasA.sales.map((s: any) => s.saleId)).not.toContain(sale.B);
		expect(ventasB.sales.map((s: any) => s.saleId)).toEqual([sale.B]);
		// Every sale listed belongs to the campaign of the route.
		expect(new Set(ventasA.sales.map((s: any) => s.campaignId))).toEqual(new Set([campaignId]));

		const compA = await L.compradores(ev(collectorA, 'compradores'));
		const compB = await L.compradores(ev(collectorB, 'compradores'));
		expect(compA.buyers.map((x: any) => x.id)).toContain(buyer.A);
		expect(compA.buyers.map((x: any) => x.id)).not.toContain(buyer.B);
		expect(compB.buyers.map((x: any) => x.id)).toEqual([buyer.B]);

		const dueA = await L.porCobrar(ev(collectorA, 'por-cobrar'));
		const dueB = await L.porCobrar(ev(collectorB, 'por-cobrar'));
		expect(dueA.due.length).toBeGreaterThan(0);
		expect(dueA.due.map((x: any) => x.saleId)).toContain(sale.A);
		expect(dueA.due.map((x: any) => x.saleId)).not.toContain(sale.B);
		expect(new Set(dueB.due.map((x: any) => x.saleId))).toEqual(new Set([sale.B]));
		expect(new Set(dueA.due.map((x: any) => x.buyerAddress))).toEqual(new Set(['Calle 1']));
		expect(new Set(dueB.due.map((x: any) => x.buyerAddress))).toEqual(new Set([null]));
	});

	it('the campaign filter keeps the lists inside the campaign of the route', async () => {
		const other = await L.ventas(ev(collectorA, 'ventas', {}, closingCampaignId));
		expect(other.sales.map((s: any) => s.saleId)).toEqual([sale.closing]);
		const dueOther = await L.porCobrar(ev(collectorA, 'por-cobrar', {}, closingCampaignId));
		expect(new Set(dueOther.due.map((x: any) => x.saleId))).toEqual(new Set([sale.closing]));
		const buyersOther = await L.compradores(ev(collectorA, 'compradores', {}, closingCampaignId));
		expect(buyersOther.buyers.map((x: any) => x.id)).toEqual([buyer.A]);
		// A buyer with sales only in another campaign answers 404 under this one.
		expect(
			await status(() =>
				L.buyer(ev(collectorB, `compradores/${buyer.B}`, { buyerId: buyer.B }, closingCampaignId))
			)
		).toBe(404);
		// The sale of one campaign is not reachable under another campaign's URL.
		expect(
			await status(() =>
				L.sale(ev(collectorA, `ventas/${sale.A}`, { saleId: sale.A }, closingCampaignId))
			)
		).toBe(404);
	});

	it('changing the ids in the URL never reveals the other collector (404)', async () => {
		expect(await status(() => L.sale(ev(collectorA, `ventas/${sale.B}`, { saleId: sale.B })))).toBe(
			404
		);
		expect(
			await status(() => L.buyer(ev(collectorA, `compradores/${buyer.B}`, { buyerId: buyer.B })))
		).toBe(404);
		expect(await status(() => L.bond(ev(collectorA, `bonos/${bond.B}`, { bondId: bond.B })))).toBe(
			404
		);
		expect(await status(() => L.sale(ev(collectorA, 'ventas/x', { saleId: 'not-a-uuid' })))).toBe(
			404
		);
		expect(await status(() => L.ventas(ev(collectorA, 'ventas', {}, 'not-a-uuid')))).toBe(404);
	});

	it('RPCs and direct queries answer nothing about the other collector', async () => {
		const a = collectorA.client;
		for (const [fn, args] of [
			['portal_my_sale', { p_sale_id: sale.B }],
			['portal_my_sale_installments', { p_sale_id: sale.B }],
			['portal_my_sale_payments', { p_sale_id: sale.B }],
			['portal_my_sale_submissions', { p_sale_id: sale.B }],
			['portal_my_sale_reserved', { p_sale_id: sale.B }],
			['portal_my_buyer', { p_buyer_id: buyer.B }],
			['portal_my_buyer_sales', { p_buyer_id: buyer.B }]
		] as const) {
			const { data, error } = await a.rpc(fn, args);
			expect(error, fn).toBeNull();
			expect(data, fn).toEqual([]);
		}
		const tables = ['sales', 'payments', 'installments', 'buyers', 'settlements'] as const;
		for (const table of tables) {
			const { data } = await a.from(table).select('*');
			const text = JSON.stringify(data ?? []);
			expect(text, table).not.toContain(sale.B);
			expect(text, table).not.toContain(buyer.B);
		}
		const ledger = await a.from('collector_ledger_entries').select('collector_id');
		expect(new Set((ledger.data ?? []).map((r) => r.collector_id)).has(idB)).toBe(false);
		const bonds = await a.from('bonds').select('id').eq('id', bond.B);
		expect(bonds.data).toEqual([]);
	});

	it('submissions and the ledger are per collector too', async () => {
		const own = await L.sale(ev(collectorB, `ventas/${sale.B}`, { saleId: sale.B }));
		expect(own.submissions).toHaveLength(1);
		const foreign = await L.sale(ev(collectorA, `ventas/${sale.A}`, { saleId: sale.A }));
		expect(foreign.submissions.map((s: any) => s.amount)).not.toContain('20.00');
		const { data } = await collectorA.client.rpc('portal_my_sale_submissions', {
			p_sale_id: sale.B
		});
		expect(data).toEqual([]);
		const cuentaA = (await L.cuenta(ev(collectorA, 'cuenta'))).ledger;
		const cuentaB = (await L.cuenta(ev(collectorB, 'cuenta'))).ledger;
		expect(
			cuentaA.entries.every((e: any) => !cuentaB.entries.some((x: any) => x.id === e.id))
		).toBe(true);
	});
});

describe('2. a collector login without a collector profile', () => {
	it('gets empty screens, no data, and 404 on any id', async () => {
		expect((await L.landing(ev(unlinked, ''))).collector).toBeNull();
		for (const [loader, suffix] of [
			[L.bonos, 'bonos'],
			[L.ventas, 'ventas'],
			[L.compradores, 'compradores'],
			[L.porCobrar, 'por-cobrar'],
			[L.cuenta, 'cuenta']
		] as const) {
			const out = await loader(ev(unlinked, suffix));
			expect(out.collector, suffix).toBeNull();
		}
		expect(await status(() => L.sale(ev(unlinked, `ventas/${sale.A}`, { saleId: sale.A })))).toBe(
			404
		);
		expect(
			await status(() => L.buyer(ev(unlinked, `compradores/${buyer.A}`, { buyerId: buyer.A })))
		).toBe(404);
		for (const table of ['sales', 'payments', 'buyers', 'bonds', 'installments'] as const) {
			const { data } = await unlinked.client.from(table).select('id');
			expect(data, table).toEqual([]);
		}
	});

	it('cannot register a collection, neither by form nor by RPC', async () => {
		const result = await register(unlinked, sale.A, fields(installments.A[0], '10'));
		expect(result).toMatchObject({ status: 403 });
		const { error } = await unlinked.client.rpc(
			'portal_payment_submit',
			submitArgs(sale.A, installments.A[0], 10)
		);
		expect(error?.code).toBe('42501');
	});

	it('an inactive collector cannot register either', async () => {
		const result = await register(collectorD, sale.D, fields(installments.D[0], '10'));
		expect(result).toMatchObject({ status: 403 });
		const { error } = await collectorD.client.rpc(
			'portal_payment_submit',
			submitArgs(sale.D, installments.D[0], 10)
		);
		expect(error?.code).toBe('42501');
		const { count } = await admin.client
			.from('payments')
			.select('id', { count: 'exact', head: true })
			.eq('sale_id', sale.D);
		expect(count).toBe(0);
	});
});

describe('3. denials', () => {
	it('operator, treasurer and read-only do not enter the portal and keep their own pages', async () => {
		for (const caller of [operator, treasurer, readOnly]) {
			expect(await status(() => L.landing(ev(caller, ''))), 'landing').toBe(403);
			for (const [loader, suffix] of [
				[L.bonos, 'bonos'],
				[L.ventas, 'ventas'],
				[L.compradores, 'compradores'],
				[L.porCobrar, 'por-cobrar'],
				[L.cuenta, 'cuenta']
			] as const)
				expect(await status(() => loader(ev(caller, suffix))), suffix).toBe(403);
			expect(
				await status(() => L.sale(ev(caller, `ventas/${sale.A}`, { saleId: sale.A }))),
				'sale'
			).toBe(403);
		}
		// Global views are unchanged: the operator still reads every sale and bond.
		const sales = await operator.client.from('sales').select('id').in('id', [sale.A, sale.B]);
		expect(sales.data).toHaveLength(2);
		const bonds = await operator.client.from('bonds').select('id').in('id', [bond.A, bond.B]);
		expect(bonds.data).toHaveLength(2);
	});

	it('the admin has no collector profile: it reaches the portal as an empty one and cannot register', async () => {
		const landing = await L.landing(ev(admin, ''));
		expect(landing.collector).toBeNull();
		expect(landing.campaigns).toEqual([]);
		const ventas = await L.ventas(ev(admin, 'ventas'));
		expect(ventas.collector).toBeNull();
		expect(ventas.sales).toEqual([]);
		expect(await status(() => L.sale(ev(admin, `ventas/${sale.A}`, { saleId: sale.A })))).toBe(404);
		expect(await register(admin, sale.A, fields(installments.A[0], '10'))).toMatchObject({
			status: 403
		});
		const mine = await admin.client.rpc('portal_my_sales', {});
		expect(mine.data ?? []).toEqual([]);
		const submit = await admin.client.rpc(
			'portal_payment_submit',
			submitArgs(sale.A, installments.A[0], 10)
		);
		expect(submit.error).not.toBeNull();
	});

	it('direct RPC calls without the *_own permission are refused', async () => {
		for (const caller of [operator, treasurer, readOnly]) {
			for (const [fn, args] of [
				['portal_my_sales', {}],
				['portal_my_campaign_buyers', { p_campaign_id: campaignId }],
				['portal_my_campaign_due_installments', { p_campaign_id: campaignId }],
				['portal_my_ledger_summary', { p_campaign_id: campaignId }],
				['portal_payment_submit', submitArgs(sale.A, installments.A[0], 10)]
			] as const) {
				const { error } = await caller.client.rpc(fn, args);
				expect(error?.code, fn).toBe('42501');
			}
		}
		const anon = createClient(supabaseUrl, anonKey, options);
		const { error } = await anon.rpc('portal_my_sales', {});
		expect(error).not.toBeNull();
	});

	it('the collector cannot reach operational pages, /api or operator RPCs', async () => {
		expect(
			await status(() =>
				L.bondsList({
					locals: locals(collectorA),
					params: { id: campaignId },
					url: new URL(`http://localhost/campaigns/${campaignId}/bonds`)
				} as never)
			)
		).toBe(403);
		expect(
			await status(() =>
				adminUsersPost({
					request: new Request('http://localhost/api/admin/users', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({})
					}),
					locals: locals(collectorA)
				} as never)
			)
		).toBe(403);
		for (const [fn, args] of [
			['settlement_open', { p_campaign_id: campaignId, p_collector_id: idA, p_notes: null }],
			[
				'settlement_attach_collector_payment',
				{ p_settlement_id: randomUUID(), p_payment_id: randomUUID() }
			],
			['settlement_reject_collector_payment', { p_payment_id: randomUUID(), p_reason: 'no' }]
		] as const) {
			const { error } = await collectorA.client.rpc(fn, args);
			expect(error?.code, fn).toBe('42501');
		}
	});

	it('cannot register on the sale of B or in a campaign that is not active (annulled sales: pgTAP 068)', async () => {
		const foreign = await register(collectorA, sale.B, fields(installments.B[1], '10'));
		expect(foreign).toMatchObject({ status: 404 });
		const direct = await collectorA.client.rpc(
			'portal_payment_submit',
			submitArgs(sale.B, installments.B[1], 10)
		);
		expect(direct.error).not.toBeNull();

		const inClosing = await register(
			collectorA,
			sale.closing,
			fields(installments.closing[0], '10'),
			closingCampaignId
		);
		expect(inClosing).toMatchObject({ status: expect.any(Number) });
		expect((inClosing as any).status).toBeGreaterThanOrEqual(400);
		const { count: inClosingCount } = await admin.client
			.from('payments')
			.select('id', { count: 'exact', head: true })
			.eq('sale_id', sale.closing);
		expect(inClosingCount).toBe(0);
	});

	it('refuses future dates and overpayment, on the form and in the database', async () => {
		const future = await register(
			collectorA,
			sale.A,
			fields(installments.A[1], '10', { paymentDate: daysFromToday(2) })
		);
		expect(future).toMatchObject({ status: 400 });
		expect(future.data.errors.paymentDate).toBeTruthy();
		const rpcFuture = await collectorA.client.rpc(
			'portal_payment_submit',
			submitArgs(sale.A, installments.A[1], 10, daysFromToday(2))
		);
		expect(rpcFuture.error).not.toBeNull();
		const over = await register(collectorA, sale.A, fields(installments.A[1], '100,01'));
		expect(over).toMatchObject({ status: expect.any(Number) });
		expect((over as any).status).toBeGreaterThanOrEqual(400);
		const rpcOver = await collectorA.client.rpc(
			'portal_payment_submit',
			submitArgs(sale.A, installments.A[1], 100.01)
		);
		expect(rpcOver.error).not.toBeNull();
		const { count } = await admin.client
			.from('payments')
			.select('id', { count: 'exact', head: true })
			.eq('sale_id', sale.A);
		expect(count).toBe(0);
	});

	it('the Buenos Aires day is neither future nor past at 21:30 local (already tomorrow in UTC)', async () => {
		// 21:30 in Buenos Aires on the 24th is 00:30 UTC on the 25th.
		expect(buenosAiresToday(new Date('2026-11-25T00:30:00Z'))).toBe('2026-11-24');
		// The database takes the Buenos Aires date of "today" as valid (never a future date).
		const { data, error } = await collectorA.client.rpc(
			'portal_payment_submit',
			submitArgs(sale.A, installments.A[2], 1, today())
		);
		expect(error).toBeNull();
		expect(typeof data).toBe('string');
		await rejectCollectorPayment(
			admin.client,
			{ paymentId: data as string, reason: 'Prueba de borde horario' },
			{ requestId: rid('edge'), permissions: admin.permissions }
		);
	});

	it('the collector cannot confirm, edit or annul a payment, nor write one directly', async () => {
		const result = await register(collectorA, sale.A, fields(installments.A[2], '30'));
		expect(result).toMatchObject({ redirect: expect.any(String) });
		const draft = await latestDraftId(sale.A, 30);
		for (const patch of [{ status: 'confirmed' }, { status: 'annulled' }, { amount: 1 }]) {
			const { data } = await collectorA.client
				.from('payments')
				.update(patch)
				.eq('id', draft)
				.select();
			expect(data ?? []).toEqual([]);
		}
		const inserted = await collectorA.client.from('payments').insert({
			campaign_id: campaignId,
			sale_id: sale.A,
			collector_id: idA,
			amount: 1,
			payment_method: 'cash',
			status: 'confirmed'
		});
		expect(inserted.error).not.toBeNull();
		expect(await paymentRow(draft)).toMatchObject({ status: 'draft', amount: 30 });
		await rejectCollectorPayment(
			admin.client,
			{ paymentId: draft, reason: 'Limpieza de la prueba' },
			{ requestId: rid('cleanup'), permissions: admin.permissions }
		);
	});
});

describe('4. a submitted collection goes through the settlement until confirmed', () => {
	let paymentId: string;
	let settlementId: string;
	let ledgerBefore: number;

	it('A submits: it stays pending and does not touch installments or the ledger', async () => {
		ledgerBefore = await ledgerCount(idA);
		const result = await register(collectorA, sale.A, fields(installments.A[0], '100,00'));
		expect(result).toEqual({ redirect: `/portal/${campaignId}/ventas/${sale.A}?enviado=1` });
		paymentId = await latestDraftId(sale.A, 100);
		expect(await paymentRow(paymentId)).toMatchObject({
			status: 'draft',
			settlement_id: null,
			collector_id: idA,
			submitted_by_collector: true
		});
		const { data: installment } = await admin.client
			.from('installments')
			.select('status')
			.eq('id', installments.A[0])
			.single();
		expect(installment!.status).toBe('pending');
		expect(await ledgerCount(idA)).toBe(ledgerBefore);
		const page = await L.sale(ev(collectorA, `ventas/${sale.A}`, { saleId: sale.A }));
		expect(page.submissions[0]).toMatchObject({ id: paymentId, status: 'draft' });
		expect(submissionStatusLabel(page.submissions[0].status)).toBe('Enviado');
		expect(page.sale.paidAmount).toBe('0.00');
	});

	it('the operator includes it in a settlement of A: "En rendición" for the collector', async () => {
		settlementId = await rpcId(admin.client, 'settlement_open', {
			p_campaign_id: campaignId,
			p_collector_id: idA,
			p_notes: null,
			p_request_id: rid('settlement')
		});
		await attachCollectorPayment(
			operator.client,
			{ settlementId, paymentId },
			{ requestId: rid('attach'), permissions: operator.permissions }
		);
		expect(await paymentRow(paymentId)).toMatchObject({
			status: 'pending_in_settlement',
			settlement_id: settlementId
		});
		const page = await L.sale(ev(collectorA, `ventas/${sale.A}`, { saleId: sale.A }));
		expect(submissionStatusLabel(page.submissions[0].status)).toBe('En rendición');
		expect(await ledgerCount(idA)).toBe(ledgerBefore);
	});

	it('closing the settlement confirms the payment: installment, commission, ledger and "Confirmado"', async () => {
		await closeSettlement(
			admin.client,
			{ settlementId },
			{ requestId: rid('close'), permissions: admin.permissions }
		);
		expect(await paymentRow(paymentId)).toMatchObject({ status: 'confirmed' });
		const { data: installment } = await admin.client
			.from('installments')
			.select('status')
			.eq('id', installments.A[0])
			.single();
		expect(installment!.status).toBe('paid');
		const { data: entries } = await admin.client
			.from('collector_ledger_entries')
			.select('entry_type,amount')
			.eq('settlement_id', settlementId);
		expect(entries).toContainEqual({ entry_type: 'commission_generated', amount: 10 });

		const page = await L.sale(ev(collectorA, `ventas/${sale.A}`, { saleId: sale.A }));
		expect(submissionStatusLabel(page.submissions[0].status)).toBe('Confirmado');
		expect(page.sale).toMatchObject({ paidAmount: '100.00' });
		const cuenta = (await L.cuenta(ev(collectorA, 'cuenta'))).ledger;
		expect(cuenta.summary.commissionGenerated).toBe(10);
	});

	it('the portal ledger summary reconciles with the balance the treasury sees', async () => {
		const portal = (await L.cuenta(ev(collectorA, 'cuenta'))).ledger;
		const treasury = await listCollectorLedger(treasurer.client, {
			campaignId,
			collectorId: idA
		});
		const treasuryBalance = await getCollectorLedgerBalance(treasurer.client, {
			campaignId,
			collectorId: idA
		});
		expect(portal.summary.balance).toBe(treasuryBalance);
		expect(portal.summary.balance).toBe(treasury[treasury.length - 1].runningBalance);
		const lines =
			portal.summary.commissionGenerated +
			portal.summary.commissionAdjusted -
			portal.summary.commissionSettled +
			portal.summary.commissionAnnulments +
			portal.summary.otherMovements;
		expect(lines).toBeCloseTo(portal.summary.balance, 2);
		// B has no confirmed collection: its balance is its own.
		const portalB = (await L.cuenta(ev(collectorB, 'cuenta'))).ledger;
		expect(portalB.summary.balance).toBe(
			await getCollectorLedgerBalance(treasurer.client, { campaignId, collectorId: idB })
		);
	});

	it('a rejected collection shows "Rechazado" with its reason and changes nothing', async () => {
		const ledgerAfterClose = await ledgerCount(idA);
		const sent = await register(collectorA, sale.A, fields(installments.A[1], '40'));
		expect(sent).toMatchObject({ redirect: expect.any(String) });
		const draft = await latestDraftId(sale.A, 40);
		await rejectCollectorPayment(
			operator.client,
			{ paymentId: draft, reason: 'No llegó la transferencia' },
			{ requestId: rid('reject'), permissions: operator.permissions }
		);
		const page = await L.sale(ev(collectorA, `ventas/${sale.A}`, { saleId: sale.A }));
		const rejected = page.submissions.find((s: any) => s.id === draft);
		expect(rejected).toMatchObject({
			status: 'annulled',
			rejectionReason: 'No llegó la transferencia'
		});
		expect(submissionStatusLabel(rejected.status)).toBe('Rechazado');
		expect(page.reserved[installments.A[1]]).toBeUndefined();
		const { data: installment } = await admin.client
			.from('installments')
			.select('status')
			.eq('id', installments.A[1])
			.single();
		expect(installment!.status).toBe('pending');
		expect(await ledgerCount(idA)).toBe(ledgerAfterClose);
		expect(page.sale.paidAmount).toBe('100.00');
	});
});
