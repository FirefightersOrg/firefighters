import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import {
	actions as deliveryActions,
	load as newDeliveryLoad
} from '../../src/routes/campaigns/[id]/deliveries/new/+page.server';
import { load as notesLoad } from '../../src/routes/campaigns/[id]/deliveries/+page.server';
import {
	load as bondLoad,
	actions as bondActions
} from '../../src/routes/campaigns/[id]/bonds/[bondId]/+page.server';
import { actions as collectorActions } from '../../src/routes/campaigns/[id]/collectors/[collectorId]/+page.server';
import { load as printLoad } from '../../src/routes/campaigns/[id]/deliveries/[noteId]/print/+page.server';
import PrintPage from '../../src/routes/campaigns/[id]/deliveries/[noteId]/print/+page@.svelte';
import { createCollector } from '$lib/server/services/parties';
import { loadPermissions } from './permissions';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import type { UserProfile } from '../../src/app';

/** Phase 6 acceptance: real route modules, real local Supabase/RLS, no mocks. */
const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seed = resolveSeedConfig(seedEnv);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
let sequence = 0;
const rid = (label: string) => `it-p6-${RUN_ID}-${String(++sequence).padStart(3, '0')}-${label}`;
type Role = 'admin' | 'operator' | 'treasurer' | 'read-only';
type Caller = {
	role: Role;
	user: User;
	client: SupabaseClient;
	profile: UserProfile;
	permissions: string[];
};
let service: SupabaseClient;
const users = {} as Record<Role, Caller>;
let campaignId: string;
let collectorId: string;
let otherCollectorId: string;
let nextNumber = 100;

