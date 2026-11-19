import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
	getDeliveryNote,
	listBondAssignments,
	listDeliveryNotes
} from '$lib/server/repositories/deliveries';
import {
	DeliveryServiceError,
	assignBondsToCollector,
	markBondLost,
	reassignBondsToCollector,
	returnBondsFromCollector
} from '$lib/server/services/deliveries';
import { createCollector } from '$lib/server/services/parties';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';

/**
 * SAN-53/54: the delivery services and reads against the local Supabase, with the seeded admin
 * and operator. Nothing can be deleted: every run creates its own campaign and collectors.
 */

const { supabaseUrl, anonKey, seedEnv } = inject('integrationEnv');
const seedConfig = resolveSeedConfig(seedEnv);
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;

interface Caller {
	client: SupabaseClient;
	permissions: string[];
}

async function signIn(email: string, password: string): Promise<Caller> {
	const anonClient = createClient(supabaseUrl, anonKey, clientOptions);
	const { data, error } = await anonClient.auth.signInWithPassword({ email, password });
	if (error || !data.session) throw new Error(`Failed to sign in as ${email}`);
	const client = createClient(supabaseUrl, anonKey, {
		...clientOptions,
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
	return { client, permissions: await loadPermissions(client) };
}

let admin: Caller;
let operator: Caller;
let campaignId: string;
let ana: string;
let beto: string;
const bondIds: string[] = [];

const ctx = (caller: Caller, label: string) => ({
	requestId: `it-delivery-${RUN_ID}-${label}`,
	permissions: caller.permissions
});

beforeAll(async () => {
	admin = await signIn(seedConfig.admin.email, seedConfig.admin.password);
	const op = seedConfig.fixtures.find((f) => f.roleNames.includes('operator'))!;
	operator = await signIn(op.email, op.password);
	const campaign = await admin.client.rpc('campaign_create', {
		p_name: `[it-delivery ${RUN_ID}] Delivery`,
		p_simple_bond_value: '60000.00',
		p_installment_count: 10,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_starts_at: '2026-01-01T03:00:00Z',
		p_ends_at: '2027-12-31T03:00:00Z',
		p_request_id: `it-delivery-${RUN_ID}-campaign`
	});
	if (campaign.error) throw new Error(campaign.error.message);
	campaignId = campaign.data as string;
	// Bonds are delivered only while the campaign is active.
	const activated = await admin.client.rpc('campaign_transition', {
		p_id: campaignId,
		p_to_status: 'active',
		p_request_id: `it-delivery-${RUN_ID}-activate`
	});
	if (activated.error) throw new Error(activated.error.message);
	for (const n of [10, 11, 12, 13]) {
		const bond = await admin.client.rpc('bond_create', {
			p_campaign_id: campaignId,
			p_base_numbers: [n],
			p_request_id: `it-delivery-${RUN_ID}-bond-${n}`
		});
		if (bond.error) throw new Error(bond.error.message);
		bondIds.push(bond.data as string);
	}
	const base = {
		phone: null,
		email: null,
		address: null,
		userProfileId: null,
		status: 'active' as const
	};
	ana = await createCollector(
		admin.client,
		{ ...base, displayName: `Ana ${RUN_ID}` },
		ctx(admin, 'ana')
	);
	beto = await createCollector(
		admin.client,
		{ ...base, displayName: `Beto ${RUN_ID}` },
		ctx(admin, 'beto')
	);
});

describe('bond delivery (local Supabase)', () => {
	it('the operator delivers bonds and the note can be listed and read', async () => {
		const noteId = await assignBondsToCollector(
			operator.client,
			{ campaignId, collectorId: ana, bondIds: bondIds.slice(0, 3), notes: 'first batch' },
			ctx(operator, 'deliver')
		);
		// Collector names need collector.view (admin, and the operator since SAN-93).
		const list = await listDeliveryNotes(admin.client, campaignId);
		expect(list.error).toBeNull();
		expect(list.data?.items).toEqual([
			expect.objectContaining({
				id: noteId,
				noteNumber: 1,
				collectorId: ana,
				collectorName: `Ana ${RUN_ID}`,
				reason: 'delivery',
				bondCount: 3,
				notes: 'first batch'
			})
		]);
		// The operator reads the note with the collector's name (collector.view, SAN-93).
		const operatorView = await listDeliveryNotes(operator.client, campaignId);
		expect(operatorView.data?.items[0]).toMatchObject({
			id: noteId,
			collectorName: `Ana ${RUN_ID}`
		});
		const note = await getDeliveryNote(operator.client, campaignId, noteId);
		expect(note.data?.bondIds.sort()).toEqual(bondIds.slice(0, 3).sort());
		const filtered = await listDeliveryNotes(operator.client, campaignId, { collectorId: beto });
		expect(filtered.data?.items).toHaveLength(0);
	});

	it('reassignment, return and loss build the custody history', async () => {
		await reassignBondsToCollector(
			operator.client,
			{ campaignId, collectorId: beto, bondIds: [bondIds[0]] },
			ctx(operator, 'reassign')
		);
		// SAN-93 (#44): the operator returns bonds too, but cannot mark them lost (admin only).
		await expect(
			markBondLost(
				operator.client,
				{
					campaignId,
					bondId: bondIds[1],
					responsibleParty: 'X',
					lostOn: '2026-11-01',
					reason: 'x'
				},
				ctx(operator, 'lost-denied')
			)
		).rejects.toMatchObject({ kind: 'permission' });
		const returnNoteId = await returnBondsFromCollector(
			operator.client,
			{ campaignId, bondIds: [bondIds[1]], fromCollectorId: ana },
			ctx(admin, 'return')
		);
		// The return issues a note for the collector (its receipt).
		const returnNote = await getDeliveryNote(admin.client, campaignId, returnNoteId);
		expect(returnNote.data?.note).toMatchObject({ reason: 'return', collectorId: ana });
		expect(returnNote.data?.bondIds).toEqual([bondIds[1]]);
		await markBondLost(
			admin.client,
			{
				campaignId,
				bondId: bondIds[2],
				responsibleParty: 'Ana',
				lostOn: '2026-11-01',
				reason: 'wet'
			},
			ctx(admin, 'lost')
		);

		const history = await listBondAssignments(admin.client, bondIds[0]);
		expect(
			history.data?.map((a) => [a.assignmentType, a.status, a.collectorName, a.noteNumber])
		).toEqual([
			['delivery', 'reassigned', `Ana ${RUN_ID}`, 1],
			['reassignment', 'active', `Beto ${RUN_ID}`, 2]
		]);
		const returned = await listBondAssignments(operator.client, bondIds[1]);
		expect(returned.data?.at(-1)?.deliveryNoteId).toBe(returnNoteId);
		expect(returned.data?.map((a) => [a.assignmentType, a.status])).toEqual([
			['delivery', 'returned'],
			['return', 'returned']
		]);
		const lost = await listBondAssignments(operator.client, bondIds[2]);
		expect(lost.data?.at(-1)).toMatchObject({
			assignmentType: 'lost',
			responsibleParty: 'Ana',
			lostOn: '2026-11-01',
			notes: 'wet'
		});
	});

	it('refusals come back as typed errors on the right field', async () => {
		const sold = assignBondsToCollector(
			operator.client,
			{ campaignId, collectorId: ana, bondIds: [bondIds[2]] },
			ctx(operator, 'lost-again')
		);
		await expect(sold).rejects.toBeInstanceOf(DeliveryServiceError);
		await expect(sold).rejects.toMatchObject({ kind: 'conflict', field: 'bondIds' });
		await expect(
			markBondLost(
				admin.client,
				{
					campaignId,
					bondId: bondIds[3],
					responsibleParty: ' ',
					lostOn: '2026-11-01',
					reason: 'x'
				},
				ctx(admin, 'no-responsible')
			)
		).rejects.toMatchObject({ kind: 'validation', field: 'responsibleParty' });
	});

	it('a stale source collector and an impossible loss date are refused on the right field', async () => {
		// bondIds[0] is with Beto (reassigned above): a screen that still shows it with Ana is stale.
		await expect(
			returnBondsFromCollector(
				admin.client,
				{ campaignId, bondIds: [bondIds[0]], fromCollectorId: ana },
				ctx(admin, 'stale-return')
			)
		).rejects.toMatchObject({ kind: 'conflict', field: 'bondIds' });
		await expect(
			reassignBondsToCollector(
				admin.client,
				{ campaignId, collectorId: ana, bondIds: [bondIds[0]], fromCollectorId: ana },
				ctx(admin, 'stale-reassign')
			)
		).rejects.toMatchObject({ kind: 'conflict', field: 'bondIds' });
		await expect(
			markBondLost(
				admin.client,
				{
					campaignId,
					bondId: bondIds[3],
					responsibleParty: 'Ana',
					lostOn: '2026-02-31',
					reason: 'x'
				},
				ctx(admin, 'bad-date')
			)
		).rejects.toMatchObject({ kind: 'validation', field: 'lostOn' });
	});
});
