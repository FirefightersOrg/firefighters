import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isRedirect } from '@sveltejs/kit';
import { load as listLoad } from '../../src/routes/campaigns/+page.server';
import {
	actions as newCampaignActions,
	load as newCampaignLoad
} from '../../src/routes/campaigns/new/+page.server';
import {
	actions as campaignActions,
	load as campaignLoad
} from '../../src/routes/campaigns/[id]/+page.server';
import {
	actions as commissionActions,
	load as commissionLoad
} from '../../src/routes/campaigns/[id]/commissions/+page.server';
import {
	defaultRulesValues,
	emptyGeneralValues,
	rulesValuesOf
} from '$lib/components/campaigns/types';
import { campaignNumberingConfig, canLoadBonds, type Campaign } from '$lib/domain/campaigns';
import {
	formatCommissionRuleType,
	formatCommissionValue,
	type CommissionRule
} from '$lib/domain/commissions';
import {
	calculateAssociatedNumber,
	DEFAULT_NUMBERING_CONFIG,
	formatCampaignNumber,
	getMaxValidBaseNumber,
	NumberingError,
	parseCampaignNumber,
	validateNoOverflow
} from '$lib/domain/numbering';
import { loadPermissions } from './permissions';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';
import { COMMISSION_RULE_MESSAGES } from '$lib/server/services/commission-rules';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import type { UserProfile } from '../../src/app';

/**
 * Phase 2 acceptance (SAN-21): campaign creation, rules, transitions, permissions, commission
 * rules and their audit trail, against the real local Supabase with the seeded users.
 *
 * Calls the real code paths: the SvelteKit loads and form actions of /campaigns/** with a
 * USER-SCOPED client and the caller's real permission list (`my_permissions()`), and the audited
 * SQL functions directly through the same client when a database-level check is the point.
 *
 * Campaigns and commission rules cannot be deleted (by design), so this suite does not clean up:
 * every campaign it creates is named `[it-p2 <run id>] ...` and every request id starts with
 * `it-p2-<run id>-`, so a run's data can be told apart and the suite can run again without a
 * `supabase db reset`. See docs/phase-2-verification.md.
 */

const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seedConfig = resolveSeedConfig(seedEnv);

const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };

const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
const NAME_PREFIX = `[it-p2 ${RUN_ID}]`;
const REQUEST_PREFIX = `it-p2-${RUN_ID}-`;
const campaignName = (label: string) => `${NAME_PREFIX} ${label}`;
let requestSeq = 0;
const rid = (label: string) => `${REQUEST_PREFIX}${String(++requestSeq).padStart(3, '0')}-${label}`;

const NBSP = ' ';
const CAMPAIGN_STARTS_ON = '2027-03-01';
const CAMPAIGN_ENDS_ON = '2027-12-31';

type RoleName = 'admin' | 'operator' | 'treasurer' | 'collector' | 'read-only';

interface SignedInUser {
	role: RoleName;
	user: User;
	client: SupabaseClient;
	profile: UserProfile;
	/** Real permission list from `my_permissions()`, as the hook would put in `locals`. */
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

interface CampaignPageData {
	campaign: Campaign;
	can: {
		editName: boolean;
		editDates: boolean;
		editRules: boolean;
		transitions: string[];
		viewCommissions: boolean;
		viewBonds: boolean;
		loadBonds: boolean;
		viewCollectors: boolean;
		viewBuyers: boolean;
		viewDeliveries: boolean;
		viewSales: boolean;
	};
}

interface CommissionPageData {
	campaign: Campaign;
	rules: CommissionRule[];
	can: { manage: boolean };
}

type Fields = Record<string, string>;

let serviceClient: SupabaseClient;
const users = {} as Record<RoleName, SignedInUser>;

/** entity_id -> audit rows this run expects for it (one per successful mutation). */
const expectedAudit = new Map<string, number>();
/** Every campaign this run created. */
const runCampaignIds: string[] = [];

// ---------------------------------------------------------------------------
// Sessions and request events
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
	if (profileError || !profile) {
		throw new Error(`No profile for ${email}: ${profileError?.message ?? 'not found'}`);
	}
	return {
		role,
		user: data.user,
		client,
		profile: profile as UserProfile,
		permissions: await loadPermissions(client)
	};
}

function localsFor(caller: SignedInUser, requestId: string, permissions?: string[]): App.Locals {
	return {
		supabase: caller.client,
		safeGetSession: async () => ({ session: null, user: caller.user }),
		session: null,
		user: caller.user,
		profile: caller.profile,
		permissions: permissions ?? caller.permissions,
		requestId
	};
}

interface EventOptions {
	path: string;
	id?: string;
	requestId: string;
	/** Form action name (`?/name`); omitted for loads and the default action. */
	action?: string;
	query?: string;
	fields?: Fields;
	/** Overrides the caller's real permission list (route-gate checks only). */
	permissions?: string[];
}

/** A RequestEvent for a load or form action, typed by the call site. */
function event<E>(caller: SignedInUser, options: EventOptions): E {
	const search = options.action !== undefined ? `?/${options.action}` : (options.query ?? '');
	const url = new URL(`http://localhost${options.path}${search}`);
	let request = new Request(url);
	if (options.fields) {
		const body = new FormData();
		for (const [key, value] of Object.entries(options.fields)) body.set(key, value);
		request = new Request(url, { method: 'POST', body });
	}
	return {
		locals: localsFor(caller, options.requestId, options.permissions),
		params: options.id ? { id: options.id } : {},
		url,
		request
	} as unknown as E;
}

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

function createFields(label: string, overrides: Fields = {}): Fields {
	return {
		...emptyGeneralValues(),
		...defaultRulesValues(),
		name: campaignName(label),
		simpleBondValue: '60.000,00',
		installmentCount: '10',
		barcodeMode: 'base_number',
		...overrides
	};
}

/** POST /campaigns/new. Returns the new id (303 redirect) or the `fail()` result. */
async function createCampaignViaAction(
	caller: SignedInUser,
	fields: Fields,
	requestId: string,
	permissions?: string[]
): Promise<{ id: string; failure?: undefined } | { id?: undefined; failure: unknown }> {
	try {
		const failure = await newCampaignActions.default(
			event(caller, { path: '/campaigns/new', requestId, fields, permissions })
		);
		return { failure };
	} catch (err) {
		if (!isRedirect(err)) throw err;
		expect(err.status).toBe(303);
		const match = /^\/campaigns\/([0-9a-f-]{36})$/.exec(err.location);
		expect(match, `unexpected redirect ${err.location}`).not.toBeNull();
		runCampaignIds.push(match![1]);
		return { id: match![1] };
	}
}

/** Creates a campaign as admin through the route and checks its single campaign.create row. */
async function adminCreatesCampaign(label: string, overrides: Fields = {}): Promise<string> {
	const requestId = rid(`create-${label}`);
	const result = await createCampaignViaAction(
		users.admin,
		createFields(label, overrides),
		requestId
	);
	expect(result.failure).toBeUndefined();
	await expectOneAudit(requestId, {
		action: 'campaign.create',
		entity_type: 'campaign',
		entity_id: result.id
	});
	return result.id!;
}

async function loadCampaign(caller: SignedInUser, id: string): Promise<CampaignPageData> {
	return (await campaignLoad(
		event(caller, { path: `/campaigns/${id}`, id, requestId: rid('load') })
	)) as unknown as CampaignPageData;
}

async function loadCommissions(caller: SignedInUser, id: string): Promise<CommissionPageData> {
	return (await commissionLoad(
		event(caller, { path: `/campaigns/${id}/commissions`, id, requestId: rid('load-rules') })
	)) as unknown as CommissionPageData;
}

type CampaignActionName = keyof typeof campaignActions;

function campaignAction(
	name: CampaignActionName,
	caller: SignedInUser,
	id: string,
	fields: Fields,
	requestId: string,
	permissions?: string[]
): Promise<unknown> {
	return campaignActions[name](
		event(caller, { path: `/campaigns/${id}`, id, action: name, fields, requestId, permissions })
	) as Promise<unknown>;
}

type CommissionActionName = keyof typeof commissionActions;

function commissionAction(
	name: CommissionActionName,
	caller: SignedInUser,
	campaignId: string,
	fields: Fields,
	requestId: string,
	permissions?: string[]
): Promise<unknown> {
	return commissionActions[name](
		event(caller, {
			path: `/campaigns/${campaignId}/commissions`,
			id: campaignId,
			action: name,
			fields,
			requestId,
			permissions
		})
	) as Promise<unknown>;
}

/**
 * The rules form as the page renders it for `campaign`: its values, the confirmation, and the
 * hidden version (`expectedUpdatedAt` = the `updated_at` string PostgREST returned).
 */
function rulesFields(campaign: Campaign, overrides: Fields = {}): Fields {
	return {
		...rulesValuesOf(campaign),
		changeReason: '',
		confirmRulesChange: 'yes',
		expectedUpdatedAt: campaign.updatedAt,
		...overrides
	};
}

/** The general-data form as the page renders it for `campaign` (with its hidden version). */
function generalFields(campaign: Campaign, overrides: Fields = {}): Fields {
	return {
		name: campaign.name,
		startsOn: CAMPAIGN_STARTS_ON,
		endsOn: CAMPAIGN_ENDS_ON,
		expectedUpdatedAt: campaign.updatedAt,
		...overrides
	};
}