async function signIn(role: Role, email: string, password: string): Promise<Caller> {
	const auth = createClient(supabaseUrl, anonKey, options);
	const { data, error } = await auth.auth.signInWithPassword({ email, password });
	if (error || !data.session) throw new Error(`Could not sign in ${email}: ${error?.message}`);
	const client = createClient(supabaseUrl, anonKey, {
		...options,
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
	const { data: profile, error: profileError } = await service
		.from('profiles')
		.select('*')
		.eq('auth_user_id', data.user.id)
		.single();
	if (profileError || !profile) throw new Error(`No profile for ${email}`);
	return {
		role,
		user: data.user,
		client,
		profile: profile as UserProfile,
		permissions: await loadPermissions(client)
	};
}
function event<E>(
	caller: Caller,
	path: string,
	params: Record<string, string>,
	fields?: Record<string, string | string[]>,
	requestId = rid('request')
): E {
	const url = new URL(`http://localhost${path}`);
	const body = new FormData();
	for (const [key, value] of Object.entries(fields ?? {}))
		for (const v of [value].flat()) body.append(key, v);
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
	} as unknown as E;
}
async function result(fn: () => unknown) {
	try {
		return await fn();
	} catch (err) {
		if (isRedirect(err)) return { redirect: err.location, status: err.status };
		if (isHttpError(err)) return err.status;
		throw err;
	}
}
async function auditFor(requestId: string) {
	const { data, error } = await service
		.from('audit_log')
		.select('action, entity_id, request_id')
		.eq('request_id', requestId);
	expect(error).toBeNull();
	return data ?? [];
}
async function bond(
	barcode: string | null = null,
	targetCampaignId = campaignId,
	number = nextNumber++
) {
	const { data, error } = await users.admin.client.rpc('bond_create', {
		p_campaign_id: targetCampaignId,
		p_base_numbers: [number],
		p_barcode: barcode,
		p_request_id: rid(`bond-${number}`)
	});
	if (error || typeof data !== 'string') throw new Error(`bond_create: ${error?.message}`);
	return data;
}
async function deliver(
	ids: string[],
	collector = collectorId,
	notes = 'Phase 6 delivery',
	targetCampaignId = campaignId
) {
	const requestId = rid('deliver');
	const out = await result(() =>
		deliveryActions.deliver(
			event(
				users.operator,
				`/campaigns/${targetCampaignId}/deliveries/new?/deliver`,
				{ id: targetCampaignId },
				{ collectorId: collector, bondIds: ids, notes },
				requestId
			)
		)
	);
	expect(out).toMatchObject({
		redirect: expect.stringMatching(/\/deliveries\/[0-9a-f-]{36}$/),
		status: 303
	});
	return {
		noteId: String((out as { redirect: string }).redirect)
			.split('/')
			.at(-1)!,
		requestId
	};
}
async function activateCampaign(id: string, requestId = rid('activate')) {
	const { error } = await users.admin.client.rpc('campaign_transition', {
		p_id: id,
		p_to_status: 'active',
		p_reason: null,
		p_request_id: requestId
	});
	if (error) throw new Error(`campaign_transition: ${error.message}`);
}
const bondPath = (id: string) => `/campaigns/${campaignId}/bonds/${id}`;
const collectorPath = (id: string) => `/campaigns/${campaignId}/collectors/${id}`;

beforeAll(async () => {
	service = createClient(supabaseUrl, serviceRoleKey, options);
	users.admin = await signIn('admin', seed.admin.email, seed.admin.password);
	for (const role of ['operator', 'treasurer', 'read-only'] as const) {
		const fixture = seed.fixtures.find((x) => x.roleNames.includes(role))!;
		users[role] = await signIn(role, fixture.email, fixture.password);
	}
	const created = await users.admin.client.rpc('campaign_create', {
		p_name: `[it-p6 ${RUN_ID}] custody`,
		p_simple_bond_value: '60000',
		p_installment_count: 10,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_starts_at: '2026-01-01T00:00:00Z',
		p_ends_at: '2027-01-01T00:00:00Z',
		p_request_id: rid('campaign')
	});
	if (created.error || typeof created.data !== 'string')
		throw new Error(`campaign_create: ${created.error?.message}`);
	campaignId = created.data;
	await activateCampaign(campaignId);
	const base = {
		phone: null,
		email: null,
		address: null,
		userProfileId: null,
		status: 'active' as const
	};
	collectorId = await createCollector(
		users.admin.client,
		{ ...base, displayName: `Collector A ${RUN_ID}` },
		{ requestId: rid('collector-a'), permissions: users.admin.permissions }
	);
	otherCollectorId = await createCollector(
		users.admin.client,
		{ ...base, displayName: `Collector B ${RUN_ID}` },
		{ requestId: rid('collector-b'), permissions: users.admin.permissions }
	);
});

describe('Phase 6: delivery and printable delivery note', () => {
	it('C1 delivers three available bonds through the route and writes complete custody/audit history', async () => {
		const { data: previousNotes, error: previousNotesError } = await service
			.from('delivery_notes')
			.select('note_number')
			.eq('campaign_id', campaignId)
			.order('note_number', { ascending: false })
			.limit(1);
		expect(previousNotesError).toBeNull();
		const previousMaxNoteNumber = previousNotes?.[0]?.note_number ?? 0;
		const ids = await Promise.all([bond('P6-A'), bond(null), bond('P6-C')]);
		const { noteId, requestId } = await deliver(ids);
		const { data: bonds } = await service
			.from('bonds')
			.select('id, commercial_status, current_collector_id')
			.in('id', ids);
		expect(bonds).toEqual(
			expect.arrayContaining(
				ids.map((id) =>
					expect.objectContaining({
						id,
						commercial_status: 'delivered_to_collector',
						current_collector_id: collectorId
					})
				)
			)
		);
		const { data: note } = await service
			.from('delivery_notes')
			.select('note_number, reason, collector_id')
			.eq('id', noteId)
			.single();
		expect(note).toMatchObject({
			note_number: previousMaxNoteNumber + 1,
			reason: 'delivery',
			collector_id: collectorId
		});
		const { data: assignments } = await service
			.from('bond_assignments')
			.select('bond_id, assignment_type, status, delivery_note_id')
			.in('bond_id', ids)
			.eq('status', 'active');
		expect(assignments).toEqual(
			expect.arrayContaining(
				ids.map((bond_id) =>
					expect.objectContaining({
						bond_id,
						assignment_type: 'delivery',
						delivery_note_id: noteId
					})
				)
			)
		);
		expect(
			(await service.from('delivery_note_items').select('bond_id').eq('delivery_note_id', noteId))
				.data
		).toHaveLength(3);
		expect((await auditFor(requestId)).map((a) => a.action).sort()).toEqual([
			'bond.deliver',
			'bond.deliver',
			'bond.deliver',
			'delivery_note.issue'
		]);
		const record = (await bondLoad(
			event(users.admin, bondPath(ids[0]), { id: campaignId, bondId: ids[0] })
		)) as { custody: { history: { assignmentType: string }[] } };
		expect(record.custody.history).toEqual(
			expect.arrayContaining([expect.objectContaining({ assignmentType: 'delivery' })])
		);
	});
	it('C2 SSR-renders all printable note fields twice, including barcode and no-barcode bonds', async () => {
		const printCampaignName = `[it-p6 ${RUN_ID}] printable`;
		const { data: printCampaignId, error: printCampaignError } = await users.admin.client.rpc(
			'campaign_create',
			{
				p_name: printCampaignName,
				p_simple_bond_value: '60000',
				p_installment_count: 10,
				p_number_digits: 4,
				p_max_number: 9999,
				p_associated_number_offset: 4871,
				p_overflow_policy: 'reject',
				p_barcode_mode: 'base_number',
				p_starts_at: '2026-01-01T00:00:00Z',
				p_ends_at: '2027-01-01T00:00:00Z',
				p_request_id: rid('printable-campaign')
			}
		);
		if (printCampaignError || typeof printCampaignId !== 'string')
			throw new Error(`campaign_create: ${printCampaignError?.message}`);
		await activateCampaign(printCampaignId);
		const withBarcode = await bond(`P6-BARCODE-${RUN_ID}`, printCampaignId, 100),
			withoutBarcode = await bond(null, printCampaignId, 101);
		const { noteId } = await deliver(
			[withBarcode, withoutBarcode],
			collectorId,
			`Notes ${RUN_ID}`,
			printCampaignId
		);
		const data = (await printLoad(
			event(users.admin, `/campaigns/${printCampaignId}/deliveries/${noteId}/print`, {
				id: printCampaignId,
				noteId
			})
		)) as {
			document: {
				institutionName: string;
				campaign: string;
				deliveryNoteNumber: string;
				date: string;
				collector: string;
				registeredBy: string;
				deliveredBonds: unknown[];
				type: string;
				baseAndAssociatedNumbers: string[];
				barcode: string[];
				notes: string;
				collectorSignature: string;
				administrationSignature: string;
			};
		};
		const html = render(PrintPage, { props: { data, params: {} } as never }).body;
		const doc = data.document;
		for (const value of [
			printCampaignName,
			'Note 0001',
			`Collector A ${RUN_ID}`,
			users.operator.profile.full_name,
			'0100 / 4971',
			'0101 / 4972',
			`P6-BARCODE-${RUN_ID}`,
			`Notes ${RUN_ID}`
		])
			expect(html.split(value).length - 1, value).toBe(2);
		for (const value of [
			doc.institutionName,
			doc.date,
			doc.collectorSignature,
			doc.administrationSignature
		])
			expect(html.split(value).length - 1, value).toBe(2);
		expect(html.split('Simple').length - 1).toBe(4);
		expect(doc.deliveredBonds).toHaveLength(2);
		expect(html).toContain('—');
		expect(html).toContain('ORIGINAL – Administration');
		expect(html).toContain('DUPLICATE – Collector');
	});
	it('C3 returns and reassigns via bond and collector actions, while rejected lost custody is unchanged', async () => {
		const returned = await bond(),
			reassigned = await bond(),
			bulk = await bond();
		await deliver([returned, reassigned, bulk]);
		expect(
			await result(() =>
				bondActions.return(
					event(
						users.admin,
						`${bondPath(returned)}?/return`,
						{ id: campaignId, bondId: returned },
						{ notes: 'returned', fromCollectorId: collectorId },
						rid('return')
					)
				)
			)
			// The return issues a return note and opens it (#47 decision).
		).toMatchObject({ redirect: expect.stringMatching(/\/deliveries\/[0-9a-f-]{36}$/) });
		const reassignment = await result(() =>
			bondActions.reassign(
				event(
					users.operator,
					`${bondPath(reassigned)}?/reassign`,
					{ id: campaignId, bondId: reassigned },
					{ collectorId: otherCollectorId, fromCollectorId: collectorId },
					rid('reassign')
				)
			)
		);
		expect(reassignment).toMatchObject({ redirect: expect.any(String) });
		expect(
			await result(() =>
				collectorActions.reassignBonds(
					event(
						users.admin,
						`${collectorPath(collectorId)}?/reassignBonds`,
						{ id: campaignId, collectorId },
						{ bondIds: [bulk], targetCollectorId: otherCollectorId },
						rid('bulk-reassign')
					)
				)
			)
		).toMatchObject({ redirect: expect.any(String) });
		const bulkReturn = await result(() =>
			collectorActions.returnBonds(
				event(
					users.admin,
					`${collectorPath(otherCollectorId)}?/returnBonds`,
					{ id: campaignId, collectorId: otherCollectorId },
					{ bondIds: [bulk] },
					rid('bulk-return')
				)
			)
		);
		// A bulk return issues one return note and opens it.
		expect(bulkReturn).toMatchObject({
			redirect: expect.stringMatching(/\/deliveries\/[0-9a-f-]{36}$/)
		});
		expect(
			(
				await service
					.from('bonds')
					.select('commercial_status, current_collector_id')
					.eq('id', returned)
					.single()
			).data
		).toMatchObject({ commercial_status: 'available', current_collector_id: null });
		expect(
			(
				await service
					.from('bond_assignments')
					.select('assignment_type, status')
					.eq('bond_id', returned)
			).data
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ assignment_type: 'delivery', status: 'returned' }),
				expect.objectContaining({ assignment_type: 'return', status: 'returned' })
			])
		);
		expect(
			(
				await service
					.from('bond_assignments')
					.select('status')
					.eq('bond_id', reassigned)
					.eq('assignment_type', 'delivery')
					.single()
			).data
		).toMatchObject({ status: 'reassigned' });
		const deniedRequest = rid('lost-rejected');
		const before = await service
			.from('bonds')
			.select('commercial_status')
			.eq('id', reassigned)
			.single();
		expect(
			await result(() =>
				bondActions.markLost(
					event(
						users.operator,
						`${bondPath(reassigned)}?/markLost`,
						{ id: campaignId, bondId: reassigned },
						{ responsibleParty: 'X', lostOn: '2026-01-01', reason: 'no permission' },
						deniedRequest
					)
				)
			)
		).toMatchObject({ status: 403 });
		expect(await auditFor(deniedRequest)).toEqual([]);
		expect(
			(await service.from('bonds').select('commercial_status').eq('id', reassigned).single()).data
		).toEqual(before.data);

		// A bond that is no longer with a collector (lost) cannot be returned or reassigned: 409,
		// unchanged, no audit. (A sold bond cannot be produced before Phase 7; see Known gaps.)
		const lost = await bond();
		await deliver([lost]);
		expect(
			await result(() =>
				bondActions.markLost(
					event(
						users.admin,
						`${bondPath(lost)}?/markLost`,
						{ id: campaignId, bondId: lost },
						{ responsibleParty: 'Ana', lostOn: '2026-11-01', reason: 'rain' },
						rid('lost-setup')
					)
				)
			)
		).toMatchObject({ success: true });
		const lostBefore = (
			await service
				.from('bonds')
				.select('commercial_status, current_collector_id, updated_at')
				.eq('id', lost)
				.single()
		).data;
		for (const [action, fields] of [
			['return', { fromCollectorId: collectorId }],
			['reassign', { collectorId: otherCollectorId, fromCollectorId: collectorId }]
		] as const) {
			const requestId = rid(`lost-${action}`);
			expect(
				await result(() =>
					bondActions[action](
						event(
							users.admin,
							`${bondPath(lost)}?/${action}`,
							{ id: campaignId, bondId: lost },
							fields,
							requestId
						)
					)
				),
				action
			).toMatchObject({ status: 409 });
			expect(await auditFor(requestId)).toEqual([]);
		}
		expect(
			(
				await service
					.from('bonds')
					.select('commercial_status, current_collector_id, updated_at')
					.eq('id', lost)
					.single()
			).data
		).toEqual(lostBefore);
	});
	it('C4 validates loss fields before RPC and persists a valid loss with its audit', async () => {
		const id = await bond();
		for (const fields of [
			{ lostOn: '2026-01-01', reason: 'x' },
			{ responsibleParty: 'A', reason: 'x' },
			{ responsibleParty: 'A', lostOn: '2026-01-01' },
			{ responsibleParty: 'A', lostOn: '2999-01-01', reason: 'x' }
		] as Record<string, string>[]) {
			const requestId = rid('bad-loss');
			expect(
				await result(() =>
					bondActions.markLost(
						event(
							users.admin,
							`${bondPath(id)}?/markLost`,
							{ id: campaignId, bondId: id },
							fields,
							requestId
						)
					)
				)
			).toMatchObject({ status: 400 });
			expect(await auditFor(requestId)).toEqual([]);
		}
		const requestId = rid('lost');
		expect(
			await result(() =>
				bondActions.markLost(
					event(
						users.admin,
						`${bondPath(id)}?/markLost`,
						{ id: campaignId, bondId: id },
						{ responsibleParty: 'Custodian', lostOn: '2026-01-01', reason: 'water' },
						requestId
					)
				)
			)
		).toMatchObject({ success: true });
		expect(
			(
				await service
					.from('bonds')
					.select('commercial_status, current_collector_id')
					.eq('id', id)
					.single()
			).data
		).toMatchObject({ commercial_status: 'lost', current_collector_id: null });
		expect(
			(
				await service
					.from('bond_assignments')
					.select('assignment_type, responsible_party, lost_on, notes')
					.eq('bond_id', id)
					.eq('assignment_type', 'lost')
					.single()
			).data
		).toMatchObject({
			assignment_type: 'lost',
			responsible_party: 'Custodian',
			lost_on: '2026-01-01',
			notes: 'water'
		});
		expect((await auditFor(requestId)).map((a) => a.action)).toEqual(['bond.mark_lost']);
	});
	it('C5 applies the current route permission matrix without denied-request audit rows', async () => {
		const id = await bond();
		const { noteId } = await deliver([id]);
		const free = await bond();
		for (const user of [users.treasurer, users['read-only']]) {
			// They can read the notes (bond.view)...
			expect(
				await notesLoad(event(user, `/campaigns/${campaignId}/deliveries`, { id: campaignId }))
			).toMatchObject({
				notes: expect.arrayContaining([expect.objectContaining({ id: noteId })]),
				can: { deliver: false }
			});
			// ...but cannot open the delivery screen nor write anything.
			expect(
				await result(() =>
					newDeliveryLoad(
						event(user, `/campaigns/${campaignId}/deliveries/new`, { id: campaignId })
					)
				)
			).toBe(403);
			const attempts: [string, () => unknown][] = [];
			const deliverRequest = rid(`${user.role}-deliver`);
			attempts.push([
				deliverRequest,
				() =>
					deliveryActions.deliver(
						event(
							user,
							`/campaigns/${campaignId}/deliveries/new?/deliver`,
							{ id: campaignId },
							{ collectorId, bondIds: [free] },
							deliverRequest
						)
					)
			]);
			for (const [action, fields] of [
				['return', {}],
				['reassign', { collectorId: otherCollectorId }],
				['markLost', { responsibleParty: 'X', lostOn: '2026-01-01', reason: 'x' }]
			] as const) {
				const requestId = rid(`${user.role}-${action}`);
				attempts.push([
					requestId,
					() =>
						bondActions[action](
							event(
								user,
								`${bondPath(id)}?/${action}`,
								{ id: campaignId, bondId: id },
								fields,
								requestId
							)
						)
				]);
			}
			for (const [requestId, attempt] of attempts) {
				expect(await result(attempt), requestId).toMatchObject({ status: 403 });
				expect(await auditFor(requestId), requestId).toEqual([]);
			}
		}
		expect(
			(await service.from('bonds').select('id, commercial_status').in('id', [id, free])).data
		).toEqual(
			expect.arrayContaining([
				{ id, commercial_status: 'delivered_to_collector' },
				{ id: free, commercial_status: 'available' }
			])
		);
		// SAN-93 (#44): the operator returns bonds, but marking one lost stays admin-only.
		for (const [action, fields] of [
			['markLost', { responsibleParty: 'X', lostOn: '2026-01-01', reason: 'x' }]
		] as const) {
			const requestId = rid(`operator-${action}`);
			expect(
				await result(() =>
					bondActions[action](
						event(
							users.operator,
							`${bondPath(id)}?/${action}`,
							{ id: campaignId, bondId: id },
							fields,
							requestId
						)
					)
				)
			).toMatchObject({ status: 403 });
			expect(await auditFor(requestId)).toEqual([]);
		}
	});
	it('C6 rejects every custody write after a campaign enters closing without changing bonds', async () => {
		const created = await users.admin.client.rpc('campaign_create', {
			p_name: `[it-p6 ${RUN_ID}] closing`,
			p_simple_bond_value: '60000',
			p_installment_count: 10,
			p_number_digits: 4,
			p_max_number: 9999,
			p_associated_number_offset: 4871,
			p_overflow_policy: 'reject',
			p_barcode_mode: 'base_number',
			p_starts_at: '2026-01-01T00:00:00Z',
			p_ends_at: '2027-01-01T00:00:00Z',
			p_request_id: rid('closing-campaign')
		});
		const closingId = created.data as string;
		expect(
			(
				await users.admin.client.rpc('campaign_transition', {
					p_id: closingId,
					p_to_status: 'active',
					p_reason: null,
					p_request_id: rid('activate')
				})
			).error
		).toBeNull();
		const available = (
			await users.admin.client.rpc('bond_create', {
				p_campaign_id: closingId,
				p_base_numbers: [1],
				p_request_id: rid('closing-available')
			})
		).data as string;
		const delivered = (
			await users.admin.client.rpc('bond_create', {
				p_campaign_id: closingId,
				p_base_numbers: [2],
				p_request_id: rid('closing-delivered')
			})
		).data as string;
		await result(() =>
			deliveryActions.deliver(
				event(
					users.operator,
					`/campaigns/${closingId}/deliveries/new?/deliver`,
					{ id: closingId },
					{ collectorId, bondIds: [delivered] },
					rid('pre-close-deliver')
				)
			)
		);
		expect(
			(
				await users.admin.client.rpc('campaign_transition', {
					p_id: closingId,
					p_to_status: 'closing',
					p_reason: null,
					p_request_id: rid('closing')
				})
			).error
		).toBeNull();
		const attempts: [string, () => unknown][] = [
			[
				rid('closed-deliver'),
				() =>
					deliveryActions.deliver(
						event(
							users.operator,
							`/campaigns/${closingId}/deliveries/new?/deliver`,
							{ id: closingId },
							{ collectorId, bondIds: [available] },
							attempts[0][0]
						)
					)
			],
			[
				rid('closed-return'),
				() =>
					bondActions.return(
						event(
							users.admin,
							`/campaigns/${closingId}/bonds/${delivered}?/return`,
							{ id: closingId, bondId: delivered },
							{ fromCollectorId: collectorId },
							attempts[1][0]
						)
					)
			],
			[
				rid('closed-reassign'),
				() =>
					bondActions.reassign(
						event(
							users.operator,
							`/campaigns/${closingId}/bonds/${delivered}?/reassign`,
							{ id: closingId, bondId: delivered },
							{ collectorId: otherCollectorId, fromCollectorId: collectorId },
							attempts[2][0]
						)
					)
			],
			[
				rid('closed-lost'),
				() =>
					bondActions.markLost(
						event(
							users.admin,
							`/campaigns/${closingId}/bonds/${available}?/markLost`,
							{ id: closingId, bondId: available },
							{ responsibleParty: 'X', lostOn: '2026-01-01', reason: 'x' },
							attempts[3][0]
						)
					)
			]
		];
		for (const [requestId, attempt] of attempts) {
			expect(await result(attempt)).toMatchObject({ status: 409 });
			expect(await auditFor(requestId)).toEqual([]);
		}
		expect(
			(await service.from('bonds').select('id, commercial_status').in('id', [available, delivered]))
				.data
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: available, commercial_status: 'available' }),
				expect.objectContaining({ id: delivered, commercial_status: 'delivered_to_collector' })
			])
		);
	});
});
