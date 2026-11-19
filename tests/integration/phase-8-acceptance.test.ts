import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { createBuyer, createCollector } from '$lib/server/services/parties';
import {
	addPaymentToSettlement,
	closeSettlement,
	openSettlement,
	removePaymentFromSettlement,
	SettlementServiceError
} from '$lib/server/services/settlements';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';
import type { UserProfile } from '../../src/app';

const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seed = resolveSeedConfig(seedEnv);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
let sequence = 0;
const rid = (label: string) => `it-p8-${RUN_ID}-${String(++sequence).padStart(3, '0')}-${label}`;
const baDate = (days = 0) => {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Argentina/Buenos_Aires'
	}).formatToParts(new Date());
	const date = Object.fromEntries(
		parts.filter((x) => x.type !== 'literal').map((x) => [x.type, x.value])
	);
	return new Date(Date.UTC(Number(date.year), Number(date.month) - 1, Number(date.day) + days))
		.toISOString()
		.slice(0, 10);
};

type Role = 'admin' | 'operator' | 'treasurer' | 'read-only' | 'collector';
interface Caller {
	user: User;
	client: SupabaseClient;
	profile: UserProfile;
	permissions: string[];
}
const users = {} as Record<Role, Caller>;
let service: SupabaseClient;
let campaignId: string;
let collectorId: string;
let otherCollectorId: string;
let buyerId: string;
let nextBase = 7000;

async function signIn(role: Role, email: string, password: string): Promise<Caller> {
	const auth = createClient(supabaseUrl, anonKey, options);
	const { data, error } = await auth.auth.signInWithPassword({ email, password });
	if (error || !data.session) throw new Error(`Could not sign in ${role}: ${error?.message}`);
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

const ctx = (caller: Caller, requestId = rid('request')) => ({
	requestId,
	permissions: caller.permissions
});
async function rpcId(client: SupabaseClient, name: string, args: Record<string, unknown>) {
	const { data, error } = await client.rpc(name, args);
	if (error || typeof data !== 'string')
		throw new Error(error?.message ?? `${name} did not return an id`);
	return data;
}
async function createSale(
	label: string,
	firstDueDate: string,
	paymentMode: 'installments' | 'full_payment' = 'installments'
) {
	const bondId = await rpcId(users.admin.client, 'bond_create', {
		p_campaign_id: campaignId,
		p_base_numbers: [nextBase],
		p_request_id: rid(`bond-${label}`)
	});
	nextBase += 3;
	const delivered = await users.admin.client.rpc('bond_deliver', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId,
		p_bond_ids: [bondId],
		p_notes: null,
		p_request_id: rid(`delivery-${label}`)
	});
	if (delivered.error) throw new Error(delivered.error.message);
	const saleId = await rpcId(users.admin.client, 'sale_register', {
		p_campaign_id: campaignId,
		p_bond_id: bondId,
		p_buyer_id: buyerId,
		p_payment_mode: paymentMode,
		p_first_due_date: firstDueDate,
		p_request_id: rid(`sale-${label}`)
	});
	const { data: plan, error: planError } = await service
		.from('payment_plans')
		.select('id')
		.eq('sale_id', saleId)
		.single();
	if (planError || !plan) throw new Error(planError?.message);
	const { data: installments, error: installmentsError } = await service
		.from('installments')
		.select('id, installment_number, amount, status')
		.eq('payment_plan_id', plan.id)
		.order('installment_number');
	if (installmentsError || !installments) throw new Error(installmentsError?.message);
	return { bondId, saleId, installments };
}
async function totals(caller: Caller, settlementId: string) {
	const { data, error } = await caller.client.rpc('settlement_totals', {
		p_settlement_id: settlementId
	});
	if (error || !data?.[0]) throw new Error(error?.message ?? 'No settlement totals');
	return data[0] as Record<string, string | number>;
}
const numericTotals = (row: Record<string, string | number>) =>
	Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
async function auditFor(requestId: string) {
	const { data, error } = await service
		.from('audit_log')
		.select('action, entity_type, entity_id')
		.eq('request_id', requestId);
	expect(error).toBeNull();
	return data ?? [];
}

