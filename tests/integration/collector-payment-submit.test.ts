import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isRedirect } from '@sveltejs/kit';
import { createAdminManagedUser } from '$lib/server/services/user-admin';
import { createBuyer, createCollector } from '$lib/server/services/parties';
import {
	attachCollectorPayment,
	rejectCollectorPayment
} from '$lib/server/services/collector-payments';
import { closeSettlement } from '$lib/server/services/settlements';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';
import type { UserProfile } from '../../src/app';
import {
	actions as actionsRaw,
	load as loadRaw
} from '../../src/routes/portal/[campaignId]/ventas/[saleId]/+page.server';

/* eslint-disable @typescript-eslint/no-explicit-any */
const actions = actionsRaw as unknown as Record<string, (event: never) => Promise<any>>;
const load = loadRaw as unknown as (event: never) => Promise<any>;
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
const PASSWORD = 'CollectorSubmit123!';
const rid = (label: string) => `it-psubmit-${label}-${RUN_ID}`;

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

const locals = (caller: Caller, label: string) => ({
	supabase: caller.client,
	session: null,
	user: caller.user,
	profile: caller.profile,
	permissions: caller.permissions,
	requestId: rid(label)
});
const pageEvent = (
	caller: Caller,
	saleId: string,
	label: string,
	body?: Record<string, string>
) => {
	const path = `/portal/ventas/${saleId}`;
	const form = new FormData();
	for (const [k, v] of Object.entries(body ?? {})) form.append(k, v);
	return {
		locals: locals(caller, label),
		params: { saleId },
		url: new URL(`http://localhost${path}`),
		request: new Request(`http://localhost${path}`, { method: 'POST', body: form })
	} as never;
};
/** Runs the form action the way the browser does: success is a redirect, failure a `fail()` result. */
async function register(caller: Caller, saleId: string, fields: Record<string, string>) {
	try {
		return await actions.registrar(pageEvent(caller, saleId, 'form', fields));
	} catch (err) {
		if (isRedirect(err)) return { redirect: err.location };
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
let collectorAId: string;
let campaignId: string;
let saleA: string;
let saleB: string;
let installmentsA: string[] = [];

async function linkedCollector(label: string) {
	const service = createClient(supabaseUrl, serviceRoleKey, options);
	const email = `psubmit_${label}_${RUN_ID}@firefighters.local`;
	await createAdminManagedUser(service, {
		email,
		password: PASSWORD,
		fullName: `Portal submit ${label} ${RUN_ID}`,
		roleNames: ['collector'],
		requestId: rid(`user-${label}`)
	});
	const caller = await signIn(email, PASSWORD);
	const id = await createCollector(
		admin.client,
		{
			displayName: `Portal submit ${label} ${RUN_ID}`,
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

let nextBase = 100 + Math.floor(Math.random() * 1000) * 8;
async function sell(collectorId: string, label: string) {
	const buyerId = await createBuyer(
		admin.client,
		{
			type: 'individual',
			firstName: label,
			lastName: RUN_ID,
			businessName: null,
			documentNumber: `8${Math.floor(Math.random() * 1e7)}`,
			taxId: null,
			phone: '1111',
			address: 'Calle 1',
			usualCollectorId: null,
			notes: null
		},
		{ requestId: rid(`buyer-${label}`), permissions: admin.permissions ?? [] }
	);
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
		p_payment_mode: 'installments',
		p_first_due_date: daysFromToday(-10),
		p_request_id: rid(`sale-${label}`)
	});
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
const formFields = (installmentId: string, amount: string, extra: Record<string, string> = {}) => ({
	installmentId,
	amount,
	paymentMethod: 'cash',
	paymentDate: today(),
	note: 'Cobrado en mano',
	requestKey: randomUUID(),
	...extra
});

beforeAll(async () => {
	admin = await signIn(seed.admin.email, seed.admin.password);
	const a = await linkedCollector('a');
	const b = await linkedCollector('b');
	collectorA = a.caller;
	collectorB = b.caller;
	collectorAId = a.id;
	campaignId = await rpcId(admin.client, 'campaign_create', {
		p_name: `[it-psubmit ${RUN_ID}]`,
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
	// 10% on the first installment: closing must write the commission to the ledger.
	await admin.client.rpc('commission_rule_create', {
		p_campaign_id: campaignId,
		p_rule_type: 'installment_first',
		p_installment_number: null,
		p_percentage: '10',
		p_fixed_amount: null,
		p_valid_from: daysFromToday(-30),
		p_valid_to: null,
		p_request_id: rid('rule')
	});
	const { error } = await admin.client.rpc('campaign_transition', {
		p_id: campaignId,
		p_to_status: 'active',
		p_request_id: rid('activate')
	});
	if (error) throw new Error(error.message);
	saleA = await sell(a.id, 'a');
	saleB = await sell(b.id, 'b');
	const { data: plan } = await admin.client
		.from('payment_plans')
		.select('id')
		.eq('sale_id', saleA)
		.single();
	const { data: rows } = await admin.client
		.from('installments')
		.select('id,installment_number')
		.eq('payment_plan_id', plan!.id)
		.order('installment_number');
	installmentsA = (rows ?? []).map((r) => r.id as string);
});

describe('collector portal: Registrar cobro end to end (local Supabase)', () => {
	let settlementId: string;
	let includedId: string;

	it('collector A submits: a draft that counts for nothing yet', async () => {
		const result = await register(collectorA, saleA, formFields(installmentsA[0], '100,00'));
		expect(result).toEqual({ redirect: `/portal/ventas/${saleA}?enviado=1` });
		includedId = await latestDraftId(saleA, 100);
		expect(await paymentRow(includedId)).toMatchObject({
			status: 'draft',
			settlement_id: null,
			collector_id: collectorAId,
			created_by: collectorA.profile.id,
			submitted_by_collector: true,
			collector_note: 'Cobrado en mano',
			payment_date: today()
		});
		const { data: installment } = await admin.client
			.from('installments')
			.select('status')
			.eq('id', installmentsA[0])
			.single();
		expect(installment!.status).toBe('pending');
		const { count } = await admin.client
			.from('collector_ledger_entries')
			.select('id', { count: 'exact', head: true })
			.eq('payment_id', includedId);
		expect(count).toBe(0);
		const { data: audit } = await admin.client
			.from('audit_log')
			.select('actor_user_id')
			.eq('action', 'payment.collector_submit')
			.eq('entity_id', includedId);
		expect(audit).toEqual([{ actor_user_id: collectorA.profile.id }]);
	});

	it('shows it to the collector as pending, reserved, and not as an applied payment', async () => {
		const data = await load(pageEvent(collectorA, saleA, 'load'));
		expect(data.canRegister).toBe(true);
		expect(data.submissions).toMatchObject([
			{ id: includedId, status: 'draft', amount: '100.00', installmentNumbers: [1] }
		]);
		expect(data.reserved).toEqual({ [installmentsA[0]]: '100.00' });
		expect(data.payments).toEqual([]);
		expect(data.sale).toMatchObject({ paidAmount: '0.00', pendingAmount: '0.00' });
	});

	it('refuses overpaying, counting drafts, and future dates', async () => {
		const over = await register(collectorA, saleA, formFields(installmentsA[0], '1'));
		expect(over).toMatchObject({
			status: 400,
			data: { message: 'El importe supera el saldo de la cuota, contando los cobros pendientes.' }
		});
		const future = await register(
			collectorA,
			saleA,
			formFields(installmentsA[1], '10', { paymentDate: daysFromToday(2) })
		);
		expect(future).toMatchObject({ status: 400 });
		expect(future.data.errors.paymentDate).toBeTruthy();
	});

	it('isolates collectors: B cannot submit for the sale of A', async () => {
		const result = await register(collectorB, saleA, formFields(installmentsA[1], '10'));
		expect(result).toMatchObject({ status: 404 });
		const { count } = await admin.client
			.from('payments')
			.select('id', { count: 'exact', head: true })
			.eq('sale_id', saleA)
			.eq('collector_id', collectorAId);
		expect(count).toBe(1);
		// And B cannot reach the RPCs that belong to the operator either.
		const { error } = await collectorB.client.rpc('settlement_reject_collector_payment', {
			p_payment_id: includedId,
			p_reason: 'no'
		});
		expect(error?.code).toBe('42501');
	});

	it('the collector cannot confirm, edit or annul it', async () => {
		for (const patch of [{ status: 'confirmed' }, { status: 'annulled' }, { amount: 1 }]) {
			const { data } = await collectorA.client
				.from('payments')
				.update(patch)
				.eq('id', includedId)
				.select();
			expect(data ?? []).toEqual([]);
		}
		const { error } = await collectorA.client.rpc('settlement_attach_collector_payment', {
			p_settlement_id: randomUUID(),
			p_payment_id: includedId
		});
		expect(error?.code).toBe('42501');
		expect(await paymentRow(includedId)).toMatchObject({ status: 'draft', amount: 100 });
	});

	it('operator includes it, closes the settlement and the payment is confirmed with its ledger', async () => {
		settlementId = await rpcId(admin.client, 'settlement_open', {
			p_campaign_id: campaignId,
			p_collector_id: collectorAId,
			p_notes: null,
			p_request_id: rid('settlement')
		});
		const ctx = { requestId: rid('attach'), permissions: admin.permissions };
		const before = await admin.client.rpc('settlement_totals', { p_settlement_id: settlementId });
		expect(Number(before.data[0].total_amount)).toBe(0);
		await attachCollectorPayment(admin.client, { settlementId, paymentId: includedId }, ctx);
		expect(await paymentRow(includedId)).toMatchObject({
			status: 'pending_in_settlement',
			settlement_id: settlementId
		});
		const during = await admin.client.rpc('settlement_totals', { p_settlement_id: settlementId });
		expect(Number(during.data[0].total_amount)).toBe(100);
		// Pending in a settlement: the collector still reads it as "Pendiente de rendición".
		const pending = await load(pageEvent(collectorA, saleA, 'load'));
		expect(pending.submissions[0].status).toBe('pending_in_settlement');

		await closeSettlement(admin.client, { settlementId }, ctx);
		expect(await paymentRow(includedId)).toMatchObject({ status: 'confirmed' });
		const { data: installment } = await admin.client
			.from('installments')
			.select('status')
			.eq('id', installmentsA[0])
			.single();
		expect(installment!.status).toBe('paid');
		const { data: ledger } = await admin.client
			.from('collector_ledger_entries')
			.select('entry_type,amount')
			.eq('settlement_id', settlementId);
		expect(ledger).toContainEqual({ entry_type: 'commission_generated', amount: 10 });
		const { data: closed } = await admin.client
			.from('settlements')
			.select('status,total_cash,total_amount')
			.eq('id', settlementId)
			.single();
		expect(closed).toMatchObject({ status: 'closed', total_cash: 100, total_amount: 100 });
		const after = await load(pageEvent(collectorA, saleA, 'load'));
		expect(after.submissions[0].status).toBe('confirmed');
		expect(after.sale).toMatchObject({ paidAmount: '100.00' });
		// Listed once, under "Cobros enviados".
		expect(after.payments).toEqual([]);
	});

	it('a closed settlement no longer accepts submissions', async () => {
		await register(collectorA, saleA, formFields(installmentsA[1], '30'));
		const draft = await latestDraftId(saleA, 30);
		await expect(
			attachCollectorPayment(
				admin.client,
				{ settlementId, paymentId: draft },
				{ requestId: rid('late'), permissions: admin.permissions }
			)
		).rejects.toMatchObject({ kind: 'conflict' });
		expect((await paymentRow(draft)).status).toBe('draft');
	});

	it('operator rejects with a reason: the collector sees it and the balance is released', async () => {
		const draft = await latestDraftId(saleA, 30);
		await rejectCollectorPayment(
			admin.client,
			{ paymentId: draft, reason: 'No llegó la transferencia' },
			{ requestId: rid('reject'), permissions: admin.permissions }
		);
		expect(await paymentRow(draft)).toMatchObject({
			status: 'annulled',
			annulment_reason: 'No llegó la transferencia'
		});
		const data = await load(pageEvent(collectorA, saleA, 'load'));
		const rejected = data.submissions.find((s: any) => s.id === draft);
		expect(rejected).toMatchObject({
			status: 'annulled',
			rejectionReason: 'No llegó la transferencia'
		});
		expect(data.reserved[installmentsA[1]]).toBeUndefined();
		const retry = await register(collectorA, saleA, formFields(installmentsA[1], '100,00'));
		expect(retry).toEqual({ redirect: `/portal/ventas/${saleA}?enviado=1` });
		await expect(
			rejectCollectorPayment(
				admin.client,
				{ paymentId: draft, reason: 'otra vez' },
				{ requestId: rid('reject2'), permissions: admin.permissions }
			)
		).rejects.toMatchObject({ kind: 'conflict' });
	});

	it('a double click with the same request key creates one payment', async () => {
		const fields = formFields(installmentsA[2], '50');
		await register(collectorA, saleA, fields);
		await register(collectorA, saleA, fields);
		const { count } = await admin.client
			.from('payments')
			.select('id', { count: 'exact', head: true })
			.eq('sale_id', saleA)
			.eq('amount', 50);
		expect(count).toBe(1);
	});

	it('B only sees its own submissions', async () => {
		const own = await register(collectorB, saleB, formFields(await firstInstallment(saleB), '20'));
		expect(own).toMatchObject({ redirect: `/portal/ventas/${saleB}?enviado=1` });
		const data = await load(pageEvent(collectorB, saleB, 'load'));
		expect(data.submissions).toHaveLength(1);
		const { data: foreign } = await collectorB.client.rpc('portal_my_sale_submissions', {
			p_sale_id: saleA
		});
		expect(foreign).toEqual([]);
	});
});

async function firstInstallment(saleId: string) {
	const { data: plan } = await admin.client
		.from('payment_plans')
		.select('id')
		.eq('sale_id', saleId)
		.single();
	const { data } = await admin.client
		.from('installments')
		.select('id')
		.eq('payment_plan_id', plan!.id)
		.eq('installment_number', 1)
		.single();
	return data!.id as string;
}
