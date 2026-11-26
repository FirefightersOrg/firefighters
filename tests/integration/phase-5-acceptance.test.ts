import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import { actions as collectorNewActions } from '../../src/routes/campaigns/[id]/collectors/new/+page.server';
import {
	actions as collectorActions,
	load as collectorLoad
} from '../../src/routes/campaigns/[id]/collectors/[collectorId]/+page.server';
import { load as collectorsLoad } from '../../src/routes/campaigns/[id]/collectors/+page.server';
import { actions as buyerNewActions } from '../../src/routes/campaigns/[id]/buyers/new/+page.server';
import {
	actions as buyerActions,
	load as buyerLoad
} from '../../src/routes/campaigns/[id]/buyers/[buyerId]/+page.server';
import { load as buyersLoad } from '../../src/routes/campaigns/[id]/buyers/+page.server';
import { load as campaignLoad } from '../../src/routes/campaigns/[id]/+page.server';
import CampaignPage from '../../src/routes/campaigns/[id]/+page.svelte';
import CollectorPage from '../../src/routes/campaigns/[id]/collectors/[collectorId]/+page.svelte';
import BuyerPage from '../../src/routes/campaigns/[id]/buyers/[buyerId]/+page.svelte';
import { campaignNav, type CampaignSectionKey } from '../../src/lib/navigation';
import { loadPermissions } from './permissions';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import type { UserProfile } from '../../src/app';

/**
 * Phase 5 acceptance (SAN-52). This calls the real SvelteKit routes under the current database
 * permission matrix and uses user-scoped clients for RLS. Parties are intentionally never deleted,
 * therefore all names and request ids include RUN_ID and the suite is repeatable without a reset.
 */
const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seed = resolveSeedConfig(seedEnv);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
const REQUEST_PREFIX = `it-p5-${RUN_ID}-`;
let sequence = 0;
const rid = (label: string) => `${REQUEST_PREFIX}${String(++sequence).padStart(3, '0')}-${label}`;

type Role = 'admin' | 'operator' | 'treasurer' | 'collector' | 'read-only';
interface Caller {
	role: Role;
	user: User;
	client: SupabaseClient;
	profile: UserProfile;
	permissions: string[];
}
type Fields = Record<string, string>;

let service: SupabaseClient;
const users = {} as Record<Role, Caller>;
let ownCollector: Caller;
let campaignId: string;
let collectorId: string;
let buyerId: string;
let businessBuyerId: string;

const fixture = (role: Role) => {
	const found = seed.fixtures.find((candidate) => candidate.roleNames.includes(role));
	if (!found) throw new Error(`Missing ${role} fixture`);
	return found;
};

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
	fields?: Fields,
	requestId = rid('request')
): E {
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
	} as unknown as E;
}

async function status(fn: () => unknown): Promise<number | unknown> {
	try {
		return await fn();
	} catch (err) {
		if (isHttpError(err) || isRedirect(err)) return err.status;
		throw err;
	}
}

const collectorFields = (name: string, profileId = ''): Fields => ({
	displayName: name,
	phone: `555-${RUN_ID.slice(-4)}`,
	email: `${name.replaceAll(/[^a-z0-9]+/gi, '.').toLowerCase()}@example.test`,
	address: `Street ${RUN_ID}`,
	userProfileId: profileId,
	status: 'active'
});
const individualFields = (overrides: Fields = {}): Fields => ({
	type: 'individual',
	firstName: `Ada ${RUN_ID}`,
	lastName: `Individual ${RUN_ID}`,
	businessName: '',
	documentNumber: `DNI-${RUN_ID}`,
	taxId: '',
	phone: '555-0101',
	address: 'Buyer street',
	usualCollectorId: collectorId,
	notes: `Notes ${RUN_ID}`,
	createAnyway: 'on',
	...overrides
});
const businessFields = (overrides: Fields = {}): Fields => ({
	type: 'business',
	firstName: '',
	lastName: '',
	businessName: `Business ${RUN_ID}`,
	documentNumber: '',
	taxId: `CUIT-${RUN_ID}`,
	phone: '555-0102',
	address: 'Business street',
	usualCollectorId: collectorId,
	notes: '',
	createAnyway: 'on',
	...overrides
});