beforeAll(async () => {
	service = createClient(supabaseUrl, serviceRoleKey, options);
	users.admin = await signIn('admin', seed.admin.email, seed.admin.password);
	for (const role of ['operator', 'treasurer', 'read-only', 'collector'] as const) {
		const fixture = seed.fixtures.find((item) => item.roleNames.includes(role))!;
		users[role] = await signIn(role, fixture.email, fixture.password);
	}
	campaignId = await rpcId(users.admin.client, 'campaign_create', {
		p_name: `[it-p8 ${RUN_ID}] settlements`,
		p_simple_bond_value: '300.00',
		p_installment_count: 3,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 1,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_starts_at: `${baDate(-1)}T03:00:00Z`,
		p_ends_at: `${baDate(365)}T03:00:00Z`,
		p_request_id: rid('campaign')
	});
	const activated = await users.admin.client.rpc('campaign_transition', {
		p_id: campaignId,
		p_to_status: 'active',
		p_request_id: rid('activate')
	});
	if (activated.error) throw new Error(activated.error.message);
	const { data: existingCollector, error: existingCollectorError } = await service
		.from('collectors')
		.select('id')
		.eq('user_profile_id', users.collector.profile.id)
		.maybeSingle();
	if (existingCollectorError) throw new Error(existingCollectorError.message);
	collectorId =
		existingCollector?.id ??
		(await createCollector(
			users.admin.client,
			{
				displayName: `Collector ${RUN_ID}`,
				phone: null,
				email: null,
				address: null,
				userProfileId: users.collector.profile.id,
				status: 'active'
			},
			ctx(users.admin)
		));
	otherCollectorId = await createCollector(
		users.admin.client,
		{
			displayName: `Other ${RUN_ID}`,
			phone: null,
			email: null,
			address: null,
			userProfileId: null,
			status: 'active'
		},
		ctx(users.admin)
	);
	buyerId = await createBuyer(
		users.admin.client,
		{
			type: 'individual',
			firstName: 'Phase',
			lastName: RUN_ID,
			businessName: null,
			documentNumber: null,
			taxId: null,
			phone: null,
			address: null,
			usualCollectorId: null,
			notes: null
		},
		ctx(users.admin)
	);
	for (const rule of [
		{
			rule_type: 'installment_middle',
			percentage: 10,
			fixed_amount: null,
			applies_to_collector_id: null
		},
		{
			rule_type: 'installment_last',
			percentage: null,
			fixed_amount: 10,
			applies_to_collector_id: null
		},
		{
			rule_type: 'installment_last',
			percentage: null,
			fixed_amount: 15,
			applies_to_collector_id: collectorId
		}
	]) {
		const { error } = await service.from('commission_rules').insert({
			campaign_id: campaignId,
			valid_from: baDate(-1),
			status: 'active',
			installment_number: null,
			...rule
		});
		if (error) throw new Error(error.message);
	}
});

