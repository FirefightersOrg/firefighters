import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isRedirect } from '@sveltejs/kit';
import { actions as bondEntryActions } from '../../src/routes/campaigns/[id]/bonds/new/+page.server';
import {
	actions as pataActions,
	load as pataLoad
} from '../../src/routes/campaigns/[id]/bonds/pata/new/+page.server';
import {
	actions as recordActions,
	load as recordLoad
} from '../../src/routes/campaigns/[id]/bonds/[bondId]/+page.server';
import { loadPermissions } from './permissions';
import { getBondById } from '$lib/server/repositories/bonds';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import type { UserProfile } from '../../src/app';

/**
 * SAN-25: printed patas, manual grouping, ungrouping and annulment through the real route code
 * (`/campaigns/[id]/bonds/pata/new` and `/campaigns/[id]/bonds/[bondId]`) against the local
 * Supabase, with the seeded admin, operator and read-only users and their real permissions.
 * Each run creates its own campaign (`[it-pata-entry <run id>] ...`).
 */

const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seedConfig = resolveSeedConfig(seedEnv);
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
let seq = 0;
const rid = (label: string) => `it-pata-entry-${RUN_ID}-${String(++seq).padStart(3, '0')}-${label}`;

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

/** A RequestEvent for `<path><search>` with the given params and (for actions) form fields. */
function event<E>(
	caller: Caller,
	path: string,
	params: Record<string, string>,
	options: { search?: string; fields?: Record<string, string | string[]> } = {}
): E {
	const url = new URL(`http://localhost${path}${options.search ?? ''}`);
	let request = new Request(url);
	if (options.fields) {
		const body = new FormData();
		for (const [key, value] of Object.entries(options.fields)) {
			for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
		}
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

type ActionResult = { status?: number; data?: Record<string, unknown> } & Record<string, unknown>;

async function catchRedirect(run: () => unknown): Promise<ActionResult & { redirect?: string }> {
	try {
		return (await run()) as ActionResult;
	} catch (err) {
		if (!isRedirect(err)) throw err;
		return { redirect: err.location };
	}
}

const idFrom = (location: string | undefined) => {
	const match = /\/bonds\/([0-9a-f-]{36})$/.exec(location ?? '');
	if (!match) throw new Error(`unexpected redirect ${location}`);
	return match[1];
};

let admin: Caller;
let operator: Caller;
let readOnly: Caller;
let campaignId: string;

const pataPath = () => `/campaigns/${campaignId}/bonds/pata/new`;
const recordPath = (bondId: string) => `/campaigns/${campaignId}/bonds/${bondId}`;

function printed(caller: Caller, baseNumbers: string, codes: { internalCode?: string } = {}) {
	return catchRedirect(() =>
		pataActions.printed(
			event(
				caller,
				pataPath(),
				{ id: campaignId },
				{
					search: '?/printed',
					fields: { baseNumbers, internalCode: codes.internalCode ?? '', barcode: '' }
				}
			)
		)
	);
}

function group(caller: Caller, memberBondIds: string[]) {
	return catchRedirect(() =>
		pataActions.group(
			event(
				caller,
				pataPath(),
				{ id: campaignId },
				{
					search: '?/group&mode=grouping',
					fields: { memberBondIds, internalCode: '', barcode: '' }
				}
			)
		)
	);
}

function recordAction(
	caller: Caller,
	action: 'ungroup' | 'annul',
	bondId: string,
	reason: string
): Promise<ActionResult> {
	return recordActions[action](
		event(
			caller,
			recordPath(bondId),
			{ id: campaignId, bondId },
			{
				search: `?/${action}`,
				fields: { reason }
			}
		)
	) as Promise<ActionResult>;
}

async function simple(baseNumber: string): Promise<string> {
	const result = await catchRedirect(() =>
		bondEntryActions.default(
			event(
				operator,
				`/campaigns/${campaignId}/bonds/new`,
				{ id: campaignId },
				{
					fields: { baseNumber, internalCode: '', barcode: '', intent: 'save' }
				}
			)
		)
	);
	return idFrom(result.redirect);
}

async function loadRecord(caller: Caller, bondId: string) {
	return (await recordLoad(
		event(caller, recordPath(bondId), { id: campaignId, bondId })
	)) as unknown as {
		record: {
			general: { commercialStatus: string; unitCount: number; totalValue: string };
			numbers: { formatted: string; released: boolean }[];
			group: {
				members: { bondId: string; ungroupedAt: string | null; reason: string | null }[];
				memberOf: { pataId: string; label: string } | null;
			};
			actions: { ungroup: boolean; annul: boolean };
		};
	};
}

beforeAll(async () => {
	serviceClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);
	admin = await signIn(seedConfig.admin.email, seedConfig.admin.password);
	const op = fixture('operator');
	operator = await signIn(op.email, op.password);
	const ro = fixture('read-only');
	readOnly = await signIn(ro.email, ro.password);

	const { data, error } = await admin.client.rpc('campaign_create', {
		p_name: `[it-pata-entry ${RUN_ID}] 4 digits`,
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
	campaignId = data as string;
});

describe('pata entry, ungroup and annul (local Supabase)', () => {
	let printedId: string;
	let memberA: string;
	let memberB: string;
	let pataId: string;

	it('read-only users can neither open the page nor save', async () => {
		await expect(pataLoad(event(readOnly, pataPath(), { id: campaignId }))).rejects.toMatchObject({
			status: 403
		});
		expect((await printed(readOnly, '10 11')).status).toBe(403);
	});

	it('a printed pata stores 2N numbers, N units and simple_bond_value * N', async () => {
		const result = await printed(operator, '68, 69; 70', { internalCode: `P-${RUN_ID}` });
		printedId = idFrom(result.redirect);
		const bond = (await getBondById(operator.client, printedId)).data;
		expect(bond).toMatchObject({
			kind: 'pata',
			origin: 'printed',
			commercialStatus: 'available',
			commercialUnitCount: 3,
			totalValue: '180000.00'
		});
		expect(bond?.numbers.map((n) => [n.numberValue, n.numberKind])).toEqual([
			[68, 'base'],
			[69, 'base'],
			[70, 'base'],
			[4939, 'associated'],
			[4940, 'associated'],
			[4941, 'associated']
		]);
	});

	it('reports campaign-wide duplicates with links, overflow and intra-pata repetitions', async () => {
		const duplicate = await printed(operator, '0070 0071');
		expect(duplicate.status).toBe(409);
		expect(duplicate.data).toMatchObject({
			errors: {
				baseNumbers: ['Los números 0070, 4941 ya están en uso en otro bono de esta campaña.']
			},
			conflicts: [{ field: 'baseNumbers', bondId: printedId, numbers: ['0070', '4941'] }]
		});
		expect((await printed(operator, '100 5129')).status).toBe(400);
		expect((await printed(operator, '100 100')).status).toBe(400);
	});

	it('groups available simple bonds into a manual pata (bond_groups rows, members keep numbers)', async () => {
		memberA = await simple('0200');
		memberB = await simple('0201');

		const search = (await pataLoad(
			event(
				operator,
				pataPath(),
				{ id: campaignId },
				{
					search: `?mode=grouping&q=0200&selected=${memberA}`
				}
			)
		)) as unknown as {
			grouping: { results: { id: string }[]; selected: { id: string; problem: string | null }[] };
		};
		expect(search.grouping.results.map((r) => r.id)).toContain(memberB);
		expect(search.grouping.results.map((r) => r.id)).not.toContain(memberA);
		expect(search.grouping.selected).toEqual([
			expect.objectContaining({ id: memberA, problem: null })
		]);

		const result = await group(operator, [memberA, memberB]);
		pataId = idFrom(result.redirect);

		const { data: rows } = await serviceClient
			.from('bond_groups')
			.select('member_bond_id, ungrouped_at')
			.eq('pata_bond_id', pataId);
		expect(rows?.map((r) => r.member_bond_id).sort()).toEqual([memberA, memberB].sort());
		expect(rows?.every((r) => r.ungrouped_at === null)).toBe(true);

		const pata = await loadRecord(operator, pataId);
		expect(pata.record.general).toMatchObject({ unitCount: 2, totalValue: '120000.00' });
		expect(pata.record.numbers.map((n) => n.formatted)).toEqual(['0200', '5071', '0201', '5072']);
		expect(pata.record.actions).toMatchObject({ ungroup: true, annul: false });

		const member = await loadRecord(admin, memberA);
		expect(member.record.group.memberOf).toEqual({ pataId, label: '0200 + 0201' });
		expect(member.record.actions).toMatchObject({ ungroup: false, annul: false });

		// Grouped bonds are no longer offered, and cannot be grouped again.
		const after = (await pataLoad(
			event(operator, pataPath(), { id: campaignId }, { search: '?mode=grouping&q=0200' })
		)) as unknown as { grouping: { results: { id: string }[] } };
		expect(after.grouping.results.map((r) => r.id)).not.toContain(memberA);

		const other = await simple('0202');
		const again = await group(operator, [memberA, other]);
		expect(again.status).toBe(409);
		expect(again.data).toMatchObject({
			errors: {
				memberBondIds: ['Bono 0200: Ya pertenece a una pata. Desagrupar esa pata primero.']
			},
			conflicts: [{ field: 'memberBondIds', bondId: pataId, numbers: ['0200'] }]
		});
		// A pata is not a simple bond.
		expect((await group(operator, [printedId, other])).status).toBe(409);
	});

	it('ungroup: reason required, operator allowed; rows kept, pata annulled, audit written', async () => {
		expect((await recordAction(readOnly, 'ungroup', pataId, 'x')).status).toBe(403);
		const noReason = await recordAction(operator, 'ungroup', pataId, ' ');
		expect(noReason.status).toBe(400);

		const result = await recordAction(operator, 'ungroup', pataId, 'Grouped by mistake');
		expect(result).toMatchObject({ form: 'ungroup', success: true });

		const { data: rows } = await serviceClient
			.from('bond_groups')
			.select('member_bond_id, ungrouped_at, ungrouped_by, reason')
			.eq('pata_bond_id', pataId);
		expect(rows).toHaveLength(2);
		for (const row of rows ?? []) {
			expect(row.ungrouped_at).not.toBeNull();
			expect(row.ungrouped_by).toBe(operator.profile.id);
			expect(row.reason).toBe('Grouped by mistake');
		}

		const { data: audit } = await serviceClient
			.from('audit_log')
			.select('action, reason, actor_user_id')
			.eq('entity_id', pataId)
			.eq('action', 'bond.ungroup');
		expect(audit).toEqual([
			{ action: 'bond.ungroup', reason: 'Grouped by mistake', actor_user_id: operator.profile.id }
		]);

		const pata = await loadRecord(operator, pataId);
		expect(pata.record.general.commercialStatus).toBe('annulled');
		expect(pata.record.group.members.map((m) => m.reason)).toEqual([
			'Grouped by mistake',
			'Grouped by mistake'
		]);
		expect(pata.record.actions.ungroup).toBe(false);

		// Members are free again: annul is offered to the admin, and they can be grouped again.
		expect((await loadRecord(admin, memberA)).record.group.memberOf).toBeNull();
		const regroup = await group(operator, [memberA, memberB]);
		expect(regroup.redirect).toBeDefined();
	});

	it('annul: admin-only with a reason; frees the numbers so they can be entered again', async () => {
		expect((await recordAction(operator, 'annul', printedId, 'x')).status).toBe(403);
		expect((await recordAction(admin, 'annul', printedId, '')).status).toBe(400);
		expect((await loadRecord(admin, printedId)).record.actions.annul).toBe(true);

		const result = await recordAction(admin, 'annul', printedId, 'Printed pata loaded twice');
		expect(result).toMatchObject({ form: 'annul', success: true });

		const annulled = await loadRecord(admin, printedId);
		expect(annulled.record.general.commercialStatus).toBe('annulled');
		expect(annulled.record.numbers.every((n) => n.released)).toBe(true);
		expect(annulled.record.actions.annul).toBe(false);

		const again = await recordAction(admin, 'annul', printedId, 'twice');
		expect(again.status).toBe(409);
		// Its numbers are released, so the database names it by id: the id is not shown.
		expect(again.data?.message).toBe('Un bono ya está anulado.');

		// The freed numbers can be entered again.
		const reentry = await printed(operator, '68 69 70');
		const reentered = (await getBondById(operator.client, idFrom(reentry.redirect))).data;
		expect(reentered?.numbers).toHaveLength(6);
	});
});
