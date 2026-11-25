import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { evaluateDrawEligibility, type DrawType } from '$lib/domain/draw-eligibility';
import { generateDrawRoster, freezeDrawRoster } from '$lib/server/services/draw-rosters';
import { createDraw, updateDraw, annulDraw } from '$lib/server/services/draws';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';

const { supabaseUrl, anonKey, seedEnv } = inject('integrationEnv');
const seed = resolveSeedConfig(seedEnv);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const run = randomUUID();
const request = (label: string) => `it-77-${run}-${label}`;
const today = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'America/Argentina/Buenos_Aires'
}).format(new Date());
const cutoffDay = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
const cutoff = `${cutoffDay}T23:59:59-03:00`;
let admin: SupabaseClient;
let readOnly: SupabaseClient;
let permissions: string[];
let campaignId: string;
let collectorId: string;
let buyerId: string;
const draws = new Map<DrawType, string>();
const fixtures: {
	bondId: string;
	units: number;
	paid: 'full' | 'partial' | 'pending' | 'late' | 'unsold';
	saleId?: string;
	installments: { id: string; installment_number: number; amount: number }[];
}[] = [];
async function signIn(email: string, password: string) {
	const client = createClient(supabaseUrl, anonKey, options);
	const { error } = await client.auth.signInWithPassword({ email, password });
	if (error) throw error;
	return client;
}
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
	const { data, error } = await admin.rpc(name, args);
	if (error) throw error;
	return data as T;
}
const ctx = (label: string) => ({ permissions, requestId: request(label) });
async function entries(rosterId: string) {
	const { data, error } = await admin
		.from('draw_roster_entries')
		.select('*')
		.eq('draw_roster_id', rosterId)
		.order('number_value')
		.order('id')
		.range(0, 499);
	if (error) throw error;
	return data!;
}
beforeAll(async () => {
	admin = await signIn(seed.admin.email, seed.admin.password);
	permissions = await loadPermissions(admin);
	const ro = seed.fixtures.find((f) => f.roleNames.includes('read-only'))!;
	readOnly = await signIn(ro.email, ro.password);
	campaignId = await rpc<string>('campaign_create', {
		p_name: `[it-77 ${run}] roster`,
		p_simple_bond_value: 100,
		p_installment_count: 2,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_starts_at: `${cutoffDay}T03:00:00Z`,
		p_ends_at: `${today}T23:59:59-03:00`,
		p_request_id: request('campaign')
	});
	await rpc('campaign_transition', {
		p_id: campaignId,
		p_to_status: 'active',
		p_request_id: request('activate')
	});
	collectorId = await rpc<string>('collector_create', {
		p_display_name: `Roster ${run}`,
		p_phone: null,
		p_email: null,
		p_address: null,
		p_user_profile_id: null,
		p_status: 'active',
		p_request_id: request('collector')
	});
	buyerId = await rpc<string>('buyer_create', {
		p_type: 'individual',
		p_first_name: 'Roster',
		p_last_name: run,
		p_business_name: null,
		p_document_number: 'SAN77',
		p_tax_id: null,
		p_phone: null,
		p_address: null,
		p_usual_collector_id: null,
		p_notes: null,
		p_request_id: request('buyer')
	});
	for (const [index, paid] of (
		['full', 'partial', 'pending', 'late', 'unsold', 'full'] as const
	).entries()) {
		const units = index === 5 ? 2 : 1;
		const bases = Array.from({ length: units }, (_, j) => 100 + index * 10 + j);
		const bondId = await rpc<string>('bond_create', {
			p_campaign_id: campaignId,
			p_base_numbers: bases,
			p_request_id: request(`bond-${index}`)
		});
		const fixture = { bondId, units, paid, installments: [] } as (typeof fixtures)[number];
		fixtures.push(fixture);
		if (paid === 'unsold') continue;
		await rpc('bond_deliver', {
			p_campaign_id: campaignId,
			p_collector_id: collectorId,
			p_bond_ids: [bondId],
			p_notes: null,
			p_request_id: request(`deliver-${index}`)
		});
		fixture.saleId = await rpc<string>('sale_register', {
			p_campaign_id: campaignId,
			p_bond_id: bondId,
			p_buyer_id: buyerId,
			p_payment_mode: 'installments',
			p_first_due_date: today,
			p_request_id: request(`sale-${index}`)
		});
		const { data, error } = await admin
			.from('installments')
			.select('id,installment_number,amount,payment_plans!inner(sale_id)')
			.eq('payment_plans.sale_id', fixture.saleId)
			.order('installment_number')
			.order('id');
		if (error) throw error;
		fixture.installments = data!;
		const settlementId = await rpc<string>('settlement_open', {
			p_campaign_id: campaignId,
			p_collector_id: collectorId,
			p_request_id: request(`open-${index}`)
		});
		await rpc('settlement_add_payment', {
			p_settlement_id: settlementId,
			p_sale_id: fixture.saleId,
			p_amount: (paid === 'partial' ? 50 : 100) * units,
			p_payment_method: paid === 'pending' ? 'transfer' : 'cash',
			p_payment_date: paid === 'late' ? today : cutoffDay,
			p_applications: fixture.installments
				.filter((i) => paid !== 'partial' || i.installment_number === 1)
				.map((i) => ({ installment_id: i.id, amount_applied: i.amount })),
			p_request_id: request(`payment-${index}`)
		});
		if (paid !== 'pending')
			await rpc('settlement_close', {
				p_settlement_id: settlementId,
				p_request_id: request(`close-${index}`)
			});
	}
	for (const drawType of [
		'monthly',
		'final',
		'extraordinary_full_payment',
		'consolation'
	] as const) {
		draws.set(
			drawType,
			await createDraw(
				admin,
				{
					campaignId,
					drawType,
					name: 'Integration roster',
					drawDate: today,
					paymentCutoffAt: cutoff,
					requiredInstallmentNumber: 1,
					eligibilityRule: {}
				},
				ctx(`create-${drawType}`)
			)
		);
	}
});