describe('Phase 8: payments and assisted settlement closing (backend)', () => {
	it('C1 calculates live cash, transfer, commissions and zero ledger balance after add and remove', async () => {
		const middle = await createSale('middle', baDate());
		const last = await createSale('last', baDate(-2));
		const settlementId = await openSettlement(
			users.operator.client,
			{ campaignId, collectorId, notes: 'Phase 8 C1' },
			ctx(users.operator)
		);
		const cashId = await addPaymentToSettlement(
			users.operator.client,
			{
				settlementId,
				saleId: middle.saleId,
				amount: 100,
				paymentMethod: 'cash',
				applications: [{ installmentId: middle.installments[1].id, amountApplied: 100 }]
			},
			ctx(users.operator)
		);
		expect(numericTotals(await totals(users.operator, settlementId))).toMatchObject({
			total_cash: 100,
			total_transfer: 0,
			total_amount: 100,
			commission_amount: 10,
			commission_paid_amount: 10,
			net_to_firefighters: 90,
			collector_credit_balance: 0
		});
		await addPaymentToSettlement(
			users.operator.client,
			{
				settlementId,
				saleId: last.saleId,
				amount: 100,
				paymentMethod: 'transfer',
				applications: [{ installmentId: last.installments[2].id, amountApplied: 100 }]
			},
			ctx(users.operator)
		);
		expect(numericTotals(await totals(users.operator, settlementId))).toMatchObject({
			total_cash: 100,
			total_transfer: 100,
			total_amount: 200,
			commission_amount: 25,
			commission_paid_amount: 25,
			net_to_firefighters: 175,
			collector_credit_balance: 0
		});
		await removePaymentFromSettlement(
			users.operator.client,
			{ paymentId: cashId, reason: 'Duplicate cash receipt' },
			ctx(users.operator)
		);
		expect(numericTotals(await totals(users.operator, settlementId))).toMatchObject({
			total_cash: 0,
			total_transfer: 100,
			total_amount: 100,
			commission_amount: 15,
			commission_paid_amount: 15,
			net_to_firefighters: 85,
			collector_credit_balance: 0
		});
	});

	it('C2 closes atomically, confirms applications across settlements, records snapshots and audits', async () => {
		const advance = await createSale('advance', baDate());
		const overdue = await createSale('overdue', baDate(-2));
		const fullyPaid = await createSale('fully-paid', baDate(), 'full_payment');
		const split = await createSale('split', baDate(), 'full_payment');
		const settlementId = await openSettlement(
			users.operator.client,
			{ campaignId, collectorId },
			ctx(users.operator)
		);
		const addRequests = [
			rid('add-advance'),
			rid('add-overdue'),
			rid('add-full'),
			rid('add-split-a')
		];
		for (const [sale, installment, amount, method, requestId] of [
			[advance, advance.installments[1], 100, 'cash', addRequests[0]],
			[overdue, overdue.installments[2], 100, 'transfer', addRequests[1]],
			[fullyPaid, fullyPaid.installments[0], 300, 'cash', addRequests[2]],
			[split, split.installments[0], 150, 'transfer', addRequests[3]]
		] as const)
			await addPaymentToSettlement(
				users.operator.client,
				{
					settlementId,
					saleId: sale.saleId,
					amount,
					paymentMethod: method,
					applications: [{ installmentId: installment.id, amountApplied: amount }]
				},
				ctx(users.operator, requestId)
			);
		const beforeClose = numericTotals(await totals(users.operator, settlementId));
		const closeRequest = rid('close');
		await closeSettlement(
			users.treasurer.client,
			{ settlementId },
			ctx(users.treasurer, closeRequest)
		);
		const secondId = await openSettlement(
			users.treasurer.client,
			{ campaignId, collectorId },
			ctx(users.treasurer)
		);
		await addPaymentToSettlement(
			users.treasurer.client,
			{
				settlementId: secondId,
				saleId: split.saleId,
				amount: 150,
				paymentMethod: 'cash',
				applications: [{ installmentId: split.installments[0].id, amountApplied: 150 }]
			},
			ctx(users.treasurer)
		);
		await closeSettlement(users.treasurer.client, { settlementId: secondId }, ctx(users.treasurer));
		const { data: stored } = await users.admin.client
			.from('settlements')
			.select(
				'status, total_cash, total_transfer, total_amount, commission_amount, commission_paid_amount, net_to_firefighters, closed_at, closed_by'
			)
			.eq('id', settlementId)
			.single();
		expect(stored).toMatchObject({
			status: 'closed',
			total_cash: beforeClose.total_cash,
			total_transfer: beforeClose.total_transfer,
			total_amount: beforeClose.total_amount,
			commission_amount: beforeClose.commission_amount,
			commission_paid_amount: beforeClose.commission_paid_amount,
			net_to_firefighters: beforeClose.net_to_firefighters,
			closed_by: users.treasurer.profile.id
		});
		expect(stored?.closed_at).toBeTruthy();
		const { data: paid } = await users.admin.client
			.from('payments')
			.select('status')
			.eq('settlement_id', settlementId);
		expect(paid?.every((payment) => payment.status === 'confirmed')).toBe(true);
		const statuses = async (sale: typeof advance) =>
			(
				await users.admin.client
					.from('installments')
					.select('status')
					.in(
						'id',
						sale.installments.map((i) => i.id)
					)
			).data?.map((i) => i.status);
		expect(await statuses(advance)).toContain('paid_advance');
		expect(await statuses(overdue)).toContain('paid_advance');
		expect(await statuses(fullyPaid)).toEqual(['paid']);
		expect(await statuses(split)).toEqual(['paid']);
		const snapshots = async (bondId: string) =>
			(
				await users.admin.client
					.from('bonds')
					.select('financial_status_snapshot')
					.eq('id', bondId)
					.single()
			).data?.financial_status_snapshot;
		expect(await snapshots(advance.bondId)).toBe('partial_payments');
		expect(await snapshots(overdue.bondId)).toBe('overdue');
		expect(await snapshots(fullyPaid.bondId)).toBe('fully_paid');
		expect(await snapshots(split.bondId)).toBe('fully_paid');
		expect(
			(await auditFor(closeRequest)).filter((row) => row.action === 'settlement.close')
		).toHaveLength(1);
		for (const requestId of addRequests)
			expect(
				(await auditFor(requestId)).filter((row) => row.action === 'payment.add')
			).toHaveLength(1);
		const emptyId = await openSettlement(
			users.treasurer.client,
			{ campaignId, collectorId },
			ctx(users.treasurer)
		);
		await expect(
			closeSettlement(users.treasurer.client, { settlementId: emptyId }, ctx(users.treasurer))
		).rejects.toMatchObject({ kind: 'conflict' satisfies SettlementServiceError['kind'] });
		expect(
			(await users.admin.client.from('settlements').select('status').eq('id', emptyId).single())
				.data?.status
		).toBe('open');
	});

	it('C3 rejects every mutation of a closed settlement, including direct authenticated UPDATE', async () => {
		const { data: closed } = await users.admin.client
			.from('settlements')
			.select('id')
			.eq('status', 'closed')
			.eq('campaign_id', campaignId)
			.limit(1)
			.single();
		const settlementId = closed!.id;
		await expect(
			closeSettlement(users.treasurer.client, { settlementId }, ctx(users.treasurer))
		).rejects.toMatchObject({ kind: 'conflict' });
		const { data: payment } = await users.admin.client
			.from('payments')
			.select('id')
			.eq('settlement_id', settlementId)
			.limit(1)
			.single();
		await expect(
			removePaymentFromSettlement(
				users.operator.client,
				{ paymentId: payment!.id, reason: 'Too late' },
				ctx(users.operator)
			)
		).rejects.toMatchObject({ kind: 'conflict' });
		const direct = await users.treasurer.client
			.from('settlements')
			.update({ notes: 'forbidden' })
			.eq('id', settlementId);
		expect(direct.error).not.toBeNull();
	});

	it('C4 enforces role permissions and collector own-settlement visibility', async () => {
		const openId = await openSettlement(
			users.operator.client,
			{ campaignId, collectorId },
			ctx(users.operator)
		);
		await expect(
			openSettlement(
				users['read-only'].client,
				{ campaignId, collectorId },
				ctx(users['read-only'])
			)
		).rejects.toMatchObject({ kind: 'permission' });
		await expect(
			closeSettlement(users.operator.client, { settlementId: openId }, ctx(users.operator))
		).rejects.toMatchObject({ kind: 'permission' });
		await expect(
			removePaymentFromSettlement(
				users.treasurer.client,
				{ paymentId: randomUUID(), reason: 'No permission first' },
				ctx(users.treasurer)
			)
		).rejects.toMatchObject({ kind: 'permission' });
		const own = await users.collector.client.from('settlements').select('id').eq('id', openId);
		expect(own.error).toBeNull();
		expect(own.data?.map((row) => row.id)).toEqual([openId]);
		const foreignId = await openSettlement(
			users.admin.client,
			{ campaignId, collectorId: otherCollectorId },
			ctx(users.admin)
		);
		const foreign = await users.collector.client
			.from('settlements')
			.select('id')
			.eq('id', foreignId);
		expect(foreign.error).toBeNull();
		expect(foreign.data).toEqual([]);
		await expect(totals(users.collector, foreignId)).rejects.toThrow();
	});

	it.todo('C5 printable settlement documents and UI are verified in SAN-64/65 (Part 2)');
});
