import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { createBuyer, createCollector } from '$lib/server/services/parties';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';
import { load as auditLoad } from '../../src/routes/campaigns/[id]/audit/+page.server';
import { isHttpError } from '@sveltejs/kit';

/** Phase 10 (SAN-74) acceptance: corrections are exercised through real authenticated users. */
const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seed = resolveSeedConfig(seedEnv);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
let sequence = 0;
const rid = (label: string) => `it-p10-${RUN_ID}-${String(++sequence).padStart(3, '0')}-${label}`;
const baDate = (days = 0) => {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Argentina/Buenos_Aires'
	}).formatToParts(new Date());
	const p = Object.fromEntries(
		parts.filter((x) => x.type !== 'literal').map((x) => [x.type, x.value])
	);
	return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + days))
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
let campaignId: string,
	collectorA: string,
	collectorB: string,
	buyerA: string,
	buyerB: string,
	settlementId: string;
let nextBase = 4000;
const sales: Record<string, { saleId: string; bondId: string; installmentId: string }> = {};
const payments: Record<string, string> = {};

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
const codeOf = (promise: Promise<unknown>) =>
	promise.then(
		() => 'ok',
		(e: { code?: string }) => e.code
	);
const balance = (collectorId: string) =>
	rpc<string>(users.admin, 'collector_ledger_balance', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId
	}).then(Number);

async function ledger(where: Record<string, string>) {
	let query = users.admin.client
		.from('collector_ledger_entries')
		.select('id, payment_id, corrects_sale_id, entry_type, direction, amount, reason')
		.eq('campaign_id', campaignId);
	for (const [key, value] of Object.entries(where)) query = query.eq(key, value);
	const { data, error } = await query.order('id');
	if (error) throw new Error(error.message);
	return (data ?? []).map((row) => ({ ...row, amount: Number(row.amount) }));
}
async function sale(label: string, collectorId = collectorA) {
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
		p_buyer_id: buyerA,
		p_payment_mode: 'installments',
		p_first_due_date: baDate(-1),
		p_request_id: rid(`sale-${label}`)
	});
	const { data, error } = await users.admin.client
		.from('installments')
		.select('id, payment_plans!inner(sale_id)')
		.eq('payment_plans.sale_id', saleId)
		.order('installment_number')
		.limit(1)
		.single();
	if (error || !data) throw new Error(error?.message ?? 'Missing installment');
	sales[label] = { saleId, bondId, installmentId: data.id };
}
async function pay(label: string, method: 'cash' | 'transfer', paymentDate = baDate()) {
	payments[label] = await rpc<string>(users.admin, 'settlement_add_payment', {
		p_settlement_id: settlementId,
		p_sale_id: sales[label].saleId,
		p_amount: 100,
		p_payment_method: method,
		p_payment_date: paymentDate,
		p_applications: [{ installment_id: sales[label].installmentId, amount_applied: 100 }],
		p_request_id: rid(`pay-${label}`)
	});
}
async function audit(requestId: string) {
	const { data, error } = await service
		.from('audit_log')
		.select('action, entity_id, actor_user_id, reason, new_value')
		.eq('request_id', requestId);
	if (error) throw new Error(error.message);
	return data ?? [];
}
async function expectCorrectionAudit(
	requestId: string,
	action: string,
	affectedId: string,
	related: { type: string; id: string },
	reason: string,
	movementIds: string[]
) {
	const rows = await audit(requestId);
	expect(rows).toHaveLength(1);
	const row = rows[0];
	const value = row.new_value as Record<string, unknown>;
	expect(row.action).toBe(action);
	expect(row.entity_id).toBe(affectedId);
	expect(row.reason).toBe(reason);
	expect(Object.keys(value).sort()).toEqual([
		'affected_entity',
		'correction_type',
		'date',
		'generated_compensatory_movements',
		'new_value',
		'previous_value',
		'reason',
		'related_entity',
		'user'
	]);
	expect(value.correction_type).toBe(action.split('.').at(-1));
	expect(value.affected_entity).toEqual({
		type: action.startsWith('settlement')
			? 'settlement'
			: action.startsWith('sale')
				? 'sale'
				: 'payment',
		id: affectedId
	});
	expect(value.related_entity).toEqual(related);
	expect(value.reason).toBe(reason);
	expect(value.user).toBe(row.actor_user_id);
	expect(typeof value.date).toBe('string');
	expect(value.previous_value).toBeTruthy();
	expect(value.new_value).toBeTruthy();
	expect([...(value.generated_compensatory_movements as string[])].sort()).toEqual(
		[...movementIds].sort()
	);
	if (movementIds.length) {
		const { data, error } = await users.admin.client
			.from('collector_ledger_entries')
			.select('id')
			.in('id', movementIds);
		if (error) throw new Error(error.message);
		expect((data ?? []).map((x) => x.id).sort()).toEqual([...movementIds].sort());
	}
}

