/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { render } from 'svelte/server';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';
import { annulDraw, completeDraw, createDraw } from '$lib/server/services/draws';
import { generateDrawRoster, freezeDrawRoster } from '$lib/server/services/draw-rosters';
import {
	createPrize,
	updatePrize,
	loadWinningNumber,
	resolvePrize,
	deliverPrize,
	annulPrize
} from '$lib/server/services/prizes';
import { evaluateDrawEligibility } from '$lib/domain/draw-eligibility';
import { load as deliveryCertificateLoad } from '../../src/routes/campaigns/[id]/draws/[drawId]/winners/[prizeId]/delivery-certificate/+page.server';
import { load as unawardedCertificateLoad } from '../../src/routes/campaigns/[id]/draws/[drawId]/winners/[prizeId]/unawarded-certificate/+page.server';
import DeliveryCertificatePage from '../../src/routes/campaigns/[id]/draws/[drawId]/winners/[prizeId]/delivery-certificate/+page@.svelte';
import UnawardedCertificatePage from '../../src/routes/campaigns/[id]/draws/[drawId]/winners/[prizeId]/unawarded-certificate/+page@.svelte';
import deliveryCertificateSource from '../../src/routes/campaigns/[id]/draws/[drawId]/winners/[prizeId]/delivery-certificate/+page@.svelte?raw';
import unawardedCertificateSource from '../../src/routes/campaigns/[id]/draws/[drawId]/winners/[prizeId]/unawarded-certificate/+page@.svelte?raw';

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
const ctx = (requestId = `it-p12-${randomUUID()}`) => ({ requestId, permissions });
const codeOf = (promise: PromiseLike<unknown>) =>
	promise.then(
		() => 'ok',
		(error: { code?: string }) => error.code
	);
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
		p_name: `[it-p12 ${randomUUID()}]`,
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

