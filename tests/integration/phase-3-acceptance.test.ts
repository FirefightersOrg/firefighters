import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { render } from 'svelte/server';
import {
	actions as campaignActions,
	load as campaignLoad
} from '../../src/routes/campaigns/[id]/+page.server';
import { load as listLoad } from '../../src/routes/campaigns/[id]/bonds/+page.server';
import ListPage from '../../src/routes/campaigns/[id]/bonds/+page.svelte';
import {
	actions as entryActions,
	load as entryLoad
} from '../../src/routes/campaigns/[id]/bonds/new/+page.server';
import {
	actions as pataActions,
	load as pataLoad
} from '../../src/routes/campaigns/[id]/bonds/pata/new/+page.server';
import {
	actions as recordActions,
	load as recordLoad
} from '../../src/routes/campaigns/[id]/bonds/[bondId]/+page.server';
import RecordPage from '../../src/routes/campaigns/[id]/bonds/[bondId]/+page.svelte';
import { BOND_RECORD_SECTIONS, type BondRecord } from '$lib/components/bonds/record/types';
import type { Campaign } from '$lib/domain/campaigns';
import { loadPermissions } from './permissions';
import type { BondFormResult } from '$lib/server/bonds/route-helpers';
import type { BondListItem } from '$lib/server/bonds/list';
import { BOND_MESSAGES } from '$lib/server/services/bonds';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import type { UserProfile } from '../../src/app';

/**
 * Phase 3 acceptance (SAN-27): bonds, patas and participating numbers, end to end against the
 * real local Supabase with the seeded users (admin, operator, treasurer, collector, read-only).
 *
 * Calls the real code paths: the SvelteKit loads and form actions of /campaigns/[id]/bonds/**
 * (and /campaigns/[id] for the frozen rules) with a USER-SCOPED client and the caller's real
 * permission list (`my_permissions()`), the audited `bond_*` SQL functions through the same
 * client when the database check itself is the point, and server-side rendering of the list and
 * record pages with the data their loads return.
 *
 * Bonds and campaigns cannot be deleted (by design), so the suite does not clean up: every
 * campaign is named `[it-p3 <run id>] ...` and every request id starts with `it-p3-<run id>-`.
 * Each run uses its own campaigns, so it runs again without `supabase db reset`.
 * See docs/phase-3-verification.md.
 */

const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seedConfig = resolveSeedConfig(seedEnv);
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };

const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
const NAME_PREFIX = `[it-p3 ${RUN_ID}]`;
const REQUEST_PREFIX = `it-p3-${RUN_ID}-`;
let requestSeq = 0;
const rid = (label: string) => `${REQUEST_PREFIX}${String(++requestSeq).padStart(4, '0')}-${label}`;

type RoleName = 'admin' | 'operator' | 'treasurer' | 'collector' | 'read-only';

interface SignedInUser {
	role: RoleName;
	user: User;
	client: SupabaseClient;
	profile: UserProfile;
	permissions: string[];
}

interface AuditRow {
	id: string;
	actor_user_id: string | null;
	action: string;
	entity_type: string;
	entity_id: string;
	old_value: Record<string, unknown> | null;
	new_value: Record<string, unknown> | null;
	reason: string | null;
	request_id: string | null;
}

interface BondDbRow {
	id: string;
	campaign_id: string;
	kind: string;
	origin: string;
	commercial_status: string;
	commercial_unit_count: number;
	total_value: string;
	annulled_by: string | null;
	annul_reason: string | null;
	annulled_from_status: string | null;
	created_by: string | null;
}

interface NumberDbRow {
	bond_id: string;
	number_value: number;
	number_kind: string;
	released_at: string | null;
	released_by: string | null;
}

interface GroupDbRow {
	pata_bond_id: string;
	member_bond_id: string;
	grouped_by: string;
	ungrouped_at: string | null;
	ungrouped_by: string | null;
	reason: string | null;
}

type Fields = Record<string, string | string[]>;

interface Outcome {
	status: number;
	data?: BondFormResult & Record<string, unknown>;
	redirect?: string;
}

interface ListData {
	campaign: Campaign;
	bonds: BondListItem[];
	pagination: { page: number; pageSize: number; total: number; pageCount: number };
	query: { values: Record<string, string>; errors: Record<string, string> };
	filtered: boolean;
	can: { create: boolean };
}

interface RecordData {
	campaign: Campaign;
	record: BondRecord;
}

let serviceClient: SupabaseClient;
const users = {} as Record<RoleName, SignedInUser>;
/** entity_id -> audit rows this run expects for it (one per successful audited write). */
const expectedAudit = new Map<string, number>();

// ---------------------------------------------------------------------------
// Sessions, request events and outcomes
// ---------------------------------------------------------------------------

async function signIn(role: RoleName, email: string, password: string): Promise<SignedInUser> {
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
		role,
		user: data.user,
		client,
		profile: profile as UserProfile,
		permissions: await loadPermissions(client)
	};
}

interface EventOptions {
	path: string;
	params: Record<string, string>;
	requestId?: string;
	/** Query string, including `?/action` for form actions. */
	search?: string;
	fields?: Fields;
	/** Overrides the caller's real permission list (forged locals). */
	permissions?: string[];
}

function event<E>(caller: SignedInUser, options: EventOptions): E {
	const url = new URL(`http://localhost${options.path}${options.search ?? ''}`);
	let request = new Request(url);
	if (options.fields) {
		const body = new FormData();
		for (const [key, value] of Object.entries(options.fields)) {
			for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
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
			permissions: options.permissions ?? caller.permissions,
			requestId: options.requestId ?? rid('load')
		},
		params: options.params,
		url,
		request
	} as unknown as E;
}

/** Runs a form action: `fail()` → its status and data, a 303 → `redirect`, else 200. */
async function act(fn: () => unknown): Promise<Outcome> {
	try {
		const result = (await fn()) as Record<string, unknown> | undefined;
		if (result && 'status' in result && 'data' in result) {
			return { status: result.status as number, data: result.data as Outcome['data'] };
		}
		return { status: 200, data: result as Outcome['data'] };
	} catch (err) {
		if (isRedirect(err)) return { status: err.status, redirect: err.location };
		throw err;
	}
}

/** Runs a load: returns its data, or the HTTP status it threw. */
async function loadOrStatus<T>(fn: () => unknown): Promise<T | number> {
	try {
		return (await fn()) as T;
	} catch (err) {
		if (isHttpError(err)) return err.status;
		if (isRedirect(err)) return err.status;
		throw err;
	}
}

function bondIdFrom(outcome: Outcome, campaignId: string): string {
	expect(outcome.status, JSON.stringify(outcome.data)).toBe(303);
	const match = new RegExp(`^/campaigns/${campaignId}/bonds/([0-9a-f-]{36})$`).exec(
		outcome.redirect ?? ''
	);
	expect(match, `unexpected redirect ${outcome.redirect}`).not.toBeNull();
	return match![1];
}

// ---------------------------------------------------------------------------
// Route helpers (each takes the request id, so its audit rows can be checked)
// ---------------------------------------------------------------------------

function enterSimple(
	caller: SignedInUser,
	campaignId: string,
	baseNumber: string,
	requestId: string,
	intent: 'save' | 'another' = 'save',
	permissions?: string[]
) {
	return act(() =>
		entryActions.default(
			event(caller, {
				path: `/campaigns/${campaignId}/bonds/new`,
				params: { id: campaignId },
				requestId,
				fields: { baseNumber, internalCode: '', barcode: '', intent },
				permissions
			})
		)
	);
}

function enterPrinted(
	caller: SignedInUser,
	campaignId: string,
	baseNumbers: string,
	requestId: string
) {
	return act(() =>
		pataActions.printed(
			event(caller, {
				path: `/campaigns/${campaignId}/bonds/pata/new`,
				params: { id: campaignId },
				requestId,
				search: '?/printed',
				fields: { baseNumbers, internalCode: '', barcode: '' }
			})
		)
	);
}

function enterGroup(
	caller: SignedInUser,
	campaignId: string,
	memberBondIds: string[],
	requestId: string
) {
	return act(() =>
		pataActions.group(
			event(caller, {
				path: `/campaigns/${campaignId}/bonds/pata/new`,
				params: { id: campaignId },
				requestId,
				search: '?/group&mode=grouping',
				fields: { memberBondIds, internalCode: '', barcode: '' }
			})
		)
	);
}

function recordAction(
	caller: SignedInUser,
	action: 'ungroup' | 'annul',
	campaignId: string,
	bondId: string,
	reason: string,
	requestId: string,
	permissions?: string[]
) {
	return act(() =>
		recordActions[action](
			event(caller, {
				path: `/campaigns/${campaignId}/bonds/${bondId}`,
				params: { id: campaignId, bondId },
				requestId,
				search: `?/${action}`,
				fields: { reason },
				permissions
			})
		)
	);
}

async function list(caller: SignedInUser, campaignId: string, search = ''): Promise<ListData> {
	const data = await loadOrStatus<ListData>(() =>
		listLoad(
			event(caller, { path: `/campaigns/${campaignId}/bonds`, params: { id: campaignId }, search })
		)
	);
	if (typeof data === 'number') throw new Error(`list load failed with ${data}`);
	return data;
}