beforeAll(async () => {
	service = createClient(supabaseUrl, serviceRoleKey, options);
	users.admin = await signIn('admin', seed.admin.email, seed.admin.password);
	const readOnly = seed.fixtures.find((f) => f.roleNames.includes('read-only'))!;
	users['read-only'] = await signIn('read-only', readOnly.email, readOnly.password);
	campaignId = await rpc<string>(users.admin, 'campaign_create', {
		p_name: `[it-p10 ${RUN_ID}] corrections`,
		p_simple_bond_value: '200.00',
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
	buyerA = await createBuyer(
		users.admin.client,
		{
			type: 'individual',
			firstName: 'Buyer',
			lastName: `A ${RUN_ID}`,
			businessName: null,
			documentNumber: `A-${RUN_ID}`,
			taxId: null,
			phone: null,
			address: null,
			usualCollectorId: null,
			notes: null
		},
		{ ...ctx, requestId: rid('buyer-a') }
	);
	buyerB = await createBuyer(
		users.admin.client,
		{
			type: 'individual',
			firstName: 'Buyer',
			lastName: `B ${RUN_ID}`,
			businessName: null,
			documentNumber: `B-${RUN_ID}`,
			taxId: null,
			phone: null,
			address: null,
			usualCollectorId: null,
			notes: null
		},
		{ ...ctx, requestId: rid('buyer-b') }
	);
	await rpc(users.admin, 'commission_rule_create', {
		p_campaign_id: campaignId,
		p_rule_type: 'installment_first',
		p_installment_number: null,
		p_percentage: '10',
		p_fixed_amount: null,
		p_valid_from: baDate(-10),
		p_valid_to: null,
		p_request_id: rid('rule-a')
	});
	await rpc(users.admin, 'commission_rule_create', {
		p_campaign_id: campaignId,
		p_rule_type: 'installment_first',
		p_installment_number: null,
		p_percentage: '20',
		p_fixed_amount: null,
		p_valid_from: baDate(-10),
		p_valid_to: null,
		p_reason: null,
		p_applies_to_collector_id: collectorB,
		p_request_id: rid('rule-b')
	});
	for (const label of [
		'cash-annul',
		'transfer-annul',
		'cash-to-transfer',
		'transfer-to-cash',
		'reassociate-old',
		'reassociate-new',
		'move-collector',
		'buyer'
	])
		await sale(label);
	settlementId = await rpc<string>(users.admin, 'settlement_open', {
		p_campaign_id: campaignId,
		p_collector_id: collectorA,
		p_request_id: rid('open')
	});
	await pay('cash-annul', 'cash');
	await pay('transfer-annul', 'transfer');
	await pay('cash-to-transfer', 'cash');
	await pay('transfer-to-cash', 'transfer');
	await pay('reassociate-old', 'transfer');
	await pay('move-collector', 'cash');
	await pay('buyer', 'transfer');
	await rpc(users.admin, 'settlement_close', {
		p_settlement_id: settlementId,
		p_request_id: rid('close')
	});
}, 120_000);

describe('Phase 10: audited corrections and closed settlement immutability', () => {
	it('C1 closed settlements reject direct mutation, add/remove and repeat close; correction is linked and terminal', async () => {
		const { data: before, error } = await users.admin.client
			.from('settlements')
			.select('*')
			.eq('id', settlementId)
			.single();
		if (error || !before) throw new Error(error?.message);
		expect(
			await codeOf(
				rpc(users.admin, 'settlement_close', {
					p_settlement_id: settlementId,
					p_request_id: rid('reclose')
				})
			)
		).toBe('55000');
		expect(
			await codeOf(
				rpc(users.admin, 'settlement_add_payment', {
					p_settlement_id: settlementId,
					p_sale_id: sales['reassociate-new'].saleId,
					p_amount: 100,
					p_payment_method: 'cash',
					p_payment_date: baDate(),
					p_applications: [
						{ installment_id: sales['reassociate-new'].installmentId, amount_applied: 100 }
					],
					p_request_id: rid('add-closed')
				})
			)
		).toBe('55000');
		expect(
			await codeOf(
				rpc(users.admin, 'settlement_remove_payment', {
					p_payment_id: payments.buyer,
					p_reason: 'not open',
					p_request_id: rid('remove-closed')
				})
			)
		).toBe('55000');
		const { error: dmlError } = await users.admin.client
			.from('settlements')
			.update({ status: 'open' })
			.eq('id', settlementId);
		expect(dmlError?.code).toBe('42501');
		const requestId = rid('settlement-correct');
		await rpc(users.admin, 'settlement_correct', {
			p_settlement_id: settlementId,
			p_reason: '  recorded commission difference  ',
			p_adjustments: { commission_delta: 5, cash_retained_delta: -2 },
			p_request_id: requestId
		});
		const { data: after } = await users.admin.client
			.from('settlements')
			.select('*')
			.eq('id', settlementId)
			.single();
		expect({ ...after, status: before.status, updated_at: before.updated_at }).toEqual(before);
		expect(after?.status).toBe('corrected');
		const { data: correction } = await users.admin.client
			.from('settlement_corrections')
			.select('id, settlement_id, commission_delta, cash_retained_delta, reason')
			.eq('settlement_id', settlementId)
			.single();
		expect(correction).toMatchObject({
			settlement_id: settlementId,
			commission_delta: 5,
			cash_retained_delta: -2,
			reason: 'recorded commission difference'
		});
		const movements = await ledger({ settlement_id: settlementId });
		const compensation = movements.filter(
			(x) => x.entry_type === 'annulment' && x.reason === 'recorded commission difference'
		);
		expect(compensation.map((x) => [x.direction, x.amount]).sort()).toEqual([
			['collector_credit', 2],
			['collector_credit', 5]
		]);
		await expectCorrectionAudit(
			requestId,
			'settlement.correct',
			settlementId,
			{ type: 'settlement_correction', id: correction!.id },
			'recorded commission difference',
			compensation.map((x) => x.id)
		);
		expect(
			await codeOf(
				rpc(users.admin, 'settlement_correct', {
					p_settlement_id: settlementId,
					p_reason: 'again',
					p_adjustments: { commission_delta: 1, cash_retained_delta: 0 },
					p_request_id: rid('settlement-again')
				})
			)
		).toBe('55000');
	});

	it('C2 annulment reverses closed cash/transfer coverage and exact commission effects without touching settlement', async () => {
		const { data: before } = await users.admin.client
			.from('settlements')
			.select('*')
			.eq('id', settlementId)
			.single();
		const cashRequest = rid('cash-annul');
		await rpc(users.admin, 'payment_annul', {
			p_payment_id: payments['cash-annul'],
			p_reason: ' cash entered twice ',
			p_request_id: cashRequest
		});
		expect(
			await ledger({ payment_id: payments['cash-annul'] }).then((r) =>
				r.map((x) => [x.entry_type, x.direction, x.amount]).sort()
			)
		).toEqual([
			['annulment', 'collector_credit', 10],
			['annulment', 'collector_debit', 10]
		]);
		expect(
			(
				await users.admin.client
					.from('installments')
					.select('status')
					.eq('id', sales['cash-annul'].installmentId)
					.single()
			).data?.status
		).toBe('overdue');
		expect(
			(
				await service
					.from('bonds')
					.select('financial_status_snapshot')
					.eq('id', sales['cash-annul'].bondId)
					.single()
			).data?.financial_status_snapshot
		).toBe('no_payments');
		await expectCorrectionAudit(
			cashRequest,
			'payment.annul',
			payments['cash-annul'],
			{ type: 'settlement', id: settlementId },
			'cash entered twice',
			(await ledger({ payment_id: payments['cash-annul'] })).map((x) => x.id)
		);
		const transferRequest = rid('transfer-annul');
		await rpc(users.admin, 'payment_annul', {
			p_payment_id: payments['transfer-annul'],
			p_reason: 'transfer rejected',
			p_request_id: transferRequest
		});
		expect(
			await ledger({ payment_id: payments['transfer-annul'] }).then((r) =>
				r.map((x) => [x.entry_type, x.direction, x.amount])
			)
		).toEqual([['annulment', 'collector_debit', 10]]);
		await expectCorrectionAudit(
			transferRequest,
			'payment.annul',
			payments['transfer-annul'],
			{ type: 'settlement', id: settlementId },
			'transfer rejected',
			(await ledger({ payment_id: payments['transfer-annul'] })).map((x) => x.id)
		);
		expect(
			(
				await users.admin.client
					.from('installments')
					.select('status')
					.eq('id', sales['transfer-annul'].installmentId)
					.single()
			).data?.status
		).toBe('overdue');
		expect(
			(await users.admin.client.from('settlements').select('*').eq('id', settlementId).single())
				.data
		).toEqual(before);
		expect(await balance(collectorA)).toBe(37);
	});

	it('C3 method/reassociation and sale buyer/collector corrections retain history and compensate both collectors', async () => {
		const c2tRequest = rid('c2t');
		const c2t = await rpc<string>(users.admin, 'payment_correct_method', {
			p_payment_id: payments['cash-to-transfer'],
			p_new_method: 'transfer',
			p_reason: 'cash should be transfer',
			p_request_id: c2tRequest
		});
		expect(
			(
				await users.admin.client
					.from('payments')
					.select('status')
					.eq('id', payments['cash-to-transfer'])
					.single()
			).data?.status
		).toBe('adjusted');
		expect(
			(
				await users.admin.client
					.from('payments')
					.select('status, payment_method, replaces_payment_id')
					.eq('id', c2t)
					.single()
			).data
		).toMatchObject({
			status: 'confirmed',
			payment_method: 'transfer',
			replaces_payment_id: payments['cash-to-transfer']
		});
		expect(
			await ledger({ payment_id: payments['cash-to-transfer'] }).then((r) =>
				r.map((x) => [x.direction, x.amount])
			)
		).toEqual([['collector_credit', 10]]);
		await expectCorrectionAudit(
			c2tRequest,
			'payment.correct_method',
			payments['cash-to-transfer'],
			{ type: 'payment', id: c2t },
			'cash should be transfer',
			(await ledger({ payment_id: payments['cash-to-transfer'] })).map((x) => x.id)
		);
		const t2cRequest = rid('t2c');
		const t2c = await rpc<string>(users.admin, 'payment_correct_method', {
			p_payment_id: payments['transfer-to-cash'],
			p_new_method: 'cash',
			p_reason: 'transfer should be cash',
			p_request_id: t2cRequest
		});
		expect(
			await ledger({ payment_id: t2c }).then((r) => r.map((x) => [x.direction, x.amount]))
		).toEqual([['collector_debit', 10]]);
		await expectCorrectionAudit(
			t2cRequest,
			'payment.correct_method',
			payments['transfer-to-cash'],
			{ type: 'payment', id: t2c },
			'transfer should be cash',
			(await ledger({ payment_id: t2c })).map((x) => x.id)
		);
		const reassociateRequest = rid('reassociate');
		const reassociate = await rpc<string>(users.admin, 'payment_reassociate_transfer', {
			p_payment_id: payments['reassociate-old'],
			p_new_sale_id: sales['reassociate-new'].saleId,
			p_applications: [
				{ installment_id: sales['reassociate-new'].installmentId, amount_applied: 100 }
			],
			p_reason: 'wrong transfer sale',
			p_request_id: reassociateRequest
		});
		expect(
			(
				await users.admin.client
					.from('payments')
					.select('status')
					.eq('id', payments['reassociate-old'])
					.single()
			).data?.status
		).toBe('adjusted');
		expect(
			(
				await users.admin.client
					.from('payments')
					.select('sale_id, replaces_payment_id')
					.eq('id', reassociate)
					.single()
			).data
		).toMatchObject({
			sale_id: sales['reassociate-new'].saleId,
			replaces_payment_id: payments['reassociate-old']
		});
		expect(
			await ledger({ payment_id: payments['reassociate-old'] }).then((r) =>
				r.map((x) => [x.direction, x.amount])
			)
		).toEqual([['collector_debit', 10]]);
		expect(
			await ledger({ payment_id: reassociate }).then((r) => r.map((x) => [x.direction, x.amount]))
		).toEqual([['collector_credit', 10]]);
		await expectCorrectionAudit(
			reassociateRequest,
			'payment.reassociate_transfer',
			payments['reassociate-old'],
			{ type: 'payment', id: reassociate },
			'wrong transfer sale',
			[
				...(await ledger({ payment_id: payments['reassociate-old'] })),
				...(await ledger({ payment_id: reassociate }))
			].map((x) => x.id)
		);
		const buyerRequest = rid('buyer');
		await rpc(users.admin, 'sale_correct_buyer', {
			p_sale_id: sales.buyer.saleId,
			p_new_buyer_id: buyerB,
			p_reason: 'wrong buyer',
			p_request_id: buyerRequest
		});
		const buyerAudit = (await audit(buyerRequest))[0].new_value as {
			previous_value: { buyer: { id: string } };
			new_value: { buyer: { id: string } };
		};
		expect(buyerAudit.previous_value.buyer.id).toBe(buyerA);
		expect(buyerAudit.new_value.buyer.id).toBe(buyerB);
		await expectCorrectionAudit(
			buyerRequest,
			'sale.correct_buyer',
			sales.buyer.saleId,
			{ type: 'bond', id: sales.buyer.bondId },
			'wrong buyer',
			[]
		);
		const moveRequest = rid('collector');
		await rpc(users.admin, 'sale_correct_collector', {
			p_sale_id: sales['move-collector'].saleId,
			p_new_collector_id: collectorB,
			p_reason: 'wrong collector',
			p_request_id: moveRequest
		});
		const moveRows = await ledger({ corrects_sale_id: sales['move-collector'].saleId });
		expect(moveRows.map((x) => [x.direction, x.amount, x.reason]).sort()).toEqual([
			['collector_credit', 10, 'wrong collector'],
			['collector_credit', 20, 'wrong collector'],
			['collector_debit', 10, 'wrong collector'],
			['collector_debit', 20, 'wrong collector']
		]);
		expect(await balance(collectorA)).toBe(37);
		expect(await balance(collectorB)).toBe(0);
		await expectCorrectionAudit(
			moveRequest,
			'sale.correct_collector',
			sales['move-collector'].saleId,
			{ type: 'bond', id: sales['move-collector'].bondId },
			'wrong collector',
			moveRows.map((x) => x.id)
		);
	});

	it('C4 read-only corrections fail 42501 with no audit and no state change', async () => {
		const requestId = rid('denied');
		const before = await users.admin.client
			.from('payments')
			.select('status')
			.eq('id', payments.buyer)
			.single();
		expect(
			await codeOf(
				rpc(users['read-only'], 'payment_annul', {
					p_payment_id: payments.buyer,
					p_reason: 'not permitted',
					p_request_id: requestId
				})
			)
		).toBe('42501');
		expect(await audit(requestId)).toHaveLength(0);
		expect(
			(await users.admin.client.from('payments').select('status').eq('id', payments.buyer).single())
				.data
		).toEqual(before.data);
	});

	it('C5 the campaign audit viewer lists the corrections and shows their 9 fields', async () => {
		const auditEvent = async (caller: Caller, query = '') => {
			const { data: profile } = await service
				.from('profiles')
				.select('*')
				.eq('auth_user_id', caller.user.id)
				.single();
			const url = new URL(`http://localhost/campaigns/${campaignId}/audit${query}`);
			return {
				locals: {
					supabase: caller.client,
					safeGetSession: async () => ({ session: null, user: caller.user }),
					session: null,
					user: caller.user,
					profile,
					permissions: caller.permissions,
					requestId: rid('audit-view')
				},
				params: { id: campaignId },
				url
			} as never;
		};
		const { data: rows } = await service
			.from('audit_log')
			.select('id, action')
			.like('request_id', `it-p10-${RUN_ID}-%`)
			.eq('action', 'payment.annul')
			.limit(1);
		const correction = rows?.[0];
		expect(correction).toBeTruthy();
		const listed = (await auditLoad(
			await auditEvent(users.admin, '?action=payment.annul')
		)) as Exclude<Awaited<ReturnType<typeof auditLoad>>, void>;
		expect(listed.entries.items.map((entry: { id: string }) => entry.id)).toContain(correction!.id);
		const detailed = (await auditLoad(
			await auditEvent(users.admin, `?detail=${correction!.id}`)
		)) as Exclude<Awaited<ReturnType<typeof auditLoad>>, void>;
		expect(
			Object.keys((detailed.detail?.newValue ?? {}) as Record<string, unknown>).sort()
		).toEqual([
			'affected_entity',
			'correction_type',
			'date',
			'generated_compensatory_movements',
			'new_value',
			'previous_value',
			'reason',
			'related_entity',
			'user'
		]);
		const denied = await Promise.resolve(auditLoad(await auditEvent(users['read-only']))).catch(
			(e: unknown) => e
		);
		expect(isHttpError(denied) ? denied.status : denied).toBe(403);
	});
});