async function createFromRedirect(fn: () => unknown): Promise<string> {
	try {
		await fn();
		throw new Error('Expected a creation redirect');
	} catch (err) {
		if (!isRedirect(err)) throw err;
		expect(err.status).toBe(303);
		return err.location.split('/').at(-1)!;
	}
}

async function auditFor(requestId: string) {
	const { data, error } = await service
		.from('audit_log')
		.select('action, entity_type, entity_id, old_value, new_value, request_id')
		.eq('request_id', requestId);
	expect(error).toBeNull();
	return data ?? [];
}

beforeAll(async () => {
	service = createClient(supabaseUrl, serviceRoleKey, options);
	users.admin = await signIn('admin', seed.admin.email, seed.admin.password);
	for (const role of ['operator', 'treasurer', 'collector', 'read-only'] as const) {
		const f = fixture(role);
		users[role] = await signIn(role, f.email, f.password);
	}

	const ownEmail = `it-p5-own-${RUN_ID}@example.test`;
	const ownPassword = `Collector-${RUN_ID}!`;
	const { data: authUser, error: authError } = await service.auth.admin.createUser({
		email: ownEmail,
		password: ownPassword,
		email_confirm: true
	});
	if (authError || !authUser.user)
		throw new Error(`Could not create own collector user: ${authError?.message}`);
	const { data: profile, error: profileError } = await service
		.from('profiles')
		.insert({
			auth_user_id: authUser.user.id,
			full_name: `Own collector ${RUN_ID}`,
			email: ownEmail,
			status: 'active'
		})
		.select('*')
		.single();
	if (profileError || !profile)
		throw new Error(`Could not create own profile: ${profileError?.message}`);
	const { data: role, error: roleError } = await service
		.from('roles')
		.select('id')
		.eq('name', 'collector')
		.single();
	if (roleError || !role) throw new Error(`Could not find collector role: ${roleError?.message}`);
	const { error: assignmentError } = await service
		.from('user_roles')
		.insert({ user_id: profile.id, role_id: role.id });
	if (assignmentError)
		throw new Error(`Could not assign collector role: ${assignmentError.message}`);
	ownCollector = await signIn('collector', ownEmail, ownPassword);

	const { data, error } = await users.admin.client.rpc('campaign_create', {
		p_name: `[it-p5 ${RUN_ID}] parties`,
		p_simple_bond_value: '60000',
		p_installment_count: 10,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_request_id: rid('campaign')
	});
	if (error || typeof data !== 'string')
		throw new Error(`campaign_create failed: ${error?.message}`);
	campaignId = data;

	// The parties every criterion uses, created through the real routes. Each test reads the
	// state it needs, so one failing test does not cascade into the others.
	collectorId = await createFromRedirect(() =>
		collectorNewActions.default(
			event(
				users.admin,
				`/campaigns/${campaignId}/collectors/new`,
				{ id: campaignId },
				collectorFields(`Collector ${RUN_ID}`, ownCollector.profile.id)
			)
		)
	);
	buyerId = await createFromRedirect(() =>
		buyerNewActions.default(
			event(
				users.operator,
				`/campaigns/${campaignId}/buyers/new`,
				{ id: campaignId },
				individualFields()
			)
		)
	);
	businessBuyerId = await createFromRedirect(() =>
		buyerNewActions.default(
			event(
				users.operator,
				`/campaigns/${campaignId}/buyers/new`,
				{ id: campaignId },
				businessFields()
			)
		)
	);
});

