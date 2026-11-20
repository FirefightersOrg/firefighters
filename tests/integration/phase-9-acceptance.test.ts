import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { createBuyer, createCollector } from '$lib/server/services/parties';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';

/**
 * Phase 9 acceptance (SAN-70): 3-tier commissions, settlement-close ledger postings, transfer
 * commission credit, audited manual adjustments, and balance reconstruction from the ledger.
 * Runs against the local Supabase stack as real users (see docs/phase-9-verification.md).
 */
const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seed = resolveSeedConfig(seedEnv);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
let sequence = 0;
const rid = (label: string) => `it-p9-${RUN_ID}-${String(++sequence).padStart(3, '0')}-${label}`;
const baDate = (days = 0) => {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Argentina/Buenos_Aires'
	}).formatToParts(new Date());
	const d = Object.fromEntries(
		parts.filter((x) => x.type !== 'literal').map((x) => [x.type, x.value])
	);
	return new Date(Date.UTC(Number(d.year), Number(d.month) - 1, Number(d.day) + days))
		.toISOString()
		.slice(0, 10);
};

type Role = 'admin' | 'read-only';
interface Caller {
	user: User;
	client: SupabaseClient;
	permissions: string[];
}
const users = {} as Record<Role, Caller>;
let service: SupabaseClient;
let campaignId: string;
let collectorA: string;
let collectorB: string;
let collectorWindow: string;
let buyerId: string;
let nextBase = 3000;
const sales: Record<string, { saleId: string; installments: string[] }> = {};

async function signIn(role: Role, email: string, password: string): Promise<Caller> {
	const auth = createClient(supabaseUrl, anonKey, options);
	const { data, error } = await auth.auth.signInWithPassword({ email, password });
	if (error || !data.session) throw new Error(`Could not sign in ${role}: ${error?.message}`);
	const client = createClient(supabaseUrl, anonKey, {
		...options,
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
	return { user: data.user, client, permissions: await loadPermissions(client) };
}

async function rpc<T>(caller: Caller, name: string, args: Record<string, unknown>): Promise<T> {
	const { data, error } = await caller.client.rpc(name, args);
	if (error) throw Object.assign(new Error(error.message), { code: error.code });
	return data as T;
}

async function soldBond(label: string, collectorId: string) {
	const bondId = await rpc<string>(users.admin, 'bond_create', {
		p_campaign_id: campaignId,
		p_base_numbers: [nextBase++],
		p_request_id: rid(`bond-${label}`)
	});
	await rpc(users.admin, 'bond_deliver', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId,
		p_bond_ids: [bondId],
		p_notes: null,
		p_request_id: rid(`deliver-${label}`)
	});
	const saleId = await rpc<string>(users.admin, 'sale_register', {
		p_campaign_id: campaignId,
		p_bond_id: bondId,
		p_buyer_id: buyerId,
		p_payment_mode: 'installments',
		p_first_due_date: baDate(1),
		p_request_id: rid(`sale-${label}`)
	});
	const { data, error } = await service
		.from('installments')
		.select('id, installment_number, payment_plans!inner(sale_id)')
		.eq('payment_plans.sale_id', saleId)
		.order('installment_number');
	if (error) throw new Error(error.message);
	sales[label] = { saleId, installments: (data ?? []).map((row) => row.id as string) };
}

async function openWithPayment(
	collectorId: string,
	label: string,
	method: 'cash' | 'transfer',
	amount: number,
	paymentDate: string = baDate()
) {
	const settlementId = await rpc<string>(users.admin, 'settlement_open', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId,
		p_request_id: rid(`open-${label}`)
	});
	await rpc(users.admin, 'settlement_add_payment', {
		p_settlement_id: settlementId,
		p_sale_id: sales[label].saleId,
		p_amount: amount,
		p_payment_method: method,
		p_payment_date: paymentDate,
		p_applications: [{ installment_id: sales[label].installments[0], amount_applied: amount }],
		p_request_id: rid(`pay-${label}`)
	});
	return settlementId;
}