it('SAN-152 annulling a draw built from own numbers releases nothing and keeps shared frozen history', async () => {
	// Dedicated mutable fixture: no dependence on other tests' draws, payments or reservations.
	const scope = randomUUID();
	const context = { permissions, requestId: `it-117-${scope}` };
	const campaign = await rpc<string>('campaign_create', {
		p_name: `SAN117 ${scope}`,
		p_simple_bond_value: 100,
		p_installment_count: 1,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_starts_at: `${today}T00:00:00-03:00`,
		p_ends_at: `${today}T23:59:59-03:00`,
		p_request_id: context.requestId
	});
	await rpc('campaign_transition', {
		p_id: campaign,
		p_to_status: 'active',
		p_request_id: context.requestId
	});
	const bond = await rpc<string>('bond_create', {
		p_campaign_id: campaign,
		p_base_numbers: [200],
		p_request_id: context.requestId
	});
	await rpc('bond_deliver', {
		p_campaign_id: campaign,
		p_collector_id: collectorId,
		p_bond_ids: [bond],
		p_notes: null,
		p_request_id: context.requestId
	});
	const sale = await rpc<string>('sale_register', {
		p_campaign_id: campaign,
		p_bond_id: bond,
		p_buyer_id: buyerId,
		p_payment_mode: 'full_payment',
		p_first_due_date: today,
		p_request_id: context.requestId
	});
	const installment = await admin
		.from('installments')
		.select('id,payment_plans!inner(sale_id)')
		.eq('payment_plans.sale_id', sale)
		.single();
	expect(installment.error).toBeNull();
	const settlement = await rpc<string>('settlement_open', {
		p_campaign_id: campaign,
		p_collector_id: collectorId,
		p_request_id: context.requestId
	});
	await rpc('settlement_add_payment', {
		p_settlement_id: settlement,
		p_sale_id: sale,
		p_amount: 100,
		p_payment_method: 'cash',
		p_payment_date: today,
		p_applications: [{ installment_id: installment.data!.id, amount_applied: 100 }],
		p_request_id: context.requestId
	});
	await rpc('settlement_close', {
		p_settlement_id: settlement,
		p_request_id: context.requestId
	});
	const newDraw = (name: string) =>
		createDraw(
			admin,
			{
				campaignId: campaign,
				drawType: 'extraordinary_full_payment',
				name,
				drawDate: today,
				paymentCutoffAt: `${today}T23:59:59-03:00`,
				requiredInstallmentNumber: null,
				eligibilityRule: {}
			},
			context
		);
	const first = await newDraw('First');
	const firstRoster = await generateDrawRoster(admin, { drawId: first }, context);
	const before = await entries(firstRoster);
	const ownNumbers = async () => {
		const result = await admin
			.from('bond_numbers')
			.select('*')
			.eq('bond_id', bond)
			.order('number_value');
		expect(result.error).toBeNull();
		return result.data!;
	};
	const owned = await ownNumbers();
	expect(owned.map((n) => n.number_kind)).toEqual(['base', 'associated']);
	expect(before.map((row) => row.number_value)).toEqual(owned.map((n) => n.number_value));
	const deniedRequest = `${context.requestId}-denied`;
	const denied = await readOnly.rpc('draw_annul', {
		p_draw_id: first,
		p_reason: 'Denied',
		p_request_id: deniedRequest
	});
	expect(denied.error?.code).toBe('42501');
	const deniedAudit = await admin.from('audit_log').select('id').eq('request_id', deniedRequest);
	expect(deniedAudit.error).toBeNull();
	expect(deniedAudit.data).toEqual([]);
	const unchanged = await admin.from('draws').select('status').eq('id', first).single();
	expect(unchanged.error).toBeNull();
	expect(unchanged.data?.status).toBe('roster_generated');
	const releaseRequest = `${context.requestId}-release`;
	await annulDraw(
		admin,
		{ drawId: first, reason: 'Cancel extraordinary' },
		{
			...context,
			requestId: releaseRequest
		}
	);
	const audit = await admin
		.from('audit_log')
		.select('new_value,old_value,reason')
		.eq('request_id', releaseRequest)
		.single();
	expect(audit.error).toBeNull();
	expect(audit.data?.new_value).toMatchObject({ status: 'annulled', released_number_ids: [] });
	expect(audit.data?.old_value).toMatchObject({ status: 'roster_generated' });
	expect(await entries(firstRoster)).toEqual(before);
	// The bond's own numbers stay reserved: no extra number was created or released.
	expect(await ownNumbers()).toEqual(owned);
	const second = await newDraw('Later');
	await generateDrawRoster(admin, { drawId: second }, context);
	expect(await ownNumbers()).toEqual(owned);
	const third = await newDraw('Shared frozen');
	const thirdRoster = await generateDrawRoster(admin, { drawId: third }, context);
	await freezeDrawRoster(admin, { drawId: third }, context);
	const frozen = await entries(thirdRoster);
	const keepRequest = `${context.requestId}-keep`;
	await annulDraw(
		admin,
		{ drawId: second, reason: 'Keep shared numbers' },
		{ ...context, requestId: keepRequest }
	);
	expect(await ownNumbers()).toEqual(owned);
	const keptAudit = await admin
		.from('audit_log')
		.select('new_value')
		.eq('request_id', keepRequest)
		.single();
	expect(keptAudit.error).toBeNull();
	expect(keptAudit.data?.new_value).toMatchObject({ released_number_ids: [] });
	const frozenRequest = `${context.requestId}-frozen`;
	const refused = await admin.rpc('draw_annul', {
		p_draw_id: third,
		p_reason: 'Frozen',
		p_request_id: frozenRequest
	});
	expect(refused.error?.code).toBe('55000');
	const frozenAudit = await admin.from('audit_log').select('id').eq('request_id', frozenRequest);
	expect(frozenAudit.error).toBeNull();
	expect(frozenAudit.data).toEqual([]);
	expect(await entries(thirdRoster)).toEqual(frozen);
});

