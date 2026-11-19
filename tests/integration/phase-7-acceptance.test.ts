import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import {
	actions as saleActions,
	load as saleNewLoad
} from '../../src/routes/campaigns/[id]/sales/new/+page.server';
import { load as saleLoad } from '../../src/routes/campaigns/[id]/sales/[saleId]/+page.server';
import { load as salesLoad } from '../../src/routes/campaigns/[id]/sales/+page.server';
import { actions as bondActions } from '../../src/routes/campaigns/[id]/bonds/[bondId]/+page.server';
import { createBuyer, createCollector } from '$lib/server/services/parties';
import { calculateFinancialStatus } from '$lib/domain/financial-status';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';
import type { UserProfile } from '../../src/app';

const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seed = resolveSeedConfig(seedEnv);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
let sequence = 0;
const rid = (label: string) => `it-p7-${RUN_ID}-${String(++sequence).padStart(3, '0')}-${label}`;
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
const addMonths = (date: string, months: number) => {
	const [year, month, day] = date.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1 + months, day)).toISOString().slice(0, 10);
};

type Role = 'admin' | 'operator' | 'treasurer' | 'read-only';
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
let buyerId: string;
const bonds: Record<string, string> = {};

async function signIn(role: Role, email: string, password: string) {
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

function event(
	caller: Caller,
	path: string,
	params: Record<string, string>,
	fields?: Record<string, string>,
	requestId = rid('request')
): never {
	const url = new URL(`http://localhost${path}`);
	const body = new FormData();
	for (const [key, value] of Object.entries(fields ?? {})) body.set(key, value);
	return {
		locals: {
			supabase: caller.client,
			safeGetSession: async () => ({ session: null, user: caller.user }),
			session: null,
			user: caller.user,
			profile: caller.profile,
			permissions: caller.permissions,
			requestId
		},
		params,
		url,
		request: new Request(url, fields ? { method: 'POST', body } : undefined)
	} as never;
}

async function run(fn: (e: never) => unknown, e: never) {
	try {
		return await fn(e);
	} catch (error) {
		if (isRedirect(error)) return { redirect: error.location, status: error.status };
		if (isHttpError(error)) return { status: error.status };
		throw error;
	}
}
const salePath = () => `/campaigns/${campaignId}/sales/new`;
const sell = (
	caller: Caller,
	bondId: string,
	paymentMode: 'full_payment' | 'installments',
	firstDueDate = baDate(1),
	requestId = rid('sale')
) =>
	run(
		saleActions.register as (e: never) => unknown,
		event(
			caller,
			`${salePath()}?/register`,
			{ id: campaignId },
			{ bondId, buyerId, paymentMode, firstDueDate },
			requestId
		)
	);
async function auditFor(requestId: string) {
	const { data, error } = await service
		.from('audit_log')
		.select('action, entity_type, entity_id, request_id')
		.eq('request_id', requestId);
	expect(error).toBeNull();
	return data ?? [];
}
const saleId = (result: unknown) =>
	/\/sales\/([0-9a-f-]{36})$/.exec(String((result as { redirect?: string }).redirect))?.[1];

beforeAll(async () => {
	service = createClient(supabaseUrl, serviceRoleKey, options);
	users.admin = await signIn('admin', seed.admin.email, seed.admin.password);
	for (const role of ['operator', 'treasurer', 'read-only'] as const) {
		const fixture = seed.fixtures.find((item) => item.roleNames.includes(role))!;
		users[role] = await signIn(role, fixture.email, fixture.password);
	}
	const createCampaign = async (name: string) => {
		const result = await users.admin.client.rpc('campaign_create', {
			p_name: `[it-p7 ${RUN_ID}] ${name}`,
			p_simple_bond_value: '60000.00',
			p_installment_count: 10,
			p_number_digits: 4,
			p_max_number: 9999,
			p_associated_number_offset: 4871,
			p_overflow_policy: 'reject',
			p_barcode_mode: 'base_number',
			p_starts_at: `${baDate(-1)}T03:00:00Z`,
			p_ends_at: `${baDate(365)}T03:00:00Z`,
			p_request_id: rid(`campaign-${name}`)
		});
		if (result.error || typeof result.data !== 'string') throw new Error(result.error?.message);
		return result.data;
	};
	campaignId = await createCampaign('active');
	const transition = await users.admin.client.rpc('campaign_transition', {
		p_id: campaignId,
		p_to_status: 'active',
		p_request_id: rid('activate')
	});
	if (transition.error) throw new Error(transition.error.message);
	collectorId = await createCollector(
		users.admin.client,
		{
			displayName: `Collector ${RUN_ID}`,
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
		{ requestId: rid('buyer'), permissions: users.admin.permissions }
	);
	for (const [key, numbers] of Object.entries({
		simple: [101],
		pata: [102, 103],
		financial: [104],
		sold: [105],
		available: [106],
		lost: [107],
		annulled: [108],
		custody: [109],
		planPata: [110, 111],
		full: [112]
	})) {
		const result = await users.admin.client.rpc('bond_create', {
			p_campaign_id: campaignId,
			p_base_numbers: numbers,
			p_request_id: rid(`bond-${key}`)
		});
		if (result.error || typeof result.data !== 'string') throw new Error(result.error?.message);
		bonds[key] = result.data;
	}
	const delivered = await users.admin.client.rpc('bond_deliver', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId,
		p_bond_ids: [
			bonds.simple,
			bonds.pata,
			bonds.financial,
			bonds.sold,
			bonds.custody,
			bonds.planPata,
			bonds.full
		],
		p_notes: null,
		p_request_id: rid('deliver')
	});
	if (delivered.error) throw new Error(delivered.error.message);
	for (const [key, rpc] of [
		['lost', 'bond_mark_lost'],
		['annulled', 'bond_annul']
	] as const) {
		const result =
			key === 'lost'
				? await users.admin.client.rpc(rpc, {
						p_campaign_id: campaignId,
						p_bond_id: bonds[key],
						p_responsible_party: 'Test',
						p_lost_on: baDate(),
						p_reason: 'Acceptance rejection',
						p_request_id: rid(key)
					})
				: await users.admin.client.rpc(rpc, {
						p_bond_id: bonds[key],
						p_reason: 'Acceptance rejection',
						p_request_id: rid(key)
					});
		if (result.error) throw new Error(result.error.message);
	}
});

describe('Phase 7: sales, payment plans and installments', () => {
	it('C1 sells a delivered simple bond and a delivered pata through /sales/new?/register with audit evidence', async () => {
		for (const [bondId, mode] of [
			[bonds.simple, 'full_payment'],
			[bonds.pata, 'installments'],
			[bonds.sold, 'full_payment']
		] as const) {
			const requestId = rid(`c1-${mode}`);
			const result = await sell(users.operator, bondId, mode, baDate(1), requestId);
			expect(saleId(result)).toBeDefined();
			const { data: bond } = await service
				.from('bonds')
				.select('commercial_status, current_buyer_id, current_collector_id')
				.eq('id', bondId)
				.single();
			expect(bond).toMatchObject({
				commercial_status: 'sold',
				current_buyer_id: buyerId,
				current_collector_id: collectorId
			});
			const { data: row } = await service
				.from('sales')
				.select('buyer_id, collector_id, total_amount')
				.eq('bond_id', bondId)
				.single();
			expect(row).toMatchObject({
				buyer_id: buyerId,
				collector_id: collectorId,
				total_amount: mode === 'installments' ? 120000 : 60000
			});
			expect(
				(await auditFor(requestId)).map((item) => `${item.action}:${item.entity_type}`)
			).toEqual(expect.arrayContaining(['sale.create:sale', 'sale.create:bond']));
		}
	});

	it('C2 creates exact monthly installment plans and protects their number uniqueness', async () => {
		const result = await sell(users.operator, bonds.planPata, 'installments', baDate(1));
		const id = saleId(result)!;
		const { data: plan } = await service
			.from('payment_plans')
			.select('*')
			.eq('sale_id', id)
			.single();
		const { data: installments } = await service
			.from('installments')
			.select('*')
			.eq('payment_plan_id', plan!.id)
			.order('installment_number');
		expect(installments).toHaveLength(10);
		expect(installments!.map((item) => item.installment_number)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10
		]);
		expect(installments!.map((item) => item.due_date)).toEqual(
			Array.from({ length: 10 }, (_, i) => addMonths(baDate(1), i))
		);
		expect(installments!.map((item) => Number(item.amount))).toEqual(Array(10).fill(12000));
		expect(installments!.reduce((sum, item) => sum + Number(item.amount), 0)).toBe(120000);
		expect(
			(
				await service.from('installments').insert({
					payment_plan_id: plan!.id,
					installment_number: 1,
					due_date: baDate(),
					amount: '1.00'
				})
			).error?.code
		).toBe('23505');
		const fullSale = await sell(users.operator, bonds.full, 'full_payment');
		const full = await service
			.from('payment_plans')
			.select('id')
			.eq('sale_id', saleId(fullSale)!)
			.single();
		expect(
			(
				await service
					.from('installments')
					.select('installment_number, due_date')
					.eq('payment_plan_id', full.data!.id)
			).data
		).toEqual([{ installment_number: 1, due_date: baDate() }]);
	});

	it('C3 keeps commercial and financial status independent and exposes the stored snapshot', async () => {
		const registered = await sell(users.operator, bonds.financial, 'installments', baDate(-31));
		const sale = { id: saleId(registered)! };
		const detail = (await saleLoad(
			event(users['read-only'], `/campaigns/${campaignId}/sales/${sale!.id}`, {
				id: campaignId,
				saleId: sale!.id
			})
		)) as {
			financialStatusSnapshot: string;
			sale: {
				installments: {
					installmentNumber: number;
					dueDate: string;
					amount: string;
					status: 'pending';
				}[];
			};
		};
		expect(detail.financialStatusSnapshot).toBe('no_payments');
		expect(
			calculateFinancialStatus({
				saleStatus: 'active',
				planStatus: 'active',
				markedUncollectible: false,
				today: baDate(),
				installments: [
					{
						number: 1,
						dueDate: baDate(-31),
						amount: '1.00',
						appliedAmount: '0.00',
						status: 'pending'
					}
				]
			})
		).toBe('overdue');
		expect(
			(await service.from('bonds').select('commercial_status').eq('id', bonds.financial).single())
				.data?.commercial_status
		).toBe('sold');
	});

	it('C4 refuses unsellable bonds and a campaign that is no longer active, without writes', async () => {
		for (const bondId of [bonds.available, bonds.lost, bonds.annulled, bonds.sold]) {
			const requestId = rid('c4');
			// Counted for this bond only: other suites may insert sales concurrently.
			const salesOf = async () =>
				(
					await service
						.from('sales')
						.select('id', { count: 'exact', head: true })
						.eq('bond_id', bondId)
				).count;
			const before = await salesOf();
			expect(
				await sell(users.operator, bondId, 'full_payment', baDate(), requestId),
				bondId
			).toMatchObject({ status: 409, data: { errors: { bondId: [expect.any(String)] } } });
			expect(await salesOf()).toBe(before);
			expect(await auditFor(requestId)).toEqual([]);
		}
		// A campaign that is no longer active: a bond delivered while it was active cannot be sold
		// once it moved to closing (a draft campaign cannot even hold a delivered bond).
		const closing = await users.admin.client.rpc('campaign_create', {
			p_name: `[it-p7 ${RUN_ID}] closing`,
			p_simple_bond_value: '60000.00',
			p_installment_count: 10,
			p_number_digits: 4,
			p_max_number: 9999,
			p_associated_number_offset: 4871,
			p_overflow_policy: 'reject',
			p_barcode_mode: 'base_number',
			p_starts_at: `${baDate(-1)}T03:00:00Z`,
			p_ends_at: `${baDate(365)}T03:00:00Z`,
			p_request_id: rid('campaign-closing')
		});
		if (closing.error) throw new Error(closing.error.message);
		const closingId = closing.data as string;
		const toStatus = async (status: string) => {
			const t = await users.admin.client.rpc('campaign_transition', {
				p_id: closingId,
				p_to_status: status,
				p_request_id: rid(`closing-${status}`)
			});
			if (t.error) throw new Error(t.error.message);
		};
		await toStatus('active');
		const created = await users.admin.client.rpc('bond_create', {
			p_campaign_id: closingId,
			p_base_numbers: [900],
			p_request_id: rid('closing-bond')
		});
		if (created.error) throw new Error(created.error.message);
		const closingBond = created.data as string;
		const delivered = await users.admin.client.rpc('bond_deliver', {
			p_campaign_id: closingId,
			p_collector_id: collectorId,
			p_bond_ids: [closingBond],
			p_notes: null,
			p_request_id: rid('closing-deliver')
		});
		if (delivered.error) throw new Error(delivered.error.message);
		await toStatus('closing');
		const closingRequest = rid('closing-sale');
		const result = await run(
			saleActions.register as (e: never) => unknown,
			event(
				users.operator,
				`/campaigns/${closingId}/sales/new?/register`,
				{ id: closingId },
				{ bondId: closingBond, buyerId, paymentMode: 'full_payment', firstDueDate: baDate() },
				closingRequest
			)
		);
		expect(result).toMatchObject({
			status: 409,
			data: { errors: { campaignId: [expect.any(String)] } }
		});
		expect(
			(
				await service
					.from('sales')
					.select('id', { count: 'exact', head: true })
					.eq('bond_id', closingBond)
			).count
		).toBe(0);
		expect(await auditFor(closingRequest)).toEqual([]);
	});

	it('C5 refuses return, reassignment, and loss after sale with no audit side effects', async () => {
		for (const [action, fields] of [
			['return', { fromCollectorId: collectorId, notes: '' }],
			['reassign', { fromCollectorId: collectorId, collectorId, notes: '' }],
			['markLost', { responsibleParty: 'Test', lostOn: baDate(), reason: 'No' }]
		] as const) {
			const requestId = rid(`c5-${action}`);
			const result = await run(
				bondActions[action] as (e: never) => unknown,
				event(
					users.admin,
					`/campaigns/${campaignId}/bonds/${bonds.sold}?/${action}`,
					{ id: campaignId, bondId: bonds.sold },
					fields,
					requestId
				)
			);
			expect(result).toMatchObject({ status: 409 });
			expect(await auditFor(requestId)).toEqual([]);
		}
		expect(
			(
				await service
					.from('bonds')
					.select('commercial_status, current_collector_id')
					.eq('id', bonds.sold)
					.single()
			).data
		).toMatchObject({ commercial_status: 'sold', current_collector_id: collectorId });
	});

	it('C6 allows operator/admin sales but limits registration and preserves read-only list/detail visibility', async () => {
		expect(await saleNewLoad(event(users.admin, salePath(), { id: campaignId }))).toMatchObject({
			campaign: { id: campaignId },
			canCreateBuyer: true
		});
		for (const caller of [users.treasurer, users['read-only']]) {
			expect(
				await run(
					saleNewLoad as (e: never) => unknown,
					event(caller, salePath(), { id: campaignId })
				)
			).toMatchObject({ status: 403 });
			expect(await sell(caller, bonds.custody, 'full_payment')).toMatchObject({ status: 403 });
		}
		const list = (await salesLoad(
			event(users['read-only'], `/campaigns/${campaignId}/sales`, { id: campaignId })
		)) as { sales: { bondId: string }[] };
		expect(list.sales.map((item) => item.bondId)).toContain(bonds.simple);
	});
});
