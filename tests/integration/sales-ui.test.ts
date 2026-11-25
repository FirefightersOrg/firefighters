import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isRedirect } from '@sveltejs/kit';
import { load as listLoad } from '../../src/routes/campaigns/[id]/sales/+page.server';
import {
	actions as newActions,
	load as newLoad
} from '../../src/routes/campaigns/[id]/sales/new/+page.server';
import { load as saleLoad } from '../../src/routes/campaigns/[id]/sales/[saleId]/+page.server';
import { load as bondLoad } from '../../src/routes/campaigns/[id]/bonds/[bondId]/+page.server';
import { load as buyerLoad } from '../../src/routes/campaigns/[id]/buyers/[buyerId]/+page.server';
import { load as collectorLoad } from '../../src/routes/campaigns/[id]/collectors/[collectorId]/+page.server';
import { createBuyer, createCollector } from '$lib/server/services/parties';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';
import type { UserProfile } from '../../src/app';

/**
 * SAN-60: the sale screens and the sale/installment sections of the bond, buyer and collector
 * records, through the real route code against the local Supabase. Every run creates its own
 * active campaign, collector, buyer and bonds.
 */

const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seedConfig = resolveSeedConfig(seedEnv);
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
let seq = 0;
const rid = (label: string) => `it-sales-ui-${RUN_ID}-${++seq}-${label}`;
const argentinaDate = (days = 0) => {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Argentina/Buenos_Aires',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(new Date());
	const value = Object.fromEntries(
		parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
	);
	return new Date(Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day) + days))
		.toISOString()
		.slice(0, 10);
};

interface Caller {
	user: User;
	client: SupabaseClient;
	profile: UserProfile;
	permissions: string[];
}
type Result = Record<string, unknown> & {
	status?: number;
	data?: Record<string, unknown>;
	redirect?: string;
};

let serviceClient: SupabaseClient;
let admin: Caller;
let operator: Caller;
let treasurer: Caller;
let campaignId: string;
let collectorId: string;
let buyerId: string;
const bonds: Record<string, string> = {};

async function signIn(email: string, password: string): Promise<Caller> {
	const anon = createClient(supabaseUrl, anonKey, clientOptions);
	const { data, error } = await anon.auth.signInWithPassword({ email, password });
	if (error || !data.session) throw new Error(`Failed to sign in as ${email}`);
	const client = createClient(supabaseUrl, anonKey, {
		...clientOptions,
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
	const { data: profile } = await serviceClient
		.from('profiles')
		.select('*')
		.eq('auth_user_id', data.user.id)
		.single();
	return {
		user: data.user,
		client,
		profile: profile as UserProfile,
		permissions: await loadPermissions(client)
	};
}

function event(
	caller: Caller,
	params: Record<string, string>,
	path: string,
	options: { action?: string; fields?: Record<string, string>; search?: string } = {}
): never {
	const url = new URL(
		`http://localhost${path}${options.action ? `?/${options.action}` : (options.search ?? '')}`
	);
	let request = new Request(url);
	if (options.fields) {
		const body = new FormData();
		for (const [k, v] of Object.entries(options.fields)) body.append(k, v);
		request = new Request(url, { method: 'POST', body });
	}
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
	} as never;
}

async function run(action: (e: never) => unknown, e: never): Promise<Result> {
	try {
		return (await action(e)) as Result;
	} catch (err) {
		if (!isRedirect(err)) throw err;
		return { redirect: err.location };
	}
}

const newPath = () => `/campaigns/${campaignId}/sales/new`;
const act = (caller: Caller, action: string, fields: Record<string, string>) =>
	run(
		newActions[action as keyof typeof newActions] as (e: never) => unknown,
		event(caller, { id: campaignId }, newPath(), { action, fields })
	);

beforeAll(async () => {
	serviceClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);
	admin = await signIn(seedConfig.admin.email, seedConfig.admin.password);
	const f = (role: string) => seedConfig.fixtures.find((x) => x.roleNames.includes(role))!;
	operator = await signIn(f('operator').email, f('operator').password);
	treasurer = await signIn(f('treasurer').email, f('treasurer').password);

	const c = await admin.client.rpc('campaign_create', {
		p_name: `[it-sales-ui ${RUN_ID}] Sales`,
		p_simple_bond_value: '60000.00',
		p_installment_count: 10,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_starts_at: '2026-01-01T03:00:00Z',
		p_ends_at: '2027-12-31T03:00:00Z',
		p_request_id: rid('campaign')
	});
	if (c.error) throw new Error(c.error.message);
	campaignId = c.data as string;
	const activated = await admin.client.rpc('campaign_transition', {
		p_id: campaignId,
		p_to_status: 'active',
		p_request_id: rid('activate')
	});
	if (activated.error) throw new Error(activated.error.message);

	collectorId = await createCollector(
		admin.client,
		{
			displayName: `Ana ${RUN_ID}`,
			phone: null,
			email: null,
			address: null,
			userProfileId: null,
			status: 'active'
		},
		{ requestId: rid('collector'), permissions: admin.permissions }
	);
	buyerId = await createBuyer(
		admin.client,
		{
			type: 'individual',
			firstName: 'Eva',
			lastName: `Paz ${RUN_ID}`,
			businessName: null,
			documentNumber: null,
			taxId: null,
			phone: null,
			address: null,
			usualCollectorId: null,
			notes: null
		},
		{ requestId: rid('buyer'), permissions: admin.permissions }
	);

	for (const [key, number, barcode] of [
		['cash', 30, 'BC-30'],
		['plan', 31, null],
		['free', 32, null]
	] as const) {
		const b = await admin.client.rpc('bond_create', {
			p_campaign_id: campaignId,
			p_base_numbers: [number],
			p_barcode: barcode,
			p_request_id: rid(`bond-${key}`)
		});
		if (b.error) throw new Error(b.error.message);
		bonds[key] = b.data as string;
	}
	// cash and plan are delivered to Ana; free stays available (not sellable).
	const delivered = await admin.client.rpc('bond_deliver', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId,
		p_bond_ids: [bonds.cash, bonds.plan],
		p_notes: null,
		p_request_id: rid('deliver')
	});
	if (delivered.error) throw new Error(delivered.error.message);
});