describe('transactional draw roster services with real users', () => {
	it('creates, edits and annuls an audited scheduled configuration', async () => {
		const drawId = await createDraw(
			admin,
			{
				campaignId,
				drawType: 'monthly',
				name: 'Configuration',
				drawDate: today,
				paymentCutoffAt: cutoff,
				requiredInstallmentNumber: 1,
				eligibilityRule: {}
			},
			ctx('configuration-create')
		);
		await updateDraw(
			admin,
			{
				drawId,
				name: 'Edited configuration',
				drawDate: today,
				paymentCutoffAt: cutoff,
				requiredInstallmentNumber: 2,
				eligibilityRule: { custom: true }
			},
			ctx('configuration-update')
		);
		await annulDraw(
			admin,
			{ drawId, reason: '  Cancelled configuration  ' },
			ctx('configuration-annul')
		);
		const { data, error } = await admin
			.from('draws')
			.select('name,status,annul_reason')
			.eq('id', drawId)
			.single();
		if (error) throw error;
		expect(data).toMatchObject({
			name: 'Edited configuration',
			status: 'annulled',
			annul_reason: 'Cancelled configuration'
		});
		const { data: audits, error: auditError } = await admin
			.from('audit_log')
			.select('action')
			.eq('entity_id', drawId)
			.order('action');
		if (auditError) throw auditError;
		expect(audits?.map((a) => a.action)).toEqual(['draw.annul', 'draw.create', 'draw.update']);
	});
	it.each(['monthly', 'final', 'extraordinary_full_payment', 'consolation'] as const)(
		'%s matches TS eligibility on the same persisted fixtures, then freezes',
		async (type) => {
			const drawId = draws.get(type)!;
			const rosterId = await generateDrawRoster(admin, { drawId }, ctx(`generate-${type}`));
			const rows = await entries(rosterId);
			for (const fixture of fixtures) {
				const { data: payments, error } = await admin
					.from('payments')
					.select(
						'id,status,payment_date,created_at,payment_installments(installment_id,amount_applied)'
					)
					.eq('sale_id', fixture.saleId ?? randomUUID())
					.order('id')
					.range(0, 499);
				if (error) throw error;
				const expected = evaluateDrawEligibility({
					draw: { type, paymentCutoffAt: cutoff, requiredInstallmentNumber: 1 },
					bond: {
						status: fixture.paid === 'unsold' ? 'available' : 'sold',
						annulled: false,
						kind: fixture.units === 1 ? 'simple' : 'pata',
						baseNumberCount: fixture.units
					},
					sale: {
						installments: fixture.installments.map((i) => ({
							number: i.installment_number,
							amount: Number(i.amount).toFixed(2)
						}))
					},
					payments: (payments ?? []).map((p) => ({
						status: p.status,
						paymentDate: p.payment_date,
						createdAt: p.created_at,
						applications: p.payment_installments.map((a) => ({
							installmentNumber: fixture.installments.find((i) => i.id === a.installment_id)!
								.installment_number,
							amountApplied: Number(a.amount_applied).toFixed(2)
						}))
					})),
					previousWins: []
				});
				const actual = rows.filter((r) => r.bond_id === fixture.bondId);
				expect(actual.length).toBeGreaterThan(0);
				for (const row of actual)
					expect({
						eligible: row.eligible,
						...(row.eligible ? {} : { reason: row.ineligibility_reason })
					}).toEqual(expected);
			}
			if (type === 'extraordinary_full_payment') {
				// SAN-152: no extra numbers; every fully paid bond participates with its own numbers.
				const { data: numbers, error } = await admin
					.from('bond_numbers')
					.select('id,bond_id,number_value,number_kind')
					.eq('campaign_id', campaignId)
					.is('released_at', null)
					.order('number_value')
					.order('id')
					.range(0, 499);
				if (error) throw error;
				expect(numbers!.filter((n) => n.number_kind === 'extraordinary')).toEqual([]);
				for (const f of fixtures.filter((x) => x.paid === 'full')) {
					expect(
						rows
							.filter((r) => r.bond_id === f.bondId)
							.map((r) => r.number_value)
							.sort((a, b) => a - b)
					).toEqual(
						numbers!
							.filter((n) => n.bond_id === f.bondId)
							.map((n) => n.number_value)
							.sort((a, b) => a - b)
					);
				}
			}
			await freezeDrawRoster(admin, { drawId }, ctx(`freeze-${type}`));
			const { data: frozen } = await admin
				.from('draw_rosters')
				.select('status')
				.eq('id', rosterId)
				.single();
			expect(frozen?.status).toBe('frozen');
			expect(await entries(rosterId)).toEqual(rows);
			await expect(
				generateDrawRoster(admin, { drawId }, ctx(`refused-${type}`))
			).rejects.toMatchObject({ status: 409 });
		}
	);
	it('denies a real read-only caller even if TS permissions are forged', async () => {
		const drawId = await createDraw(
			admin,
			{
				campaignId,
				drawType: 'consolation',
				name: 'Denial fixture',
				drawDate: today,
				paymentCutoffAt: cutoff,
				requiredInstallmentNumber: 1,
				eligibilityRule: {}
			},
			ctx('denial-fixture')
		);
		for (const [action, fn] of [
			['generate', generateDrawRoster],
			['freeze', freezeDrawRoster]
		] as const) {
			const requestId = request(`denied-${action}`);
			await expect(
				fn(readOnly, { drawId }, { requestId, permissions: [`draw.${action}_roster`] })
			).rejects.toMatchObject({ status: 403 });
			const { data: audits, error } = await admin
				.from('audit_log')
				.select('id')
				.eq('request_id', requestId);
			if (error) throw error;
			expect(audits).toEqual([]);
			const { data: draw } = await admin.from('draws').select('status').eq('id', drawId).single();
			expect(draw?.status).toBe('scheduled');
			const { data: rosters } = await admin.from('draw_rosters').select('id').eq('draw_id', drawId);
			expect(rosters).toEqual([]);
		}
	});
});