async function totals(settlementId: string) {
	const rows = await rpc<Record<string, string>[]>(users.admin, 'settlement_totals', {
		p_settlement_id: settlementId
	});
	return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
}

const balance = (collectorId: string) =>
	rpc<string>(users.admin, 'collector_ledger_balance', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId
	}).then(Number);

async function entries(collectorId: string) {
	const { data, error } = await users.admin.client
		.from('collector_ledger_entries')
		.select('id, entry_type, direction, amount, status, settlement_id, reason, annul_reason')
		.eq('campaign_id', campaignId)
		.eq('collector_id', collectorId)
		.order('created_at');
	if (error) throw new Error(error.message);
	return (data ?? []).map((row) => ({ ...row, amount: Number(row.amount) }));
}

async function audit(requestId: string) {
	const { data, error } = await service
		.from('audit_log')
		.select('action, reason')
		.eq('request_id', requestId);
	if (error) throw new Error(error.message);
	return data ?? [];
}

const codeOf = (promise: Promise<unknown>) =>
	promise.then(
		() => 'ok',
		(e: { code?: string }) => e.code
	);

beforeAll(async () => {
	service = createClient(supabaseUrl, serviceRoleKey, options);
	users.admin = await signIn('admin', seed.admin.email, seed.admin.password);
	const readOnly = seed.fixtures.find((f) => f.roleNames.includes('read-only'))!;
	users['read-only'] = await signIn('read-only', readOnly.email, readOnly.password);
	campaignId = await rpc<string>(users.admin, 'campaign_create', {
		p_name: `[it-p9 ${RUN_ID}] commissions`,
		p_simple_bond_value: '60000.00',
		p_installment_count: 2,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_starts_at: `${baDate(-10)}T03:00:00Z`,
		p_ends_at: `${baDate(365)}T03:00:00Z`,
		p_request_id: rid('campaign')
	});
	await rpc(users.admin, 'campaign_transition', {
		p_id: campaignId,
		p_to_status: 'active',
		p_request_id: rid('activate')
	});
	const ctx = { permissions: users.admin.permissions };
	const collector = (name: string) =>
		createCollector(
			users.admin.client,
			{
				displayName: `${name} ${RUN_ID}`,
				phone: null,
				email: null,
				address: null,
				userProfileId: null,
				status: 'active'
			},
			{ ...ctx, requestId: rid(`collector-${name}`) }
		);
	collectorA = await collector('A');
	collectorB = await collector('B');
	collectorWindow = await collector('Window');
	buyerId = await createBuyer(
		users.admin.client,
		{
			type: 'individual',
			firstName: 'Buyer',
			lastName: RUN_ID,
			businessName: null,
			documentNumber: null,
			taxId: null,
			phone: null,
			address: null,
			usualCollectorId: null,
			notes: null
		},
		{ ...ctx, requestId: rid('buyer') }
	);
	// General 10% on the first installment; collector A has a special 20% rule.
	await rpc(users.admin, 'commission_rule_create', {
		p_campaign_id: campaignId,
		p_rule_type: 'installment_first',
		p_installment_number: null,
		p_percentage: '10',
		p_fixed_amount: null,
		p_valid_from: baDate(-10),
		p_valid_to: null,
		p_request_id: rid('rule-general'),
		p_reason: null
	});
	await rpc(users.admin, 'commission_rule_create', {
		p_campaign_id: campaignId,
		p_rule_type: 'installment_first',
		p_installment_number: null,
		p_percentage: '20',
		p_fixed_amount: null,
		p_valid_from: baDate(-1),
		p_valid_to: null,
		p_request_id: rid('rule-special'),
		p_reason: null,
		p_applies_to_collector_id: collectorA
	});
	await soldBond('a-cash', collectorA);
	await soldBond('a-transfer', collectorA);
	await soldBond('b-cash', collectorB);
	await rpc(users.admin, 'commission_rule_create', {
		p_campaign_id: campaignId,
		p_rule_type: 'installment_first',
		p_installment_number: null,
		p_percentage: '20',
		p_fixed_amount: null,
		p_valid_from: baDate(-4),
		p_valid_to: baDate(-2),
		p_request_id: rid('rule-window'),
		p_reason: null,
		p_applies_to_collector_id: collectorWindow
	});
}, 120_000);