function ruleFields(overrides: Fields = {}): Fields {
	return {
		ruleType: 'cash_full_payment',
		installmentNumber: '',
		valueKind: 'percentage',
		percentage: '',
		fixedAmount: '',
		validFrom: '2027-01-01',
		validTo: '',
		reason: '',
		...overrides
	};
}

async function getCampaign(id: string): Promise<Campaign> {
	return (await loadCampaign(users.admin, id)).campaign;
}

/** A rule as the admin's commissions page loads it (its `updatedAt` is the edit form's version). */
async function getRule(campaignId: string, ruleId: string): Promise<CommissionRule> {
	const rule = (await loadCommissions(users.admin, campaignId)).rules.find((r) => r.id === ruleId);
	expect(rule, `rule ${ruleId}`).toBeDefined();
	return rule!;
}

/** The commission rule edit form for `rule` (id and hidden version) plus the rule fields. */
async function ruleEditFields(campaignId: string, ruleId: string, overrides: Fields = {}) {
	const rule = await getRule(campaignId, ruleId);
	return { ruleId, expectedUpdatedAt: rule.updatedAt, ...ruleFields(overrides) };
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

/** Exactly one audit row for the request, matching `expected`; counted for the final tally. */
async function expectOneAudit(requestId: string, expected: Partial<AuditRow>): Promise<AuditRow> {
	const rows = await auditRowsFor(requestId);
	expect(rows, `audit rows for ${requestId}`).toHaveLength(1);
	expect(rows[0]).toMatchObject({
		actor_user_id: users.admin.profile.id,
		request_id: requestId,
		...expected
	});
	expectedAudit.set(rows[0].entity_id, (expectedAudit.get(rows[0].entity_id) ?? 0) + 1);
	return rows[0];
}

async function expectNoAudit(requestId: string) {
	expect(await auditRowsFor(requestId), `audit rows for ${requestId}`).toEqual([]);
}

async function rpc(client: SupabaseClient, fn: string, args: Record<string, unknown>) {
	return client.rpc(fn, args);
}

function rpcCreateArgs(name: string, requestId: string, overrides: Record<string, unknown> = {}) {
	return {
		p_name: name,
		p_simple_bond_value: '60000.00',
		p_installment_count: 10,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_request_id: requestId,
		...overrides
	};
}

function rpcRulesArgs(campaign: Campaign, requestId: string, overrides: Record<string, unknown>) {
	return {
		p_id: campaign.id,
		p_simple_bond_value: campaign.simpleBondValue,
		p_installment_count: campaign.installmentCount,
		p_number_digits: campaign.numberDigits,
		p_max_number: campaign.maxNumber,
		p_associated_number_offset: campaign.associatedNumberOffset,
		p_overflow_policy: campaign.overflowPolicy,
		p_barcode_mode: campaign.barcodeMode,
		p_expected_updated_at: campaign.updatedAt,
		p_request_id: requestId,
		...overrides
	};
}

function rpcRuleArgs(campaignId: string, requestId: string, overrides: Record<string, unknown>) {
	return {
		p_campaign_id: campaignId,
		p_rule_type: 'cash_full_payment',
		p_installment_number: null,
		p_percentage: '10.00',
		p_fixed_amount: null,
		p_valid_from: '2027-01-01',
		p_valid_to: null,
		p_request_id: requestId,
		...overrides
	};
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
	serviceClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);
	const fixture = (role: RoleName) => {
		const user = seedConfig.fixtures.find((f) => f.roleNames.includes(role));
		if (!user) throw new Error(`resolveSeedConfig returned no ${role} fixture`);
		return user;
	};
	users.admin = await signIn('admin', seedConfig.admin.email, seedConfig.admin.password);
	for (const role of ['operator', 'treasurer', 'collector', 'read-only'] as const) {
		const { email, password } = fixture(role);
		users[role] = await signIn(role, email, password);
	}
	console.log(
		`[integration] Phase 2 run id: ${RUN_ID} (campaign names start with "${NAME_PREFIX}")`
	);
});

