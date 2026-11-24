import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';
import { createDraw } from '$lib/server/services/draws';
import { generateDrawRoster, freezeDrawRoster } from '$lib/server/services/draw-rosters';
import {
	createPrize,
	updatePrize,
	loadWinningNumber,
	resolvePrize,
	deliverPrize,
	reversePrizeDelivery,
	annulPrize
} from '$lib/server/services/prizes';
import { evaluateDrawEligibility } from '$lib/domain/draw-eligibility';

const { supabaseUrl, anonKey, seedEnv } = inject('integrationEnv');
const seed = resolveSeedConfig(seedEnv);
let admin: SupabaseClient;
let readOnly: SupabaseClient;
let permissions: string[];
const today = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'America/Argentina/Buenos_Aires'
}).format(new Date());
const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
const cutoff = `${today}T23:59:59-03:00`;
const ctx = (requestId = `it-81-${randomUUID()}`) => ({ requestId, permissions });
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
	const { data, error } = await admin.rpc(name, args);
	if (error) throw error;
	return data as T;
}
async function row(table: string, id: string) {
	const { data, error } = await admin.from(table).select('*').eq('id', id).single();
	if (error) throw error;
	return data!;
}
async function audits(requestId: string) {
	const { data, error } = await admin.from('audit_log').select('*').eq('request_id', requestId);
	if (error) throw error;
	return data!;
}
beforeAll(async () => {
	const signIn = async (email: string, password: string) => {
		const db = createClient(supabaseUrl, anonKey, {
			auth: { autoRefreshToken: false, persistSession: false }
		});
		const { error } = await db.auth.signInWithPassword({ email, password });
		if (error) throw error;
		return db;
	};
	admin = await signIn(seed.admin.email, seed.admin.password);
	permissions = await loadPermissions(admin);
	const ro = seed.fixtures.find((f) => f.roleNames.includes('read-only'))!;
	readOnly = await signIn(ro.email, ro.password);
});
async function fixture() {
	const campaignId = await rpc<string>('campaign_create', {
		p_name: `[it-81 ${randomUUID()}]`,
		p_simple_bond_value: 100,
		p_installment_count: 1,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_starts_at: `${yesterday}T03:00:00Z`,
		p_ends_at: `${today}T23:59:59-03:00`,
		p_request_id: ctx().requestId
	});
	await rpc('campaign_transition', {
		p_id: campaignId,
		p_to_status: 'active',
		p_request_id: ctx().requestId
	});
	const collectorId = await rpc<string>('collector_create', {
		p_display_name: `Prize ${randomUUID()}`,
		p_phone: null,
		p_email: null,
		p_address: null,
		p_user_profile_id: null,
		p_status: 'active',
		p_request_id: ctx().requestId
	});
	const buyerId = await rpc<string>('buyer_create', {
		p_type: 'individual',
		p_first_name: 'Prize',
		p_last_name: randomUUID(),
		p_business_name: null,
		p_document_number: null,
		p_tax_id: null,
		p_phone: null,
		p_address: null,
		p_usual_collector_id: null,
		p_notes: null,
		p_request_id: ctx().requestId
	});
	const bondId = await rpc<string>('bond_create', {
		p_campaign_id: campaignId,
		p_base_numbers: [100],
		p_request_id: ctx().requestId
	});
	const unsoldId = await rpc<string>('bond_create', {
		p_campaign_id: campaignId,
		p_base_numbers: [200],
		p_request_id: ctx().requestId
	});
	await rpc('bond_deliver', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId,
		p_bond_ids: [bondId],
		p_notes: null,
		p_request_id: ctx().requestId
	});
	const saleId = await rpc<string>('sale_register', {
		p_campaign_id: campaignId,
		p_bond_id: bondId,
		p_buyer_id: buyerId,
		p_payment_mode: 'full_payment',
		p_first_due_date: today,
		p_request_id: ctx().requestId
	});
	const { data: installments, error } = await admin
		.from('installments')
		.select('id,amount,payment_plans!inner(sale_id)')
		.eq('payment_plans.sale_id', saleId);
	if (error) throw error;
	const settlementId = await rpc<string>('settlement_open', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId,
		p_request_id: ctx().requestId
	});
	await rpc('settlement_add_payment', {
		p_settlement_id: settlementId,
		p_sale_id: saleId,
		p_amount: 100,
		p_payment_method: 'cash',
		p_payment_date: today,
		p_applications: installments!.map((i) => ({ installment_id: i.id, amount_applied: i.amount })),
		p_request_id: ctx().requestId
	});
	await rpc('settlement_close', { p_settlement_id: settlementId, p_request_id: ctx().requestId });
	const draw = async (type: 'final' | 'consolation' = 'final', date = yesterday) =>
		createDraw(
			admin,
			{
				campaignId,
				drawType: type,
				name: 'Prize draw',
				drawDate: date,
				paymentCutoffAt: cutoff,
				requiredInstallmentNumber: 1,
				eligibilityRule: {}
			},
			ctx()
		);
	const drawId = await draw();
	const rosterId = await generateDrawRoster(admin, { drawId }, ctx());
	await freezeDrawRoster(admin, { drawId }, ctx());
	const prize = (position = 1, excludesFromConsolation = true) =>
		createPrize(
			admin,
			{ drawId, name: 'Prize', description: null, position, excludesFromConsolation },
			ctx()
		);
	return { campaignId, collectorId, buyerId, bondId, unsoldId, drawId, rosterId, draw, prize };
}

