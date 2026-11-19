import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isRedirect } from '@sveltejs/kit';
import { load as listLoad } from '../../src/routes/campaigns/[id]/deliveries/+page.server';
import {
	actions as newActions,
	load as newLoad
} from '../../src/routes/campaigns/[id]/deliveries/new/+page.server';
import { load as noteLoad } from '../../src/routes/campaigns/[id]/deliveries/[noteId]/+page.server';
import { getUserPermissions } from '$lib/server/auth/permissions';
import { createCollector } from '$lib/server/services/parties';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import type { UserProfile } from '../../src/app';

/**
 * SAN-55: delivery screens through the real route code against the local Supabase, with the
 * seeded admin, operator and read-only users. Every run creates its own campaign and collector.
 */

const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seedConfig = resolveSeedConfig(seedEnv);
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
let seq = 0;
const rid = (label: string) => `it-deliveries-${RUN_ID}-${++seq}-${label}`;

interface Caller {
	user: User;
	client: SupabaseClient;
	profile: UserProfile;
	permissions: string[];
}
let serviceClient: SupabaseClient;

async function signIn(email: string, password: string): Promise<Caller> {
	const anon = createClient(supabaseUrl, anonKey, clientOptions);
	const { data, error } = await anon.auth.signInWithPassword({ email, password });
	if (error || !data.session) throw new Error(`Failed to sign in as ${email}`);
	const client = createClient(supabaseUrl, anonKey, {
		...clientOptions,
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
	const { data: profile } = await serviceClient
		.from('profiles')
		.select('*')
		.eq('auth_user_id', data.user.id)
		.single();
	return {
		user: data.user,
		client,
		profile: profile as UserProfile,
		permissions: await getUserPermissions(client)
	};
}

function event<E>(
	caller: Caller,
	params: Record<string, string>,
	path: string,
	options: { action?: string; fields?: Record<string, string | string[]>; search?: string } = {}
): E {
	const url = new URL(
		`http://localhost${path}${options.action ? `?/${options.action}` : (options.search ?? '')}`
	);
	let request = new Request(url);
	if (options.fields) {
		const body = new FormData();
		for (const [k, v] of Object.entries(options.fields))
			for (const x of [v].flat()) body.append(k, x);
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

async function run(action: (e: never) => unknown, e: unknown) {
	try {
		return (await action(e as never)) as Record<string, unknown> & {
			status?: number;
			data?: Record<string, unknown>;
		};
	} catch (err) {
		if (!isRedirect(err)) throw err;
		return { redirect: err.location } as Record<string, unknown> & { redirect: string };
	}
}

let admin: Caller;
let operator: Caller;
let readOnly: Caller;
let campaignId: string;
let collectorId: string;

beforeAll(async () => {
	serviceClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);
	admin = await signIn(seedConfig.admin.email, seedConfig.admin.password);
	const f = (role: string) => seedConfig.fixtures.find((x) => x.roleNames.includes(role))!;
	operator = await signIn(f('operator').email, f('operator').password);
	readOnly = await signIn(f('read-only').email, f('read-only').password);
	const c = await admin.client.rpc('campaign_create', {
		p_name: `[it-deliveries ${RUN_ID}] Deliveries`,
		p_simple_bond_value: '60000.00',
		p_installment_count: 10,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_request_id: rid('campaign')
	});
	campaignId = c.data as string;
	for (const n of [20, 21, 22, 23]) {
		await admin.client.rpc('bond_create', {
			p_campaign_id: campaignId,
			p_base_numbers: [n],
			p_barcode: `BC-${n}`,
			p_request_id: rid(`bond-${n}`)
		});
	}
	collectorId = await createCollector(
		admin.client,
		{
			displayName: `Ana ${RUN_ID}`,
			phone: null,
			email: null,
			address: null,
			userProfileId: null,
			status: 'active'
		},
		{ requestId: rid('collector'), permissions: admin.permissions }
	);
});

describe('delivery screens (local Supabase)', () => {
	const base = () => `/campaigns/${campaignId}/deliveries`;

	it('read-only sees the notes list but cannot open a new delivery', async () => {
		const page = (await listLoad(event(readOnly, { id: campaignId }, base()))) as {
			can: { deliver: boolean };
		};
		expect(page.can.deliver).toBe(false);
		await expect(
			newLoad(event(readOnly, { id: campaignId }, `${base()}/new`))
		).rejects.toMatchObject({ status: 403 });
	});

	it('the operator finds bonds by number, code and range, and delivers them', async () => {
		const lookup = (fields: Record<string, string>) =>
			run(
				newActions.lookup as (e: never) => unknown,
				event(operator, { id: campaignId }, `${base()}/new`, { action: 'lookup', fields })
			);
		const byNumber = await lookup({ query: '4891' }); // associated number of 0020
		expect((byNumber.found as { label: string }[]).map((b) => b.label)).toEqual(['0020 / 4891']);
		const byCode = await lookup({ query: 'BC-21' });
		expect((byCode.found as { label: string }[]).map((b) => b.label)).toEqual(['0021 / 4892']);
		const byRange = await lookup({ from: '0020', to: '0022' });
		const ids = (byRange.found as { id: string }[]).map((b) => b.id);
		expect(ids).toHaveLength(3);

		const delivered = await run(
			newActions.deliver as (e: never) => unknown,
			event(operator, { id: campaignId }, `${base()}/new`, {
				action: 'deliver',
				fields: { collectorId, bondIds: ids, notes: 'box 1' }
			})
		);
		const noteId = /\/deliveries\/([0-9a-f-]{36})$/.exec(String(delivered.redirect))![1];

		const detail = (await noteLoad(
			event(admin, { id: campaignId, noteId }, `${base()}/${noteId}`)
		)) as {
			note: { noteNumber: number; collectorName: string; notes: string };
			bonds: { label: string }[];
		};
		expect(detail.note).toMatchObject({
			noteNumber: 1,
			collectorName: `Ana ${RUN_ID}`,
			notes: 'box 1'
		});
		expect(detail.bonds.map((b) => b.label)).toEqual(['0020 / 4891', '0021 / 4892', '0022 / 4893']);

		// Delivered bonds are no longer offered.
		const again = await lookup({ from: '0020', to: '0023' });
		expect((again.found as { label: string }[]).map((b) => b.label)).toEqual(['0023 / 4894']);

		const filtered = (await listLoad(
			event(admin, { id: campaignId }, base(), { search: `?collector=${collectorId}&number=1` })
		)) as {
			notes: { noteNumber: number; bondCount: number }[];
		};
		expect(filtered.notes).toEqual([expect.objectContaining({ noteNumber: 1, bondCount: 3 })]);
		const none = (await listLoad(
			event(admin, { id: campaignId }, base(), { search: '?number=99' })
		)) as { notes: unknown[] };
		expect(none.notes).toHaveLength(0);
	});

	it('a bond taken meanwhile is reported on the bond list', async () => {
		const [{ id }] = (
			await serviceClient
				.from('bond_list')
				.select('id')
				.eq('campaign_id', campaignId)
				.contains('base_numbers', [23])
		).data as { id: string }[];
		await admin.client.rpc('bond_mark_lost', {
			p_campaign_id: campaignId,
			p_bond_id: id,
			p_responsible_party: 'X',
			p_lost_on: '2026-11-01',
			p_reason: 'gone',
			p_request_id: rid('lost')
		});
		const result = await run(
			newActions.deliver as (e: never) => unknown,
			event(operator, { id: campaignId }, `${base()}/new`, {
				action: 'deliver',
				fields: { collectorId, bondIds: [id] }
			})
		);
		expect(result).toMatchObject({
			status: 409,
			data: { errors: { bondIds: [expect.stringContaining('lost')] } }
		});
	});
});