describe('Phase 12: winner validation, prize resolution, and certificates', () => {
	it('C1 refuses loads until the public roster freeze transition, without winner or audit writes', async () => {
		const f = await fixture();
		const draftDraw = await f.draw();
		const prizeId = await createPrize(
			admin,
			{ drawId: draftDraw, name: 'Freeze gate', description: null, position: 1 },
			ctx()
		);
		const before = await row('prizes', prizeId);
		const refusal = async (expectedStatus: 'scheduled' | 'roster_generated') => {
			const request = ctx();
			await expect(
				loadWinningNumber(admin, { prizeId, numberValue: 100, notes: null }, request)
			).rejects.toMatchObject({ status: 409 });
			expect(
				await codeOf(
					admin
						.rpc('draw_load_winning_number', {
							p_prize_id: prizeId,
							p_number_value: 100,
							p_notes: null,
							p_request_id: request.requestId
						})
						.then(({ error }) => {
							if (error) throw Object.assign(new Error(error.message), { code: error.code });
						})
				)
			).toBe('55000');
			expect(await audits(request.requestId)).toEqual([]);
			expect(await row('prizes', prizeId)).toEqual(before);
			const { data, error } = await admin
				.from('winning_numbers')
				.select('id')
				.eq('prize_id', prizeId);
			if (error) throw error;
			expect(data).toEqual([]);
			expect((await row('draws', draftDraw)).status).toBe(expectedStatus);
		};
		await refusal('scheduled');
		await generateDrawRoster(admin, { drawId: draftDraw }, ctx());
		await refusal('roster_generated');
		await freezeDrawRoster(admin, { drawId: draftDraw }, ctx());
		const success = ctx();
		const winningNumberId = await loadWinningNumber(
			admin,
			{ prizeId, numberValue: 100, notes: null },
			success
		);
		expect(await row('winning_numbers', winningNumberId)).toMatchObject({
			prize_id: prizeId,
			result_status: 'eligible_winner'
		});
		expect((await audits(success.requestId)).map((entry) => entry.action)).toEqual([
			'draw.load_winner'
		]);
		const annulledDraw = await f.draw();
		const annulledPrize = await createPrize(
			admin,
			{ drawId: annulledDraw, name: 'Annulled gate', description: null, position: 1 },
			ctx()
		);
		await annulDraw(admin, { drawId: annulledDraw, reason: 'Phase 12 refusal fixture' }, ctx());
		const annulledBefore = await row('prizes', annulledPrize);
		const annulledRequest = ctx();
		await expect(
			loadWinningNumber(
				admin,
				{ prizeId: annulledPrize, numberValue: 100, notes: null },
				annulledRequest
			)
		).rejects.toMatchObject({ status: 409 });
		expect(await audits(annulledRequest.requestId)).toEqual([]);
		expect(await row('prizes', annulledPrize)).toEqual(annulledBefore);
	});

	it('C1 completes a frozen draw through the public API only once every prize is resolved (SAN-123)', async () => {
		const f = await fixture();
		const prizeId = await f.prize();
		const blocked = ctx();
		await expect(completeDraw(admin, { drawId: f.drawId }, blocked)).rejects.toMatchObject({
			status: 409
		});
		expect(await audits(blocked.requestId)).toEqual([]);
		expect((await row('draws', f.drawId)).status).toBe('roster_frozen');
		const denied = ctx();
		await expect(completeDraw(readOnly, { drawId: f.drawId }, denied)).rejects.toMatchObject({
			status: 403
		});
		expect(await audits(denied.requestId)).toEqual([]);
		await loadWinningNumber(admin, { prizeId, numberValue: 9999, notes: null }, ctx());
		const done = ctx();
		await completeDraw(admin, { drawId: f.drawId }, done);
		expect((await row('draws', f.drawId)).status).toBe('completed');
		expect(await audits(done.requestId)).toMatchObject([
			{ action: 'draw.complete', entity_type: 'draw', entity_id: f.drawId }
		]);
		const late = ctx();
		await expect(
			createPrize(admin, { drawId: f.drawId, name: 'Late', description: null, position: 2 }, late)
		).rejects.toMatchObject({ status: 409 });
		expect(await audits(late.requestId)).toEqual([]);
		// Void-only correction stays possible on a completed draw; loading is never possible again.
		await annulPrize(admin, { prizeId, reason: 'Wrong number after completion' }, ctx());
		const reload = ctx();
		await expect(
			loadWinningNumber(admin, { prizeId, numberValue: 100, notes: null }, reload)
		).rejects.toMatchObject({ status: 409 });
		expect(await audits(reload.requestId)).toEqual([]);
	});

	it('C5 propagates a physical manual-pata member win to every member in a later same-date consolation', async () => {
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
	it('C3 resolves and delivers synchronized snapshot ownership', async () => {
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
		const duplicate = ctx();
		await expect(
			loadWinningNumber(admin, { prizeId, numberValue: 100, notes: 'Again' }, duplicate)
		).rejects.toMatchObject({ status: 409 });
		expect(await audits(duplicate.requestId)).toEqual([]);
		expect(await row('winning_numbers', winningId)).toMatchObject({ notes: 'Loaded' });
		const resolveRequest = ctx();
		await resolvePrize(admin, { prizeId, decision: 'award', notes: 'Approved' }, resolveRequest);
		expect(await audits(resolveRequest.requestId)).toMatchObject([
			{ action: 'prize.resolve', entity_type: 'prize', entity_id: prizeId }
		]);
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
		const deliverRequest = ctx();
		await deliverPrize(admin, { prizeId, notes: 'Received by buyer' }, deliverRequest);
		expect(await audits(deliverRequest.requestId)).toMatchObject([
			{ action: 'prize.deliver', entity_type: 'prize', entity_id: prizeId }
		]);
		expect((await row('prizes', prizeId)).status).toBe('delivered');
		expect(await row('prize_awards', award.id)).toMatchObject({
			status: 'delivered',
			delivered_at: expect.any(String),
			delivered_by: expect.any(String)
		});
		const deliveredBefore = await row('prizes', prizeId);
		const deliveredAnnul = ctx();
		await expect(
			annulPrize(admin, { prizeId, reason: 'Wrong result' }, deliveredAnnul)
		).rejects.toMatchObject({
			status: 409,
			message: 'A delivered prize cannot be annulled; pending product decision.'
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
	it('C2 classifies frozen ineligible and no-match results without awards', async () => {
		const f = await fixture();
		// Live data changes AFTER the freeze: bond 200 is delivered and sold now, but the frozen roster
		// recorded it as not sold, so the winner must still be classified from the frozen snapshot.
		await rpc('bond_deliver', {
			p_campaign_id: f.campaignId,
			p_collector_id: f.collectorId,
			p_bond_ids: [f.unsoldId],
			p_notes: null,
			p_request_id: ctx().requestId
		});
		await rpc('sale_register', {
			p_campaign_id: f.campaignId,
			p_bond_id: f.unsoldId,
			p_buyer_id: f.buyerId,
			p_payment_mode: 'full_payment',
			p_first_due_date: today,
			p_request_id: ctx().requestId
		});
		expect((await row('bonds', f.unsoldId)).commercial_status).toBe('sold');
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
	it('C4 annuls incorrect history, reuses position on a replacement and audits both events', async () => {
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
	it('Denials: rejects all six services in SQL with forged TS permissions and no state/audit writes', async () => {
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
	it('C5 blocks consolation generation and freeze until all previous excluding prizes are resolved', async () => {
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
	it('C4 annuls from pending_validation and pending_delivery, keeping the winner and award history', async () => {
		const f = await fixture();
		const pending = await f.prize(1);
		const pendingWinner = await loadWinningNumber(
			admin,
			{ prizeId: pending, numberValue: 100, notes: null },
			ctx()
		);
		expect((await row('prizes', pending)).status).toBe('pending_validation');
		const pendingRequest = ctx();
		await annulPrize(admin, { prizeId: pending, reason: 'Wrong prize' }, pendingRequest);
		expect((await row('prizes', pending)).status).toBe('annulled');
		expect((await row('winning_numbers', pendingWinner)).result_status).toBe('eligible_winner');
		expect(await audits(pendingRequest.requestId)).toMatchObject([
			{ action: 'prize.annul', reason: 'Wrong prize' }
		]);
		const awarded = await f.prize(1);
		await loadWinningNumber(admin, { prizeId: awarded, numberValue: 100, notes: null }, ctx());
		await resolvePrize(admin, { prizeId: awarded, decision: 'award', notes: null }, ctx());
		expect((await row('prizes', awarded)).status).toBe('pending_delivery');
		await annulPrize(admin, { prizeId: awarded, reason: 'Wrong winner' }, ctx());
		expect((await row('prizes', awarded)).status).toBe('annulled');
		const { data: awards, error } = await admin
			.from('prize_awards')
			.select('status,bond_id')
			.eq('prize_id', awarded);
		if (error) throw error;
		expect(awards).toEqual([{ status: 'annulled', bond_id: f.bondId }]);
	});

	it('C4 requires the dedicated annul permission even when resolution is allowed in TS', async () => {
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
	it('C5 consolation parity excludes only prior active excluding awards and regenerates after annulment', async () => {
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

	it('C6 loads and renders delivery and unawarded certificates through the real routes for draw.view', async () => {
		const f = await fixture();
		const deliveredPrize = await f.prize();
		await loadWinningNumber(
			admin,
			{ prizeId: deliveredPrize, numberValue: 100, notes: 'Loaded' },
			ctx()
		);
		await resolvePrize(
			admin,
			{ prizeId: deliveredPrize, decision: 'award', notes: 'Approved' },
			ctx()
		);
		await deliverPrize(admin, { prizeId: deliveredPrize, notes: 'Received by buyer' }, ctx());
		const unawardedPrize = await f.prize(2);
		await loadWinningNumber(
			admin,
			{ prizeId: unawardedPrize, numberValue: 200, notes: 'Not paid' },
			ctx()
		);
		const operatorFixture = seed.fixtures.find((fixture) => fixture.roleNames.includes('operator'));
		if (!operatorFixture) throw new Error('Missing seeded operator fixture');
		const operator = createClient(supabaseUrl, anonKey, {
			auth: { autoRefreshToken: false, persistSession: false }
		});
		const { error: operatorSignInError } = await operator.auth.signInWithPassword({
			email: operatorFixture.email,
			password: operatorFixture.password
		});
		if (operatorSignInError) throw operatorSignInError;
		const { data: session } = await operator.auth.getSession();
		const { data: userData, error: userError } = await operator.auth.getUser();
		if (userError || !userData.user) throw userError ?? new Error('Missing read-only user');
		const { data: profile, error: profileError } = await operator
			.from('profiles')
			.select('*')
			.eq('auth_user_id', userData.user.id)
			.single();
		if (profileError || !profile) throw profileError ?? new Error('Missing read-only profile');
		const readOnlyPermissions = await loadPermissions(operator);
		expect(readOnlyPermissions).toContain('draw.view');
		expect(readOnlyPermissions).not.toContain('prize.deliver');
		const event = (prizeId: string) =>
			({
				locals: {
					supabase: operator,
					user: userData.user,
					session: session.session,
					profile,
					permissions: readOnlyPermissions,
					requestId: ctx().requestId,
					safeGetSession: async () => ({ session: session.session, user: userData.user })
				},
				params: { id: f.campaignId, drawId: f.drawId, prizeId },
				url: new URL('http://localhost/print')
			}) as never;
		const delivery = (await deliveryCertificateLoad(event(deliveredPrize)))! as any;
		const unawarded = (await unawardedCertificateLoad(event(unawardedPrize)))! as any;
		expect(delivery.document).toMatchObject({
			draw: expect.any(String),
			prize: expect.any(String),
			winningNumber: '0100',
			associatedBond: expect.any(String),
			buyer: expect.any(String),
			collector: expect.any(String),
			rosterStatus: 'Eligible',
			notes: 'Received by buyer',
			registeredBy: 'System Administrator'
		});
		expect(unawarded.document).toMatchObject({
			draw: expect.any(String),
			prize: expect.any(String),
			winningNumber: '0200',
			associatedBond: expect.any(String),
			buyer: '—',
			reason: 'Bond not sold',
			rosterStatus: 'Not eligible — Bond not sold',
			notes: 'Not paid',
			registeredBy: 'System Administrator'
		});
		const deliveryHtml = render(DeliveryCertificatePage, {
			props: { data: delivery, params: {} } as any
		}).body;
		const unawardedHtml = render(UnawardedCertificatePage, {
			props: { data: unawarded, params: {} } as any
		}).body;
		for (const value of Object.values(delivery.document))
			expect(deliveryHtml).toContain(String(value));
		for (const value of Object.values(unawarded.document))
			expect(unawardedHtml).toContain(String(value));
		expect(deliveryCertificateSource).toContain('@media print');
		expect(unawardedCertificateSource).toContain('@media print');
		const wrongDraw: any = event(deliveredPrize);
		wrongDraw.params.drawId = randomUUID();
		await expect(deliveryCertificateLoad(wrongDraw)).rejects.toMatchObject({ status: 404 });
		const wrongCampaign: any = event(deliveredPrize);
		wrongCampaign.params.id = randomUUID();
		await expect(deliveryCertificateLoad(wrongCampaign)).rejects.toMatchObject({ status: 404 });
		await expect(unawardedCertificateLoad(event(deliveredPrize))).rejects.toMatchObject({
			status: expect.any(Number)
		});
		await annulPrize(admin, { prizeId: unawardedPrize, reason: 'Certificate correction' }, ctx());
		await expect(unawardedCertificateLoad(event(unawardedPrize))).rejects.toMatchObject({
			status: 404
		});
	});
});