describe('Phase 5: collectors and buyers', () => {
	it('creates, edits, searches and loads individual/business party records through real routes', async () => {
		// The type decides which identity columns are kept (the other ones are stored as null).
		const { data: persisted } = await service
			.from('buyers')
			.select('id, type, first_name, last_name, business_name, document_number, tax_id')
			.in('id', [buyerId, businessBuyerId]);
		expect(persisted?.find((b) => b.id === buyerId)).toMatchObject({
			type: 'individual',
			first_name: `Ada ${RUN_ID}`,
			last_name: `Individual ${RUN_ID}`,
			business_name: null,
			document_number: `DNI-${RUN_ID}`,
			tax_id: null
		});
		expect(persisted?.find((b) => b.id === businessBuyerId)).toMatchObject({
			type: 'business',
			first_name: null,
			last_name: null,
			business_name: `Business ${RUN_ID}`,
			document_number: null,
			tax_id: `CUIT-${RUN_ID}`
		});

		const collectors = (await collectorsLoad(
			event(users.admin, `/campaigns/${campaignId}/collectors?q=${encodeURIComponent(RUN_ID)}`, {
				id: campaignId
			})
		)) as { collectors: { id: string }[] };
		expect(collectors.collectors.map((collector) => collector.id)).toContain(collectorId);
		const buyers = (await buyersLoad(
			event(
				users.operator,
				`/campaigns/${campaignId}/buyers?q=${encodeURIComponent(`DNI-${RUN_ID}`)}`,
				{ id: campaignId }
			)
		)) as { buyers: { id: string }[] };
		expect(buyers.buyers.map((buyer) => buyer.id)).toContain(buyerId);
		const businesses = (await buyersLoad(
			event(
				users.operator,
				`/campaigns/${campaignId}/buyers?q=${encodeURIComponent(`CUIT-${RUN_ID}`)}`,
				{ id: campaignId }
			)
		)) as { buyers: { id: string }[] };
		expect(businesses.buyers.map((buyer) => buyer.id)).toContain(businessBuyerId);
		for (const [query, expected] of [
			[`Ada ${RUN_ID}`, buyerId],
			[`Individual ${RUN_ID}`, buyerId],
			[`Business ${RUN_ID}`, businessBuyerId]
		] as const) {
			const found = (await buyersLoad(
				event(users.operator, `/campaigns/${campaignId}/buyers?q=${encodeURIComponent(query)}`, {
					id: campaignId
				})
			)) as { buyers: { id: string }[] };
			expect(
				found.buyers.map((buyer) => buyer.id),
				query
			).toEqual([expected]);
		}

		const collectorRecord = (await collectorLoad(
			event(users.admin, `/campaigns/${campaignId}/collectors/${collectorId}`, {
				id: campaignId,
				collectorId
			})
		)) as { collector: { updatedAt: string } };
		const collectorRequest = rid('collector-update');
		expect(
			await collectorActions.update(
				event(
					users.admin,
					`/campaigns/${campaignId}/collectors/${collectorId}?/update`,
					{ id: campaignId, collectorId },
					{
						...collectorFields(`Collector edited ${RUN_ID}`, ownCollector.profile.id),
						updatedAt: collectorRecord.collector.updatedAt
					},
					collectorRequest
				)
			)
		).toMatchObject({ success: true });
		const buyerRecord = (await buyerLoad(
			event(users.operator, `/campaigns/${campaignId}/buyers/${buyerId}`, {
				id: campaignId,
				buyerId
			})
		)) as { buyer: { updatedAt: string } };
		const buyerRequest = rid('buyer-update');
		expect(
			await buyerActions.update(
				event(
					users.operator,
					`/campaigns/${campaignId}/buyers/${buyerId}?/update`,
					{ id: campaignId, buyerId },
					{
						...individualFields({ lastName: `Edited ${RUN_ID}` }),
						updatedAt: buyerRecord.buyer.updatedAt
					},
					buyerRequest
				)
			)
		).toMatchObject({ success: true });

		const [collectorAudit] = await auditFor(collectorRequest);
		expect(collectorAudit).toMatchObject({
			action: 'collector.update',
			entity_id: collectorId,
			old_value: { display_name: `Collector ${RUN_ID}` },
			new_value: { display_name: `Collector edited ${RUN_ID}` }
		});
		const [buyerAudit] = await auditFor(buyerRequest);
		expect(buyerAudit).toMatchObject({
			action: 'buyer.update',
			entity_id: buyerId,
			old_value: { last_name: `Individual ${RUN_ID}` },
			new_value: { last_name: `Edited ${RUN_ID}` }
		});
	});

	it('enforces FK references and permanent deletion guards with service role', async () => {
		const { data: bondId, error: bondError } = await users.admin.client.rpc('bond_create', {
			p_campaign_id: campaignId,
			p_base_numbers: [Math.floor(Math.random() * 3000) + 1],
			p_internal_code: null,
			p_barcode: null,
			p_request_id: rid('bond')
		});
		expect(bondError).toBeNull();
		expect(typeof bondId).toBe('string');
		const missing = randomUUID();
		const missingCollector = await service
			.from('bonds')
			.update({ current_collector_id: missing })
			.eq('id', bondId);
		expect(missingCollector.error?.code).toBe('23503');
		const missingBuyer = await service
			.from('bonds')
			.update({ current_buyer_id: missing })
			.eq('id', bondId);
		expect(missingBuyer.error?.code).toBe('23503');
		expect(
			(
				await service
					.from('bonds')
					.update({ current_collector_id: collectorId, current_buyer_id: buyerId })
					.eq('id', bondId)
			).error
		).toBeNull();
		const badRule = await service.from('commission_rules').insert({
			campaign_id: campaignId,
			rule_type: 'cash_full_payment',
			percentage: 10,
			valid_from: '2026-01-01',
			applies_to_collector_id: missing
		});
		expect(badRule.error?.code).toBe('23503');
		expect(
			(
				await service.from('commission_rules').insert({
					campaign_id: campaignId,
					rule_type: 'cash_full_payment',
					percentage: 10,
					valid_from: '2026-01-01',
					applies_to_collector_id: collectorId
				})
			).error
		).toBeNull();
		// The intended trigger SQLSTATE is 23001, but service_role is denied DELETE before the
		// trigger runs (42501). The records remain undeletable; see the verification finding.
		expect((await service.from('collectors').delete().eq('id', collectorId)).error?.code).toBe(
			'42501'
		);
		expect((await service.from('buyers').delete().eq('id', buyerId)).error?.code).toBe('42501');
	});

	it('uses the current role matrix for route 403s and RLS, including the collector own scope', async () => {
		// SAN-93 (#44): the operator views collectors (collector.view) and manages buyers;
		// Treasurer and read-only can also view both parties.
		expect(
			await collectorsLoad(
				event(
					users.operator,
					`/campaigns/${campaignId}/collectors?q=${encodeURIComponent(RUN_ID)}`,
					{
						id: campaignId
					}
				)
			)
		).toMatchObject({
			collectors: expect.arrayContaining([expect.objectContaining({ id: collectorId })])
		});
		for (const user of [users.treasurer, users['read-only']]) {
			await expect(
				buyersLoad(event(user, `/campaigns/${campaignId}/buyers`, { id: campaignId }))
			).resolves.toHaveProperty('buyers');
		}

		expect(
			await buyersLoad(
				event(
					users.operator,
					`/campaigns/${campaignId}/buyers?q=${encodeURIComponent(`DNI-${RUN_ID}`)}`,
					{ id: campaignId }
				)
			)
		).toMatchObject({ buyers: expect.arrayContaining([expect.objectContaining({ id: buyerId })]) });
		expect(
			await status(() =>
				collectorsLoad(
					event(ownCollector, `/campaigns/${campaignId}/collectors`, { id: campaignId })
				)
			)
		).toBe(403);

		const ownRows = await ownCollector.client.from('collectors').select('id');
		expect(ownRows.error).toBeNull();
		expect(ownRows.data).toEqual([{ id: collectorId }]);
		const collectorRows = await users.collector.client
			.from('collectors')
			.select('id')
			.in('id', [collectorId]);
		expect(collectorRows.data).toEqual([]);
		expect(
			(await users.treasurer.client.from('buyers').select('id').eq('id', buyerId)).data
		).toEqual([{ id: buyerId }]);
		expect(
			(await users.operator.client.from('buyers').select('id').eq('id', buyerId)).data
		).toEqual([{ id: buyerId }]);
	});

	it('denies collector.manage and buyer.manage writes through the routes, without side effects', async () => {
		const statusOf = (result: unknown) =>
			typeof result === 'number' ? result : (result as { status?: number }).status;
		const { data: before } = await service
			.from('buyers')
			.select('updated_at, last_name')
			.eq('id', buyerId)
			.single();
		const { data: collectorBefore } = await service
			.from('collectors')
			.select('updated_at, display_name')
			.eq('id', collectorId)
			.single();
		const buyerCountBefore = (
			await service.from('buyers').select('id', { count: 'exact', head: true })
		).count;

		const attempts: [string, () => unknown][] = [];
		for (const user of [users.treasurer, users['read-only']]) {
			const createRequest = rid(`${user.role}-buyer-create`);
			attempts.push([
				createRequest,
				() =>
					buyerNewActions.default(
						event(
							user,
							`/campaigns/${campaignId}/buyers/new`,
							{ id: campaignId },
							individualFields({ documentNumber: `DENIED-${RUN_ID}` }),
							createRequest
						)
					)
			]);
			const updateRequest = rid(`${user.role}-buyer-update`);
			attempts.push([
				updateRequest,
				() =>
					buyerActions.update(
						event(
							user,
							`/campaigns/${campaignId}/buyers/${buyerId}?/update`,
							{ id: campaignId, buyerId },
							{
								...individualFields({ lastName: `Denied ${RUN_ID}` }),
								updatedAt: before!.updated_at
							},
							updateRequest
						)
					)
			]);
		}
		const collectorRequest = rid('operator-collector-update');
		attempts.push([
			collectorRequest,
			() =>
				collectorActions.update(
					event(
						users.operator,
						`/campaigns/${campaignId}/collectors/${collectorId}?/update`,
						{ id: campaignId, collectorId },
						{
							...collectorFields(`Denied ${RUN_ID}`, ownCollector.profile.id),
							updatedAt: collectorBefore!.updated_at
						},
						collectorRequest
					)
				)
		]);

		for (const [requestId, attempt] of attempts) {
			expect(statusOf(await status(attempt)), requestId).toBe(403);
			expect(await auditFor(requestId), requestId).toEqual([]);
		}
		expect(
			(await service.from('buyers').select('updated_at, last_name').eq('id', buyerId).single()).data
		).toEqual(before);
		expect(
			(
				await service
					.from('collectors')
					.select('updated_at, display_name')
					.eq('id', collectorId)
					.single()
			).data
		).toEqual(collectorBefore);
		expect((await service.from('buyers').select('id', { count: 'exact', head: true })).count).toBe(
			buyerCountBefore
		);
	});

	it('returns 409 for stale collector and buyer edits and does not audit the rejected write', async () => {
		const { data: collector } = await service
			.from('collectors')
			.select('updated_at')
			.eq('id', collectorId)
			.single();
		const firstCollectorRequest = rid('collector-first');
		expect(
			await collectorActions.update(
				event(
					users.admin,
					`/campaigns/${campaignId}/collectors/${collectorId}?/update`,
					{ id: campaignId, collectorId },
					{
						...collectorFields(`Collector concurrent ${RUN_ID}`, ownCollector.profile.id),
						updatedAt: collector!.updated_at
					},
					firstCollectorRequest
				)
			)
		).toMatchObject({ success: true });
		const staleCollectorRequest = rid('collector-stale');
		expect(
			await collectorActions.update(
				event(
					users.admin,
					`/campaigns/${campaignId}/collectors/${collectorId}?/update`,
					{ id: campaignId, collectorId },
					{
						...collectorFields(`Collector rejected ${RUN_ID}`, ownCollector.profile.id),
						updatedAt: collector!.updated_at
					},
					staleCollectorRequest
				)
			)
		).toMatchObject({ status: 409 });
		expect(await auditFor(staleCollectorRequest)).toEqual([]);

		const { data: buyer } = await service
			.from('buyers')
			.select('updated_at')
			.eq('id', buyerId)
			.single();
		const firstBuyerRequest = rid('buyer-first');
		expect(
			await buyerActions.update(
				event(
					users.operator,
					`/campaigns/${campaignId}/buyers/${buyerId}?/update`,
					{ id: campaignId, buyerId },
					{
						...individualFields({ lastName: `Concurrent ${RUN_ID}` }),
						updatedAt: buyer!.updated_at
					},
					firstBuyerRequest
				)
			)
		).toMatchObject({ success: true });
		const staleBuyerRequest = rid('buyer-stale');
		expect(
			await buyerActions.update(
				event(
					users.operator,
					`/campaigns/${campaignId}/buyers/${buyerId}?/update`,
					{ id: campaignId, buyerId },
					{ ...individualFields({ lastName: `Rejected ${RUN_ID}` }), updatedAt: buyer!.updated_at },
					staleBuyerRequest
				)
			)
		).toMatchObject({ status: 409 });
		expect(await auditFor(staleBuyerRequest)).toEqual([]);
	});

	it('renders every collector and buyer record section, including audit visibility', async () => {
		const collectorData = await collectorLoad(
			event(users.admin, `/campaigns/${campaignId}/collectors/${collectorId}`, {
				id: campaignId,
				collectorId
			})
		);
		const collectorHtml = render(CollectorPage, { props: { data: collectorData } as never }).body;
		// UX plan PR 15: the record opens with a sentence; its lists follow and the data, the history
		// and the corrections are collapsed underneath.
		expect(collectorHtml).toContain('data-collector-sentence');
		for (const title of [
			'Bonos',
			'Rendiciones',
			'Datos y correcciones',
			'Editar los datos del cobrador',
			'Reglas especiales de comisión',
			'Movimientos registrados'
		])
			expect(collectorHtml).toContain(title);
		expect(collectorHtml).toContain('collector.create');
		// The operator opens collector records too (collector.view, SAN-93); only the admin sees the audit.

		const buyerData = await buyerLoad(
			event(users.admin, `/campaigns/${campaignId}/buyers/${buyerId}`, { id: campaignId, buyerId })
		);
		const buyerHtml = render(BuyerPage, { props: { data: buyerData } as never }).body;
		expect(buyerHtml).toContain('data-buyer-sentence');
		for (const title of [
			'Datos e historial',
			'Editar los datos del comprador',
			'Bonos de otras campañas',
			'Movimientos registrados'
		])
			expect(buyerHtml).toContain(title);
		expect(buyerHtml).toContain('buyer.create');
		const operatorBuyerData = await buyerLoad(
			event(users.operator, `/campaigns/${campaignId}/buyers/${buyerId}`, {
				id: campaignId,
				buyerId
			})
		);
		// Without `audit.view` the history is not offered at all.
		const operatorBuyerHtml = render(BuyerPage, {
			props: { data: operatorBuyerData } as never
		}).body;
		expect(operatorBuyerHtml).toContain('Editar los datos del comprador');
		expect(operatorBuyerHtml).not.toContain('Movimientos registrados');
		expect(operatorBuyerHtml).not.toContain('buyer.create');
	});

	it('shows the campaign sections only for the permissions available now', async () => {
		// The sections moved from the campaign page to the shell (UX plan PR 5): `campaignNav` decides
		// them from the same permissions. Checked here with each role's live permissions.
		const sections = (caller: Caller) =>
			campaignNav(caller.permissions, campaignId, `/campaigns/${campaignId}`)
				.groups.flatMap((group) => group.items)
				.map((item) => item.key);
		// SAN-93 (#44): the operator has collector.view and buyer.manage. SAN-158: treasurer and
		// read-only read collectors and buyers too.
		for (const user of [users.admin, users.operator, users.treasurer, users['read-only']]) {
			expect(sections(user)).toContain('collectors');
			expect(sections(user)).toContain('buyers');
		}

		// The shell and the page's own flags come from the same rules: they never disagree.
		const flags: [CampaignSectionKey, string][] = [
			['bonds', 'viewBonds'],
			['deliveries', 'viewDeliveries'],
			['sales', 'viewSales'],
			['settlements', 'viewSettlements'],
			['collectors', 'viewCollectors'],
			['buyers', 'viewBuyers'],
			['draws', 'viewDraws'],
			['reports', 'viewReports'],
			['commissions', 'viewCommissions'],
			['audit', 'viewAudit'],
			['backups', 'exportBackups']
		];
		for (const user of [users.admin, users.operator, users.treasurer, users['read-only']]) {
			const data = await campaignLoad(event(user, `/campaigns/${campaignId}`, { id: campaignId }));
			const can = (data as { can: Record<string, unknown> }).can;
			for (const [section, flag] of flags)
				expect(sections(user).includes(section), `${section} vs can.${flag}`).toBe(can[flag]);
			// And the page itself no longer lists them.
			const html = render(CampaignPage, { props: { data } as never }).body;
			expect(html).not.toContain('>Cobradores</a>');
			expect(html).not.toContain('>Compradores</a>');
		}
	});
});