describe('Phase 9: commissions and collector ledger', () => {
	let cashSettlement: string;

	it('C1 a special per-collector rule overrides the general rule within its validity', async () => {
		cashSettlement = await openWithPayment(collectorA, 'a-cash', 'cash', 30000);
		expect(await totals(cashSettlement)).toMatchObject({ commission_amount: 6000 });
		const other = await openWithPayment(collectorB, 'b-cash', 'cash', 30000);
		expect(await totals(other)).toMatchObject({ commission_amount: 3000 });
	});

	it.each([
		['before valid_from (future rule)', -5, 3000],
		['at inclusive valid_from', -4, 6000],
		['at inclusive valid_to', -2, 6000],
		['after valid_to (expired rule)', -1, 3000]
	] as const)(
		'C1 payment dated %s selects the applicable rule',
		async (label, days, commission) => {
			await soldBond(label, collectorWindow);
			const settlement = await openWithPayment(collectorWindow, label, 'cash', 30000, baDate(days));
			expect(await totals(settlement)).toMatchObject({ commission_amount: commission });
		}
	);

	it('C2 closing a cash settlement posts generated and cash-retained commission', async () => {
		expect(await totals(cashSettlement)).toMatchObject({
			total_cash: 30000,
			commission_paid_amount: 6000,
			net_to_firefighters: 24000
		});
		await rpc(users.admin, 'settlement_close', {
			p_settlement_id: cashSettlement,
			p_request_id: rid('close-cash')
		});
		const posted = (await entries(collectorA)).filter((e) => e.settlement_id === cashSettlement);
		expect(posted.map((e) => [e.entry_type, e.direction, e.amount]).sort()).toEqual([
			['commission_generated', 'collector_credit', 6000],
			['commission_settled', 'collector_debit', 6000]
		]);
		expect(await balance(collectorA)).toBe(0);
	});

	it('C2 repeated settlement_close fails without duplicating ledger entries', async () => {
		const before = await entries(collectorA);
		expect(before.filter((e) => e.settlement_id === cashSettlement)).toHaveLength(2);
		expect(
			await codeOf(
				rpc(users.admin, 'settlement_close', {
					p_settlement_id: cashSettlement,
					p_request_id: rid('close-cash-again')
				})
			)
		).toBe('55000');
		expect((await entries(collectorA)).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
			before.sort((a, b) => a.id.localeCompare(b.id))
		);
		expect(await balance(collectorA)).toBe(0);
	});

	it('C3 a transfer payment leaves the commission as collector credit until it is settled', async () => {
		const transfer = await openWithPayment(collectorA, 'a-transfer', 'transfer', 30000);
		expect(await totals(transfer)).toMatchObject({
			commission_amount: 6000,
			commission_paid_amount: 0,
			net_to_firefighters: 30000,
			collector_credit_balance: 6000
		});
		await rpc(users.admin, 'settlement_close', {
			p_settlement_id: transfer,
			p_request_id: rid('close-transfer')
		});
		const posted = (await entries(collectorA)).filter((e) => e.settlement_id === transfer);
		expect(posted.map((e) => [e.entry_type, e.direction, e.amount])).toEqual([
			['commission_generated', 'collector_credit', 6000]
		]);
		expect(await balance(collectorA)).toBe(6000);
		const settleRequest = rid('settle');
		await rpc(users.admin, 'commission_settle', {
			p_campaign_id: campaignId,
			p_collector_id: collectorA,
			p_amount: 2500,
			p_reason: 'Paid in cash at the station',
			p_request_id: settleRequest
		});
		expect(await balance(collectorA)).toBe(3500);
		expect((await audit(settleRequest)).map((a) => a.action)).toEqual(['commission.settle']);
		expect(
			await codeOf(
				rpc(users.admin, 'commission_settle', {
					p_campaign_id: campaignId,
					p_collector_id: collectorA,
					p_amount: 999999,
					p_reason: 'Too much'
				})
			)
		).toBe('22023');
	});

	it('C4 manual adjustments require permission and a reason, and are audited', async () => {
		const adjust = (caller: Caller, reason: string, requestId?: string) =>
			rpc(caller, 'commission_adjust', {
				p_campaign_id: campaignId,
				p_collector_id: collectorA,
				p_amount: 500,
				p_direction: 'in_favor_of_firefighters',
				p_reason: reason,
				p_request_id: requestId ?? null
			});
		expect(await codeOf(adjust(users['read-only'], 'Not allowed'))).toBe('42501');
		expect(
			await codeOf(
				rpc(users['read-only'], 'collector_ledger_adjust', {
					p_campaign_id: campaignId,
					p_collector_id: collectorA,
					p_amount: 1,
					p_direction: 'collector_credit',
					p_reason: 'x'
				})
			)
		).toBe('42501');
		expect(await codeOf(adjust(users.admin, '   '))).toBe('22023');
		const adjustRequest = rid('adjust');
		await adjust(users.admin, 'Commission overpaid in settlement 1', adjustRequest);
		expect(await audit(adjustRequest)).toEqual([
			{ action: 'commission.adjust', reason: 'Commission overpaid in settlement 1' }
		]);
		expect(await balance(collectorA)).toBe(3000);
		const { data: rule } = await users.admin.client
			.from('commission_rules')
			.select('percentage')
			.eq('campaign_id', campaignId)
			.eq('applies_to_collector_id', collectorA)
			.single();
		expect(Number(rule?.percentage)).toBe(20);

		const creditId = await rpc<string>(users.admin, 'collector_ledger_adjust', {
			p_campaign_id: campaignId,
			p_collector_id: collectorA,
			p_amount: 100,
			p_direction: 'collector_credit',
			p_reason: 'Typo, to be annulled',
			p_request_id: rid('ledger-adjust')
		});
		expect(await balance(collectorA)).toBe(3100);
		const annulRequest = rid('annul');
		await rpc(users.admin, 'collector_ledger_annul_entry', {
			p_entry_id: creditId,
			p_reason: 'Entered by mistake',
			p_request_id: annulRequest
		});
		expect((await audit(annulRequest)).map((a) => a.action)).toEqual(['collector_ledger.annul']);
		expect((await entries(collectorA)).find((e) => e.id === creditId)).toMatchObject({
			reason: 'Typo, to be annulled',
			annul_reason: 'Entered by mistake'
		});
		expect(await balance(collectorA)).toBe(3000);
		const closedEntry = (await entries(collectorA)).find(
			(e) => e.settlement_id === cashSettlement
		)!;
		expect(
			await codeOf(
				rpc(users.admin, 'collector_ledger_annul_entry', {
					p_entry_id: closedEntry.id,
					p_reason: 'Not allowed'
				})
			)
		).toBe('55000');
	});

	it('C5 the balance is rebuilt only from non-annulled ledger entries', async () => {
		const all = await entries(collectorA);
		const rebuilt = all
			.filter((e) => e.status !== 'annulled')
			.reduce((sum, e) => sum + (e.direction === 'collector_credit' ? e.amount : -e.amount), 0);
		expect(rebuilt).toBe(3000);
		expect(await balance(collectorA)).toBe(rebuilt);
		expect(all.some((e) => e.status === 'annulled')).toBe(true);
		const view = await rpc<{ running_balance: string }[]>(
			users.admin,
			'collector_ledger_entries_with_balance',
			{ p_campaign_id: campaignId, p_collector_id: collectorA }
		);
		expect(Number(view.at(-1)?.running_balance)).toBe(3000);
		// No stored, editable balance: collectors carry no balance field.
		const { data: collector } = await service
			.from('collectors')
			.select('*')
			.eq('id', collectorA)
			.single();
		expect(Object.keys(collector ?? {}).some((key) => key.includes('balance'))).toBe(false);
	});
});
