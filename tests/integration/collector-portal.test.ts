import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { createAdminManagedUser } from '$lib/server/services/user-admin';
import { createCollector } from '$lib/server/services/parties';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';
import type { UserProfile } from '../../src/app';
import { load as portalLoad } from '../../src/routes/portal/+page.server';
import { load as homeLoad } from '../../src/routes/+page.server';
import { load as bondsLoad } from '../../src/routes/campaigns/[id]/bonds/+page.server';

vi.mock('$env/dynamic/private', async () => {
	const { inject } = await import('vitest');
	const env = inject('integrationEnv');
	return { env: { SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey, APP_ENV: 'local' } };
});
vi.mock('$env/dynamic/public', async () => {
	const { inject } = await import('vitest');
	const env = inject('integrationEnv');
	return { env: { PUBLIC_SUPABASE_URL: env.supabaseUrl, PUBLIC_SUPABASE_ANON_KEY: env.anonKey } };
});

const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seed = resolveSeedConfig(seedEnv);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = 'CollectorPortal123!';

interface Caller {
	user: User;
	client: SupabaseClient;
	profile: UserProfile;
	permissions: string[];
}

async function signIn(email: string, password: string): Promise<Caller> {
	const anon = createClient(supabaseUrl, anonKey, options);
	const { data, error } = await anon.auth.signInWithPassword({ email, password });
	if (error || !data.session || !data.user) throw new Error(`Unable to sign in as ${email}`);
	const client = createClient(supabaseUrl, anonKey, {
		...options,
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
	const { data: profile, error: profileError } = await client
		.from('profiles')
		.select('*')
		.eq('auth_user_id', data.user.id)
		.single();
	if (profileError || !profile) throw new Error(`No profile for ${email}`);
	return {
		user: data.user,
		client,
		profile: profile as UserProfile,
		permissions: await loadPermissions(client)
	};
}

function locals(caller: Caller) {
	return {
		supabase: caller.client,
		session: null,
		user: caller.user,
		profile: caller.profile,
		permissions: caller.permissions,
		requestId: `it-portal-${RUN_ID}`
	};
}

function portalEvent(caller: Caller, path = '/portal') {
	return {
		locals: locals(caller),
		url: new URL(`http://localhost${path}`)
	} as unknown as Parameters<typeof portalLoad>[0];
}

async function outcome(fn: () => unknown) {
	try {
		await fn();
		return 200;
	} catch (err) {
		if (isHttpError(err)) return err.status;
		if (isRedirect(err)) return err.status;
		throw err;
	}
}

let admin: Caller;
let linked: Caller; // collector user linked to collector A
let unlinked: Caller; // collector user with no collector
let operator: Caller;
let treasurer: Caller;
let readOnly: Caller;
let collectorA: string;
let collectorB: string;
let campaignId: string;
let bondA: string;
let bondB: string;

async function rpcId(client: SupabaseClient, name: string, args: Record<string, unknown>) {
	const { data, error } = await client.rpc(name, args);
	if (error || typeof data !== 'string') throw new Error(`${name}: ${error?.message}`);
	return data;
}

beforeAll(async () => {
	admin = await signIn(seed.admin.email, seed.admin.password);
	const byRole = (role: string) => seed.fixtures.find((f) => f.roleNames.includes(role))!;
	operator = await signIn(byRole('operator').email, byRole('operator').password);
	treasurer = await signIn(byRole('treasurer').email, byRole('treasurer').password);
	readOnly = await signIn(byRole('read-only').email, byRole('read-only').password);
	// The seeded collector fixture stays unlinked.
	unlinked = await signIn(byRole('collector').email, byRole('collector').password);

	// A dedicated collector login, linked to collector A below. Collectors cannot be deleted, so the
	// user and its collector stay behind (every run uses fresh ids).
	const service = createClient(supabaseUrl, serviceRoleKey, options);
	const email = `portal_${RUN_ID}@firefighters.local`;
	await createAdminManagedUser(service, {
		email,
		password: PASSWORD,
		fullName: `Portal ${RUN_ID}`,
		roleNames: ['collector'],
		requestId: `it-portal-user-${RUN_ID}`
	});
	linked = await signIn(email, PASSWORD);

	const collectorInput = (name: string, userProfileId: string | null) => ({
		displayName: `${name} ${RUN_ID}`,
		phone: null,
		email: null,
		address: null,
		userProfileId,
		status: 'active' as const
	});
	collectorA = await createCollector(admin.client, collectorInput('Portal A', linked.profile.id), {
		requestId: `it-portal-a-${RUN_ID}`,
		permissions: admin.permissions
	});
	collectorB = await createCollector(admin.client, collectorInput('Portal B', null), {
		requestId: `it-portal-b-${RUN_ID}`,
		permissions: admin.permissions
	});

	campaignId = await rpcId(admin.client, 'campaign_create', {
		p_name: `[it-portal ${RUN_ID}]`,
		p_simple_bond_value: '300.00',
		p_installment_count: 3,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 1,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_starts_at: '2026-01-01T03:00:00Z',
		p_ends_at: '2099-12-31T03:00:00Z',
		p_request_id: `it-portal-campaign-${RUN_ID}`
	});
	const { error: activateError } = await admin.client.rpc('campaign_transition', {
		p_id: campaignId,
		p_to_status: 'active',
		p_request_id: `it-portal-activate-${RUN_ID}`
	});
	if (activateError) throw new Error(activateError.message);

	const base = 100 + Math.floor(Math.random() * 5000) * 2;
	bondA = await rpcId(admin.client, 'bond_create', {
		p_campaign_id: campaignId,
		p_base_numbers: [base],
		p_request_id: `it-portal-bond-a-${RUN_ID}`
	});
	bondB = await rpcId(admin.client, 'bond_create', {
		p_campaign_id: campaignId,
		p_base_numbers: [base + 1],
		p_request_id: `it-portal-bond-b-${RUN_ID}`
	});
	for (const [collector, bond, label] of [
		[collectorA, bondA, 'a'],
		[collectorB, bondB, 'b']
	]) {
		const { error } = await admin.client.rpc('bond_deliver', {
			p_campaign_id: campaignId,
			p_collector_id: collector,
			p_bond_ids: [bond],
			p_notes: null,
			p_request_id: `it-portal-deliver-${label}-${RUN_ID}`
		});
		if (error) throw new Error(error.message);
	}
});

describe('collector portal own scope (local Supabase)', () => {
	it('the collector role holds exactly the own-scope grants', () => {
		expect([...linked.permissions].sort()).toEqual([
			'bond.view_own',
			'campaign.view',
			'collector.ledger.view_own',
			'payment.create_own',
			'sale.view_own'
		]);
	});

	it('a linked collector reaches /portal and is resolved from the session', async () => {
		const result = (await portalLoad(portalEvent(linked)))!;
		expect(result.collector).toMatchObject({ id: collectorA, status: 'active' });
	});

	it('a collector without a link reaches /portal with an empty state and no data', async () => {
		const result = (await portalLoad(portalEvent(unlinked)))!;
		expect(result.collector).toBeNull();
		const { data } = await unlinked.client.from('bonds').select('id');
		expect(data).toEqual([]);
	});

	it('sees only its own bond and delivery, never the other collector', async () => {
		const bonds = await linked.client.from('bonds').select('id').eq('campaign_id', campaignId);
		expect(bonds.data?.map((b) => b.id)).toEqual([bondA]);
		const numbers = await linked.client
			.from('bond_numbers')
			.select('bond_id')
			.eq('campaign_id', campaignId);
		expect(new Set(numbers.data?.map((n) => n.bond_id))).toEqual(new Set([bondA]));
		const notes = await linked.client
			.from('delivery_notes')
			.select('collector_id')
			.eq('campaign_id', campaignId);
		expect(notes.data?.map((n) => n.collector_id)).toEqual([collectorA]);
		const other = await linked.client.from('bonds').select('id').eq('id', bondB);
		expect(other.data).toEqual([]);
	});

	it('cannot read buyers directly, and the buyer read function needs a collector with sales', async () => {
		const buyers = await linked.client.from('buyers').select('id');
		expect(buyers.data).toEqual([]);
		const mine = await linked.client.rpc('portal_my_buyers', { p_campaign_id: campaignId });
		expect(mine.error).toBeNull();
		expect(mine.data).toEqual([]);
		const staff = await treasurer.client.rpc('portal_my_buyers', { p_campaign_id: campaignId });
		expect(staff.error?.code).toBe('42501');
	});

	it('answers 403 on the operational screens and redirects the collector home to the portal', async () => {
		const bonds = {
			locals: locals(linked),
			params: { id: campaignId },
			url: new URL(`http://localhost/campaigns/${campaignId}/bonds`)
		} as unknown as Parameters<typeof bondsLoad>[0];
		expect(await outcome(() => bondsLoad(bonds))).toBe(403);
		const home = { locals: locals(linked) } as unknown as Parameters<typeof homeLoad>[0];
		expect(await outcome(() => homeLoad(home))).toBe(303);
	});

	it('operator, treasurer and read-only are unchanged: no portal, same home page', async () => {
		for (const caller of [operator, treasurer, readOnly]) {
			expect(await outcome(() => portalLoad(portalEvent(caller)))).toBe(403);
			const home = { locals: locals(caller) } as unknown as Parameters<typeof homeLoad>[0];
			expect(await outcome(() => homeLoad(home))).toBe(200);
		}
		const { data } = await operator.client.from('bonds').select('id').eq('campaign_id', campaignId);
		expect(data?.length).toBe(2);
		const adminBonds = await admin.client.from('bonds').select('id').eq('campaign_id', campaignId);
		expect(adminBonds.data?.length).toBe(2);
	});
});
