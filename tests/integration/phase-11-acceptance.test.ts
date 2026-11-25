import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { createBuyer, createCollector } from '$lib/server/services/parties';
import { annulDraw, createDraw, updateDraw } from '$lib/server/services/draws';
import { freezeDrawRoster, generateDrawRoster } from '$lib/server/services/draw-rosters';
import { load as rosterLoad } from '../../src/routes/campaigns/[id]/draws/[drawId]/roster/+page.server';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';

const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seed = resolveSeedConfig(seedEnv);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
let sequence = 0;
const rid = (label: string) => `it-p11-${RUN_ID}-${String(++sequence).padStart(3, '0')}-${label}`;
const baDate = (days = 0) => {
	const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
		.formatToParts(new Date())
		.filter((part) => part.type !== 'literal');
	const date = Object.fromEntries(parts.map((part) => [part.type, part.value]));
	return new Date(Date.UTC(Number(date.year), Number(date.month) - 1, Number(date.day) + days))
		.toISOString()
		.slice(0, 10);
};
const cutoffDay = baDate(-2);
const cutoff = `${cutoffDay}T23:59:59-03:00`;

interface Caller {
	user: User;
	client: SupabaseClient;
	permissions: string[];
}
interface Fixture {
	bondId: string;
	saleId: string;
	installments: { id: string; installment_number: number; amount: number }[];
	paymentIds: string[];
}
let admin: Caller;
let financialReader: SupabaseClient;
let readOnly: Caller;
let campaignId: string;
let collectorId: string;
let buyerId: string;
let nextBase = 100;
const fixtures = {} as Record<
	'monthly' | 'late' | 'full' | 'partial' | 'pending' | 'annulled' | 'pata',
	Fixture
>;

async function signIn(email: string, password: string): Promise<Caller> {
	const auth = createClient(supabaseUrl, anonKey, options);
	const { data, error } = await auth.auth.signInWithPassword({ email, password });
	if (error || !data.session) throw new Error(error?.message ?? 'Could not authenticate test user');
	const client = createClient(supabaseUrl, anonKey, {
		...options,
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
	return { user: data.user, client, permissions: await loadPermissions(client) };
}
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
	const { data, error } = await admin.client.rpc(name, args);
	if (error) throw Object.assign(new Error(error.message), { code: error.code });
	return data as T;
}
const codeOf = (promise: PromiseLike<unknown>) =>
	promise.then(
		() => 'ok',
		(error: { code?: string }) => error.code
	);
async function audit(requestId: string) {
	const { data, error } = await financialReader
		.from('audit_log')
		.select('id, action')
		.eq('request_id', requestId);
	if (error) throw new Error(error.message);
	return data ?? [];
}
async function drawRow(drawId: string) {
	const { data, error } = await admin.client.from('draws').select('*').eq('id', drawId).single();
	if (error) throw new Error(error.message);
	return data;
}
async function rosterRow(rosterId: string) {
	const { data, error } = await admin.client
		.from('draw_rosters')
		.select('*')
		.eq('id', rosterId)
		.single();
	if (error) throw new Error(error.message);
	return data;
}
async function rosterEntries(rosterId: string) {
	const { data, error } = await admin.client
		.from('draw_roster_entries')
		.select('*')
		.eq('draw_roster_id', rosterId)
		.order('number_value')
		.order('id')
		.range(0, 499);
	if (error) throw new Error(error.message);
	return data ?? [];
}
async function createSale(label: string, bases: number[]): Promise<Fixture> {
	const bondId = await rpc<string>('bond_create', {
		p_campaign_id: campaignId,
		p_base_numbers: bases,
		p_request_id: rid(`bond-${label}`)
	});
	await rpc('bond_deliver', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId,
		p_bond_ids: [bondId],
		p_notes: null,
		p_request_id: rid(`deliver-${label}`)
	});
	const saleId = await rpc<string>('sale_register', {
		p_campaign_id: campaignId,
		p_bond_id: bondId,
		p_buyer_id: buyerId,
		p_payment_mode: 'installments',
		p_first_due_date: cutoffDay,
		p_request_id: rid(`sale-${label}`)
	});
	const { data, error } = await admin.client
		.from('installments')
		.select('id, installment_number, amount, payment_plans!inner(sale_id)')
		.eq('payment_plans.sale_id', saleId)
		.order('installment_number')
		.order('id');
	if (error || !data) throw new Error(error?.message ?? 'Missing installments');
	return {
		bondId,
		saleId,
		installments: data.map((row) => ({ ...row, amount: Number(row.amount) })),
		paymentIds: []
	};
}
async function sale(label: keyof typeof fixtures, bases: number[]) {
	fixtures[label] = await createSale(label, bases);
}
async function payment(
	fixture: Fixture,
	installmentNumbers: number[],
	date: string,
	close = true,
	method: 'cash' | 'transfer' = 'cash'
) {
	const settlementId = await rpc<string>('settlement_open', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId,
		p_request_id: rid('open')
	});
	const applications = fixture.installments
		.filter((installment) => installmentNumbers.includes(installment.installment_number))
		.map((installment) => ({ installment_id: installment.id, amount_applied: installment.amount }));
	const paymentId = await rpc<string>('settlement_add_payment', {
		p_settlement_id: settlementId,
		p_sale_id: fixture.saleId,
		p_amount: applications.reduce((total, application) => total + application.amount_applied, 0),
		p_payment_method: method,
		p_payment_date: date,
		p_applications: applications,
		p_request_id: rid('payment')
	});
	fixture.paymentIds.push(paymentId);
	if (close)
		await rpc('settlement_close', { p_settlement_id: settlementId, p_request_id: rid('close') });
	return { settlementId, paymentId };
}
async function draw(
	type: 'monthly' | 'final' | 'extraordinary_full_payment' | 'consolation',
	requiredInstallmentNumber: number | null = type === 'monthly' ? 2 : null
) {
	return createDraw(
		admin.client,
		{
			campaignId,
			drawType: type,
			name: `${type} ${RUN_ID}`,
			drawDate: baDate(1),
			paymentCutoffAt: cutoff,
			requiredInstallmentNumber,
			eligibilityRule: {}
		},
		{ requestId: rid(`create-${type}`), permissions: admin.permissions }
	);
}

