import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isHttpError } from '@sveltejs/kit';
import { createAdminManagedUser } from '$lib/server/services/user-admin';
import { createCollector } from '$lib/server/services/parties';
import type { PortalLedgerEntry } from '$lib/server/services/portal-ledger';
import { listCollectorLedger } from '$lib/server/services/commission-ledger';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import { loadPermissions } from './permissions';
import type { UserProfile } from '../../src/app';
import { load as cuentaLoad } from '../../src/routes/portal/[campaignId]/cuenta/+page.server';

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
const PASSWORD = 'PortalLedger123!';

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

function event(caller: Caller, campaign = campaignId, query = '') {
	return {
		locals: {
			supabase: caller.client,
			session: null,
			user: caller.user,
			profile: caller.profile,
			permissions: caller.permissions,
			requestId: `it-ledger-${RUN_ID}`
		},
		params: { campaignId: campaign },
		url: new URL(`http://localhost/portal/${campaign}/cuenta${query}`)
	} as unknown as Parameters<typeof cuentaLoad>[0];
}

async function status(fn: () => unknown) {
	try {
		await fn();
		return 200;
	} catch (err) {
		if (isHttpError(err)) return err.status;
		throw err;
	}
}

let admin: Caller;
let operator: Caller;
let linkedA: Caller;
let linkedB: Caller;
let unlinked: Caller;
let collectorA: string;
let collectorB: string;
let campaignId: string;

async function adjust(collector: string, direction: string, amount: string, label: string) {
	const { data, error } = await admin.client.rpc('collector_ledger_adjust', {
		p_campaign_id: campaignId,
		p_collector_id: collector,
		p_amount: amount,
		p_direction: direction,
		p_reason: `Internal treasury note ${label}`,
		p_request_id: `it-ledger-${label}-${RUN_ID}`
	});
	if (error) throw new Error(`${label}: ${error.message}`);
	return data as string;
}

async function makeCollectorUser(tag: string, name: string) {
	const service = createClient(supabaseUrl, serviceRoleKey, options);
	const email = `ledger_${tag}_${RUN_ID}@firefighters.local`;
	await createAdminManagedUser(service, {
		email,
		password: PASSWORD,
		fullName: `Ledger ${name} ${RUN_ID}`,
		roleNames: ['collector'],
		requestId: `it-ledger-user-${tag}-${RUN_ID}`
	});
	const caller = await signIn(email, PASSWORD);
	const id = await createCollector(
		admin.client,
		{
			displayName: `Ledger ${name} ${RUN_ID}`,
			phone: null,
			email: null,
			address: null,
			userProfileId: caller.profile.id,
			status: 'active'
		},
		{ requestId: `it-ledger-collector-${tag}-${RUN_ID}`, permissions: admin.permissions }
	);
	return { caller, id };
}

beforeAll(async () => {
	admin = await signIn(seed.admin.email, seed.admin.password);
	const byRole = (role: string) => seed.fixtures.find((f) => f.roleNames.includes(role))!;
	operator = await signIn(byRole('operator').email, byRole('operator').password);
	const unlinkedEmail = `ledger_free_${RUN_ID}@firefighters.local`;
	await createAdminManagedUser(createClient(supabaseUrl, serviceRoleKey, options), {
		email: unlinkedEmail,
		password: PASSWORD,
		fullName: `Ledger free ${RUN_ID}`,
		roleNames: ['collector'],
		requestId: `it-ledger-user-free-${RUN_ID}`
	});
	unlinked = await signIn(unlinkedEmail, PASSWORD);
	({ caller: linkedA, id: collectorA } = await makeCollectorUser('a', 'A'));
	({ caller: linkedB, id: collectorB } = await makeCollectorUser('b', 'B'));

	const { data, error } = await admin.client.rpc('campaign_create', {
		p_name: `[it-ledger ${RUN_ID}]`,
		p_simple_bond_value: '300.00',
		p_installment_count: 3,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 1,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_starts_at: '2026-01-01T03:00:00Z',
		p_ends_at: '2099-12-31T03:00:00Z',
		p_request_id: `it-ledger-campaign-${RUN_ID}`
	});
	if (error || typeof data !== 'string') throw new Error(`campaign_create: ${error?.message}`);
	campaignId = data;
	const activate = await admin.client.rpc('campaign_transition', {
		p_id: campaignId,
		p_to_status: 'active',
		p_request_id: `it-ledger-activate-${RUN_ID}`
	});
	if (activate.error) throw new Error(activate.error.message);

	// A: +50, +20 (annulled below), -10 -> balance 40. B: +7.
	await adjust(collectorA, 'collector_credit', '50.00', 'a1');
	const annulled = await adjust(collectorA, 'collector_credit', '20.00', 'a2');
	await adjust(collectorA, 'collector_debit', '10.00', 'a3');
	await adjust(collectorB, 'collector_credit', '7.00', 'b1');
	const annul = await admin.client.rpc('collector_ledger_annul_entry', {
		p_entry_id: annulled,
		p_reason: 'Internal annul note',
		p_request_id: `it-ledger-annul-${RUN_ID}`
	});
	if (annul.error) throw new Error(annul.error.message);
});

