import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isHttpError } from '@sveltejs/kit';
import { createAdminManagedUser } from '$lib/server/services/user-admin';
import { createCollector } from '$lib/server/services/parties';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';
import type { UserProfile } from '../../src/app';
import { load as listLoad } from '../../src/routes/portal/[campaignId]/bonos/+page.server';
import { load as detailLoad } from '../../src/routes/portal/[campaignId]/bonos/[bondId]/+page.server';
import { load as printLoad } from '../../src/routes/portal/[campaignId]/remitos/[deliveryNoteId]/imprimir/+page.server';

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
const PASSWORD = 'MyBondsPortal123!';

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
		requestId: `it-my-bonds-${RUN_ID}`
	};
}

const listEvent = (caller: Caller, campaignId: string) =>
	({
		locals: locals(caller),
		params: { campaignId },
		url: new URL(`http://localhost/portal/${campaignId}/bonos`)
	}) as unknown as Parameters<typeof listLoad>[0];
const detailEvent = (caller: Caller, campaignId: string, bondId: string) =>
	({
		locals: locals(caller),
		params: { campaignId, bondId },
		url: new URL(`http://localhost/portal/${campaignId}/bonos/${bondId}`)
	}) as unknown as Parameters<typeof detailLoad>[0];

async function status(fn: () => unknown) {
	try {
		await fn();
		return 200;
	} catch (err) {
		if (isHttpError(err)) return err.status;
		throw err;
	}
}

async function rpcId(client: SupabaseClient, name: string, args: Record<string, unknown>) {
	const { data, error } = await client.rpc(name, args);
	if (error || typeof data !== 'string') throw new Error(`${name}: ${error?.message}`);
	return data;
}

let admin: Caller;
let userA: Caller;
let userB: Caller;
let campaignId: string;
let bondA: string;
let bondB: string;

async function linkedCollector(label: string) {
	const service = createClient(supabaseUrl, serviceRoleKey, options);
	const email = `mybonds_${label}_${RUN_ID}@firefighters.local`;
	await createAdminManagedUser(service, {
		email,
		password: PASSWORD,
		fullName: `My bonds ${label} ${RUN_ID}`,
		roleNames: ['collector'],
		requestId: `it-my-bonds-user-${label}-${RUN_ID}`
	});
	const caller = await signIn(email, PASSWORD);
	const collectorId = await createCollector(
		admin.client,
		{
			displayName: `My bonds ${label} ${RUN_ID}`,
			phone: null,
			email: null,
			address: null,
			userProfileId: caller.profile.id,
			status: 'active' as const
		},
		{ requestId: `it-my-bonds-collector-${label}-${RUN_ID}`, permissions: admin.permissions }
	);
	return { caller, collectorId };
}

beforeAll(async () => {
	admin = await signIn(seed.admin.email, seed.admin.password);
	const a = await linkedCollector('a');
	const b = await linkedCollector('b');
	userA = a.caller;
	userB = b.caller;

	campaignId = await rpcId(admin.client, 'campaign_create', {
		p_name: `[it-my-bonds ${RUN_ID}]`,
		p_simple_bond_value: '300.00',
		p_installment_count: 3,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 1,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_starts_at: '2026-01-01T03:00:00Z',
		p_ends_at: '2099-12-31T03:00:00Z',
		p_request_id: `it-my-bonds-campaign-${RUN_ID}`
	});
	const { error: activateError } = await admin.client.rpc('campaign_transition', {
		p_id: campaignId,
		p_to_status: 'active',
		p_request_id: `it-my-bonds-activate-${RUN_ID}`
	});
	if (activateError) throw new Error(activateError.message);

	const base = 100 + Math.floor(Math.random() * 2000) * 4;
	bondA = await rpcId(admin.client, 'bond_create', {
		p_campaign_id: campaignId,
		p_base_numbers: [base],
		p_request_id: `it-my-bonds-bond-a-${RUN_ID}`
	});
	bondB = await rpcId(admin.client, 'bond_create', {
		p_campaign_id: campaignId,
		p_base_numbers: [base + 2],
		p_request_id: `it-my-bonds-bond-b-${RUN_ID}`
	});
	for (const [collector, bond, label] of [
		[a.collectorId, bondA, 'a'],
		[b.collectorId, bondB, 'b']
	]) {
		const { error } = await admin.client.rpc('bond_deliver', {
			p_campaign_id: campaignId,
			p_collector_id: collector,
			p_bond_ids: [bond],
			p_notes: null,
			p_request_id: `it-my-bonds-deliver-${label}-${RUN_ID}`
		});
		if (error) throw new Error(error.message);
	}
});

describe('Mis bonos with two collectors (local Supabase)', () => {
	it('each collector lists only their own bond', async () => {
		const forA = (await listLoad(listEvent(userA, campaignId)))!;
		expect(forA.bonds.map((b: { id: string }) => b.id)).toEqual([bondA]);
		expect(forA.pagination.total).toBe(1);
		const forB = (await listLoad(listEvent(userB, campaignId)))!;
		expect(forB.bonds.map((b: { id: string }) => b.id)).toEqual([bondB]);
		expect(forA.bonds[0].commercialStatus).toBe('delivered_to_collector');
		expect(forA.bonds[0].baseNumbers).toHaveLength(1);
	});

	it('the detail shows the own history and delivery note, and the other collector bond is a 404', async () => {
		const own = (await detailLoad(detailEvent(userA, campaignId, bondA)))!;
		expect(own.assignments).toHaveLength(1);
		expect(own.assignments[0]).toMatchObject({ assignmentType: 'delivery', status: 'active' });
		expect(own.notes).toHaveLength(1);
		expect(await status(() => detailLoad(detailEvent(userA, campaignId, bondB)))).toBe(404);
		expect(await status(() => detailLoad(detailEvent(userB, campaignId, bondA)))).toBe(404);
	});

	it('each collector prints only their own delivery note (SAN-153)', async () => {
		const noteA = (await detailLoad(detailEvent(userA, campaignId, bondA)))!.notes[0].id;
		const noteB = (await detailLoad(detailEvent(userB, campaignId, bondB)))!.notes[0].id;
		const printEvent = (caller: Caller, id: string) =>
			({
				locals: locals(caller),
				params: { campaignId, deliveryNoteId: id },
				url: new URL(`http://localhost/portal/${campaignId}/remitos/${id}/imprimir`)
			}) as unknown as Parameters<typeof printLoad>[0];

		const own = (await printLoad(printEvent(userA, noteA)))!;
		expect(own.document).toMatchObject({ bondCount: 1, status: 'issued' });
		expect(own.document.collector).toContain('My bonds a');
		expect(await status(() => printLoad(printEvent(userA, noteB)))).toBe(404);
		expect(await status(() => printLoad(printEvent(userB, noteA)))).toBe(404);
		expect(await status(() => printLoad(printEvent(userA, randomUUID())))).toBe(404);
		// Another campaign id never reveals the note either.
		const other = {
			...printEvent(userA, noteA),
			params: { campaignId: randomUUID(), deliveryNoteId: noteA }
		};
		expect(await status(() => printLoad(other as never))).toBe(404);
		// A user holding bond.view_own without a linked collector sees nothing.
		expect(await status(() => printLoad(printEvent(admin, noteA)))).toBe(404);
	});

	it('an admin holding bond.view_own only sees bonds assigned to their own collector', async () => {
		const result = (await listLoad(listEvent(admin, campaignId)))!;
		expect(result.collector).toBeNull();
		expect(result.bonds).toEqual([]);
		expect(await status(() => detailLoad(detailEvent(admin, campaignId, bondA)))).toBe(404);
	});
});
