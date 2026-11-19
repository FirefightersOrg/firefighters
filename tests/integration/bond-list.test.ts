import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { load as listLoad } from '../../src/routes/campaigns/[id]/bonds/+page.server';
import {
	actions as recordActions,
	load as recordLoad
} from '../../src/routes/campaigns/[id]/bonds/[bondId]/+page.server';
import { loadPermissions } from './permissions';
import type { BondListItem } from '$lib/server/bonds/list';
import type { BondRecord } from '$lib/components/bonds/record/types';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import type { UserProfile } from '../../src/app';

/**
 * SAN-26: the bonds list (filters, pagination) and the bond record's audit section through the
 * real route code against the local Supabase, with the seeded admin, operator and read-only users.
 * Each run creates its own campaigns (`[it-bond-list <run id>] ...`).
 */

const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seedConfig = resolveSeedConfig(seedEnv);
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
let seq = 0;
const rid = (label: string) => `it-bond-list-${RUN_ID}-${String(++seq).padStart(3, '0')}-${label}`;

interface Caller {
	user: User;
	client: SupabaseClient;
	profile: UserProfile;
	permissions: string[];
}

let serviceClient: SupabaseClient;

async function signIn(email: string, password: string): Promise<Caller> {
	const anonClient = createClient(supabaseUrl, anonKey, clientOptions);
	const { data, error } = await anonClient.auth.signInWithPassword({ email, password });
	if (error || !data.session) {
		throw new Error(
			`Failed to sign in as ${email}: ${error?.message ?? 'no session'}. ` +
				'Did you run `supabase db reset` and `APP_ENV=local pnpm seed:admin`?'
		);
	}
	const client = createClient(supabaseUrl, anonKey, {
		...clientOptions,
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
	const { data: profile, error: profileError } = await serviceClient
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

function fixture(role: string) {
	const found = seedConfig.fixtures.find((f) => f.roleNames.includes(role));
	if (!found) throw new Error(`resolveSeedConfig returned no ${role} fixture`);
	return found;
}

function event<E>(
	caller: Caller,
	path: string,
	params: Record<string, string>,
	options: { search?: string; fields?: Record<string, string> } = {}
): E {
	const url = new URL(`http://localhost${path}${options.search ?? ''}`);
	let request = new Request(url);
	if (options.fields) {
		const body = new FormData();
		for (const [key, value] of Object.entries(options.fields)) body.append(key, value);
		request = new Request(url, { method: 'POST', body });
	}
	return {
		locals: {
			supabase: caller.client,
			safeGetSession: async () => ({ session: null, user: caller.user }),
			session: null,
			user: caller.user,
			profile: caller.profile,
			permissions: caller.permissions,
			requestId: rid('req')
		},
		params,
		url,
		request
	} as unknown as E;
}

let admin: Caller;
let operator: Caller;
let readOnly: Caller;
let campaignId: string;
let otherCampaignId: string;
const ids: Record<string, string> = {};

async function createCampaign(label: string): Promise<string> {
	const { data, error } = await admin.client.rpc('campaign_create', {
		p_name: `[it-bond-list ${RUN_ID}] ${label}`,
		p_simple_bond_value: '60000.00',
		p_installment_count: 10,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_request_id: rid('campaign')
	});
	if (error) throw new Error(`campaign_create failed: ${error.message}`);
	return data as string;
}

async function rpc(caller: Caller, fn: string, args: Record<string, unknown>): Promise<string> {
	const { data, error } = await caller.client.rpc(fn, { ...args, p_request_id: rid(fn) });
	if (error) throw new Error(`${fn} failed: ${error.message}`);
	return data as string;
}

type ListData = {
	bonds: BondListItem[];
	pagination: { page: number; total: number; pageCount: number };
	query: { errors: Record<string, string> };
};

async function list(caller: Caller, search = '', id = campaignId): Promise<ListData> {
	return (await listLoad(
		event(caller, `/campaigns/${id}/bonds`, { id }, { search })
	)) as unknown as ListData;
}

async function record(caller: Caller, bondId: string): Promise<BondRecord> {
	const data = (await recordLoad(
		event(caller, `/campaigns/${campaignId}/bonds/${bondId}`, { id: campaignId, bondId })
	)) as unknown as { record: BondRecord };
	return data.record;
}

beforeAll(async () => {
	serviceClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);
	admin = await signIn(seedConfig.admin.email, seedConfig.admin.password);
	const op = fixture('operator');
	operator = await signIn(op.email, op.password);
	const ro = fixture('read-only');
	readOnly = await signIn(ro.email, ro.password);

	campaignId = await createCampaign('list');
	otherCampaignId = await createCampaign('other');

	// 28 simple bonds 0001..0028 (0005 with codes), a printed pata 0100 + 0101, a manual pata of
	// 0001 + 0002, then 0003 annulled by mistake.
	for (let n = 1; n <= 28; n++) {
		ids[`s${n}`] = await rpc(operator, 'bond_create', {
			p_campaign_id: campaignId,
			p_base_numbers: [n],
			p_internal_code: n === 5 ? `INT-${RUN_ID}` : null,
			p_barcode: n === 5 ? `BC,${RUN_ID}` : null
		});
	}
	ids.printed = await rpc(operator, 'bond_create', {
		p_campaign_id: campaignId,
		p_base_numbers: [101, 100]
	});
	ids.manual = await rpc(operator, 'bond_group_into_pata', {
		p_campaign_id: campaignId,
		p_member_bond_ids: [ids.s1, ids.s2]
	});
	await rpc(admin, 'bond_annul', { p_bond_id: ids.s3, p_reason: 'Loaded by mistake' });
	// Another campaign with the same numbers: never listed here.
	ids.foreign = await rpc(operator, 'bond_create', {
		p_campaign_id: otherCampaignId,
		p_base_numbers: [1]
	});
});

describe('bonds list (local Supabase)', () => {
	it('pages on the server in base number order with the total', async () => {
		const first = await list(readOnly);
		expect(first.pagination).toMatchObject({ page: 1, total: 30, pageCount: 2 });
		expect(first.bonds).toHaveLength(25);
		// 0001 and the manual pata 0001 + 0002 share the lowest number (load order breaks the tie).
		expect(first.bonds.slice(0, 4).map((b) => b.baseFormatted.join(' + '))).toEqual([
			'0001',
			'0001 + 0002',
			'0002',
			'0003'
		]);
		const second = await list(readOnly, '?page=2');
		// Page 2: the rest, ending with the printed pata 0100 + 0101 (lowest base 0100).
		expect(second.bonds.map((b) => b.baseFormatted.join(' + '))).toEqual([
			'0025',
			'0026',
			'0027',
			'0028',
			'0100 + 0101'
		]);
		const all = [...first.bonds, ...second.bonds].map((b) => b.id);
		expect(new Set(all).size).toBe(30);
		expect(all).not.toContain(ids.foreign);
	});

	it('a number finds the bond and the manual pata it is in; grouped members name their pata', async () => {
		const byBase = await list(readOnly, '?base=1');
		expect(byBase.bonds.map((b) => b.id).sort()).toEqual([ids.s1, ids.manual].sort());
		const member = byBase.bonds.find((b) => b.id === ids.s1)!;
		expect(member.inPata).toEqual({ pataId: ids.manual, label: '0001 + 0002' });
		const byAssociated = await list(readOnly, '?associated=4873');
		expect(byAssociated.bonds.map((b) => b.id).sort()).toEqual([ids.s2, ids.manual].sort());
		const printed = await list(readOnly, '?associated=4972');
		expect(printed.bonds.map((b) => b.id)).toEqual([ids.printed]);
		expect(printed.bonds[0]).toMatchObject({
			typeLabel: 'Printed pata',
			baseFormatted: ['0100', '0101'],
			associatedFormatted: ['4971', '4972'],
			totalValue: '120000.00'
		});
	});

	it('filters by code, type and statuses, and combines filters', async () => {
		expect((await list(readOnly, `?code=INT-${RUN_ID}`)).bonds.map((b) => b.id)).toEqual([ids.s5]);
		expect(
			(await list(readOnly, `?code=${encodeURIComponent(`BC,${RUN_ID}`)}`)).bonds.map((b) => b.id)
		).toEqual([ids.s5]);
		expect((await list(readOnly, '?type=pata')).bonds.map((b) => b.id).sort()).toEqual(
			[ids.printed, ids.manual].sort()
		);
		expect((await list(readOnly, '?status=annulled')).bonds.map((b) => b.id)).toEqual([ids.s3]);
		expect((await list(readOnly, '?status=annulled&type=pata')).pagination.total).toBe(0);
		expect((await list(readOnly, '?financial=no_payments')).pagination.total).toBe(30);
		expect((await list(readOnly, '?financial=overdue')).pagination.total).toBe(0);
		const invalid = await list(readOnly, '?base=99999');
		expect(invalid.query.errors.base).toBeDefined();
		expect(invalid.bonds).toEqual([]);
	});
});

describe('bond record audit (local Supabase)', () => {
	it('admin (audit.view) sees the bond entries with names; the operator gets a note', async () => {
		const own = await record(admin, ids.s5);
		expect(own.audit.allowed).toBe(true);
		expect(own.audit.entries.map((e) => e.action)).toEqual(['bond.create']);
		expect(own.audit.entries[0]).toMatchObject({
			actionLabel: 'Loaded',
			summary: 'Numbers 0005, 4876'
		});
		expect(own.audit.entries[0].actorLabel).not.toBe('System');

		const hidden = await record(operator, ids.s5);
		expect(hidden.audit).toEqual({ allowed: false, entries: [], truncated: false });
	});

	it('a member shows the grouping and ungrouping of its pata; the pata its own history', async () => {
		const result = await recordActions.ungroup(
			event(
				operator,
				`/campaigns/${campaignId}/bonds/${ids.manual}`,
				{ id: campaignId, bondId: ids.manual },
				{ search: '?/ungroup', fields: { reason: 'Wrong bonds' } }
			)
		);
		expect(result).toMatchObject({ form: 'ungroup', success: true });

		const member = await record(admin, ids.s1);
		expect(member.audit.entries.map((e) => e.action)).toEqual([
			'bond.ungroup',
			'bond.group',
			'bond.create'
		]);
		expect(member.audit.entries[0]).toMatchObject({
			reason: 'Wrong bonds',
			viaPata: { pataId: ids.manual, label: '0001 + 0002' },
			summary: 'This bond was freed from pata 0001 + 0002'
		});
		expect(member.group.memberOf).toBeNull();
		expect(member.group.pastPatas).toMatchObject([
			{ pataId: ids.manual, label: '0001 + 0002', reason: 'Wrong bonds' }
		]);

		const pata = await record(admin, ids.manual);
		expect(pata.audit.entries.map((e) => [e.action, e.viaPata])).toEqual([
			['bond.ungroup', null],
			['bond.group', null]
		]);
		// The other member's record is not affected by s1's own history.
		const other = await record(admin, ids.s4);
		expect(other.audit.entries.map((e) => e.action)).toEqual(['bond.create']);

		// The ungrouped pata is still found by its numbers, annulled; the members are free.
		const byBase = await list(readOnly, '?base=1');
		expect(byBase.bonds.find((b) => b.id === ids.manual)?.commercialStatus).toBe('annulled');
		expect(byBase.bonds.find((b) => b.id === ids.s1)?.inPata).toBeNull();
	});

	it('an annulled bond lists its released numbers in the audit', async () => {
		const annulled = await record(admin, ids.s3);
		expect(annulled.audit.entries[0]).toMatchObject({
			action: 'bond.annul',
			reason: 'Loaded by mistake',
			summary: 'Released numbers 0003, 4874'
		});
	});

	it('record actions refuse a bond of another campaign (404, nothing changed)', async () => {
		const result = (await recordActions.annul(
			event(
				admin,
				`/campaigns/${campaignId}/bonds/${ids.foreign}`,
				{ id: campaignId, bondId: ids.foreign },
				{ search: '?/annul', fields: { reason: 'x' } }
			)
		)) as { status: number };
		expect(result.status).toBe(404);
		const { data } = await serviceClient
			.from('bonds')
			.select('commercial_status')
			.eq('id', ids.foreign)
			.single();
		expect(data?.commercial_status).toBe('available');
	});
});