describe('sale screens (local Supabase)', () => {
	it('the treasurer cannot open the sale registration', async () => {
		await expect(newLoad(event(treasurer, { id: campaignId }, newPath()))).rejects.toMatchObject({
			status: 403
		});
		expect(await act(treasurer, 'register', { bondId: bonds.cash })).toMatchObject({
			status: 403
		});
	});

	it('the lookup finds only the matching bond and explains why it cannot be sold', async () => {
		const byNumber = (await act(operator, 'lookup', { query: '0030' })) as {
			found: { id: string; sellable: boolean }[];
		};
		expect(byNumber.found).toEqual([expect.objectContaining({ id: bonds.cash, sellable: true })]);
		// 31 + 4871 = 4902: the associated number finds the same bond.
		const byAssociated = (await act(operator, 'lookup', { query: '4902' })) as {
			found: { id: string }[];
		};
		expect(byAssociated.found.map((b) => b.id)).toEqual([bonds.plan]);
		const byCode = (await act(operator, 'lookup', { query: 'BC-30' })) as {
			found: { id: string }[];
		};
		expect(byCode.found.map((b) => b.id)).toEqual([bonds.cash]);
		const available = (await act(operator, 'lookup', { query: '0032' })) as {
			found: { id: string; sellable: boolean; reason: string }[];
		};
		expect(available.found).toEqual([
			expect.objectContaining({
				id: bonds.free,
				sellable: false,
				reason: expect.stringContaining('primero hay que entregarlo')
			})
		]);
		// Registering it anyway is refused on the bond field, before the database.
		expect(
			await act(operator, 'register', {
				bondId: bonds.free,
				buyerId,
				paymentMode: 'full_payment',
				firstDueDate: argentinaDate(1)
			})
		).toMatchObject({ status: 409, data: { errors: { bondId: [expect.any(String)] } } });
	});

	it('the operator registers a full-payment sale and the detail and bond record show it', async () => {
		const registered = await act(operator, 'register', {
			bondId: bonds.cash,
			buyerId,
			paymentMode: 'full_payment'
		});
		const saleId = /\/sales\/([0-9a-f-]{36})$/.exec(String(registered.redirect))?.[1];
		expect(saleId).toBeDefined();

		const detail = (await saleLoad(
			event(admin, { id: campaignId, saleId: saleId! }, `/campaigns/${campaignId}/sales/${saleId}`)
		)) as {
			sale: { sale: { paymentMode: string; totalAmount: string }; installments: unknown[] };
			financialStatus: string;
		};
		expect(detail.sale.sale).toMatchObject({
			paymentMode: 'full_payment',
			totalAmount: '60000.00'
		});
		expect(detail.sale.installments).toHaveLength(1);
		expect(detail.financialStatus).toBe('no_payments');
		expect(detail.sale).toMatchObject({
			bondNumberPairs: [{ base: 30, associated: 4901 }],
			installments: [{ dueDate: argentinaDate() }]
		});

		const bondRecord = (await bondLoad(
			event(
				admin,
				{ id: campaignId, bondId: bonds.cash },
				`/campaigns/${campaignId}/bonds/${bonds.cash}`
			)
		)) as { sale: { sale: { id: string } } | null; installments: unknown[] };
		expect(bondRecord.sale?.sale.id).toBe(saleId);
		expect(bondRecord.installments).toHaveLength(1);
	});

	it('creates a buyer inline, sells in installments, and the records and list show the debt', async () => {
		const created = await act(operator, 'createBuyer', {
			type: 'individual',
			firstName: 'Inline',
			lastName: `Buyer ${RUN_ID}`,
			businessName: '',
			documentNumber: '',
			taxId: '',
			phone: '',
			address: '',
			usualCollectorId: '',
			notes: ''
		});
		expect(created).toMatchObject({ form: 'buyer', success: true, buyerId: expect.any(String) });
		const inlineBuyer = created.buyerId as string;

		const registered = await act(operator, 'register', {
			bondId: bonds.plan,
			buyerId: inlineBuyer,
			paymentMode: 'installments',
			firstDueDate: argentinaDate(2)
		});
		expect(String(registered.redirect)).toMatch(/\/sales\/[0-9a-f-]{36}$/);
		const saleId = /\/sales\/([0-9a-f-]{36})$/.exec(String(registered.redirect))?.[1];
		const detail = (await saleLoad(
			event(admin, { id: campaignId, saleId: saleId! }, `/campaigns/${campaignId}/sales/${saleId}`)
		)) as { sale: { installments: { installmentNumber: number }[] } };
		expect(detail.sale.installments.map((installment) => installment.installmentNumber)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10
		]);

		const buyerRecord = (await buyerLoad(
			event(
				admin,
				{ id: campaignId, buyerId: inlineBuyer },
				`/campaigns/${campaignId}/buyers/${inlineBuyer}`
			)
		)) as {
			sales: { bondId: string }[];
			installments: { dueDate: string; amount: string }[];
			installmentsTotal: number;
		};
		expect(buyerRecord.sales.map((s) => s.bondId)).toEqual([bonds.plan]);
		expect(buyerRecord.installmentsTotal).toBe(10);
		expect(buyerRecord.installments[0]).toMatchObject({
			dueDate: argentinaDate(2),
			amount: '6000.00'
		});
		expect(buyerRecord.installments.map((installment) => installment.dueDate)).toEqual(
			[...buyerRecord.installments].map((installment) => installment.dueDate).sort()
		);

		const collectorRecord = (await collectorLoad(
			event(
				admin,
				{ id: campaignId, collectorId },
				`/campaigns/${campaignId}/collectors/${collectorId}`
			)
		)) as { installmentsTotal: number };
		// The full payment (1) and the installment plan (10) were both sold through Ana.
		expect(collectorRecord.installmentsTotal).toBe(11);

		const plans = (await listLoad(
			event(admin, { id: campaignId }, `/campaigns/${campaignId}/sales`, {
				search: '?paymentMode=installments'
			})
		)) as { sales: { bondId: string; bondNumberPairs: { base: number; associated: number }[] }[] };
		expect(plans.sales.map((s) => s.bondId)).toEqual([bonds.plan]);
		expect(plans.sales[0].bondNumberPairs).toEqual([{ base: 31, associated: 4902 }]);
		const byBuyer = (await listLoad(
			event(admin, { id: campaignId }, `/campaigns/${campaignId}/sales`, {
				search: `?buyer=${encodeURIComponent('Inline')}`
			})
		)) as { sales: { bondId: string }[] };
		expect(byBuyer.sales.map((s) => s.bondId)).toEqual([bonds.plan]);
	});

	it('selling the same bond twice is refused on the bond field', async () => {
		expect(
			await act(operator, 'register', {
				bondId: bonds.cash,
				buyerId,
				paymentMode: 'full_payment',
				firstDueDate: argentinaDate(1)
			})
		).toMatchObject({ status: 409, data: { errors: { bondId: [expect.any(String)] } } });
	});
});