async function record(
	caller: SignedInUser,
	campaignId: string,
	bondId: string
): Promise<RecordData> {
	const data = await loadOrStatus<RecordData>(() =>
		recordLoad(
			event(caller, {
				path: `/campaigns/${campaignId}/bonds/${bondId}`,
				params: { id: campaignId, bondId }
			})
		)
	);
	if (typeof data === 'number') throw new Error(`record load failed with ${data}`);
	return data;
}

/** All rows of the list for a query, across pages. */
async function listAll(
	caller: SignedInUser,
	campaignId: string,
	query = ''
): Promise<BondListItem[]> {
	const first = await list(caller, campaignId, query ? `?${query}` : '');
	const rows = [...first.bonds];
	for (let page = 2; page <= first.pagination.pageCount; page++) {
		rows.push(
			...(await list(caller, campaignId, `?${query}${query ? '&' : ''}page=${page}`)).bonds
		);
	}
	return rows;
}

// ---------------------------------------------------------------------------
// Database helpers (service role: reads only, except where a test says otherwise)
// ---------------------------------------------------------------------------

async function bondRow(id: string): Promise<BondDbRow> {
	const { data, error } = await serviceClient
		.from('bonds')
		.select(
			'id, campaign_id, kind, origin, commercial_status, commercial_unit_count, total_value::text, annulled_by, annul_reason, annulled_from_status, created_by'
		)
		.eq('id', id)
		.single();
	expect(error).toBeNull();
	return data as unknown as BondDbRow;
}

async function numbersOf(bondId: string): Promise<NumberDbRow[]> {
	const { data, error } = await serviceClient
		.from('bond_numbers')
		.select('bond_id, number_value, number_kind, released_at, released_by')
		.eq('bond_id', bondId)
		.order('number_kind')
		.order('number_value');
	expect(error).toBeNull();
	return (data ?? []) as NumberDbRow[];
}

/** Active (not released) holders of a number in a campaign. */
async function holdersOf(campaignId: string, value: number): Promise<string[]> {
	const { data, error } = await serviceClient
		.from('bond_numbers')
		.select('bond_id')
		.eq('campaign_id', campaignId)
		.eq('number_value', value)
		.is('released_at', null);
	expect(error).toBeNull();
	return (data ?? []).map((r) => (r as { bond_id: string }).bond_id);
}

async function groupsOf(
	column: 'pata_bond_id' | 'member_bond_id',
	id: string
): Promise<GroupDbRow[]> {
	const { data, error } = await serviceClient
		.from('bond_groups')
		.select('pata_bond_id, member_bond_id, grouped_by, ungrouped_at, ungrouped_by, reason')
		.eq(column, id)
		.order('grouped_at');
	expect(error).toBeNull();
	return (data ?? []) as GroupDbRow[];
}

async function bondCount(campaignId: string): Promise<number> {
	const { count, error } = await serviceClient
		.from('bonds')
		.select('id', { count: 'exact', head: true })
		.eq('campaign_id', campaignId);
	expect(error).toBeNull();
	return count ?? 0;
}

async function campaignUpdatedAt(id: string): Promise<string> {
	const { data, error } = await serviceClient
		.from('campaigns')
		.select('updated_at')
		.eq('id', id)
		.single();
	expect(error).toBeNull();
	return (data as { updated_at: string }).updated_at;
}

// ---------------------------------------------------------------------------
// Audit helpers
// ---------------------------------------------------------------------------

async function auditRowsFor(requestId: string): Promise<AuditRow[]> {
	const { data, error } = await serviceClient
		.from('audit_log')
		.select('*')
		.eq('request_id', requestId);
	expect(error).toBeNull();
	return (data ?? []) as AuditRow[];
}

async function expectOneAudit(
	requestId: string,
	actor: SignedInUser,
	expected: Partial<AuditRow>
): Promise<AuditRow> {
	const rows = await auditRowsFor(requestId);
	expect(rows, `audit rows for ${requestId}`).toHaveLength(1);
	expect(rows[0]).toMatchObject({
		actor_user_id: actor.profile.id,
		request_id: requestId,
		...expected
	});
	expectedAudit.set(rows[0].entity_id, (expectedAudit.get(rows[0].entity_id) ?? 0) + 1);
	return rows[0];
}

async function expectNoAudit(requestId: string) {
	expect(await auditRowsFor(requestId), `audit rows for ${requestId}`).toEqual([]);
}

/** A bond_* / campaign_* RPC through the caller's client, with a run request id. */
async function rpc(caller: SignedInUser, fn: string, args: Record<string, unknown>, label = fn) {
	const requestId = rid(label);
	const result = await caller.client.rpc(fn, { ...args, p_request_id: requestId });
	return { ...result, requestId };
}

/** A successful audited RPC: returns its result and checks its single audit row. */
async function rpcOk(
	caller: SignedInUser,
	fn: string,
	args: Record<string, unknown>,
	action: string
): Promise<string> {
	const { data, error, requestId } = await rpc(caller, fn, args);
	expect(error, `${fn}: ${error?.message}`).toBeNull();
	const entityId =
		(data as string | null) ?? ((args.p_bond_id ?? args.p_pata_bond_id ?? args.p_id) as string);
	await expectOneAudit(requestId, caller, { action, entity_id: entityId });
	return entityId;
}

/** A rejected RPC: the SQLSTATE, and no audit row. */
async function rpcRejected(
	caller: SignedInUser,
	fn: string,
	args: Record<string, unknown>,
	code: string,
	message?: string | RegExp
) {
	const { error, requestId } = await rpc(caller, fn, args);
	expect(error, `${fn} should fail with ${code}`).not.toBeNull();
	expect(error!.code).toBe(code);
	if (message) expect(error!.message).toMatch(message);
	await expectNoAudit(requestId);
	return error!;
}

interface CampaignOptions {
	digits?: 4 | 5;
	value?: string;
	installments?: number;
	dates?: boolean;
}

async function createCampaign(label: string, options: CampaignOptions = {}): Promise<string> {
	const digits = options.digits ?? 4;
	return rpcOk(
		users.admin,
		'campaign_create',
		{
			p_name: `${NAME_PREFIX} ${label}`,
			p_simple_bond_value: options.value ?? '60000.00',
			p_installment_count: options.installments ?? 10,
			p_number_digits: digits,
			p_max_number: digits === 4 ? 9999 : 99999,
			p_associated_number_offset: digits === 4 ? 4871 : 48710,
			p_overflow_policy: 'reject',
			p_barcode_mode: 'base_number',
			p_starts_at: options.dates ? '2027-03-01T00:00:00-03:00' : null,
			p_ends_at: options.dates ? '2027-12-31T23:59:59-03:00' : null
		},
		'campaign.create'
	);
}

async function transition(id: string, to: string, reason: string | null = null) {
	await rpcOk(
		users.admin,
		'campaign_transition',
		{ p_id: id, p_to_status: to, p_reason: reason },
		'campaign.transition'
	);
}

/** Simple bond through POST /bonds/new (Save), checked and audited. */
async function simpleViaRoute(caller: SignedInUser, campaignId: string, baseNumber: string) {
	const requestId = rid(`simple-${baseNumber}`);
	const id = bondIdFrom(await enterSimple(caller, campaignId, baseNumber, requestId), campaignId);
	await expectOneAudit(requestId, caller, {
		action: 'bond.create',
		entity_type: 'bond',
		entity_id: id
	});
	return id;
}

/** Simple bond through bond_create (fast setup), audited. */
function simpleViaRpc(caller: SignedInUser, campaignId: string, base: number) {
	return rpcOk(
		caller,
		'bond_create',
		{ p_campaign_id: campaignId, p_base_numbers: [base] },
		'bond.create'
	);
}

function expectDuplicate(outcome: Outcome, field: string, bondId: string, numbers: string[]) {
	expect(outcome.status, JSON.stringify(outcome.data)).toBe(409);
	expect(outcome.data?.success).toBe(false);
	expect(outcome.data?.errors[field]?.[0]).toMatch(/already used by/);
	const link = outcome.data?.conflicts?.find((c) => c.bondId === bondId);
	expect(link, `conflict link to ${bondId}`).toBeDefined();
	expect(link!.numbers).toEqual(numbers);
}

function renderRecord(data: RecordData): string {
	const params = { id: data.campaign.id, bondId: data.record.general.id };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
	const props = { data, form: null, params } as any;
	return render(RecordPage, { props }).body;
}

function renderList(data: ListData): string {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
	const props = { data, form: null, params: { id: data.campaign.id } } as any;
	return render(ListPage, { props }).body;
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
	serviceClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);
	users.admin = await signIn('admin', seedConfig.admin.email, seedConfig.admin.password);
	for (const role of ['operator', 'treasurer', 'collector', 'read-only'] as const) {
		const fixture = seedConfig.fixtures.find((f) => f.roleNames.includes(role));
		if (!fixture) throw new Error(`resolveSeedConfig returned no ${role} fixture`);
		users[role] = await signIn(role, fixture.email, fixture.password);
	}
	console.log(
		`[integration] Phase 3 run id: ${RUN_ID} (campaign names start with "${NAME_PREFIX}")`
	);
});