describe('audited prize services with real users', () => {
	it('reverses a delivery without losing history and supports redelivery', async () => {
		const f = await fixture();
		const prizeId = await f.prize();
		await loadWinningNumber(admin, { prizeId, numberValue: 100, notes: null }, ctx());
		await resolvePrize(admin, { prizeId, decision: 'award', notes: 'Approved' }, ctx());
		await deliverPrize(admin, { prizeId, notes: 'Original receipt' }, ctx());
		const { data: before, error: beforeError } = await admin
			.from('prize_awards')
			.select('*')
			.eq('prize_id', prizeId)
			.single();
		if (beforeError) throw beforeError;
		const denied = ctx();
		const deniedPrize = await row('prizes', prizeId);
		const { error: deniedError } = await readOnly.rpc('prize_reverse_delivery', {
			p_prize_id: prizeId,
			p_reason: 'Mistake',
			p_request_id: denied.requestId
		});
		expect(deniedError?.code).toBe('42501');
		expect(await row('prizes', prizeId)).toEqual(deniedPrize);
		expect(await row('prize_awards', before.id)).toEqual(before);
		expect(await audits(denied.requestId)).toEqual([]);
		const request = ctx();
		await reversePrizeDelivery(admin, { prizeId, reason: ' Mistake ' }, request);
		expect((await row('prizes', prizeId)).status).toBe('pending_delivery');
		expect(await row('prize_awards', before.id)).toMatchObject({
			status: 'awarded',
			delivered_at: null,
			delivered_by: null,
			notes: 'Approved'
		});
		const { data: history, error: historyError } = await admin
			.from('prize_delivery_reversals')
			.select('*')
			.eq('prize_id', prizeId)
			.order('reversed_at')
			.order('id');
		if (historyError) throw historyError;
		expect(history).toHaveLength(1);
		expect(history![0]).toMatchObject({
			award_snapshot: before,
			delivered_at: before.delivered_at,
			delivered_by: before.delivered_by,
			notes: 'Original receipt',
			reason: 'Mistake'
		});
		expect(await audits(request.requestId)).toHaveLength(1);
		const repeat = ctx();
		await expect(
			reversePrizeDelivery(admin, { prizeId, reason: 'Again' }, repeat)
		).rejects.toMatchObject({ status: 409 });
		expect(await audits(repeat.requestId)).toEqual([]);
		const { data: certificate, error: certificateError } = await admin.rpc(
			'prize_certificate_data',
			{ p_prize_id: prizeId }
		);
		if (certificateError) throw certificateError;
		expect(certificate).toMatchObject({
			prize_status: 'pending_delivery',
			award_status: 'awarded',
			delivered_at: null
		});
		await deliverPrize(admin, { prizeId, notes: 'Second receipt' }, ctx());
		expect(await row('prize_delivery_reversals', history![0].id)).toEqual(history![0]);
		expect((await row('prizes', prizeId)).status).toBe('delivered');
		expect(await row('prize_awards', before.id)).toMatchObject({
			status: 'delivered',
			notes: 'Second receipt'
		});
	});
	it('propagates a physical manual-pata member win to every member in a later same-date consolation', async () => {
		const f = await fixture();
		const members = [];
		for (const value of [300, 400])
			members.push(
				await rpc<string>('bond_create', {
					p_campaign_id: f.campaignId,
					p_base_numbers: [value],
					p_request_id: ctx().requestId
				})
			);
		const parent = await rpc<string>('bond_group_into_pata', {
			p_campaign_id: f.campaignId,
			p_member_bond_ids: members,
			p_request_id: ctx().requestId
		});
		await rpc('bond_deliver', {
			p_campaign_id: f.campaignId,
			p_collector_id: f.collectorId,
			p_bond_ids: [parent],
			p_notes: null,
			p_request_id: ctx().requestId
		});
		const saleId = await rpc<string>('sale_register', {
			p_campaign_id: f.campaignId,
			p_bond_id: parent,
			p_buyer_id: f.buyerId,
			p_payment_mode: 'full_payment',
			p_first_due_date: today,
			p_request_id: ctx().requestId
		});
		const { data: installments, error } = await admin
			.from('installments')
			.select('id,amount,payment_plans!inner(sale_id)')
			.eq('payment_plans.sale_id', saleId);
		if (error) throw error;
		const settlement = await rpc<string>('settlement_open', {
			p_campaign_id: f.campaignId,
			p_collector_id: f.collectorId,
			p_request_id: ctx().requestId
		});
		await rpc('settlement_add_payment', {
			p_settlement_id: settlement,
			p_sale_id: saleId,
			p_amount: 200,
			p_payment_method: 'cash',
			p_payment_date: today,
			p_applications: installments!.map((i) => ({
				installment_id: i.id,
				amount_applied: i.amount
			})),
			p_request_id: ctx().requestId
		});
		await rpc('settlement_close', { p_settlement_id: settlement, p_request_id: ctx().requestId });
		const sourceDraw = await f.draw();
		await generateDrawRoster(admin, { drawId: sourceDraw }, ctx());
		await freezeDrawRoster(admin, { drawId: sourceDraw }, ctx());
		const prizeId = await createPrize(
			admin,
			{
				drawId: sourceDraw,
				name: 'Member winner',
				description: null,
				position: 1
			},
			ctx()
		);
		await loadWinningNumber(admin, { prizeId, numberValue: 300, notes: null }, ctx());
		await resolvePrize(admin, { prizeId, decision: 'award', notes: null }, ctx());
		const { data: award, error: awardError } = await admin
			.from('prize_awards')
			.select('*')
			.eq('prize_id', prizeId)
			.single();
		if (awardError) throw awardError;
		expect(award).toMatchObject({
			bond_id: members[0],
			buyer_id: f.buyerId,
			collector_id: f.collectorId
		});
		const consolation = await f.draw('consolation');
		const roster = await generateDrawRoster(admin, { drawId: consolation }, ctx());
		const { data: entries, error: entryError } = await admin
			.from('draw_roster_entries')
			.select('*')
			.eq('draw_roster_id', roster)
			.in('bond_id', members)
			.order('number_value')
			.order('id');
		if (entryError) throw entryError;
		expect(entries).toHaveLength(4);
		for (const entry of entries!)
			expect(entry).toMatchObject({ eligible: false, ineligibility_reason: 'already_won' });
	});
	it('edits, loads, resolves and delivers synchronized snapshot ownership', async () => {
		const f = await fixture();
		const prizeId = await f.prize();
		await updatePrize(
			admin,
			{
				prizeId,
				name: ' Edited ',
				description: 'Prize description',
				position: 1,
				excludesFromConsolation: true
			},
			ctx()
		);
		const request = ctx();
		const winningId = await loadWinningNumber(
			admin,
			{ prizeId, numberValue: 100, notes: 'Loaded' },
			request
		);
		expect(await row('winning_numbers', winningId)).toMatchObject({
			result_status: 'eligible_winner',
			number_value: 100
		});
		expect(await row('prizes', prizeId)).toMatchObject({
			status: 'pending_validation',
			name: 'Edited'
		});
		expect(await audits(request.requestId)).toHaveLength(1);
		await resolvePrize(admin, { prizeId, decision: 'award', notes: 'Approved' }, ctx());
		const { data: award, error } = await admin
			.from('prize_awards')
			.select('*')
			.eq('prize_id', prizeId)
			.single();
		if (error) throw error;
		expect(award).toMatchObject({
			status: 'awarded',
			bond_id: f.bondId,
			buyer_id: f.buyerId,
			collector_id: f.collectorId
		});
		expect((await row('prizes', prizeId)).status).toBe('pending_delivery');
		await deliverPrize(admin, { prizeId, notes: 'Received by buyer' }, ctx());
		expect((await row('prizes', prizeId)).status).toBe('delivered');
		const deliveredBefore = await row('prizes', prizeId);
		const deliveredAnnul = ctx();
		await expect(
			annulPrize(admin, { prizeId, reason: 'Wrong result' }, deliveredAnnul)
		).rejects.toMatchObject({
			status: 409,
			message: 'A delivered prize cannot be annulled. Reverse the delivery first.'
		});
		expect(await row('prizes', prizeId)).toEqual(deliveredBefore);
		expect(await audits(deliveredAnnul.requestId)).toEqual([]);
		expect(await row('prize_awards', award.id)).toMatchObject({
			status: 'delivered',
			notes: 'Received by buyer'
		});
		const repeat = ctx();
		await expect(deliverPrize(admin, { prizeId, notes: 'Again' }, repeat)).rejects.toMatchObject({
			status: 409
		});
		expect(await audits(repeat.requestId)).toEqual([]);
	});
	it('classifies frozen ineligible and no-match results without awards', async () => {
		const f = await fixture();
		for (const [position, numberValue, result] of [
			[1, 200, 'not_eligible'],
			[2, 9999, 'no_match']
		] as const) {
			const prizeId = await f.prize(position);
			const id = await loadWinningNumber(admin, { prizeId, numberValue, notes: null }, ctx());
			const winner = await row('winning_numbers', id);
			expect(winner.result_status).toBe(result);
			expect((await row('prizes', prizeId)).status).toBe('unawarded');
			if (winner.matched_roster_entry_id)
				expect(
					(await row('draw_roster_entries', winner.matched_roster_entry_id)).ineligibility_reason
				).toBe('not_sold');
			const { data, error } = await admin.from('prize_awards').select('id').eq('prize_id', prizeId);
			if (error) throw error;
			expect(data).toEqual([]);
		}
	});
	it('annuls incorrect history, reuses position on a replacement and audits both events', async () => {
		const f = await fixture();
		const prizeId = await f.prize();
		const winner = await loadWinningNumber(
			admin,
			{ prizeId, numberValue: 9999, notes: 'Mistake' },
			ctx()
		);
		const before = await row('winning_numbers', winner);
		const annul = ctx();
		await annulPrize(admin, { prizeId, reason: 'Wrong result' }, annul);
		expect((await row('prizes', prizeId)).status).toBe('annulled');
		expect(await row('winning_numbers', winner)).toEqual(before);
		const replacement = await f.prize();
		const correct = ctx();
		await loadWinningNumber(
			admin,
			{ prizeId: replacement, numberValue: 100, notes: 'Correct result' },
			correct
		);
		expect((await audits(annul.requestId))[0]).toMatchObject({
			action: 'prize.annul',
			reason: 'Wrong result'
		});
		expect((await audits(correct.requestId))[0]).toMatchObject({ action: 'draw.load_winner' });
		await resolvePrize(
			admin,
			{ prizeId: replacement, decision: 'unaward', notes: 'Declined' },
			ctx()
		);
		expect((await row('prizes', replacement)).status).toBe('unawarded');
	});
	it('denies all six services in SQL with forged TS permissions and no state/audit writes', async () => {
		const f = await fixture();
		const prizeId = await f.prize();
		const before = await row('prizes', prizeId);
		for (const call of [
			(c: ReturnType<typeof ctx>) =>
				createPrize(
					readOnly,
					{ drawId: f.drawId, name: 'Denied', description: null, position: 2 },
					c
				),
			(c: ReturnType<typeof ctx>) =>
				updatePrize(
					readOnly,
					{
						prizeId,
						name: 'Denied',
						description: null,
						position: 1,
						excludesFromConsolation: true
					},
					c
				),
			(c: ReturnType<typeof ctx>) =>
				loadWinningNumber(readOnly, { prizeId, numberValue: 100, notes: null }, c),
			(c: ReturnType<typeof ctx>) =>
				resolvePrize(readOnly, { prizeId, decision: 'award', notes: null }, c),
			(c: ReturnType<typeof ctx>) => deliverPrize(readOnly, { prizeId, notes: 'Denied' }, c),
			(c: ReturnType<typeof ctx>) => annulPrize(readOnly, { prizeId, reason: 'Denied' }, c)
		]) {
			const request = ctx();
			await expect(call(request)).rejects.toMatchObject({ status: 403 });
			expect(await audits(request.requestId)).toEqual([]);
			expect(await row('prizes', prizeId)).toEqual(before);
			const { data, error } = await admin
				.from('winning_numbers')
				.select('id')
				.eq('prize_id', prizeId);
			if (error) throw error;
			expect(data).toEqual([]);
		}
	});
	it('blocks consolation generation and freeze until all previous excluding prizes are resolved', async () => {
		const f = await fixture();
		const prizeId = await f.prize();
		const drawId = await f.draw('consolation', today);
		const prizeBefore = await row('prizes', prizeId);
		for (const loaded of [false, true]) {
			if (loaded) await loadWinningNumber(admin, { prizeId, numberValue: 100, notes: null }, ctx());
			const denied = ctx();
			await expect(generateDrawRoster(admin, { drawId }, denied)).rejects.toMatchObject({
				status: 409,
				message:
					'previous draws of the campaign have unresolved prizes that exclude from consolation'
			});
			expect(await audits(denied.requestId)).toEqual([]);
			expect((await row('prizes', prizeId)).status).toBe(prizeBefore.status);
			expect((await row('draws', drawId)).status).toBe('scheduled');
		}
		await resolvePrize(admin, { prizeId, decision: 'unaward', notes: null }, ctx());
		await generateDrawRoster(admin, { drawId }, ctx());
		const latePrize = await f.prize(2);
		const deniedFreeze = ctx();
		await expect(freezeDrawRoster(admin, { drawId }, deniedFreeze)).rejects.toMatchObject({
			status: 409,
			message: 'previous draws of the campaign have unresolved prizes that exclude from consolation'
		});
		expect(await audits(deniedFreeze.requestId)).toEqual([]);
		expect((await row('draws', drawId)).status).toBe('roster_generated');
		await annulPrize(admin, { prizeId: latePrize, reason: 'Incorrect configuration' }, ctx());
		await freezeDrawRoster(admin, { drawId }, ctx());
		expect((await row('draws', drawId)).status).toBe('roster_frozen');
	});
	it('requires the dedicated annul permission even when resolution is allowed in TS', async () => {
		const f = await fixture();
		const prizeId = await f.prize();
		const before = await row('prizes', prizeId);
		const denied = { requestId: ctx().requestId, permissions: ['prize.resolve'] };
		await expect(annulPrize(admin, { prizeId, reason: 'Denied' }, denied)).rejects.toMatchObject({
			status: 403
		});
		expect(await row('prizes', prizeId)).toEqual(before);
		expect(await audits(denied.requestId)).toEqual([]);
	});
	it('consolation parity excludes only prior active excluding awards and regenerates after annulment', async () => {
		const f = await fixture();
		const prizeId = await f.prize();
		await loadWinningNumber(admin, { prizeId, numberValue: 100, notes: null }, ctx());
		await resolvePrize(admin, { prizeId, decision: 'award', notes: null }, ctx());
		const drawId = await f.draw('consolation', today);
		const check = async (won: boolean) => {
			const rosterId = await generateDrawRoster(admin, { drawId }, ctx());
			const { data, error } = await admin
				.from('draw_roster_entries')
				.select('*')
				.eq('draw_roster_id', rosterId)
				.eq('bond_id', f.bondId)
				.order('number_value')
				.order('id');
			if (error) throw error;
			const expected = evaluateDrawEligibility({
				draw: { type: 'consolation', paymentCutoffAt: cutoff, requiredInstallmentNumber: 1 },
				bond: { status: 'sold', annulled: false, kind: 'simple', baseNumberCount: 1 },
				sale: { installments: [{ number: 1, amount: '100.00' }] },
				payments: [
					{
						status: 'confirmed',
						paymentDate: today,
						createdAt: cutoff,
						applications: [{ installmentNumber: 1, amountApplied: '100.00' }]
					}
				],
				previousWins: won ? [{ drawType: 'final', excludesFromConsolation: true }] : []
			});
			expect(data).toHaveLength(2);
			for (const e of data!)
				expect({
					eligible: e.eligible,
					...(e.eligible ? {} : { reason: e.ineligibility_reason })
				}).toEqual(expected);
		};
		await check(true);
		await annulPrize(admin, { prizeId, reason: 'Incorrect result' }, ctx());
		await check(false);
		const nonExcluding = await f.prize(1, false);
		await loadWinningNumber(admin, { prizeId: nonExcluding, numberValue: 100, notes: null }, ctx());
		await resolvePrize(admin, { prizeId: nonExcluding, decision: 'award', notes: null }, ctx());
		await check(false);
	});
});