beforeAll(async () => {
	financialReader = createClient(supabaseUrl, serviceRoleKey, options);
	admin = await signIn(seed.admin.email, seed.admin.password);
	const readOnlyFixture = seed.fixtures.find((fixture) => fixture.roleNames.includes('read-only'));
	if (!readOnlyFixture) throw new Error('Missing seeded read-only fixture');
	readOnly = await signIn(readOnlyFixture.email, readOnlyFixture.password);
	campaignId = await rpc<string>('campaign_create', {
		p_name: `[it-p11 ${RUN_ID}] draw roster`,
		p_simple_bond_value: 100,
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
	await rpc('campaign_transition', {
		p_id: campaignId,
		p_to_status: 'active',
		p_request_id: rid('activate')
	});
	const context = { permissions: admin.permissions };
	collectorId = await createCollector(
		admin.client,
		{
			displayName: `Roster collector ${RUN_ID}`,
			phone: null,
			email: null,
			address: null,
			userProfileId: null,
			status: 'active'
		},
		{ ...context, requestId: rid('collector') }
	);
	buyerId = await createBuyer(
		admin.client,
		{
			type: 'business',
			firstName: null,
			lastName: null,
			businessName: `Roster buyer ${RUN_ID}`,
			documentNumber: null,
			taxId: `20-${RUN_ID.replace(/\D/g, '').slice(-10)}`,
			phone: null,
			address: null,
			usualCollectorId: null,
			notes: null
		},
		{ ...context, requestId: rid('buyer') }
	);
	for (const label of ['monthly', 'late', 'full', 'partial', 'pending', 'annulled'] as const)
		await sale(label, [nextBase++]);
	await sale('pata', [nextBase++, nextBase++]);
	await payment(fixtures.monthly, [1, 2], cutoffDay);
	await payment(fixtures.late, [1], cutoffDay);
	// baDate(-1) is the day after cutoffDay = baDate(-2), so it is recorded but not covered.
	await payment(fixtures.late, [2], baDate(-1));
	await payment(fixtures.full, [1, 2], cutoffDay);
	await payment(fixtures.partial, [1], cutoffDay);
	await payment(fixtures.pending, [1, 2], cutoffDay, false, 'transfer');
	const annulled = await payment(fixtures.annulled, [1, 2], cutoffDay);
	await rpc('payment_annul', {
		p_payment_id: annulled.paymentId,
		p_reason: 'phase 11 annulled coverage',
		p_request_id: rid('annul')
	});
	await payment(fixtures.pata, [1, 2], cutoffDay);
}, 120_000);

describe('Phase 11: draw roster generation and frozen roster immutability', () => {
	it('C1 evaluates monthly, final and extraordinary coverage by the Buenos Aires cutoff; consolation requires an installment and generates once enabled (SAN-81)', async () => {
		const monthly = await draw('monthly');
		const final = await draw('final');
		const extraordinary = await draw('extraordinary_full_payment');
		const monthlyRoster = await generateDrawRoster(
			admin.client,
			{ drawId: monthly },
			{ requestId: rid('monthly-generate'), permissions: admin.permissions }
		);
		const finalRoster = await generateDrawRoster(
			admin.client,
			{ drawId: final },
			{ requestId: rid('final-generate'), permissions: admin.permissions }
		);
		const extraordinaryRoster = await generateDrawRoster(
			admin.client,
			{ drawId: extraordinary },
			{ requestId: rid('extra-generate'), permissions: admin.permissions }
		);
		const eligibility = async (rosterId: string, fixture: Fixture) =>
			(await rosterEntries(rosterId))
				.filter((entry) => entry.bond_id === fixture.bondId)
				.map((entry) => ({
					eligible: entry.eligible,
					reason: entry.ineligibility_reason
				}));
		expect(await eligibility(monthlyRoster, fixtures.monthly)).toEqual([
			{ eligible: true, reason: null },
			{ eligible: true, reason: null }
		]);
		expect(await eligibility(monthlyRoster, fixtures.late)).toEqual([
			{ eligible: false, reason: 'installments_not_covered' },
			{ eligible: false, reason: 'installments_not_covered' }
		]);
		expect(await eligibility(finalRoster, fixtures.full)).toEqual([
			{ eligible: true, reason: null },
			{ eligible: true, reason: null }
		]);
		expect(await eligibility(finalRoster, fixtures.partial)).toEqual([
			{ eligible: false, reason: 'not_fully_paid' },
			{ eligible: false, reason: 'not_fully_paid' }
		]);
		expect(await eligibility(extraordinaryRoster, fixtures.pending)).toEqual([
			{ eligible: false, reason: 'not_fully_paid' },
			{ eligible: false, reason: 'not_fully_paid' }
		]);
		expect(await eligibility(extraordinaryRoster, fixtures.annulled)).toEqual([
			{ eligible: false, reason: 'not_fully_paid' },
			{ eligible: false, reason: 'not_fully_paid' }
		]);
		expect(
			await codeOf(
				rpc('draw_create', {
					p_campaign_id: campaignId,
					p_draw_type: 'consolation',
					p_name: 'invalid consolation',
					p_draw_date: baDate(1),
					p_payment_cutoff_at: cutoff,
					p_required_installment_number: null,
					p_eligibility_rule: {},
					p_request_id: rid('bad-consolation-create')
				})
			)
		).toBe('22023');
		const consolation = await draw('consolation', 1);
		expect(
			await codeOf(
				rpc('draw_update', {
					p_draw_id: consolation,
					p_name: 'invalid consolation update',
					p_draw_date: baDate(1),
					p_payment_cutoff_at: cutoff,
					p_required_installment_number: null,
					p_eligibility_rule: {},
					p_request_id: rid('bad-consolation-update')
				})
			)
		).toBe('22023');
		expect(
			await codeOf(
				admin.client
					.rpc('draw_generate_roster', {
						p_draw_id: consolation,
						p_request_id: rid('consolation-generate')
					})
					.then(({ error }) => {
						if (error) throw Object.assign(new Error(error.message), { code: error.code });
					})
			)
		).toBe('ok'); // SAN-81 enabled consolation: with no prior prizes there is nothing to exclude.
	});

	it('C2 extraordinary roster uses exactly the bonds own base and associated numbers (SAN-152)', async () => {
		const drawId = await draw('extraordinary_full_payment');
		const rosterId = await generateDrawRoster(
			admin.client,
			{ drawId },
			{ requestId: rid('extra-numbers-one'), permissions: admin.permissions }
		);
		const numbers = async () => {
			const { data, error } = await admin.client
				.from('bond_numbers')
				.select('id,bond_id,number_value,number_kind')
				.eq('campaign_id', campaignId)
				.is('released_at', null)
				.order('number_value')
				.order('id')
				.range(0, 499);
			if (error) throw new Error(error.message);
			return data ?? [];
		};
		const all = await numbers();
		expect(all.filter((number) => number.number_kind === 'extraordinary')).toEqual([]);
		const rows = (await rosterEntries(rosterId)).filter((row) => row.eligible);
		for (const bondId of [fixtures.full.bondId, fixtures.pata.bondId]) {
			expect(
				rows
					.filter((row) => row.bond_id === bondId)
					.map((row) => row.number_value)
					.sort((a, b) => a - b)
			).toEqual(
				all
					.filter((number) => number.bond_id === bondId)
					.map((number) => number.number_value)
					.sort((a, b) => a - b)
			);
		}
		const before = all.length;
		await generateDrawRoster(
			admin.client,
			{ drawId },
			{ requestId: rid('extra-numbers-two'), permissions: admin.permissions }
		);
		expect(await numbers()).toHaveLength(before);
	});

	it('C3 persists eligible and ineligible rows with real party snapshots and the roster UI reads the business buyer label', async () => {
		const drawId = await draw('monthly');
		const rosterId = await generateDrawRoster(
			admin.client,
			{ drawId },
			{ requestId: rid('snapshot-generate'), permissions: admin.permissions }
		);
		const rows = await rosterEntries(rosterId);
		const eligible = rows.find((row) => row.bond_id === fixtures.monthly.bondId)!;
		const ineligible = rows.find((row) => row.bond_id === fixtures.late.bondId)!;
		expect(eligible).toMatchObject({
			eligible: true,
			ineligibility_reason: null,
			buyer_snapshot: { id: buyerId, business_name: `Roster buyer ${RUN_ID}` },
			collector_snapshot: { id: collectorId, display_name: `Roster collector ${RUN_ID}` }
		});
		expect(ineligible).toMatchObject({
			eligible: false,
			ineligibility_reason: 'installments_not_covered'
		});
		const { data: profile, error } = await financialReader
			.from('profiles')
			.select('*')
			.eq('auth_user_id', admin.user.id)
			.single();
		if (error) throw new Error(error.message);
		const loaded = await rosterLoad({
			locals: {
				supabase: admin.client,
				user: admin.user,
				session: null,
				profile,
				permissions: admin.permissions,
				requestId: rid('roster-load'),
				safeGetSession: async () => ({ session: null, user: admin.user })
			},
			params: { id: campaignId, drawId },
			url: new URL(`http://localhost/campaigns/${campaignId}/draws/${drawId}/roster`)
		} as never);
		const rosterPage = loaded as Exclude<typeof loaded, void>;
		expect(
			rosterPage.entries.find(
				(entry: { bondId: string; buyerName: string }) => entry.bondId === fixtures.monthly.bondId
			)?.buyerName
		).toBe(`Roster buyer ${RUN_ID}`);
	});

	it('C4 freezes full rows: later cutoff-valid confirmation and correction do not alter them; regeneration is refused and repeat freeze is audit-free', async () => {
		// Dedicated fixture: this test never mutates the shared C1 coverage fixtures.
		const c4Partial = await createSale('c4-partial', [nextBase++]);
		await payment(c4Partial, [1], cutoffDay);
		const drawId = await draw('monthly');
		const rosterId = await generateDrawRoster(
			admin.client,
			{ drawId },
			{ requestId: rid('freeze-generate'), permissions: admin.permissions }
		);
		await freezeDrawRoster(
			admin.client,
			{ drawId },
			{ requestId: rid('freeze'), permissions: admin.permissions }
		);
		const beforeEntries = await rosterEntries(rosterId);
		const beforeRoster = await rosterRow(rosterId);
		// This settlement changes live eligibility after the snapshot, but never its frozen rows.
		await payment(c4Partial, [2], cutoffDay);
		await rpc('payment_correct_method', {
			p_payment_id: c4Partial.paymentIds[0],
			p_new_method: 'transfer',
			p_reason: 'phase 11 frozen roster correction',
			p_request_id: rid('frozen-correction')
		});
		expect(await rosterEntries(rosterId)).toEqual(beforeEntries);
		const regenerateRequest = rid('frozen-regenerate');
		await expect(
			generateDrawRoster(
				admin.client,
				{ drawId },
				{ requestId: regenerateRequest, permissions: admin.permissions }
			)
		).rejects.toMatchObject({ status: 409 });
		expect(await audit(regenerateRequest)).toEqual([]);
		expect(await rosterEntries(rosterId)).toEqual(beforeEntries);
		expect(await rosterRow(rosterId)).toEqual(beforeRoster);
		const repeatRequest = rid('repeat-freeze');
		await freezeDrawRoster(
			admin.client,
			{ drawId },
			{ requestId: repeatRequest, permissions: admin.permissions }
		);
		expect(await audit(repeatRequest)).toEqual([]);
		expect((await drawRow(drawId))?.status).toBe('roster_frozen');
	});

	it('C5 rejects a forged read-only caller without audit writes or changing draw and roster rows', async () => {
		const drawId = await draw('monthly');
		const rosterId = await generateDrawRoster(
			admin.client,
			{ drawId },
			{ requestId: rid('denied-setup-generate'), permissions: admin.permissions }
		);
		const beforeDraw = await drawRow(drawId);
		const beforeEntries = await rosterEntries(rosterId);
		const rawCode = (name: string, args: Record<string, unknown>) =>
			codeOf(
				readOnly.client.rpc(name, args).then(({ error }) => {
					if (error) throw Object.assign(new Error(error.message), { code: error.code });
				})
			);
		const denied = async (
			requestId: string,
			operation: () => Promise<unknown>,
			raw: () => PromiseLike<string | undefined>
		) => {
			await operation().then(
				() => expect.unreachable('The read-only caller must be denied.'),
				(error: { status?: number }) => expect(error.status).toBe(403)
			);
			expect(await raw()).toBe('42501');
			expect(await audit(requestId)).toEqual([]);
			expect(await drawRow(drawId)).toEqual(beforeDraw);
			expect(await rosterEntries(rosterId)).toEqual(beforeEntries);
		};
		const createRequest = rid('denied-create');
		await denied(
			createRequest,
			() =>
				createDraw(
					readOnly.client,
					{
						campaignId,
						drawType: 'monthly',
						name: 'Denied draw',
						drawDate: baDate(1),
						paymentCutoffAt: cutoff,
						requiredInstallmentNumber: 2,
						eligibilityRule: {}
					},
					{ requestId: createRequest, permissions: ['draw.create'] }
				),
			() =>
				rawCode('draw_create', {
					p_campaign_id: campaignId,
					p_draw_type: 'monthly',
					p_name: 'Denied draw',
					p_draw_date: baDate(1),
					p_payment_cutoff_at: cutoff,
					p_required_installment_number: 2,
					p_eligibility_rule: {},
					p_request_id: createRequest
				})
		);
		const updateRequest = rid('denied-update');
		await denied(
			updateRequest,
			() =>
				updateDraw(
					readOnly.client,
					{
						drawId,
						name: 'Denied update',
						drawDate: baDate(1),
						paymentCutoffAt: cutoff,
						requiredInstallmentNumber: 2,
						eligibilityRule: {}
					},
					{ requestId: updateRequest, permissions: ['draw.update'] }
				),
			() =>
				rawCode('draw_update', {
					p_draw_id: drawId,
					p_name: 'Denied update',
					p_draw_date: baDate(1),
					p_payment_cutoff_at: cutoff,
					p_required_installment_number: 2,
					p_eligibility_rule: {},
					p_request_id: updateRequest
				})
		);
		const annulRequest = rid('denied-annul');
		await denied(
			annulRequest,
			() =>
				annulDraw(
					readOnly.client,
					{ drawId, reason: 'Denied annulment' },
					{ requestId: annulRequest, permissions: ['draw.update'] }
				),
			() =>
				rawCode('draw_annul', {
					p_draw_id: drawId,
					p_reason: 'Denied annulment',
					p_request_id: annulRequest
				})
		);
		for (const [action, fn] of [
			['generate', generateDrawRoster],
			['freeze', freezeDrawRoster]
		] as const) {
			const requestId = rid(`denied-${action}`);
			await denied(
				requestId,
				() =>
					fn(readOnly.client, { drawId }, { requestId, permissions: [`draw.${action}_roster`] }),
				() => rawCode(`draw_${action}_roster`, { p_draw_id: drawId, p_request_id: requestId })
			);
		}
		await freezeDrawRoster(
			admin.client,
			{ drawId },
			{ requestId: rid('denied-direct-freeze'), permissions: admin.permissions }
		);
		const frozenRoster = await rosterRow(rosterId);
		const frozenEntries = await rosterEntries(rosterId);
		const entry = frozenEntries[0]!;
		// Direct DML is revoked from every authenticated role, admins included: only the audited
		// SECURITY DEFINER functions write rosters (review of #87).
		for (const caller of [readOnly, admin]) {
			const update = await caller.client
				.from('draw_roster_entries')
				.update({ number_value: entry.number_value })
				.eq('id', entry.id)
				.select();
			expect(update.error?.code).toBe('42501');
			const remove = await caller.client
				.from('draw_roster_entries')
				.delete()
				.eq('id', entry.id)
				.select();
			expect(remove.error?.code).toBe('42501');
			const rosterUpdate = await caller.client
				.from('draw_rosters')
				.update({ status: 'frozen' })
				.eq('id', rosterId)
				.select();
			expect(rosterUpdate.error?.code).toBe('42501');
			const rosterDelete = await caller.client
				.from('draw_rosters')
				.delete()
				.eq('id', rosterId)
				.select();
			expect(rosterDelete.error?.code).toBe('42501');
		}
		expect(await rosterRow(rosterId)).toEqual(frozenRoster);
		expect(await rosterEntries(rosterId)).toEqual(frozenEntries);
	});
});