describe('Phase 2 end-to-end acceptance (local Supabase)', () => {
	// Campaign ids shared by the sections below (each section uses its own campaign).
	let mainId: string;
	let fiveDigitId: string;

	describe('1. Campaign creation (POST /campaigns/new -> campaign_create)', () => {
		it('admin creates a draft with es-AR money (60.000,00 / 10 -> 6000.00) and default numbering', async () => {
			expect(
				(await newCampaignLoad(
					event(users.admin, { path: '/campaigns/new', requestId: rid('load-new') })
				)) ?? {}
			).toEqual({});

			const requestId = rid('create-main');
			const fields = createFields('Main draft');
			// The form's defaults are the 4-digit MVP numbering.
			expect(fields).toMatchObject({
				numberDigits: '4',
				maxNumber: '9999',
				associatedNumberOffset: '4871',
				overflowPolicy: 'reject'
			});
			const result = await createCampaignViaAction(users.admin, fields, requestId);
			expect(result.failure).toBeUndefined();
			mainId = result.id!;

			const { campaign, can } = await loadCampaign(users.admin, mainId);
			expect(campaign).toMatchObject({
				id: mainId,
				name: campaignName('Main draft'),
				status: 'draft',
				startsAt: null,
				endsAt: null,
				simpleBondValue: '60000.00',
				installmentCount: 10,
				installmentValue: '6000.00',
				numberDigits: 4,
				maxNumber: 9999,
				associatedNumberOffset: 4871,
				overflowPolicy: 'reject',
				barcodeMode: 'base_number',
				createdBy: users.admin.profile.id
			});
			expect(campaignNumberingConfig(campaign)).toEqual(DEFAULT_NUMBERING_CONFIG);
			expect(can).toEqual({
				editName: true,
				editDates: true,
				editRules: true,
				transitions: ['active', 'annulled'],
				viewCommissions: true,
				viewAudit: true,
				viewBonds: true,
				loadBonds: true,
				// SAN-52: campaign links to collectors / buyers.
				viewCollectors: true,
				viewBuyers: true,
				viewDeliveries: true,
				viewSales: true,
				// SAN-64: admins can navigate to the settlement workspace.
				viewSettlements: true,
				// SAN-78: any draw.* permission exposes the draws link.
				viewDraws: true,
				exportBackups: true,
				// SAN-86: report.view_operational.
				viewReports: true
			});

			const audit = await expectOneAudit(requestId, {
				action: 'campaign.create',
				entity_type: 'campaign',
				entity_id: mainId,
				old_value: null,
				reason: null
			});
			expect(audit.new_value).toMatchObject({
				id: mainId,
				name: campaignName('Main draft'),
				status: 'draft',
				simple_bond_value: 60000,
				installment_count: 10,
				installment_value: 6000,
				number_digits: 4,
				max_number: 9999,
				associated_number_offset: 4871,
				overflow_policy: 'reject',
				barcode_mode: 'base_number',
				created_by: users.admin.profile.id
			});
		});

		it('rejects 60.000,00 / 7 (not exact to the cent) in the form and in campaign_create', async () => {
			const requestId = rid('create-not-exact');
			const result = await createCampaignViaAction(
				users.admin,
				createFields('Not exact', { installmentCount: '7' }),
				requestId
			);
			expect(result.failure).toMatchObject({
				status: 400,
				data: { form: 'create', success: false, errors: { installmentCount: [expect.any(String)] } }
			});
			await expectNoAudit(requestId);

			// The database rejects it on its own too (no rounding).
			const dbRequestId = rid('rpc-create-not-exact');
			const { data, error } = await rpc(
				users.admin.client,
				'campaign_create',
				rpcCreateArgs(campaignName('Not exact (rpc)'), dbRequestId, { p_installment_count: 7 })
			);
			expect(data).toBeNull();
			expect(error).toMatchObject({
				code: '22023',
				message: 'simple bond value 60000.00 cannot be split into 7 equal installments'
			});
			await expectNoAudit(dbRequestId);

			const { data: rows } = await serviceClient
				.from('campaigns')
				.select('id')
				.like('name', `${NAME_PREFIX} Not exact%`);
			expect(rows).toEqual([]);
		});

		it('creates a 5-digit campaign (number_digits 5, max_number 99999)', async () => {
			fiveDigitId = await adminCreatesCampaign('Five digits', {
				numberDigits: '5',
				maxNumber: '99999',
				simpleBondValue: '120.000,50',
				installmentCount: '1',
				barcodeMode: 'internal_code'
			});
			const campaign = await getCampaign(fiveDigitId);
			expect(campaign).toMatchObject({
				numberDigits: 5,
				maxNumber: 99999,
				associatedNumberOffset: 4871,
				simpleBondValue: '120000.50',
				installmentValue: '120000.50',
				barcodeMode: 'internal_code'
			});
		});

		it('rejects a max number that does not fit the digits (form 400, database 23514)', async () => {
			const requestId = rid('create-bad-numbering');
			const result = await createCampaignViaAction(
				users.admin,
				createFields('Bad numbering', { maxNumber: '99999' }),
				requestId
			);
			expect(result.failure).toMatchObject({
				status: 400,
				data: { errors: { maxNumber: [expect.any(String)] } }
			});
			await expectNoAudit(requestId);

			const dbRequestId = rid('rpc-create-bad-numbering');
			const { error } = await rpc(
				users.admin.client,
				'campaign_create',
				rpcCreateArgs(campaignName('Bad numbering (rpc)'), dbRequestId, { p_max_number: 99999 })
			);
			expect(error?.code).toBe('23514');
			expect(error?.message).toContain('campaigns_max_number_fits_digits');
			await expectNoAudit(dbRequestId);
		});

		it('caps max number at the Postgres integer maximum (2147483647 ok, 2147483648 rejected)', async () => {
			const requestId = rid('create-max-number-too-big');
			const result = await createCampaignViaAction(
				users.admin,
				createFields('Max number too big', { numberDigits: '10', maxNumber: '2147483648' }),
				requestId
			);
			expect(result.failure).toMatchObject({
				status: 400,
				data: { errors: { maxNumber: ['El número máximo debe ser como máximo 2147483647'] } }
			});
			await expectNoAudit(requestId);

			const id = await adminCreatesCampaign('Max number at the cap', {
				numberDigits: '10',
				maxNumber: '2147483647'
			});
			expect(await getCampaign(id)).toMatchObject({ numberDigits: 10, maxNumber: 2147483647 });
		});

		it('numbering domain on the stored configs: 0068 -> 4939, 5129 overflows, 5-digit zero padding', async () => {
			const four = campaignNumberingConfig(await getCampaign(mainId));
			expect(parseCampaignNumber('0068', four)).toBe(68);
			expect(calculateAssociatedNumber(68, four)).toBe(4939);
			expect(formatCampaignNumber(68, four)).toBe('0068');
			expect(formatCampaignNumber(calculateAssociatedNumber(68, four), four)).toBe('4939');
			expect(getMaxValidBaseNumber(four)).toBe(5128);
			expect(calculateAssociatedNumber(5128, four)).toBe(9999);
			expect(validateNoOverflow(5129, four)).toBe(false);
			expect(() => calculateAssociatedNumber(5129, four)).toThrow(NumberingError);
			try {
				calculateAssociatedNumber(5129, four);
			} catch (err) {
				expect((err as NumberingError).code).toBe('overflow');
				expect((err as Error).message).toContain(
					'10000 (5129 + 4871) exceeds the campaign maximum 9999'
				);
			}

			const five = campaignNumberingConfig(await getCampaign(fiveDigitId));
			expect(formatCampaignNumber(68, five)).toBe('00068');
			expect(formatCampaignNumber(calculateAssociatedNumber(68, five), five)).toBe('04939');
			expect(formatCampaignNumber(0, five)).toBe('00000');
			expect(formatCampaignNumber(99999, five)).toBe('99999');
			expect(parseCampaignNumber('00068', five)).toBe(68);
			expect(getMaxValidBaseNumber(five)).toBe(95128);
			expect(() => calculateAssociatedNumber(95129, five)).toThrow(NumberingError);
		});
	});

	describe('2. Rules of a draft (?/rules -> campaign_update_rules)', () => {
		it('requires the explicit confirmation (400, nothing written)', async () => {
			const before = await getCampaign(mainId);
			const requestId = rid('rules-unconfirmed');
			const result = await campaignAction(
				'rules',
				users.admin,
				mainId,
				rulesFields(before, { installmentCount: '12', confirmRulesChange: '' }),
				requestId
			);
			expect(result).toMatchObject({
				status: 400,
				data: { form: 'rules', errors: { confirmRulesChange: [expect.any(String)] } }
			});
			await expectNoAudit(requestId);
			expect(await getCampaign(mainId)).toEqual(before);
		});

		it('with confirmation and a reason writes exactly one campaign.update_rules row (old/new/reason)', async () => {
			const requestId = rid('rules-with-reason');
			const result = await campaignAction(
				'rules',
				users.admin,
				mainId,
				rulesFields(await getCampaign(mainId), {
					installmentCount: '12',
					changeReason: '  Board decision 2027  '
				}),
				requestId
			);
			expect(result).toEqual({
				form: 'rules',
				success: true,
				message: 'Reglas guardadas.',
				errors: {}
			});

			const audit = await expectOneAudit(requestId, {
				action: 'campaign.update_rules',
				entity_type: 'campaign',
				entity_id: mainId,
				reason: 'Board decision 2027'
			});
			expect(audit.old_value).toEqual({ installment_count: 10, installment_value: 6000 });
			expect(audit.new_value).toEqual({ installment_count: 12, installment_value: 5000 });
			expect(await getCampaign(mainId)).toMatchObject({
				installmentCount: 12,
				installmentValue: '5000.00'
			});
		});

		it('the reason is optional (audit reason null); a no-op save writes nothing', async () => {
			const requestId = rid('rules-no-reason');
			const result = await campaignAction(
				'rules',
				users.admin,
				mainId,
				rulesFields(await getCampaign(mainId), { barcodeMode: 'manual_mapping' }),
				requestId
			);
			expect(result).toMatchObject({ success: true, message: 'Reglas guardadas.' });
			const audit = await expectOneAudit(requestId, {
				action: 'campaign.update_rules',
				entity_id: mainId,
				reason: null
			});
			expect(audit.old_value).toEqual({ barcode_mode: 'base_number' });
			expect(audit.new_value).toEqual({ barcode_mode: 'manual_mapping' });

			const noopId = rid('rules-noop');
			const noop = await campaignAction(
				'rules',
				users.admin,
				mainId,
				rulesFields(await getCampaign(mainId)),
				noopId
			);
			expect(noop).toMatchObject({ success: true, message: 'No hay cambios para guardar.' });
			await expectNoAudit(noopId);
		});

		it('rejects a non-exact split on edit too (60.000,00 / 7)', async () => {
			const before = await getCampaign(mainId);
			const requestId = rid('rules-not-exact');
			const result = await campaignAction(
				'rules',
				users.admin,
				mainId,
				rulesFields(before, { installmentCount: '7' }),
				requestId
			);
			expect(result).toMatchObject({
				status: 400,
				data: { errors: { installmentCount: [expect.any(String)] } }
			});
			await expectNoAudit(requestId);
			expect(await getCampaign(mainId)).toEqual(before);
		});
	});

	describe('3. Status transitions (?/transition, ?/update)', () => {
		let annulId: string;

		it('activation without dates is rejected (409 in the route, 23514 in the database)', async () => {
			const requestId = rid('activate-no-dates');
			const result = await campaignAction(
				'transition',
				users.admin,
				mainId,
				{ toStatus: 'active', reason: '' },
				requestId
			);
			expect(result).toMatchObject({
				status: 409,
				data: { form: 'transition', message: CAMPAIGN_MESSAGES.activationNeedsDates }
			});
			await expectNoAudit(requestId);

			const dbRequestId = rid('rpc-activate-no-dates');
			const { error } = await rpc(users.admin.client, 'campaign_transition', {
				p_id: mainId,
				p_to_status: 'active',
				p_request_id: dbRequestId
			});
			expect(error).toMatchObject({
				code: '23514',
				message: 'campaign cannot be activated without starts_at and ends_at'
			});
			await expectNoAudit(dbRequestId);
			expect((await getCampaign(mainId)).status).toBe('draft');
		});

		it('route gate: activation needs campaign.update_rules, closing/annulling need campaign.close', async () => {
			const all = users.admin.permissions;
			const withoutUpdateRules = all.filter((p) => p !== 'campaign.update_rules');
			const withoutClose = all.filter((p) => p !== 'campaign.close');
			const cases: [string, string, string[]][] = [
				['active', '', withoutUpdateRules],
				['closing', '', withoutClose],
				['closed', '', withoutClose],
				['annulled', 'reason', withoutClose]
			];
			for (const [toStatus, reason, permissions] of cases) {
				const requestId = rid(`gate-${toStatus}`);
				const result = await campaignAction(
					'transition',
					users.admin,
					mainId,
					{ toStatus, reason },
					requestId,
					permissions
				);
				expect(result, toStatus).toMatchObject({
					status: 403,
					data: { message: CAMPAIGN_MESSAGES.permission }
				});
				await expectNoAudit(requestId);
			}
			expect((await getCampaign(mainId)).status).toBe('draft');
		});

		it('sets the dates (one campaign.update row), then activates (one campaign.transition row)', async () => {
			const datesId = rid('update-dates');
			const saved = await campaignAction(
				'update',
				users.admin,
				mainId,
				generalFields(await getCampaign(mainId)),
				datesId
			);
			expect(saved).toEqual({
				form: 'general',
				success: true,
				message: 'Cambios guardados.',
				errors: {}
			});
			const datesAudit = await expectOneAudit(datesId, {
				action: 'campaign.update',
				entity_type: 'campaign',
				entity_id: mainId,
				old_value: { starts_at: null, ends_at: null }
			});
			expect(Object.keys(datesAudit.new_value ?? {}).sort()).toEqual(['ends_at', 'starts_at']);

			const activateId = rid('activate');
			const activated = await campaignAction(
				'transition',
				users.admin,
				mainId,
				{ toStatus: 'active', reason: '' },
				activateId
			);
			expect(activated).toMatchObject({
				success: true,
				message: expect.stringContaining('activada')
			});
			await expectOneAudit(activateId, {
				action: 'campaign.transition',
				entity_type: 'campaign',
				entity_id: mainId,
				old_value: { status: 'draft' },
				new_value: { status: 'active' },
				reason: null
			});

			const { campaign, can } = await loadCampaign(users.admin, mainId);
			expect(campaign.status).toBe('active');
			expect(campaign.startsAt).not.toBeNull();
			expect(can).toMatchObject({
				editName: true,
				editDates: true,
				editRules: false,
				transitions: ['closing', 'annulled']
			});
		});

		it('rules are frozen while active (409 in the route, 55000 in the database)', async () => {
			const before = await getCampaign(mainId);
			const requestId = rid('rules-active');
			const result = await campaignAction(
				'rules',
				users.admin,
				mainId,
				rulesFields(before, { simpleBondValue: '66.000,00' }),
				requestId
			);
			expect(result).toMatchObject({
				status: 409,
				data: { message: CAMPAIGN_MESSAGES.rulesFrozen }
			});
			await expectNoAudit(requestId);

			const dbRequestId = rid('rpc-rules-active');
			const { error } = await rpc(
				users.admin.client,
				'campaign_update_rules',
				rpcRulesArgs(before, dbRequestId, { p_simple_bond_value: '66000.00' })
			);
			expect(error?.code).toBe('55000');
			expect(error?.message).toContain(
				'campaign rules can only be changed while the campaign is draft'
			);
			await expectNoAudit(dbRequestId);
			expect(await getCampaign(mainId)).toEqual(before);
		});

		it('dates cannot be cleared after activation but can still change', async () => {
			const before = await getCampaign(mainId);
			const requestId = rid('clear-dates');
			const result = await campaignAction(
				'update',
				users.admin,
				mainId,
				generalFields(before, { startsOn: '', endsOn: '' }),
				requestId
			);
			expect(result).toMatchObject({
				status: 409,
				data: { errors: { startsOn: [CAMPAIGN_MESSAGES.datesCannotBeCleared] } }
			});
			await expectNoAudit(requestId);

			const dbRequestId = rid('rpc-clear-dates');
			const { error } = await rpc(users.admin.client, 'campaign_update', {
				p_id: mainId,
				p_name: before.name,
				p_starts_at: before.startsAt,
				p_ends_at: null,
				p_expected_updated_at: before.updatedAt,
				p_request_id: dbRequestId
			});
			expect(error?.code).toBe('23514');
			await expectNoAudit(dbRequestId);
			expect(await getCampaign(mainId)).toEqual(before);

			const moveId = rid('move-end-date');
			expect(
				await campaignAction(
					'update',
					users.admin,
					mainId,
					generalFields(before, { endsOn: '2028-01-31' }),
					moveId
				)
			).toMatchObject({ success: true, message: 'Cambios guardados.' });
			await expectOneAudit(moveId, { action: 'campaign.update', entity_id: mainId });
		});

		it('active -> closing -> closed; a closed campaign is immutable', async () => {
			// Only annulling requires a reason; the other transitions take an optional one.
			const reasons = { closing: '  Season over  ', closed: '' } as const;
			for (const toStatus of ['closing', 'closed'] as const) {
				const from = (await getCampaign(mainId)).status;
				const requestId = rid(`to-${toStatus}`);
				expect(
					await campaignAction(
						'transition',
						users.admin,
						mainId,
						{ toStatus, reason: reasons[toStatus] },
						requestId
					)
				).toMatchObject({ success: true });
				await expectOneAudit(requestId, {
					action: 'campaign.transition',
					entity_id: mainId,
					old_value: { status: from },
					new_value: { status: toStatus },
					reason: toStatus === 'closing' ? 'Season over' : null
				});
			}

			const closed = await getCampaign(mainId);
			const renameId = rid('rename-closed');
			expect(
				await campaignAction(
					'update',
					users.admin,
					mainId,
					generalFields(closed, { name: campaignName('Renamed'), endsOn: '2028-01-31' }),
					renameId
				)
			).toMatchObject({ status: 409, data: { message: CAMPAIGN_MESSAGES.nameFrozen } });
			await expectNoAudit(renameId);

			const annulId = rid('annul-closed');
			expect(
				await campaignAction(
					'transition',
					users.admin,
					mainId,
					{ toStatus: 'annulled', reason: 'too late' },
					annulId
				)
			).toMatchObject({ status: 409 });
			await expectNoAudit(annulId);

			expect((await loadCampaign(users.admin, mainId)).can).toMatchObject({
				editName: false,
				editDates: false,
				editRules: false,
				transitions: []
			});
		});

		it('draft -> annulled requires a reason and is terminal', async () => {
			annulId = await adminCreatesCampaign('Draft to annul');

			const noReasonId = rid('annul-no-reason');
			expect(
				await campaignAction(
					'transition',
					users.admin,
					annulId,
					{ toStatus: 'annulled', reason: '   ' },
					noReasonId
				)
			).toMatchObject({ status: 400, data: { errors: { reason: [expect.any(String)] } } });
			await expectNoAudit(noReasonId);

			const dbNoReasonId = rid('rpc-annul-no-reason');
			const { error } = await rpc(users.admin.client, 'campaign_transition', {
				p_id: annulId,
				p_to_status: 'annulled',
				p_reason: ' ',
				p_request_id: dbNoReasonId
			});
			expect(error).toMatchObject({
				code: '22023',
				message: 'a reason is required to annul a campaign'
			});
			await expectNoAudit(dbNoReasonId);

			const requestId = rid('annul-draft');
			expect(
				await campaignAction(
					'transition',
					users.admin,
					annulId,
					{ toStatus: 'annulled', reason: 'Created by mistake' },
					requestId
				)
			).toMatchObject({ success: true, message: 'Campaña anulada.' });
			await expectOneAudit(requestId, {
				action: 'campaign.transition',
				entity_id: annulId,
				old_value: { status: 'draft' },
				new_value: { status: 'annulled' },
				reason: 'Created by mistake'
			});

			// Terminal: no transition, no rule, date or name change.
			const annulled = await getCampaign(annulId);
			const attempts: [CampaignActionName, Fields][] = [
				['transition', { toStatus: 'active', reason: '' }],
				['transition', { toStatus: 'annulled', reason: 'again' }],
				['rules', rulesFields(annulled, { installmentCount: '12' })],
				[
					'update',
					generalFields(annulled, {
						name: campaignName('Renamed annulled'),
						startsOn: '',
						endsOn: ''
					})
				]
			];
			for (const [name, fields] of attempts) {
				const attemptId = rid(`annulled-${name}`);
				expect(
					await campaignAction(name, users.admin, annulId, fields, attemptId),
					`${name} ${JSON.stringify(fields)}`
				).toMatchObject({ status: 409 });
				await expectNoAudit(attemptId);
			}
			expect(await getCampaign(annulId)).toEqual(annulled);
			expect((await loadCampaign(users.admin, annulId)).can.transitions).toEqual([]);
		});

		it('an annulled campaign rejects commission rule changes (409)', async () => {
			const requestId = rid('rule-on-annulled');
			expect(
				await commissionAction(
					'create',
					users.admin,
					annulId,
					ruleFields({ percentage: '10' }),
					requestId
				)
			).toMatchObject({
				status: 409,
				data: { message: COMMISSION_RULE_MESSAGES.campaignLocked }
			});
			await expectNoAudit(requestId);
		});
	});

	describe('4. Permissions (docs/permissions.md matrix)', () => {
		let targetId: string;
		let target: Campaign;

		beforeAll(async () => {
			// A draft with dates: every denied call below would otherwise succeed for an admin.
			targetId = await adminCreatesCampaign('Permission target', {
				startsOn: CAMPAIGN_STARTS_ON,
				endsOn: CAMPAIGN_ENDS_ON
			});
			target = await getCampaign(targetId);
		});

		it('seeded grants: campaign.view for operator/treasurer/read-only, nothing for collector; rule management admin-only', async () => {
			const campaignAndCommission = (u: SignedInUser) =>
				u.permissions
					.filter((p) => p.startsWith('campaign.') || p.startsWith('commission.'))
					.sort();

			expect(campaignAndCommission(users.admin)).toEqual([
				'campaign.close',
				'campaign.create',
				'campaign.update',
				'campaign.update_rules',
				'campaign.view',
				'commission.adjust',
				'commission.rule_manage',
				'commission.settle',
				'commission.view'
			]);
			expect(campaignAndCommission(users.operator)).toEqual(['campaign.view']);
			// SAN-93 decision: read-only may view commission rules.
			expect(campaignAndCommission(users['read-only'])).toEqual([
				'campaign.view',
				'commission.view'
			]);
			// The treasurer may adjust commissions (later phase) and, since SAN-93, view the rules
			// (commission.adjust implies commission.view), but not manage them.
			expect(campaignAndCommission(users.treasurer)).toEqual([
				'campaign.view',
				'commission.adjust',
				'commission.view'
			]);
			expect(campaignAndCommission(users.collector)).toEqual(['campaign.view']);
		});

		describe.each(['operator', 'treasurer', 'read-only'] as const)('%s', (role) => {
			it('can list and view campaigns (read-only UI hints)', async () => {
				const caller = users[role];
				const list = (await listLoad(
					event(caller, { path: '/campaigns', requestId: rid(`${role}-list`) })
				)) as unknown as { campaigns: Campaign[]; canCreate: boolean };
				expect(list.canCreate).toBe(false);
				expect(list.campaigns.map((c) => c.id)).toContain(targetId);

				const { campaign, can } = await loadCampaign(caller, targetId);
				expect(campaign).toEqual(target);
				expect(can).toEqual({
					editName: false,
					editDates: false,
					editRules: false,
					transitions: [],
					// SAN-93: treasurer (commission.adjust) and read-only (decision) hold commission.view.
					viewCommissions: role !== 'operator',
					viewAudit: role === 'treasurer',
					// SAN-26: every one of these roles has bond.view (bonds list link).
					viewBonds: true,
					// SAN-24: operators load bonds (bond.create) while the campaign is draft or active.
					loadBonds: role === 'operator' && canLoadBonds(target.status),
					// SAN-52 / SAN-93: the operator holds collector.view and reads buyers through
					// buyer.manage; treasurer and read-only see neither.
					viewCollectors: role === 'operator',
					viewBuyers: role === 'operator',
					// SAN-55: every one of these roles has bond.view.
					viewDeliveries: true,
					viewSales: true,
					// SAN-64: settlement action/view permissions expose the workspace link.
					viewSettlements: role !== 'read-only',
					// SAN-78: operator and treasurer hold draw.* permissions; read-only does not.
					viewDraws: role !== 'read-only',
					// SAN-90: only the administrator holds report.export.
					exportBackups: false,
					// SAN-86: operator, treasurer and read-only hold report.view_operational.
					viewReports: true
				});

				await expect(
					newCampaignLoad(event(caller, { path: '/campaigns/new', requestId: rid('new') }))
				).rejects.toMatchObject({ status: 403 });
			});

			it('is denied create/update/rules/transition by the route (403) and the database (42501)', async () => {
				const caller = users[role];
				const requestIds: string[] = [];
				const next = (label: string) => {
					const id = rid(`${role}-${label}`);
					requestIds.push(id);
					return id;
				};

				const created = await createCampaignViaAction(
					caller,
					createFields(`Denied ${role}`),
					next('create')
				);
				expect(created.failure).toMatchObject({
					status: 403,
					data: { message: CAMPAIGN_MESSAGES.permission }
				});
				const routeAttempts: [CampaignActionName, Fields][] = [
					['update', generalFields(target, { name: campaignName(`Renamed by ${role}`) })],
					['rules', rulesFields(target, { installmentCount: '12' })],
					['transition', { toStatus: 'active', reason: '' }],
					['transition', { toStatus: 'annulled', reason: 'no' }]
				];
				for (const [name, fields] of routeAttempts) {
					expect(
						await campaignAction(name, caller, targetId, fields, next(name)),
						`${role} ${name}`
					).toMatchObject({ status: 403, data: { message: CAMPAIGN_MESSAGES.permission } });
				}

				const rpcAttempts: [string, Record<string, unknown>][] = [
					[
						'campaign_create',
						rpcCreateArgs(campaignName(`Denied ${role} (rpc)`), next('rpc-create'))
					],
					[
						'campaign_update',
						{
							p_id: targetId,
							p_name: campaignName(`Renamed by ${role}`),
							p_starts_at: target.startsAt,
							p_ends_at: target.endsAt,
							p_expected_updated_at: target.updatedAt,
							p_request_id: next('rpc-update')
						}
					],
					[
						'campaign_update_rules',
						rpcRulesArgs(target, next('rpc-rules'), { p_installment_count: 12 })
					],
					...(['active', 'closing', 'annulled'] as const).map(
						(toStatus): [string, Record<string, unknown>] => [
							'campaign_transition',
							{
								p_id: targetId,
								p_to_status: toStatus,
								p_reason: 'denied',
								p_request_id: next(`rpc-${toStatus}`)
							}
						]
					)
				];
				for (const [fn, args] of rpcAttempts) {
					const { data, error } = await rpc(caller.client, fn, args);
					expect(data, fn).toBeNull();
					expect(error?.code, `${role} ${fn}`).toBe('42501');
					expect(error?.message).toMatch(/^permission denied: campaign\.\w+ is required$/);
				}

				for (const id of requestIds) await expectNoAudit(id);
				expect(await getCampaign(targetId)).toEqual(target);
				const { data: leaked } = await serviceClient
					.from('campaigns')
					.select('id')
					.like('name', `${NAME_PREFIX} Denied ${role}%`);
				expect(leaked).toEqual([]);
			});

			it('cannot manage commission rules; only the treasurer and read-only can see them (SAN-93)', async () => {
				const caller = users[role];
				const canView = role !== 'operator';
				if (canView) {
					await expect(loadCommissions(caller, targetId)).resolves.toBeDefined();
				} else {
					await expect(loadCommissions(caller, targetId)).rejects.toMatchObject({ status: 403 });
				}

				const createId = rid(`${role}-rule-create`);
				expect(
					await commissionAction(
						'create',
						caller,
						targetId,
						ruleFields({ percentage: '10' }),
						createId
					)
				).toMatchObject({
					status: 403,
					data: { message: COMMISSION_RULE_MESSAGES.permission }
				});

				const rpcId = rid(`${role}-rpc-rule-create`);
				const { error } = await rpc(
					caller.client,
					'commission_rule_create',
					rpcRuleArgs(targetId, rpcId, {})
				);
				expect(error).toMatchObject({
					code: '42501',
					message: 'permission denied: commission.rule_manage is required'
				});

				// RLS shows the rules only with commission.view, and never errors.
				const { data: visible, error: selectError } = await caller.client
					.from('commission_rules')
					.select('id')
					.order('id');
				expect(selectError).toBeNull();
				if (canView) {
					const { data: all, error: allError } = await serviceClient
						.from('commission_rules')
						.select('id')
						.order('id');
					expect(allError).toBeNull();
					expect(visible).toEqual(all);
				} else {
					expect(visible).toEqual([]);
				}

				await expectNoAudit(createId);
				await expectNoAudit(rpcId);
			});
		});

		it('the database denies even when the route gate is bypassed (forged locals.permissions)', async () => {
			// The operator's request carries the admin's permission list: the route lets it through,
			// the SQL function checks the real caller and refuses (42501 -> 403).
			const forged = users.admin.permissions;
			const createId = rid('forged-create');
			const created = await createCampaignViaAction(
				users.operator,
				createFields('Forged create'),
				createId,
				forged
			);
			expect(created.failure).toMatchObject({
				status: 403,
				data: { message: CAMPAIGN_MESSAGES.permission }
			});

			const transitionId = rid('forged-activate');
			expect(
				await campaignAction(
					'transition',
					users.operator,
					targetId,
					{ toStatus: 'active', reason: '' },
					transitionId,
					forged
				)
			).toMatchObject({ status: 403, data: { message: CAMPAIGN_MESSAGES.permission } });

			const rulesId = rid('forged-rules');
			expect(
				await campaignAction(
					'rules',
					users.operator,
					targetId,
					rulesFields(target, { installmentCount: '12' }),
					rulesId,
					forged
				)
			).toMatchObject({ status: 403 });

			// The operator can see the campaign (campaign.view), so the action reaches
			// commission_rule_create, which refuses (42501 -> 403).
			const ruleId = rid('forged-rule-create');
			expect(
				await commissionAction(
					'create',
					users.operator,
					targetId,
					ruleFields({ percentage: '10' }),
					ruleId,
					forged
				)
			).toMatchObject({ status: 403, data: { message: COMMISSION_RULE_MESSAGES.permission } });

			for (const id of [createId, transitionId, rulesId, ruleId]) await expectNoAudit(id);
			expect(await getCampaign(targetId)).toEqual(target);
		});

		it('collector can view campaigns (campaign.view, SAN-93) but not manage them (403 in the route, 42501 on writes)', async () => {
			const collector = users.collector;
			const list = (await listLoad(
				event(collector, { path: '/campaigns', requestId: rid('collector-list') })
			)) as unknown as { campaigns: Campaign[]; canCreate: boolean };
			expect(list.canCreate).toBe(false);
			expect(list.campaigns.map((c) => c.id)).toContain(targetId);
			await expect(
				newCampaignLoad(
					event(collector, { path: '/campaigns/new', requestId: rid('collector-new') })
				)
			).rejects.toMatchObject({ status: 403 });
			await expect(loadCommissions(collector, targetId)).rejects.toMatchObject({ status: 403 });

			const { data, error } = await collector.client.from('campaigns').select('id').limit(1);
			expect(error).toBeNull();
			expect(data).toHaveLength(1);

			const requestId = rid('collector-rpc-create');
			const { error: rpcError } = await rpc(
				collector.client,
				'campaign_create',
				rpcCreateArgs(campaignName('Collector'), requestId)
			);
			expect(rpcError?.code).toBe('42501');
			await expectNoAudit(requestId);
		});
	});

	describe('5. Commission rules (/campaigns/[id]/commissions -> commission_rule_*)', () => {
		let campaignId: string;
		const ruleIds: Partial<Record<string, string>> = {};

		async function createRule(label: string, fields: Fields): Promise<string> {
			const requestId = rid(`rule-${label}`);
			const result = (await commissionAction(
				'create',
				users.admin,
				campaignId,
				ruleFields(fields),
				requestId
			)) as { success: boolean; message: string; ruleId: string };
			expect(result, label).toMatchObject({
				form: 'create',
				success: true,
				message: 'Regla agregada.'
			});
			const audit = await expectOneAudit(requestId, {
				action: 'commission_rule.create',
				entity_type: 'commission_rule',
				entity_id: result.ruleId,
				old_value: null
			});
			expect(audit.new_value).toMatchObject({
				id: result.ruleId,
				campaign_id: campaignId,
				rule_type: fields.ruleType,
				status: 'active',
				applies_to_collector_id: null,
				created_by: users.admin.profile.id
			});
			return result.ruleId;
		}

		beforeAll(async () => {
			campaignId = await adminCreatesCampaign('Commissions', {
				startsOn: CAMPAIGN_STARTS_ON,
				endsOn: CAMPAIGN_ENDS_ON
			});
		});

		it('admin sees the empty rules page with management enabled (draft)', async () => {
			const data = await loadCommissions(users.admin, campaignId);
			expect(data.campaign.id).toBe(campaignId);
			expect(data.rules).toEqual([]);
			expect(data.can.manage).toBe(true);
		});

		it('creates rules of all 5 types (percentage and es-AR fixed amounts), displayed in es-AR', async () => {
			ruleIds.cash = await createRule('cash', {
				ruleType: 'cash_full_payment',
				valueKind: 'percentage',
				percentage: '25',
				validFrom: '2027-01-01',
				validTo: '2027-06-30'
			});
			ruleIds.first = await createRule('first', {
				ruleType: 'installment_first',
				valueKind: 'fixed_amount',
				fixedAmount: '1.500,00'
			});
			ruleIds.middle = await createRule('middle', {
				ruleType: 'installment_middle',
				valueKind: 'percentage',
				percentage: '12,5'
			});
			ruleIds.last = await createRule('last', {
				ruleType: 'installment_last',
				valueKind: 'fixed_amount',
				fixedAmount: '2.000,50'
			});
			ruleIds.custom10 = await createRule('custom-10', {
				ruleType: 'custom',
				installmentNumber: '10',
				valueKind: 'percentage',
				percentage: '5'
			});

			const { rules } = await loadCommissions(users.admin, campaignId);
			const byId = new Map(rules.map((r) => [r.id, r]));
			const shown = (key: string) => {
				const rule = byId.get(ruleIds[key]!)!;
				return { type: formatCommissionRuleType(rule), value: formatCommissionValue(rule), rule };
			};
			expect(shown('cash')).toMatchObject({
				value: `25${NBSP}%`,
				rule: {
					percentage: '25.00',
					fixedAmount: null,
					validFrom: '2027-01-01',
					validTo: '2027-06-30'
				}
			});
			expect(shown('first')).toMatchObject({
				value: `$${NBSP}1.500,00`,
				rule: { percentage: null, fixedAmount: '1500.00', validTo: null }
			});
			expect(shown('middle').value).toBe(`12,5${NBSP}%`);
			expect(shown('last').value).toBe(`$${NBSP}2.000,50`);
			expect(shown('custom10')).toMatchObject({
				type: 'Specific installment: #10',
				value: `5${NBSP}%`,
				rule: { installmentNumber: 10 }
			});
			expect(rules.every((r) => r.status === 'active' && r.appliesToCollectorId === null)).toBe(
				true
			);
		});

		it('rejects a custom installment above the campaign installment count (form 400, database 22023)', async () => {
			const requestId = rid('rule-custom-11');
			expect(
				await commissionAction(
					'create',
					users.admin,
					campaignId,
					ruleFields({ ruleType: 'custom', installmentNumber: '11', percentage: '5' }),
					requestId
				)
			).toMatchObject({
				status: 400,
				data: { errors: { installmentNumber: ['El número de cuota debe estar entre 1 y 10'] } }
			});
			await expectNoAudit(requestId);

			const dbRequestId = rid('rpc-rule-custom-11');
			const { error } = await rpc(
				users.admin.client,
				'commission_rule_create',
				rpcRuleArgs(campaignId, dbRequestId, { p_rule_type: 'custom', p_installment_number: 11 })
			);
			expect(error).toMatchObject({
				code: '22023',
				message: 'installment number must be between 1 and 10'
			});
			await expectNoAudit(dbRequestId);
		});

		it('rejects overlapping validity of the same type (23P01 -> friendly 409); adjacent range is fine', async () => {
			const overlapId = rid('rule-overlap');
			expect(
				await commissionAction(
					'create',
					users.admin,
					campaignId,
					ruleFields({ percentage: '20', validFrom: '2027-06-30' }),
					overlapId
				)
			).toMatchObject({ status: 409, data: { message: COMMISSION_RULE_MESSAGES.overlap } });
			await expectNoAudit(overlapId);

			const dbOverlapId = rid('rpc-rule-overlap');
			const { error } = await rpc(
				users.admin.client,
				'commission_rule_create',
				rpcRuleArgs(campaignId, dbOverlapId, {
					p_valid_from: '2027-03-01',
					p_valid_to: '2027-03-31'
				})
			);
			expect(error?.code).toBe('23P01');
			expect(error?.message).toContain('commission_rules_no_overlap');
			await expectNoAudit(dbOverlapId);

			// Starts the day after the first cash rule ends.
			ruleIds.cashLater = await createRule('cash-adjacent', {
				ruleType: 'cash_full_payment',
				percentage: '20',
				validFrom: '2027-07-01'
			});
			// Another custom installment with the same validity is a different rule key.
			ruleIds.custom9 = await createRule('custom-9', {
				ruleType: 'custom',
				installmentNumber: '9',
				percentage: '4'
			});
		});

		it('edits a rule (one commission_rule.update row with the changed keys and reason); no-op writes nothing', async () => {
			const requestId = rid('rule-edit');
			expect(
				await commissionAction(
					'update',
					users.admin,
					campaignId,
					await ruleEditFields(campaignId, ruleIds.cash!, {
						percentage: '30',
						validTo: '2027-06-30',
						reason: 'Raised by the board'
					}),
					requestId
				)
			).toMatchObject({
				form: 'update',
				success: true,
				message: 'Regla guardada.',
				ruleId: ruleIds.cash
			});
			await expectOneAudit(requestId, {
				action: 'commission_rule.update',
				entity_type: 'commission_rule',
				entity_id: ruleIds.cash,
				old_value: { campaign_id: campaignId, percentage: 25 },
				new_value: { campaign_id: campaignId, percentage: 30 },
				reason: 'Raised by the board'
			});

			const noopId = rid('rule-edit-noop');
			expect(
				await commissionAction(
					'update',
					users.admin,
					campaignId,
					await ruleEditFields(campaignId, ruleIds.cash!, {
						percentage: '30,00',
						validTo: '2027-06-30'
					}),
					noopId
				)
			).toMatchObject({ success: true, message: 'No hay cambios para guardar.' });
			await expectNoAudit(noopId);
		});

		it('annuls a rule (reason required); an annulled rule cannot change; the slot can be re-used', async () => {
			const noReasonId = rid('rule-annul-no-reason');
			expect(
				await commissionAction(
					'annul',
					users.admin,
					campaignId,
					{ ruleId: ruleIds.cash!, reason: '  ' },
					noReasonId
				)
			).toMatchObject({ status: 400, data: { errors: { reason: [expect.any(String)] } } });
			await expectNoAudit(noReasonId);

			const dbNoReasonId = rid('rpc-rule-annul-no-reason');
			const { error } = await rpc(users.admin.client, 'commission_rule_annul', {
				p_id: ruleIds.cash,
				p_reason: '',
				p_request_id: dbNoReasonId
			});
			expect(error).toMatchObject({
				code: '22023',
				message: 'a reason is required to annul a commission rule'
			});
			await expectNoAudit(dbNoReasonId);

			const annulId = rid('rule-annul');
			expect(
				await commissionAction(
					'annul',
					users.admin,
					campaignId,
					{ ruleId: ruleIds.cash!, reason: 'Wrong percentage' },
					annulId
				)
			).toMatchObject({ form: 'annul', success: true, message: 'Regla anulada.' });
			await expectOneAudit(annulId, {
				action: 'commission_rule.annul',
				entity_type: 'commission_rule',
				entity_id: ruleIds.cash,
				old_value: { campaign_id: campaignId, status: 'active' },
				new_value: {
					campaign_id: campaignId,
					status: 'annulled',
					annulled_by: users.admin.profile.id
				},
				reason: 'Wrong percentage'
			});
			const annulled = (await loadCommissions(users.admin, campaignId)).rules.find(
				(r) => r.id === ruleIds.cash
			);
			expect(annulled).toMatchObject({
				status: 'annulled',
				annulReason: 'Wrong percentage',
				annulledBy: users.admin.profile.id
			});

			const editAnnulledId = rid('rule-edit-annulled');
			expect(
				await commissionAction(
					'update',
					users.admin,
					campaignId,
					await ruleEditFields(campaignId, ruleIds.cash!, {
						percentage: '35',
						validTo: '2027-06-30'
					}),
					editAnnulledId
				)
			).toMatchObject({ status: 409, data: { message: COMMISSION_RULE_MESSAGES.annulled } });
			const annulAgainId = rid('rule-annul-again');
			expect(
				await commissionAction(
					'annul',
					users.admin,
					campaignId,
					{ ruleId: ruleIds.cash!, reason: 'again' },
					annulAgainId
				)
			).toMatchObject({
				status: 409,
				data: { message: COMMISSION_RULE_MESSAGES.alreadyAnnulled }
			});
			await expectNoAudit(editAnnulledId);
			await expectNoAudit(annulAgainId);

			// Annulled rules never block: the same type and validity can be created again.
			ruleIds.cashAgain = await createRule('cash-recreate', {
				ruleType: 'cash_full_payment',
				percentage: '25',
				validFrom: '2027-01-01',
				validTo: '2027-06-30'
			});
		});

		it('an annulment always records who annulled (direct write without annulled_by -> 23514)', async () => {
			const before = await getRule(campaignId, ruleIds.cashAgain!);
			const { error } = await serviceClient
				.from('commission_rules')
				.update({
					status: 'annulled',
					annulled_at: new Date().toISOString(),
					annul_reason: 'Direct write'
				})
				.eq('id', ruleIds.cashAgain!);
			expect(error?.code).toBe('23514');
			expect(error?.message).toContain('commission_rules_annulment_consistent');
			expect(await getRule(campaignId, ruleIds.cashAgain!)).toEqual(before);
		});

		it('a draft cannot lower installment_count below an active custom rule (form 400, database 55000)', async () => {
			const before = await getCampaign(campaignId);
			const requestId = rid('rules-below-custom');
			expect(
				await campaignAction(
					'rules',
					users.admin,
					campaignId,
					rulesFields(before, { installmentCount: '5' }),
					requestId
				)
			).toMatchObject({
				status: 400,
				data: { errors: { installmentCount: [expect.stringContaining('cuota 10')] } }
			});
			await expectNoAudit(requestId);

			const dbRequestId = rid('rpc-rules-below-custom');
			const { error } = await rpc(
				users.admin.client,
				'campaign_update_rules',
				rpcRulesArgs(before, dbRequestId, { p_installment_count: 5 })
			);
			expect(error?.code).toBe('55000');
			expect(error?.message).toContain('installment count cannot be lowered below 10');
			await expectNoAudit(dbRequestId);
			expect(await getCampaign(campaignId)).toEqual(before);
		});

		it('rules stay manageable once the campaign is active', async () => {
			const activateId = rid('commissions-activate');
			expect(
				await campaignAction(
					'transition',
					users.admin,
					campaignId,
					{ toStatus: 'active', reason: '' },
					activateId
				)
			).toMatchObject({ success: true });
			await expectOneAudit(activateId, { action: 'campaign.transition', entity_id: campaignId });

			expect((await loadCommissions(users.admin, campaignId)).can.manage).toBe(true);
			ruleIds.custom8 = await createRule('custom-8-active', {
				ruleType: 'custom',
				installmentNumber: '8',
				valueKind: 'fixed_amount',
				fixedAmount: '300'
			});
			const editId = rid('rule-edit-active');
			expect(
				await commissionAction(
					'update',
					users.admin,
					campaignId,
					await ruleEditFields(campaignId, ruleIds.custom8!, {
						ruleType: 'custom',
						installmentNumber: '8',
						valueKind: 'fixed_amount',
						fixedAmount: '350,00'
					}),
					editId
				)
			).toMatchObject({ success: true, message: 'Regla guardada.' });
			await expectOneAudit(editId, {
				action: 'commission_rule.update',
				entity_id: ruleIds.custom8,
				old_value: { campaign_id: campaignId, fixed_amount: 300 },
				new_value: { campaign_id: campaignId, fixed_amount: 350 }
			});
		});

		it('rules are read-only once the campaign is closing (409 in the route, 55000 in the database)', async () => {
			const closingId = rid('commissions-closing');
			expect(
				await campaignAction(
					'transition',
					users.admin,
					campaignId,
					{ toStatus: 'closing', reason: '' },
					closingId
				)
			).toMatchObject({ success: true });
			await expectOneAudit(closingId, { action: 'campaign.transition', entity_id: campaignId });

			expect((await loadCommissions(users.admin, campaignId)).can.manage).toBe(false);

			const attempts: [CommissionActionName, Fields][] = [
				['create', ruleFields({ ruleType: 'custom', installmentNumber: '7', percentage: '3' })],
				[
					'update',
					await ruleEditFields(campaignId, ruleIds.first!, {
						ruleType: 'installment_first',
						valueKind: 'fixed_amount',
						fixedAmount: '1.600,00'
					})
				],
				['annul', { ruleId: ruleIds.middle!, reason: 'closing' }]
			];
			for (const [name, fields] of attempts) {
				const requestId = rid(`closing-rule-${name}`);
				expect(
					await commissionAction(name, users.admin, campaignId, fields, requestId),
					name
				).toMatchObject({
					status: 409,
					data: { message: COMMISSION_RULE_MESSAGES.campaignLocked }
				});
				await expectNoAudit(requestId);
			}

			const dbRequestId = rid('rpc-closing-rule-annul');
			const { error } = await rpc(users.admin.client, 'commission_rule_annul', {
				p_id: ruleIds.middle,
				p_reason: 'closing',
				p_request_id: dbRequestId
			});
			expect(error?.code).toBe('55000');
			await expectNoAudit(dbRequestId);
		});
	});

	describe('6. Concurrent edits (optimistic concurrency) and non-finite numbers', () => {
		// Two admins editing at once is simulated with one admin session: "B" saves first with the
		// version both loaded, then "A" submits the form it loaded before B's save.
		let campaignId: string;

		beforeAll(async () => {
			campaignId = await adminCreatesCampaign('Concurrency', {
				startsOn: CAMPAIGN_STARTS_ON,
				endsOn: CAMPAIGN_ENDS_ON
			});
		});

		it('the version is the exact PostgREST string (microseconds); a JS Date round-trip is stale', async (ctx) => {
			const campaign = await getCampaign(campaignId);
			expect(campaign.updatedAt).toMatch(
				/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00:00$/
			);
			const micros = (/\.(\d{1,6})/.exec(campaign.updatedAt)?.[1] ?? '').padEnd(6, '0');
			// A Date keeps milliseconds only; if the sub-millisecond part is 0 the two are equal.
			if (micros.endsWith('000')) ctx.skip();

			const requestId = rid('rpc-version-as-date');
			const { error } = await rpc(users.admin.client, 'campaign_update', {
				p_id: campaignId,
				p_name: campaignName('Concurrency (via Date)'),
				p_starts_at: campaign.startsAt,
				p_ends_at: campaign.endsAt,
				p_expected_updated_at: new Date(campaign.updatedAt).toISOString(),
				p_request_id: requestId
			});
			expect(error).toMatchObject({
				code: 'PT409',
				message: 'campaign was modified by someone else'
			});
			await expectNoAudit(requestId);
			expect(await getCampaign(campaignId)).toEqual(campaign);
		});

		it('campaign_update: a stale form is a 409 asking to reload; nothing is written', async () => {
			const loaded = await getCampaign(campaignId);

			const otherId = rid('concurrent-rename');
			expect(
				await campaignAction(
					'update',
					users.admin,
					campaignId,
					generalFields(loaded, { name: campaignName('Concurrency (renamed by B)') }),
					otherId
				)
			).toMatchObject({ success: true, message: 'Cambios guardados.' });
			await expectOneAudit(otherId, { action: 'campaign.update', entity_id: campaignId });
			const afterB = await getCampaign(campaignId);
			expect(afterB.updatedAt).not.toBe(loaded.updatedAt);

			const staleId = rid('stale-update');
			const staleFields = generalFields(loaded, { endsOn: '2028-01-31' });
			expect(
				await campaignAction('update', users.admin, campaignId, staleFields, staleId)
			).toMatchObject({
				status: 409,
				data: {
					form: 'general',
					message: CAMPAIGN_MESSAGES.staleVersion,
					values: { expectedUpdatedAt: loaded.updatedAt }
				}
			});
			await expectNoAudit(staleId);

			const dbStaleId = rid('rpc-stale-update');
			const { error } = await rpc(users.admin.client, 'campaign_update', {
				p_id: campaignId,
				p_name: loaded.name,
				p_starts_at: loaded.startsAt,
				p_ends_at: loaded.endsAt,
				p_expected_updated_at: loaded.updatedAt,
				p_request_id: dbStaleId
			});
			expect(error).toMatchObject({
				code: 'PT409',
				message: 'campaign was modified by someone else'
			});
			await expectNoAudit(dbStaleId);
			expect(await getCampaign(campaignId)).toEqual(afterB);

			// After reloading, the same edit goes through.
			const retryId = rid('update-after-reload');
			expect(
				await campaignAction(
					'update',
					users.admin,
					campaignId,
					generalFields(afterB, { endsOn: '2028-01-31' }),
					retryId
				)
			).toMatchObject({ success: true, message: 'Cambios guardados.' });
			await expectOneAudit(retryId, { action: 'campaign.update', entity_id: campaignId });
		});

		it('campaign_update_rules: a stale rules form is a 409; any campaign save makes it stale', async () => {
			const loaded = await getCampaign(campaignId);

			// B saves the general data: both forms share the campaign version.
			const otherId = rid('concurrent-dates');
			expect(
				await campaignAction(
					'update',
					users.admin,
					campaignId,
					generalFields(loaded, { endsOn: '2028-02-29' }),
					otherId
				)
			).toMatchObject({ success: true });
			await expectOneAudit(otherId, { action: 'campaign.update', entity_id: campaignId });
			const afterB = await getCampaign(campaignId);

			const staleId = rid('stale-rules');
			expect(
				await campaignAction(
					'rules',
					users.admin,
					campaignId,
					rulesFields(loaded, { installmentCount: '12', changeReason: 'Stale' }),
					staleId
				)
			).toMatchObject({
				status: 409,
				data: { form: 'rules', message: CAMPAIGN_MESSAGES.staleVersion }
			});
			await expectNoAudit(staleId);

			const dbStaleId = rid('rpc-stale-rules');
			const { error } = await rpc(
				users.admin.client,
				'campaign_update_rules',
				rpcRulesArgs(loaded, dbStaleId, { p_installment_count: 12 })
			);
			expect(error).toMatchObject({
				code: 'PT409',
				message: 'campaign was modified by someone else'
			});
			await expectNoAudit(dbStaleId);
			expect(await getCampaign(campaignId)).toEqual(afterB);

			const retryId = rid('rules-after-reload');
			expect(
				await campaignAction(
					'rules',
					users.admin,
					campaignId,
					rulesFields(afterB, { installmentCount: '12' }),
					retryId
				)
			).toMatchObject({ success: true, message: 'Reglas guardadas.' });
			await expectOneAudit(retryId, { action: 'campaign.update_rules', entity_id: campaignId });
		});

		it('commission_rule_update: a stale edit form is a 409 asking to reload; nothing is written', async () => {
			const createId = rid('concurrency-rule-create');
			const created = (await commissionAction(
				'create',
				users.admin,
				campaignId,
				ruleFields({ percentage: '10' }),
				createId
			)) as { success: boolean; ruleId: string };
			expect(created).toMatchObject({ success: true });
			await expectOneAudit(createId, {
				action: 'commission_rule.create',
				entity_id: created.ruleId
			});
			const ruleId = created.ruleId;
			const loaded = await getRule(campaignId, ruleId);

			const otherId = rid('concurrent-rule-edit');
			expect(
				await commissionAction(
					'update',
					users.admin,
					campaignId,
					{ ruleId, expectedUpdatedAt: loaded.updatedAt, ...ruleFields({ percentage: '11' }) },
					otherId
				)
			).toMatchObject({ success: true, message: 'Regla guardada.' });
			await expectOneAudit(otherId, { action: 'commission_rule.update', entity_id: ruleId });

			const staleId = rid('stale-rule-edit');
			expect(
				await commissionAction(
					'update',
					users.admin,
					campaignId,
					{ ruleId, expectedUpdatedAt: loaded.updatedAt, ...ruleFields({ percentage: '12' }) },
					staleId
				)
			).toMatchObject({
				status: 409,
				data: { form: 'update', ruleId, message: COMMISSION_RULE_MESSAGES.staleVersion }
			});
			await expectNoAudit(staleId);

			const dbStaleId = rid('rpc-stale-rule-edit');
			const { error } = await rpc(users.admin.client, 'commission_rule_update', {
				p_id: ruleId,
				p_rule_type: 'cash_full_payment',
				p_installment_number: null,
				p_percentage: '12.00',
				p_fixed_amount: null,
				p_valid_from: '2027-01-01',
				p_valid_to: null,
				p_expected_updated_at: loaded.updatedAt,
				p_request_id: dbStaleId
			});
			expect(error).toMatchObject({
				code: 'PT409',
				message: 'commission rule was modified by someone else'
			});
			await expectNoAudit(dbStaleId);
			expect(await getRule(campaignId, ruleId)).toMatchObject({ percentage: '11.00' });
		});

		it('NaN and Infinity are rejected by the SQL functions; nothing is written', async () => {
			const campaign = await getCampaign(campaignId);
			const rule = (await loadCommissions(users.admin, campaignId)).rules.find(
				(r) => r.status === 'active'
			)!;
			const cases: [string, Record<string, unknown>, string, string][] = [
				[
					'commission_rule_create',
					rpcRuleArgs(campaignId, rid('rpc-nan-fixed'), {
						p_percentage: null,
						p_fixed_amount: 'NaN',
						p_valid_from: '2030-01-01'
					}),
					'22023',
					'fixed amount must be a finite number'
				],
				[
					'commission_rule_create',
					rpcRuleArgs(campaignId, rid('rpc-inf-fixed'), {
						p_percentage: null,
						p_fixed_amount: 'Infinity',
						p_valid_from: '2030-01-01'
					}),
					'22023',
					'fixed amount must be a finite number'
				],
				[
					'commission_rule_create',
					rpcRuleArgs(campaignId, rid('rpc-nan-percentage'), {
						p_percentage: 'NaN',
						p_valid_from: '2030-01-01'
					}),
					'22023',
					'percentage must be a finite number'
				],
				[
					'commission_rule_update',
					{
						p_id: rule.id,
						p_rule_type: rule.ruleType,
						p_installment_number: rule.installmentNumber,
						p_percentage: null,
						p_fixed_amount: 'NaN',
						p_valid_from: rule.validFrom,
						p_valid_to: rule.validTo,
						p_expected_updated_at: rule.updatedAt,
						p_request_id: rid('rpc-nan-rule-update')
					},
					'22023',
					'fixed amount must be a finite number'
				],
				// Campaign money: rejected by the table CHECKs (NaN would otherwise pass "> 0" and the
				// exact-installment check, since NaN = NaN in Postgres).
				[
					'campaign_create',
					rpcCreateArgs(campaignName('NaN value'), rid('rpc-nan-campaign'), {
						p_simple_bond_value: 'NaN'
					}),
					'23514',
					'campaigns_installment_value_positive'
				],
				[
					'campaign_update_rules',
					rpcRulesArgs(campaign, rid('rpc-nan-rules'), { p_simple_bond_value: 'NaN' }),
					'23514',
					'campaigns_installment_value_positive'
				]
			];
			for (const [fn, args, code, message] of cases) {
				const { data, error } = await rpc(users.admin.client, fn, args);
				expect(data, fn).toBeNull();
				expect(error?.code, `${fn} ${JSON.stringify(args)}`).toBe(code);
				expect(error?.message).toContain(message);
				await expectNoAudit(args.p_request_id as string);
			}
			expect(await getCampaign(campaignId)).toEqual(campaign);
			expect(await getRule(campaignId, rule.id)).toEqual(rule);
			const { data: leaked } = await serviceClient
				.from('campaigns')
				.select('id')
				.eq('name', campaignName('NaN value'));
			expect(leaked).toEqual([]);
		});
	});

	describe('7. Audit trail', () => {
		it('every successful mutation wrote exactly one row and rejected calls wrote none', async () => {
			expect(expectedAudit.size).toBeGreaterThan(0);
			for (const [entityId, expected] of expectedAudit) {
				const { count, error } = await serviceClient
					.from('audit_log')
					.select('id', { count: 'exact', head: true })
					.eq('entity_id', entityId)
					.like('request_id', `${REQUEST_PREFIX}%`);
				expect(error).toBeNull();
				expect(count, `audit rows for entity ${entityId}`).toBe(expected);
			}

			// Every row this run wrote carries one of its request ids, and nothing else did.
			const total = [...expectedAudit.values()].reduce((a, b) => a + b, 0);
			const { count, error } = await serviceClient
				.from('audit_log')
				.select('id', { count: 'exact', head: true })
				.like('request_id', `${REQUEST_PREFIX}%`);
			expect(error).toBeNull();
			expect(count).toBe(total);
			console.log(
				`[integration] Phase 2 audit: ${total} rows for ${expectedAudit.size} entities, ` +
					`${runCampaignIds.length} campaigns created`
			);
		});

		it('audit rows of this run cannot be updated or deleted through the API (sanity)', async () => {
			const { data: row } = await serviceClient
				.from('audit_log')
				.select('id, action')
				.like('request_id', `${REQUEST_PREFIX}%`)
				.limit(1)
				.single();
			expect(row).not.toBeNull();
			for (const client of [serviceClient, users.admin.client]) {
				const { error: updateError } = await client
					.from('audit_log')
					.update({ action: 'tampered' })
					.eq('id', row!.id);
				expect(updateError).toMatchObject({ code: '42501' });
				const { error: deleteError } = await client.from('audit_log').delete().eq('id', row!.id);
				expect(deleteError).toMatchObject({ code: '42501' });
			}
			const { data: after } = await serviceClient
				.from('audit_log')
				.select('id, action')
				.eq('id', row!.id)
				.single();
			expect(after).toEqual(row);
		});

		it('campaigns and commission rules cannot be deleted (so this suite leaves its data)', async () => {
			for (const client of [serviceClient, users.admin.client]) {
				const { error: campaignError } = await client
					.from('campaigns')
					.delete()
					.eq('id', runCampaignIds[0]);
				expect(campaignError).toMatchObject({
					code: '42501',
					message: 'permission denied for table campaigns'
				});
				const { error: ruleError } = await client
					.from('commission_rules')
					.delete()
					.in('campaign_id', runCampaignIds);
				expect(ruleError).toMatchObject({
					code: '42501',
					message: 'permission denied for table commission_rules'
				});
			}
			const { count } = await serviceClient
				.from('campaigns')
				.select('id', { count: 'exact', head: true })
				.like('name', `${NAME_PREFIX}%`);
			expect(count).toBe(runCampaignIds.length);
		});
	});
});