describe('portal "Mi cuenta corriente" (local Supabase)', () => {
	it('each collector sees only its own ledger and balance', async () => {
		const a = (await cuentaLoad(event(linkedA)))!;
		expect(a.collector).toMatchObject({ id: collectorA });
		expect(a.ledger?.summary.balance).toBe(40);
		expect(a.ledger?.total).toBe(3);
		expect(a.ledger?.entries.map((e: PortalLedgerEntry) => e.amount).sort()).toEqual([10, 20, 50]);

		const b = (await cuentaLoad(event(linkedB)))!;
		expect(b.collector).toMatchObject({ id: collectorB });
		expect(b.ledger?.summary.balance).toBe(7);
		expect(b.ledger?.entries.map((e: PortalLedgerEntry) => e.amount)).toEqual([7]);
	});

	it('lists the annulled entry without counting it, and leaks no internal notes', async () => {
		const a = (await cuentaLoad(event(linkedA)))!;
		const annulled = a.ledger!.entries.filter((e: PortalLedgerEntry) => e.status === 'annulled');
		expect(annulled.map((e: PortalLedgerEntry) => e.amount)).toEqual([20]);
		expect(JSON.stringify(a.ledger)).not.toMatch(/Internal|reason/i);
	});

	it('matches the balance the treasury sees for the same collector', async () => {
		const treasury = await listCollectorLedger(admin.client, {
			campaignId,
			collectorId: collectorA
		});
		const a = (await cuentaLoad(event(linkedA)))!;
		expect(a.ledger?.summary.balance).toBe(treasury[treasury.length - 1].runningBalance);
		// Newest first: the same entries, reversed, with the same running balances.
		expect(a.ledger?.entries.map((e: PortalLedgerEntry) => [e.id, e.runningBalance])).toEqual(
			[...treasury].reverse().map((e) => [e.id, e.runningBalance])
		);
	});

	it('paginates with a stable order and answers 404 past the end', async () => {
		const rpc = await linkedA.client.rpc('portal_my_ledger', {
			p_campaign_id: campaignId,
			p_limit: 2,
			p_offset: 0
		});
		const rest = await linkedA.client.rpc('portal_my_ledger', {
			p_campaign_id: campaignId,
			p_limit: 2,
			p_offset: 2
		});
		const all = await linkedA.client.rpc('portal_my_ledger', {
			p_campaign_id: campaignId,
			p_limit: 100,
			p_offset: 0
		});
		expect([...(rpc.data ?? []), ...(rest.data ?? [])].map((r: { id: string }) => r.id)).toEqual(
			(all.data ?? []).map((r: { id: string }) => r.id)
		);
		expect(await status(() => cuentaLoad(event(linkedA, campaignId, '?page=9')))).toBe(404);
	});

	it('the SQL takes no collector argument: nobody can read another collectors ledger', async () => {
		// Direct table reads and the RPCs both return only own rows, whatever the caller asks for.
		const direct = await linkedA.client
			.from('collector_ledger_entries')
			.select('collector_id')
			.eq('campaign_id', campaignId);
		expect(new Set(direct.data?.map((r) => r.collector_id))).toEqual(new Set([collectorA]));
		const other = await linkedA.client
			.from('collector_ledger_entries')
			.select('id')
			.eq('collector_id', collectorB);
		expect(other.data).toEqual([]);
	});

	it('answers 404 for an unknown campaign, an empty state without a collector, 403 for staff', async () => {
		expect(await status(() => cuentaLoad(event(linkedA, randomUUID())))).toBe(404);
		const empty = (await cuentaLoad(event(unlinked)))!;
		expect(empty.collector).toBeNull();
		expect(empty.ledger).toBeNull();
		expect(await status(() => cuentaLoad(event(operator)))).toBe(403);
	});
});