describe('Phase 3 end-to-end acceptance (local Supabase)', () => {
	/** Campaign A: 4 digits / max 9999 / offset 4871, 60000.00, draft. */
	let A: string;
	/** Campaign C: 5 digits / max 99999 / offset 48710, 60000.50 in 2 installments, draft. */
	let C: string;
	/** Campaign B: 4 digits, active (another campaign with the same numbers). */
	let B: string;
	const a: Record<string, string> = {};
	const c: Record<string, string> = {};
	const b: Record<string, string> = {};

	beforeAll(async () => {
		A = await createCampaign('A 4 digits draft');
		C = await createCampaign('C 5 digits draft', { digits: 5, value: '60000.50', installments: 2 });
		B = await createCampaign('B 4 digits active', { dates: true });
		await transition(B, 'active');
	});

	describe('1. Participating numbers are unique per campaign under every creation flow', () => {
		it('simple bond (POST /bonds/new): stored with its associated number; duplicates refused both ways', async () => {
			const requestId = rid('simple-68');
			const outcome = await enterSimple(users.operator, A, '68', requestId);
			a.s68 = bondIdFrom(outcome, A);
			const audit = await expectOneAudit(requestId, users.operator, {
				action: 'bond.create',
				entity_type: 'bond',
				entity_id: a.s68
			});
			expect(audit.new_value).toMatchObject({
				kind: 'simple',
				origin: 'printed',
				commercial_status: 'available',
				commercial_unit_count: 1,
				numbers: [
					{ number_value: 68, number_kind: 'base' },
					{ number_value: 4939, number_kind: 'associated' }
				]
			});
			expect(await bondRow(a.s68)).toMatchObject({
				kind: 'simple',
				origin: 'printed',
				commercial_status: 'available',
				commercial_unit_count: 1,
				total_value: '60000.00',
				created_by: users.operator.profile.id
			});
			expect((await numbersOf(a.s68)).map((n) => [n.number_kind, n.number_value])).toEqual([
				['associated', 4939],
				['base', 68]
			]);

			// The same base, typed with or without zeros.
			for (const typed of ['68', '0068']) {
				const again = rid(`dup-${typed}`);
				expectDuplicate(await enterSimple(users.operator, A, typed, again), 'baseNumber', a.s68, [
					'0068',
					'4939'
				]);
				await expectNoAudit(again);
			}
			// A base equal to an existing associated number.
			const asBase = rid('dup-4939');
			expectDuplicate(await enterSimple(users.admin, A, '4939', asBase), 'baseNumber', a.s68, [
				'4939'
			]);
			await expectNoAudit(asBase);

			// An associated number equal to an existing base: 5000 is a base, 129 + 4871 = 5000.
			a.s5000 = await simpleViaRoute(users.operator, A, '5000');
			const asAssociated = rid('dup-129');
			expectDuplicate(
				await enterSimple(users.operator, A, '129', asAssociated),
				'baseNumber',
				a.s5000,
				['5000']
			);
			await expectNoAudit(asAssociated);
			expect(await holdersOf(A, 129)).toEqual([]);

			// The database says the same, with the conflicts as JSON.
			const error = await rpcRejected(
				users.operator,
				'bond_create',
				{ p_campaign_id: A, p_base_numbers: [68] },
				'23505',
				`number 0068 is already used by bond ${a.s68}`
			);
			expect(JSON.parse(error.details!)).toEqual({
				conflicts: [
					{ number: 68, formatted: '0068', bond_id: a.s68, number_kind: 'base' },
					{ number: 4939, formatted: '4939', bond_id: a.s68, number_kind: 'associated' }
				]
			});
			expect(await holdersOf(A, 68)).toEqual([a.s68]);
		});

		it('the same numbers in another campaign are independent', async () => {
			b.s68 = await simpleViaRoute(users.operator, B, '68');
			expect(await holdersOf(B, 68)).toEqual([b.s68]);
			expect(await holdersOf(A, 68)).toEqual([a.s68]);
		});

		it('printed pata (POST ?/printed): 2N numbers; any overlap with the campaign or inside the pata refused', async () => {
			const requestId = rid('printed-100-101');
			a.p300 = bondIdFrom(await enterPrinted(users.operator, A, '100 101', requestId), A);
			await expectOneAudit(requestId, users.operator, { action: 'bond.create', entity_id: a.p300 });
			expect((await numbersOf(a.p300)).map((n) => n.number_value).sort((x, y) => x - y)).toEqual([
				100, 101, 4971, 4972
			]);

			const cases: [string, string, string[]][] = [
				['302 68', a.s68, ['0068', '4939']], // base already a base
				['302 4939', a.s68, ['4939']], // base already an associated
				['302 4971', a.p300, ['4971']], // base already a pata's associated
				['302, 129', a.s5000, ['5000']] // associated already a base
			];
			for (const [typed, owner, numbers] of cases) {
				const reqId = rid(`printed-dup-${typed}`);
				expectDuplicate(
					await enterPrinted(users.operator, A, typed, reqId),
					'baseNumbers',
					owner,
					numbers
				);
				await expectNoAudit(reqId);
			}
			expect(await holdersOf(A, 302)).toEqual([]);

			// Repeated inside the pata: the same base twice, or a base equal to another's associated.
			for (const typed of ['303 303', '10 4881']) {
				const reqId = rid(`printed-repeat-${typed}`);
				const outcome = await enterPrinted(users.operator, A, typed, reqId);
				expect(outcome.status).toBe(400);
				expect(outcome.data?.errors.baseNumbers?.[0]).toMatch(/more than once|repeated|appears/i);
				await expectNoAudit(reqId);
			}
			await rpcRejected(
				users.operator,
				'bond_create',
				{ p_campaign_id: A, p_base_numbers: [303, 303] },
				'22023',
				/appears more than once/
			);
			await rpcRejected(
				users.operator,
				'bond_create',
				{ p_campaign_id: A, p_base_numbers: [10, 4881] },
				'22023',
				/appears more than once/
			);
			await rpcRejected(
				users.operator,
				'bond_create',
				{ p_campaign_id: A, p_base_numbers: [302, 100] },
				'23505',
				/number 0100 is already used/
			);
			expect(await holdersOf(A, 302)).toEqual([]);
			expect(await holdersOf(A, 10)).toEqual([]);
		});

		it('manual grouping (POST ?/group): members keep their numbers, which stay unique', async () => {
			a.s600 = await simpleViaRoute(users.operator, A, '600');
			a.s601 = await simpleViaRoute(users.operator, A, '601');
			a.s602 = await simpleViaRoute(users.operator, A, '602');

			const requestId = rid('group-600-601');
			a.m1 = bondIdFrom(await enterGroup(users.operator, A, [a.s600, a.s601], requestId), A);
			const audit = await expectOneAudit(requestId, users.operator, {
				action: 'bond.group',
				entity_id: a.m1
			});
			expect(audit.new_value).toMatchObject({
				kind: 'pata',
				origin: 'manual_grouping',
				numbers: [],
				members: [a.s600, a.s601].sort()
			});
			expect(await numbersOf(a.m1)).toEqual([]);
			expect((await numbersOf(a.s600)).map((n) => n.number_value)).toEqual([5471, 600]);
			const rows = await groupsOf('pata_bond_id', a.m1);
			expect(rows.map((r) => r.member_bond_id).sort()).toEqual([a.s600, a.s601].sort());
			for (const row of rows) {
				expect(row).toMatchObject({
					grouped_by: users.operator.profile.id,
					ungrouped_at: null,
					reason: null
				});
			}
			expect((await bondRow(a.s600)).commercial_status).toBe('available');

			// A grouped member's numbers are still taken: by the member, not by the pata.
			const dupSimple = rid('dup-600');
			expectDuplicate(
				await enterSimple(users.operator, A, '600', dupSimple),
				'baseNumber',
				a.s600,
				['0600', '5471']
			);
			await expectNoAudit(dupSimple);
			const dupPata = rid('dup-printed-603-601');
			expectDuplicate(
				await enterPrinted(users.operator, A, '603 601', dupPata),
				'baseNumbers',
				a.s601,
				['0601', '5472']
			);
			await expectNoAudit(dupPata);

			// A member cannot be in two patas; only available simple bonds of the campaign group.
			const patasBefore = await bondCount(A);
			for (const [label, members] of [
				['grouped-member', [a.s601, a.s602]],
				['printed-member', [a.p300, a.s602]],
				['pata-member', [a.m1, a.s602]]
			] as const) {
				const reqId = rid(`group-bad-${label}`);
				const outcome = await enterGroup(users.operator, A, [...members], reqId);
				expect(outcome.status, label).toBe(409);
				expect(outcome.data?.errors.memberBondIds?.length).toBeGreaterThan(0);
				await expectNoAudit(reqId);
			}
			const single = rid('group-single');
			expect((await enterGroup(users.operator, A, [a.s602], single)).status).toBe(400);
			await expectNoAudit(single);
			await rpcRejected(
				users.operator,
				'bond_group_into_pata',
				{ p_campaign_id: A, p_member_bond_ids: [a.s601, a.s602] },
				'55000',
				/already belongs to manually grouped pata/
			);
			await rpcRejected(
				users.operator,
				'bond_group_into_pata',
				{ p_campaign_id: A, p_member_bond_ids: [a.p300, a.s602] },
				'22023',
				/only simple bonds/
			);
			await rpcRejected(
				users.operator,
				'bond_group_into_pata',
				{ p_campaign_id: A, p_member_bond_ids: [a.s602, a.s602] },
				'22023',
				/listed more than once/
			);
			expect(await bondCount(A)).toBe(patasBefore);
			expect(await groupsOf('member_bond_id', a.s602)).toEqual([]);
		});

		it('numbers of a bond annulled by mistake are released and can be entered again by every flow', async () => {
			const requestId = rid('annul-68');
			const outcome = await recordAction(
				users.admin,
				'annul',
				A,
				a.s68,
				'  Typed twice  ',
				requestId
			);
			expect(outcome).toMatchObject({ status: 200, data: { form: 'annul', success: true } });
			const audit = await expectOneAudit(requestId, users.admin, {
				action: 'bond.annul',
				entity_id: a.s68,
				reason: 'Typed twice'
			});
			expect(audit.new_value).toMatchObject({
				commercial_status: 'annulled',
				released_numbers: [{ number_value: 68 }, { number_value: 4939 }]
			});
			expect(await bondRow(a.s68)).toMatchObject({
				commercial_status: 'annulled',
				annulled_from_status: 'available',
				annulled_by: users.admin.profile.id,
				annul_reason: 'Typed twice'
			});
			for (const n of await numbersOf(a.s68)) {
				expect(n.released_at).not.toBeNull();
				expect(n.released_by).toBe(users.admin.profile.id);
			}
			const again = rid('annul-68-again');
			expect((await recordAction(users.admin, 'annul', A, a.s68, 'again', again)).status).toBe(409);
			await expectNoAudit(again);

			// Simple flow: 0068 again.
			a.s68b = await simpleViaRoute(users.operator, A, '68');
			expect(await holdersOf(A, 68)).toEqual([a.s68b]);
			expect(await holdersOf(A, 4939)).toEqual([a.s68b]);
			// The released rows are kept as history.
			expect((await numbersOf(a.s68)).length).toBe(2);

			// Printed pata flow: annul the pata 0100 + 0101 and type it again.
			const annulPata = rid('annul-p300');
			expect(
				(await recordAction(users.admin, 'annul', A, a.p300, 'Wrong pata', annulPata)).status
			).toBe(200);
			await expectOneAudit(annulPata, users.admin, { action: 'bond.annul', entity_id: a.p300 });
			const printedAgain = rid('printed-100-101-again');
			a.p300b = bondIdFrom(await enterPrinted(users.operator, A, '0101 0100', printedAgain), A);
			await expectOneAudit(printedAgain, users.operator, {
				action: 'bond.create',
				entity_id: a.p300b
			});
			expect(await holdersOf(A, 4971)).toEqual([a.p300b]);

			// Manual grouping flow: the re-entered bond groups with another; the annulled one cannot.
			const groupReleased = rid('group-68b-602');
			a.m2 = bondIdFrom(await enterGroup(users.operator, A, [a.s68b, a.s602], groupReleased), A);
			await expectOneAudit(groupReleased, users.operator, {
				action: 'bond.group',
				entity_id: a.m2
			});
			const groupAnnulled = rid('group-annulled');
			expect((await enterGroup(users.operator, A, [a.s68, a.s5000], groupAnnulled)).status).toBe(
				409
			);
			await expectNoAudit(groupAnnulled);
		});

		it('numbers of a bond annulled from sold stay held (no release, no re-entry)', async () => {
			a.s700 = await simpleViaRpc(users.operator, A, 700);
			// Sales arrive in Phase 4+/10: simulate the sale and its annulment as the trusted server
			// (service_role). The database guards still apply.
			for (const status of ['delivered_to_collector', 'sold']) {
				const { error } = await serviceClient
					.from('bonds')
					.update({ commercial_status: status })
					.eq('id', a.s700);
				expect(error).toBeNull();
			}
			const { error: annulError } = await serviceClient
				.from('bonds')
				.update({
					commercial_status: 'annulled',
					annulled_by: users.admin.profile.id,
					annul_reason: 'Sale cancelled'
				})
				.eq('id', a.s700);
			expect(annulError).toBeNull();
			expect((await bondRow(a.s700)).annulled_from_status).toBe('sold');

			const { error: releaseError } = await serviceClient
				.from('bond_numbers')
				.update({ released_at: new Date().toISOString(), released_by: users.admin.profile.id })
				.eq('bond_id', a.s700);
			expect(releaseError?.code).toBe('55000');
			expect((await numbersOf(a.s700)).every((n) => n.released_at === null)).toBe(true);

			for (const [label, run] of [
				['simple', (r: string) => enterSimple(users.operator, A, '0700', r)],
				['printed', (r: string) => enterPrinted(users.operator, A, '701 700', r)]
			] as const) {
				const reqId = rid(`sold-held-${label}`);
				const outcome = await run(reqId);
				expect(outcome.status, label).toBe(409);
				expect(outcome.data?.conflicts?.[0].bondId).toBe(a.s700);
				await expectNoAudit(reqId);
			}
			await rpcRejected(
				users.operator,
				'bond_create',
				{ p_campaign_id: A, p_base_numbers: [700] },
				'23505'
			);
			const reannul = rid('annul-sold');
			expect((await recordAction(users.admin, 'annul', A, a.s700, 'x', reannul)).status).toBe(409);
			await expectNoAudit(reannul);

			const loaded = await record(users.admin, A, a.s700);
			expect(loaded.record.general).toMatchObject({
				commercialStatus: 'annulled',
				annulledFromStatus: 'sold'
			});
			expect(loaded.record.numbers.every((n) => !n.released)).toBe(true);
			expect(await holdersOf(A, 700)).toEqual([a.s700]);
			expect(await holdersOf(A, 5571)).toEqual([a.s700]);
		});

		it('concurrent requests for the same number: exactly one wins', async () => {
			const [first, second] = await Promise.all([
				rpc(users.operator, 'bond_create', { p_campaign_id: A, p_base_numbers: [800] }),
				rpc(users.admin, 'bond_create', { p_campaign_id: A, p_base_numbers: [801, 800] })
			]);
			const results = [
				{ ...first, caller: users.operator },
				{ ...second, caller: users.admin }
			];
			const ok = results.filter((r) => !r.error);
			const failed = results.filter((r) => r.error);
			expect(ok).toHaveLength(1);
			expect(failed).toHaveLength(1);
			expect(failed[0].error!.code).toBe('23505');
			expect(failed[0].error!.message).toMatch(/number 0800 is already used by bond/);
			await expectOneAudit(ok[0].requestId, ok[0].caller, {
				action: 'bond.create',
				entity_id: ok[0].data as string
			});
			await expectNoAudit(failed[0].requestId);
			expect(await holdersOf(A, 800)).toEqual([ok[0].data]);

			// The same member raced into two patas.
			const m810 = await simpleViaRpc(users.operator, A, 810);
			const m811 = await simpleViaRpc(users.operator, A, 811);
			const m812 = await simpleViaRpc(users.operator, A, 812);
			const groups = await Promise.all([
				rpc(users.operator, 'bond_group_into_pata', {
					p_campaign_id: A,
					p_member_bond_ids: [m810, m811]
				}),
				rpc(users.admin, 'bond_group_into_pata', {
					p_campaign_id: A,
					p_member_bond_ids: [m811, m812]
				})
			]);
			const groupOk = groups.filter((g) => !g.error);
			const groupFailed = groups.filter((g) => g.error);
			expect(groupOk).toHaveLength(1);
			expect(['55000', '23505']).toContain(groupFailed[0].error!.code);
			const winner = groups[0].error ? users.admin : users.operator;
			await expectOneAudit(groupOk[0].requestId, winner, {
				action: 'bond.group',
				entity_id: groupOk[0].data as string
			});
			await expectNoAudit(groupFailed[0].requestId);
			expect((await groupsOf('member_bond_id', m811)).filter((g) => !g.ungrouped_at)).toHaveLength(
				1
			);
		});
	});

	describe('2. Numbering: 4 and 5 digits from the campaign configuration', () => {
		it('a 5-digit campaign: entry, padding, associated numbers, overflow and duplicates', async () => {
			const requestId = rid('c-simple-68');
			const outcome = await enterSimple(users.operator, C, '68', requestId, 'another');
			expect(outcome).toMatchObject({
				status: 200,
				data: { success: true, created: { baseFormatted: '00068', associatedFormatted: '48778' } }
			});
			c.s68 = outcome.data!.created!.id;
			await expectOneAudit(requestId, users.operator, { action: 'bond.create', entity_id: c.s68 });
			expect((await numbersOf(c.s68)).map((n) => n.number_value)).toEqual([48778, 68]);
			expect(await bondRow(c.s68)).toMatchObject({ total_value: '60000.50' });

			// Numbers above 9999 exist only with 5 digits.
			c.s12345 = await simpleViaRoute(users.operator, C, '12345');
			expect((await numbersOf(c.s12345)).map((n) => n.number_value)).toEqual([61055, 12345]);
			const tooLong = rid('a-12345');
			expect((await enterSimple(users.operator, A, '12345', tooLong)).status).toBe(400);
			await expectNoAudit(tooLong);

			// Overflow: highest base 99999 - 48710 = 51289.
			const overflow = rid('c-overflow');
			const over = await enterSimple(users.operator, C, '51290', overflow);
			expect(over.status).toBe(400);
			expect(over.data?.errors.baseNumber?.[0]).toContain('51289');
			await expectNoAudit(overflow);
			const dbOverflow = await rpcRejected(
				users.operator,
				'bond_create',
				{ p_campaign_id: C, p_base_numbers: [51290] },
				'22023',
				/base number 51290 overflows: its associated number 100000 exceeds the campaign maximum number 99999/
			);
			expect(dbOverflow.hint).toBe('the highest allowed base number is 51289');
			c.s51289 = await simpleViaRpc(users.operator, C, 51289);
			expect(await holdersOf(C, 99999)).toEqual([c.s51289]);

			// Duplicates are reported padded to 5 digits.
			const dup = rid('c-dup-68');
			expectDuplicate(await enterSimple(users.operator, C, '00068', dup), 'baseNumber', c.s68, [
				'00068',
				'48778'
			]);
			await expectNoAudit(dup);
			await rpcRejected(
				users.operator,
				'bond_create',
				{ p_campaign_id: C, p_base_numbers: [68] },
				'23505',
				`number 00068 is already used by bond ${c.s68}`
			);

			// Record and list show 5 digits; the list filter accepts both spellings.
			const loaded = await record(users.operator, C, c.s68);
			expect(loaded.record.numbers.map((n) => n.formatted)).toEqual(['00068', '48778']);
			for (const typed of ['68', '00068']) {
				const found = await list(users.operator, C, `?base=${typed}`);
				expect(found.bonds.map((x) => x.id)).toEqual([c.s68]);
				expect(found.bonds[0]).toMatchObject({
					baseFormatted: ['00068'],
					associatedFormatted: ['48778']
				});
			}
			const invalid = await list(users.operator, C, '?base=123456');
			expect(invalid.query.errors.base).toBe('Enter a number from 00000 to 99999.');
			const invalidA = await list(users.operator, A, '?base=12345');
			expect(invalidA.query.errors.base).toBe('Enter a number from 0000 to 9999.');
		});
	});

	describe('3. Pata unit count and total value', () => {
		it('printed and manual patas: commercial_unit_count = N, total_value = simple_bond_value * N exactly', async () => {
			// 5 digits, 60000.50 per simple bond (cents check exactness).
			const p3 = rid('c-printed-3');
			c.p100 = bondIdFrom(await enterPrinted(users.operator, C, '100 101 102', p3), C);
			await expectOneAudit(p3, users.operator, { action: 'bond.create', entity_id: c.p100 });
			c.s200 = await simpleViaRoute(users.operator, C, '200');
			c.s201 = await simpleViaRoute(users.operator, C, '201');
			c.s202 = await simpleViaRoute(users.operator, C, '202');
			const g2 = rid('c-group-2');
			c.m2 = bondIdFrom(await enterGroup(users.operator, C, [c.s200, c.s201], g2), C);
			await expectOneAudit(g2, users.operator, { action: 'bond.group', entity_id: c.m2 });

			// 4 digits, 60000.00: printed N=2 (0100 + 0101 again) and a manual pata of 3.
			a.s610 = await simpleViaRpc(users.operator, A, 610);
			a.s611 = await simpleViaRpc(users.operator, A, 611);
			a.s612 = await simpleViaRpc(users.operator, A, 612);
			const g3 = rid('a-group-3');
			a.m3 = bondIdFrom(await enterGroup(users.admin, A, [a.s610, a.s611, a.s612], g3), A);
			await expectOneAudit(g3, users.admin, { action: 'bond.group', entity_id: a.m3 });

			const expected: [string, string, string, number, string][] = [
				[C, c.p100, 'printed', 3, '180001.50'],
				[C, c.m2, 'manual_grouping', 2, '120001.00'],
				[A, a.p300b, 'printed', 2, '120000.00'],
				[A, a.m1, 'manual_grouping', 2, '120000.00'],
				[A, a.m3, 'manual_grouping', 3, '180000.00']
			];
			for (const [campaignId, id, origin, n, total] of expected) {
				expect(await bondRow(id)).toMatchObject({
					kind: 'pata',
					origin,
					commercial_unit_count: n,
					total_value: total
				});
				const loaded = await record(users.operator, campaignId, id);
				expect(loaded.record.general).toMatchObject({ unitCount: n, totalValue: total });
				const row = (await listAll(users.operator, campaignId, 'type=pata')).find(
					(x) => x.id === id
				);
				expect(row).toMatchObject({ unitCount: n, totalValue: total });
			}
			// Printed: 2N numbers of its own. Manual: none, its members' numbers are shown.
			expect(await numbersOf(c.p100)).toHaveLength(6);
			const manual = await record(users.operator, C, c.m2);
			expect(manual.record.numbers.map((n) => n.formatted).sort()).toEqual([
				'00200',
				'00201',
				'48910',
				'48911'
			]);
			expect(manual.record.group.members.map((m) => m.baseFormatted).sort()).toEqual([
				'00200',
				'00201'
			]);

			// The database refuses any other total (trusted server writing directly).
			const { error } = await serviceClient.from('bonds').insert({
				campaign_id: C,
				kind: 'pata',
				origin: 'printed',
				commercial_unit_count: 2,
				total_value: '120001.01',
				created_by: users.admin.profile.id
			});
			expect(error?.code).toBe('23514');
			expect(error?.message).toMatch(/bond total value must be 120001\.00/);
		});
	});

	describe('4. Ungrouping a manual pata', () => {
		it('reason required; rows kept with ungrouped_at/by/reason; pata annulled; one audit row; members free', async () => {
			const noReason = rid('ungroup-no-reason');
			const missing = await recordAction(users.operator, 'ungroup', A, a.m1, '   ', noReason);
			expect(missing.status).toBe(400);
			expect(missing.data?.errors.reason?.[0]).toBe('A reason is required to ungroup a pata');
			await expectNoAudit(noReason);
			await rpcRejected(
				users.operator,
				'bond_ungroup_pata',
				{ p_pata_bond_id: a.m1, p_reason: ' ' },
				'22023'
			);
			expect((await bondRow(a.m1)).commercial_status).toBe('available');

			const requestId = rid('ungroup-m1');
			const outcome = await recordAction(
				users.operator,
				'ungroup',
				A,
				a.m1,
				'  Wrong bonds  ',
				requestId
			);
			expect(outcome).toMatchObject({ status: 200, data: { form: 'ungroup', success: true } });
			const audit = await expectOneAudit(requestId, users.operator, {
				action: 'bond.ungroup',
				entity_type: 'bond',
				entity_id: a.m1,
				reason: 'Wrong bonds'
			});
			const members = [a.s600, a.s601].sort();
			expect(audit.old_value).toEqual({ commercial_status: 'available', members });
			expect(audit.new_value).toEqual({
				commercial_status: 'annulled',
				members: [],
				ungrouped_members: members
			});

			const rows = await groupsOf('pata_bond_id', a.m1);
			expect(rows).toHaveLength(2);
			for (const row of rows) {
				expect(row.ungrouped_at).not.toBeNull();
				expect(row).toMatchObject({
					ungrouped_by: users.operator.profile.id,
					reason: 'Wrong bonds'
				});
			}
			expect(await bondRow(a.m1)).toMatchObject({
				commercial_status: 'annulled',
				annulled_from_status: 'available',
				annulled_by: users.operator.profile.id,
				annul_reason: 'Wrong bonds'
			});
			// Members keep their numbers and are available on their own again.
			expect(await holdersOf(A, 600)).toEqual([a.s600]);
			expect((await bondRow(a.s600)).commercial_status).toBe('available');

			const twice = rid('ungroup-again');
			expect((await recordAction(users.operator, 'ungroup', A, a.m1, 'again', twice)).status).toBe(
				409
			);
			await expectNoAudit(twice);

			// Free members can be annulled (admin) and grouped again.
			const annulMember = rid('annul-601');
			expect(
				(await recordAction(users.admin, 'annul', A, a.s601, 'Not printed', annulMember)).status
			).toBe(200);
			await expectOneAudit(annulMember, users.admin, { action: 'bond.annul', entity_id: a.s601 });
			expect(await holdersOf(A, 601)).toEqual([]);
			a.s603 = await simpleViaRoute(users.operator, A, '603');
			const regroup = rid('regroup-600-603');
			a.m4 = bondIdFrom(await enterGroup(users.operator, A, [a.s600, a.s603], regroup), A);
			await expectOneAudit(regroup, users.operator, { action: 'bond.group', entity_id: a.m4 });
			const history = await groupsOf('member_bond_id', a.s600);
			expect(history.map((h) => [h.pata_bond_id, h.ungrouped_at === null])).toEqual([
				[a.m1, false],
				[a.m4, true]
			]);

			// Records: the old pata keeps its members as history; the member lists the past pata.
			const pata = await record(users.admin, A, a.m1);
			expect(pata.record.group.members).toHaveLength(2);
			expect(
				pata.record.group.members.every((m) => m.ungroupedAt && m.reason === 'Wrong bonds')
			).toBe(true);
			expect(pata.record.actions.ungroup).toBe(false);
			const member = await record(users.admin, A, a.s600);
			expect(member.record.group.memberOf).toEqual({ pataId: a.m4, label: '0600 + 0603' });
			expect(member.record.group.pastPatas).toMatchObject([
				{ pataId: a.m1, label: '0600 + 0601', reason: 'Wrong bonds' }
			]);
		});

		it('only manual patas are ungrouped; manual patas and grouped members are not annulled', async () => {
			const printed = rid('ungroup-printed');
			expect((await recordAction(users.operator, 'ungroup', A, a.p300b, 'x', printed)).status).toBe(
				400
			);
			await expectNoAudit(printed);
			const pata = rid('annul-manual');
			const annulPata = await recordAction(users.admin, 'annul', A, a.m4, 'x', pata);
			expect(annulPata.status).toBe(409);
			expect(annulPata.data?.message).toBe(BOND_MESSAGES.manualPataAnnul);
			await expectNoAudit(pata);
			const grouped = rid('annul-grouped-member');
			expect((await recordAction(users.admin, 'annul', A, a.s600, 'x', grouped)).status).toBe(409);
			await expectNoAudit(grouped);
			await rpcRejected(
				users.admin,
				'bond_annul',
				{ p_bond_id: a.s600, p_reason: 'x' },
				'55000',
				/belongs to manually grouped pata/
			);
			await rpcRejected(
				users.admin,
				'bond_annul',
				{ p_bond_id: a.m4, p_reason: 'x' },
				'55000',
				/cannot be annulled directly/
			);
			await rpcRejected(
				users.operator,
				'bond_ungroup_pata',
				{ p_pata_bond_id: a.p300b, p_reason: 'x' },
				'22023'
			);
			expect((await bondRow(a.s600)).commercial_status).toBe('available');
			expect((await bondRow(a.m4)).commercial_status).toBe('available');
		});
	});

	describe('5. Bonds list and bond record', () => {
		it('the list pages on the server over all the campaign bonds, in base number order', async () => {
			// Enough bonds for more than one page.
			for (let n = 1000; n < 1026; n++) await simpleViaRpc(users.operator, A, n);
			const total = await bondCount(A);
			const first = await list(users['read-only'], A);
			expect(first.pagination).toEqual({
				page: 1,
				pageSize: 25,
				total,
				pageCount: Math.ceil(total / 25)
			});
			expect(first.bonds).toHaveLength(25);
			expect(first.pagination.pageCount).toBeGreaterThan(1);
			const all = await listAll(users['read-only'], A);
			expect(all).toHaveLength(total);
			expect(new Set(all.map((x) => x.id)).size).toBe(total);
			const lowest = all.map((x) => Number(x.baseFormatted[0] ?? 'NaN'));
			expect(lowest.filter((n) => !Number.isNaN(n))).toEqual(
				[...lowest].filter((n) => !Number.isNaN(n)).sort((x, y) => x - y)
			);
			expect(all.map((x) => x.id)).not.toContain(b.s68);
			const beyond = await list(users['read-only'], A, '?page=999');
			expect(beyond.bonds).toEqual([]);
			expect(beyond.pagination.total).toBe(total);

			const html = renderList(first);
			expect(html).toContain(`Page 1 of ${first.pagination.pageCount}`);
			for (const row of first.bonds) expect(html).toContain(`data-bond-id="${row.id}"`);
			expect(html).toContain('page=2');
		});

		it('?base= finds a member and its manual pata (and the ungrouped one); other filters work', async () => {
			for (const query of ['base=600', 'base=0600', 'associated=5471']) {
				const found = await list(users.treasurer, A, `?${query}`);
				expect(found.bonds.map((x) => x.id).sort(), query).toEqual([a.s600, a.m1, a.m4].sort());
				const member = found.bonds.find((x) => x.id === a.s600)!;
				expect(member.inPata).toEqual({ pataId: a.m4, label: '0600 + 0603' });
				expect(found.bonds.find((x) => x.id === a.m1)!.commercialStatus).toBe('annulled');
				expect(found.bonds.find((x) => x.id === a.m4)!.baseFormatted).toEqual(['0600', '0603']);
			}
			// A released number finds both the annulled bond and the one holding it now.
			expect((await list(users.treasurer, A, '?base=68')).bonds.map((x) => x.id).sort()).toEqual(
				[a.s68, a.s68b, a.m2].sort()
			);
			const annulled = (await listAll(users.treasurer, A, 'status=annulled'))
				.map((x) => x.id)
				.sort();
			expect(annulled).toEqual([a.s68, a.p300, a.s700, a.m1, a.s601].sort());
			const manualAvailable = (await listAll(users.treasurer, A, 'type=pata&status=available')).map(
				(x) => x.id
			);
			expect(manualAvailable).toEqual(expect.arrayContaining([a.p300b, a.m2, a.m3, a.m4]));
			expect(manualAvailable).not.toContain(a.m1);
			const filtered = await list(users.treasurer, A, '?base=600');
			expect(renderList(filtered)).toContain(`data-bond-id="${a.m4}"`);
		});

		it('the record renders its 14 sections (SAN-55 adds Assignment history); audit for audit.view, a note otherwise', async () => {
			const titles = BOND_RECORD_SECTIONS.map((s) => s.title);
			expect(titles).toHaveLength(14);
			const byRole: Record<string, string> = {};
			for (const role of ['admin', 'operator', 'treasurer', 'read-only'] as const) {
				const loaded = await record(users[role], A, a.s600);
				const html = renderRecord(loaded);
				BOND_RECORD_SECTIONS.forEach((section, i) => {
					expect(html, `${role}: section ${section.id}`).toContain(`id="${section.id}"`);
					expect(html).toMatch(
						new RegExp(
							`${i + 1}\\.</span>\\s*${section.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
						)
					);
				});
				byRole[role] = html;
				const canAudit = role === 'admin' || role === 'treasurer';
				expect(loaded.record.audit.allowed, role).toBe(canAudit);
				if (canAudit) {
					// The member's own load plus both patas it was in (group / ungroup / group).
					expect(
						loaded.record.audit.entries.map((e) => [e.action, e.viaPata?.pataId ?? null])
					).toEqual([
						['bond.group', a.m4],
						['bond.ungroup', a.m1],
						['bond.group', a.m1],
						['bond.create', null]
					]);
					expect(html).toContain('data-audit-action="bond.ungroup"');
					expect(html).toContain('data-audit-action="bond.group"');
					expect(html).toContain('Wrong bonds');
				} else {
					expect(loaded.record.audit.entries).toEqual([]);
					expect(html).toContain('You do not have permission to view the audit log.');
					expect(html).not.toContain('data-audit-action');
				}
			}
			expect(byRole.admin).not.toEqual(byRole.operator);

			// A printed pata and a manual pata render too, with their numbers.
			const printedHtml = renderRecord(await record(users.admin, A, a.p300b));
			for (const n of ['0100', '0101', '4971', '4972']) expect(printedHtml).toContain(n);
			const manualHtml = renderRecord(await record(users.admin, A, a.m1));
			expect(manualHtml).toContain('Wrong bonds');
			expect(manualHtml).toContain('data-audit-action="bond.ungroup"');
		});
	});

	describe('6. Permissions per seeded role (routes and database)', () => {
		it('seeded permissions', () => {
			const bondPerms = (role: RoleName) =>
				users[role].permissions
					.filter((p) => p.startsWith('bond.') || p === 'audit.view' || p === 'campaign.view')
					.sort();
			expect(bondPerms('admin')).toEqual(
				expect.arrayContaining([
					'bond.view',
					'bond.create',
					'bond.annul',
					'audit.view',
					'campaign.view'
				])
			);
			expect(bondPerms('operator')).toEqual(
				expect.arrayContaining(['bond.view', 'bond.create', 'campaign.view'])
			);
			expect(bondPerms('operator')).toContain('bond.return');
			expect(bondPerms('operator')).not.toContain('bond.mark_lost');
			expect(bondPerms('operator')).toContain('bond.return');
			expect(bondPerms('operator')).not.toContain('bond.mark_lost');
			expect(bondPerms('operator')).toContain('bond.return');
			expect(bondPerms('operator')).not.toContain('bond.mark_lost');
			expect(bondPerms('operator')).not.toContain('bond.annul');
			expect(bondPerms('operator')).not.toContain('audit.view');
			expect(bondPerms('treasurer')).toEqual(['audit.view', 'bond.view', 'campaign.view']);
			expect(bondPerms('read-only')).toEqual(['bond.view', 'campaign.view']);
			expect(bondPerms('collector')).toEqual(['campaign.view']);
		});

		it('pages: who can open the list, the record and the entry forms', async () => {
			const expected: Record<RoleName, [boolean, boolean, boolean]> = {
				// [list + record, /bonds/new, /bonds/pata/new]
				admin: [true, true, true],
				operator: [true, true, true],
				treasurer: [true, false, false],
				'read-only': [true, false, false],
				collector: [false, false, false]
			};
			for (const [role, [view, entry, pata]] of Object.entries(expected) as [
				RoleName,
				[boolean, boolean, boolean]
			][]) {
				const caller = users[role];
				const listed = await loadOrStatus<ListData>(() =>
					listLoad(event(caller, { path: `/campaigns/${A}/bonds`, params: { id: A } }))
				);
				const shown = await loadOrStatus<RecordData>(() =>
					recordLoad(
						event(caller, {
							path: `/campaigns/${A}/bonds/${a.s600}`,
							params: { id: A, bondId: a.s600 }
						})
					)
				);
				const newPage = await loadOrStatus(() =>
					entryLoad(event(caller, { path: `/campaigns/${A}/bonds/new`, params: { id: A } }))
				);
				const pataPage = await loadOrStatus(() =>
					pataLoad(
						event(caller, {
							path: `/campaigns/${A}/bonds/pata/new`,
							params: { id: A },
							search: '?mode=grouping'
						})
					)
				);
				expect(typeof listed === 'number' ? listed : 200, `${role} list`).toBe(view ? 200 : 403);
				expect(typeof shown === 'number' ? shown : 200, `${role} record`).toBe(view ? 200 : 403);
				expect(typeof newPage === 'number' ? newPage : 200, `${role} new`).toBe(entry ? 200 : 403);
				expect(typeof pataPage === 'number' ? pataPage : 200, `${role} pata`).toBe(
					pata ? 200 : 403
				);
				if (typeof listed !== 'number') expect(listed.can.create, `${role} can.create`).toBe(entry);
				if (typeof shown !== 'number') {
					// Record actions: ungroup needs bond.create, annul needs bond.annul.
					const pataRecord = await record(caller, A, a.m4);
					expect(pataRecord.record.actions.ungroup, `${role} ungroup`).toBe(entry);
					const simpleRecord = await record(caller, A, a.s5000);
					expect(simpleRecord.record.actions.annul, `${role} annul`).toBe(role === 'admin');
				}
			}
		});

		it('route actions: create/group/ungroup need bond.create, annul needs bond.annul; nothing written otherwise', async () => {
			const before = await bondCount(A);
			for (const role of ['treasurer', 'read-only', 'collector'] as const) {
				const caller = users[role];
				const outcomes = [
					['create', rid(`${role}-create`), (r: string) => enterSimple(caller, A, '900', r)],
					['printed', rid(`${role}-printed`), (r: string) => enterPrinted(caller, A, '901 902', r)],
					[
						'group',
						rid(`${role}-group`),
						(r: string) => enterGroup(caller, A, [a.s5000, a.s603], r)
					],
					[
						'ungroup',
						rid(`${role}-ungroup`),
						(r: string) => recordAction(caller, 'ungroup', A, a.m4, 'x', r)
					],
					[
						'annul',
						rid(`${role}-annul`),
						(r: string) => recordAction(caller, 'annul', A, a.s5000, 'x', r)
					]
				] as const;
				for (const [label, reqId, run] of outcomes) {
					const outcome = await run(reqId);
					expect(outcome.status, `${role} ${label}`).toBe(403);
					expect(outcome.data?.message).toBe(BOND_MESSAGES.permission);
					await expectNoAudit(reqId);
				}
			}
			// The operator cannot annul, not even with forged locals (the database refuses).
			const opAnnul = rid('operator-annul');
			expect((await recordAction(users.operator, 'annul', A, a.s5000, 'x', opAnnul)).status).toBe(
				403
			);
			await expectNoAudit(opAnnul);
			const forged = rid('operator-annul-forged');
			const forgedOutcome = await recordAction(
				users.operator,
				'annul',
				A,
				a.s5000,
				'x',
				forged,
				users.admin.permissions
			);
			expect(forgedOutcome.status).toBe(403);
			await expectNoAudit(forged);
			const forgedCreate = rid('read-only-create-forged');
			expect(
				(
					await enterSimple(
						users['read-only'],
						A,
						'900',
						forgedCreate,
						'save',
						users.admin.permissions
					)
				).status
			).toBe(403);
			await expectNoAudit(forgedCreate);

			expect(await bondCount(A)).toBe(before);
			expect((await bondRow(a.s5000)).commercial_status).toBe('available');
			expect((await bondRow(a.m4)).commercial_status).toBe('available');
		});

		it('database: the bond_* functions check the permission; tables are read-only for users', async () => {
			for (const role of ['treasurer', 'read-only', 'collector'] as const) {
				const caller = users[role];
				await rpcRejected(
					caller,
					'bond_create',
					{ p_campaign_id: A, p_base_numbers: [900] },
					'42501',
					'permission denied: bond.create is required'
				);
				await rpcRejected(
					caller,
					'bond_group_into_pata',
					{ p_campaign_id: A, p_member_bond_ids: [a.s5000, a.s603] },
					'42501'
				);
				await rpcRejected(
					caller,
					'bond_ungroup_pata',
					{ p_pata_bond_id: a.m4, p_reason: 'x' },
					'42501'
				);
				await rpcRejected(caller, 'bond_annul', { p_bond_id: a.s5000, p_reason: 'x' }, '42501');
			}
			await rpcRejected(
				users.operator,
				'bond_annul',
				{ p_bond_id: a.s5000, p_reason: 'x' },
				'42501',
				'permission denied: bond.annul is required'
			);

			// No direct writes, even for the admin.
			const insert = await users.admin.client
				.from('bonds')
				.insert({ campaign_id: A, kind: 'simple', origin: 'printed', total_value: '60000.00' });
			expect(insert.error?.code).toBe('42501');
			const update = await users.admin.client
				.from('bonds')
				.update({ commercial_status: 'annulled' })
				.eq('id', a.s5000)
				.select();
			expect(update.error?.code).toBe('42501');
			const numbers = await users.operator.client
				.from('bond_numbers')
				.update({ released_at: new Date().toISOString() })
				.eq('bond_id', a.s5000)
				.select();
			expect(numbers.error?.code).toBe('42501');
			// Nothing is deleted, not even by the trusted server.
			for (const table of ['bonds', 'bond_numbers', 'bond_groups']) {
				const column =
					table === 'bond_groups' ? 'pata_bond_id' : table === 'bonds' ? 'id' : 'bond_id';
				const del = await serviceClient.from(table).delete().eq(column, a.m1);
				expect(del.error?.code, table).toBe('42501');
			}
			// The collector sees no bonds at all (RLS).
			for (const table of ['bonds', 'bond_numbers', 'bond_groups', 'bond_list']) {
				const { data, error } = await users.collector.client.from(table).select('*').limit(5);
				expect(error, table).toBeNull();
				expect(data, table).toEqual([]);
			}
			expect((await bondRow(a.s5000)).commercial_status).toBe('available');
		});

		it("campaign A's record with a bond of campaign B: 404 and nothing changes", async () => {
			b.s69 = await simpleViaRpc(users.operator, B, 69);
			b.m = await rpcOk(
				users.operator,
				'bond_group_into_pata',
				{ p_campaign_id: B, p_member_bond_ids: [b.s68, b.s69] },
				'bond.group'
			);
			const b70 = await simpleViaRpc(users.operator, B, 70);

			const annul = rid('cross-annul');
			const annulOutcome = await recordAction(users.admin, 'annul', A, b70, 'x', annul);
			expect(annulOutcome.status).toBe(404);
			expect(annulOutcome.data?.message).toBe(BOND_MESSAGES.bondNotFound);
			await expectNoAudit(annul);
			const ungroup = rid('cross-ungroup');
			expect((await recordAction(users.operator, 'ungroup', A, b.m, 'x', ungroup)).status).toBe(
				404
			);
			await expectNoAudit(ungroup);
			const missing = rid('cross-missing');
			expect((await recordAction(users.admin, 'annul', A, randomUUID(), 'x', missing)).status).toBe(
				404
			);
			await expectNoAudit(missing);
			expect(
				await loadOrStatus(() =>
					recordLoad(
						event(users.admin, {
							path: `/campaigns/${A}/bonds/${b70}`,
							params: { id: A, bondId: b70 }
						})
					)
				)
			).toBe(404);
			// Grouping members of campaign B from campaign A's form.
			const crossGroup = rid('cross-group');
			const before = await bondCount(A);
			expect((await enterGroup(users.operator, A, [a.s5000, b70], crossGroup)).status).toBe(409);
			await expectNoAudit(crossGroup);
			await rpcRejected(
				users.operator,
				'bond_group_into_pata',
				{ p_campaign_id: A, p_member_bond_ids: [a.s5000, b70] },
				'22023',
				/belongs to another campaign/
			);
			expect(await bondCount(A)).toBe(before);
			expect((await bondRow(b70)).commercial_status).toBe('available');
			expect((await bondRow(b.m)).commercial_status).toBe('available');
			expect((await groupsOf('pata_bond_id', b.m)).every((g) => g.ungrouped_at === null)).toBe(
				true
			);
		});
	});

	describe('7. Campaign status windows and frozen rules', () => {
		it('bonds are loaded and changed in draft (A) and active (B) campaigns', async () => {
			const draft = await loadOrStatus<{ canLoad: boolean }>(() =>
				entryLoad(event(users.operator, { path: `/campaigns/${A}/bonds/new`, params: { id: A } }))
			);
			expect(draft).toMatchObject({ canLoad: true });
			b.s71 = await simpleViaRoute(users.operator, B, '71');
			const active = await campaignLoad(
				event(users.admin, { path: `/campaigns/${B}`, params: { id: B } })
			);
			expect(active).toMatchObject({ campaign: { status: 'active' }, can: { loadBonds: true } });
		});

		it('closing, closed and annulled campaigns refuse every bond change (route 409, database 55000)', async () => {
			const W = await createCampaign('W window', { dates: true });
			await transition(W, 'active');
			const ws = await simpleViaRoute(users.operator, W, '1');
			const w2 = await simpleViaRpc(users.operator, W, 2);
			const w3 = await simpleViaRpc(users.operator, W, 3);
			const wm = await rpcOk(
				users.operator,
				'bond_group_into_pata',
				{ p_campaign_id: W, p_member_bond_ids: [w2, w3] },
				'bond.group'
			);
			const w4 = await simpleViaRpc(users.operator, W, 4);
			const w5 = await simpleViaRpc(users.operator, W, 5);

			const X = await createCampaign('X annulled');
			const xs = await simpleViaRpc(users.operator, X, 1);
			await transition(X, 'annulled', 'Created by mistake');

			const checkLocked = async (campaignId: string, status: string) => {
				const before = await bondCount(campaignId);
				const page = (await entryLoad(
					event(users.operator, {
						path: `/campaigns/${campaignId}/bonds/new`,
						params: { id: campaignId }
					})
				)) as { canLoad: boolean; lockedMessage: string };
				expect(page.canLoad).toBe(false);
				expect(page.lockedMessage).toContain(BOND_MESSAGES.campaignLocked);
				expect(page.lockedMessage).toContain(`This campaign is ${status}`);
				const attempts = [
					['create', (r: string) => enterSimple(users.operator, campaignId, '9', r)],
					['printed', (r: string) => enterPrinted(users.operator, campaignId, '10 11', r)]
				] as const;
				for (const [label, run] of attempts) {
					const reqId = rid(`${status}-${label}`);
					const outcome = await run(reqId);
					expect(outcome.status, `${status} ${label}`).toBe(409);
					expect(outcome.data?.message).toContain(BOND_MESSAGES.campaignLocked);
					await expectNoAudit(reqId);
				}
				await rpcRejected(
					users.operator,
					'bond_create',
					{ p_campaign_id: campaignId, p_base_numbers: [9] },
					'55000',
					/draft or active/
				);
				expect(await bondCount(campaignId)).toBe(before);
			};

			const checkLockedChanges = async (status: string) => {
				const reqs = [
					[
						'group',
						rid(`${status}-group`),
						(r: string) => enterGroup(users.operator, W, [w4, w5], r)
					],
					[
						'ungroup',
						rid(`${status}-ungroup`),
						(r: string) => recordAction(users.operator, 'ungroup', W, wm, 'x', r)
					],
					[
						'annul',
						rid(`${status}-annul`),
						(r: string) => recordAction(users.admin, 'annul', W, ws, 'x', r)
					]
				] as const;
				for (const [label, reqId, run] of reqs) {
					const outcome = await run(reqId);
					expect(outcome.status, `${status} ${label}`).toBe(409);
					await expectNoAudit(reqId);
				}
				await rpcRejected(
					users.operator,
					'bond_group_into_pata',
					{ p_campaign_id: W, p_member_bond_ids: [w4, w5] },
					'55000'
				);
				await rpcRejected(
					users.operator,
					'bond_ungroup_pata',
					{ p_pata_bond_id: wm, p_reason: 'x' },
					'55000'
				);
				await rpcRejected(users.admin, 'bond_annul', { p_bond_id: ws, p_reason: 'x' }, '55000');
				const shown = await record(users.admin, W, wm);
				expect(shown.record.actions).toMatchObject({ ungroup: false, annul: false });
				expect(shown.record.actions.lockedMessage).toContain(BOND_MESSAGES.campaignLocked);
				expect((await list(users.admin, W)).can.create).toBe(false);
				expect((await bondRow(ws)).commercial_status).toBe('available');
				expect((await bondRow(wm)).commercial_status).toBe('available');
				expect(await groupsOf('member_bond_id', w4)).toEqual([]);
			};

			await transition(W, 'closing');
			await checkLocked(W, 'closing');
			await checkLockedChanges('closing');
			await transition(W, 'closed');
			await checkLocked(W, 'closed');
			await checkLockedChanges('closed');
			await checkLocked(X, 'annulled');
			expect((await bondRow(xs)).commercial_status).toBe('available');
		});

		it('rules are frozen once a draft has bonds (annulled ones included); editable without bonds', async () => {
			const F = await createCampaign('F frozen by an annulled bond');
			const fs = await simpleViaRpc(users.operator, F, 1);
			await rpcOk(users.admin, 'bond_annul', { p_bond_id: fs, p_reason: 'Mistake' }, 'bond.annul');
			const N = await createCampaign('N no bonds');

			const rulesFields = (campaign: Campaign, value: string) => ({
				simpleBondValue: value,
				installmentCount: String(campaign.installmentCount),
				numberDigits: String(campaign.numberDigits),
				maxNumber: String(campaign.maxNumber),
				associatedNumberOffset: String(campaign.associatedNumberOffset),
				overflowPolicy: campaign.overflowPolicy,
				barcodeMode: campaign.barcodeMode,
				changeReason: '',
				confirmRulesChange: 'yes',
				expectedUpdatedAt: campaign.updatedAt
			});
			type CampaignPage = {
				campaign: Campaign;
				hasBonds: boolean;
				can: { editRules: boolean; loadBonds: boolean };
			};
			const page = async (id: string) =>
				(await campaignLoad(
					event(users.admin, { path: `/campaigns/${id}`, params: { id } })
				)) as unknown as CampaignPage;

			for (const id of [A, C, F]) {
				const loaded = await page(id);
				expect(loaded).toMatchObject({
					campaign: { status: 'draft' },
					hasBonds: true,
					can: { editRules: false, loadBonds: true }
				});
				const reqId = rid('rules-frozen');
				const outcome = await act(() =>
					campaignActions.rules(
						event(users.admin, {
							path: `/campaigns/${id}`,
							params: { id },
							requestId: reqId,
							search: '?/rules',
							fields: rulesFields(loaded.campaign, '70.000,00')
						})
					)
				);
				expect(outcome.status).toBe(409);
				expect(outcome.data?.message).toBe(CAMPAIGN_MESSAGES.rulesFrozenByBonds);
				await expectNoAudit(reqId);
				await rpcRejected(
					users.admin,
					'campaign_update_rules',
					{
						p_id: id,
						p_simple_bond_value: '70000.00',
						p_installment_count: loaded.campaign.installmentCount,
						p_number_digits: loaded.campaign.numberDigits,
						p_max_number: loaded.campaign.maxNumber,
						p_associated_number_offset: loaded.campaign.associatedNumberOffset,
						p_overflow_policy: loaded.campaign.overflowPolicy,
						p_barcode_mode: loaded.campaign.barcodeMode,
						p_expected_updated_at: await campaignUpdatedAt(id)
					},
					'55000',
					'campaign rules cannot be changed once the campaign has bonds'
				);
				expect((await page(id)).campaign.simpleBondValue).toBe(loaded.campaign.simpleBondValue);
			}

			// Control: a draft without bonds still edits its rules.
			const free = await page(N);
			expect(free).toMatchObject({ hasBonds: false, can: { editRules: true } });
			const reqId = rid('rules-no-bonds');
			const outcome = await act(() =>
				campaignActions.rules(
					event(users.admin, {
						path: `/campaigns/${N}`,
						params: { id: N },
						requestId: reqId,
						search: '?/rules',
						fields: rulesFields(free.campaign, '70.000,00')
					})
				)
			);
			expect(outcome.status, JSON.stringify(outcome.data)).toBe(200);
			await expectOneAudit(reqId, users.admin, { action: 'campaign.update_rules', entity_id: N });
			expect((await page(N)).campaign.simpleBondValue).toBe('70000.00');
		});
	});

	describe('8. Audit trail', () => {
		it('one audit row per successful write and none for rejected calls (per entity and per run)', async () => {
			const ids = [...expectedAudit.keys()];
			const { data, error } = await serviceClient
				.from('audit_log')
				.select('entity_id')
				.in('entity_id', ids);
			expect(error).toBeNull();
			const actual = new Map<string, number>();
			for (const row of (data ?? []) as { entity_id: string }[]) {
				actual.set(row.entity_id, (actual.get(row.entity_id) ?? 0) + 1);
			}
			expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expectedAudit));
			const expectedTotal = [...expectedAudit.values()].reduce((x, y) => x + y, 0);
			const { count } = await serviceClient
				.from('audit_log')
				.select('id', { count: 'exact', head: true })
				.like('request_id', `${REQUEST_PREFIX}%`);
			expect(count).toBe(expectedTotal);
			console.log(
				`[integration] Phase 3 run ${RUN_ID}: ${expectedTotal} audit rows for ${ids.length} entities`
			);
		});
	});
});
