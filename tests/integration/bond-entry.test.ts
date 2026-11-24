import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isRedirect } from '@sveltejs/kit';
import {
	actions as campaignActions,
	load as campaignLoad
} from '../../src/routes/campaigns/[id]/+page.server';
import {
	actions as bondEntryActions,
	load as bondEntryLoad
} from '../../src/routes/campaigns/[id]/bonds/new/+page.server';
import { loadPermissions } from './permissions';
import { getBondById } from '$lib/server/repositories/bonds';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import type { UserProfile } from '../../src/app';

/**
 * SAN-24: manual simple bond entry through the real route code (`/campaigns/[id]/bonds/new` load
 * and action, `/campaigns/[id]` load and rules action) against the local Supabase, with the seeded
 * admin, operator and read-only users and their real permission lists.
 *
 * Bonds and campaigns cannot be deleted: each run creates its own campaigns named
 * `[it-bond-entry <run id>] ...`, so numbers never collide with a previous run.
 */

const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seedConfig = resolveSeedConfig(seedEnv);
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
let seq = 0;
const rid = (label: string) => `it-bond-entry-${RUN_ID}-${String(++seq).padStart(3, '0')}-${label}`;

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

/** A RequestEvent for a load or form action of `/campaigns/<id><suffix>`. */
function event<E>(
	caller: Caller,
	id: string,
	suffix: string,
	options: { action?: string; fields?: Record<string, string> } = {}
): E {
	const search = options.fields ? `?/${options.action ?? 'default'}` : '';
	const url = new URL(`http://localhost/campaigns/${id}${suffix}${search}`);
	let request = new Request(url);
	if (options.fields) {
		const body = new FormData();
		for (const [key, value] of Object.entries(options.fields)) body.set(key, value);
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
		params: { id },
		url,
		request
	} as unknown as E;
}

type ActionResult = { status?: number; data?: Record<string, unknown> } & Record<string, unknown>;

/** POST /campaigns/<id>/bonds/new. A 303 (Save) is returned as `{ redirect }`. */
async function enter(
	caller: Caller,
	campaignId: string,
	baseNumber: string,
	intent: 'save' | 'another' = 'another',
	codes: { internalCode?: string; barcode?: string } = {}
): Promise<ActionResult & { redirect?: string }> {
	try {
		return (await bondEntryActions.default(
			event(caller, campaignId, '/bonds/new', {
				fields: {
					baseNumber,
					internalCode: codes.internalCode ?? '',
					barcode: codes.barcode ?? '',
					intent
				}
			})
		)) as ActionResult;
	} catch (err) {
		if (!isRedirect(err)) throw err;
		return { redirect: err.location };
	}
}

async function createCampaign(label: string, digits: 4 | 5): Promise<string> {
	const { data, error } = await admin.client.rpc('campaign_create', {
		p_name: `[it-bond-entry ${RUN_ID}] ${label}`,
		p_simple_bond_value: '60000.00',
		p_installment_count: 10,
		p_number_digits: digits,
		p_max_number: digits === 4 ? 9999 : 99999,
		p_associated_number_offset: digits === 4 ? 4871 : 48710,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_request_id: rid(`campaign-${label}`)
	});
	if (error) throw new Error(`campaign_create failed: ${error.message}`);
	return data as string;
}

let admin: Caller;
let operator: Caller;
let readOnly: Caller;
let campaignId: string;
let firstBondId: string;

beforeAll(async () => {
	serviceClient = createClient(supabaseUrl, serviceRoleKey, clientOptions);
	admin = await signIn(seedConfig.admin.email, seedConfig.admin.password);
	const op = fixture('operator');
	operator = await signIn(op.email, op.password);
	const ro = fixture('read-only');
	readOnly = await signIn(ro.email, ro.password);
	campaignId = await createCampaign('4 digits', 4);
});

describe('manual simple bond entry (local Supabase)', () => {
	it('a draft without bonds: rules editable, bond loading offered to admin and operator', async () => {
		const page = (await campaignLoad(event(admin, campaignId, ''))) as unknown as {
			hasBonds: boolean;
			can: { editRules: boolean; loadBonds: boolean };
		};
		expect(page.hasBonds).toBe(false);
		expect(page.can).toMatchObject({ editRules: true, loadBonds: true });

		const entry = (await bondEntryLoad(event(operator, campaignId, '/bonds/new'))) as unknown as {
			canLoad: boolean;
		};
		expect(entry.canLoad).toBe(true);
	});

	it('read-only users can neither open the page nor save', async () => {
		await expect(bondEntryLoad(event(readOnly, campaignId, '/bonds/new'))).rejects.toMatchObject({
			status: 403
		});
		const result = await enter(readOnly, campaignId, '0001');
		expect(result.status).toBe(403);
	});

	it('Save & add another: creates an available simple bond computed by the database', async () => {
		const result = await enter(operator, campaignId, '68', 'another', { internalCode: 'E-1' });
		expect(result).toMatchObject({
			success: true,
			message: 'Bono 0068 / 4939 guardado.',
			created: { baseFormatted: '0068', associatedFormatted: '4939' }
		});
		firstBondId = (result.created as { id: string }).id;

		const bond = (await getBondById(operator.client, firstBondId)).data;
		expect(bond).toMatchObject({
			campaignId,
			kind: 'simple',
			origin: 'printed',
			commercialStatus: 'available',
			commercialUnitCount: 1,
			totalValue: '60000.00',
			internalCode: 'E-1',
			barcode: null
		});
		expect(bond?.numbers.map((n) => [n.numberValue, n.numberKind])).toEqual([
			[68, 'base'],
			[4939, 'associated']
		]);
	});

	it('Save: redirects to the new bond record', async () => {
		const result = await enter(admin, campaignId, '0100', 'save');
		const match = new RegExp(`^/campaigns/${campaignId}/bonds/([0-9a-f-]{36})$`).exec(
			result.redirect ?? ''
		);
		expect(match, `unexpected result ${JSON.stringify(result)}`).not.toBeNull();
		expect((await getBondById(admin.client, match![1])).data?.numbers).toHaveLength(2);
	});

	it('reports duplicates with the formatted numbers and the bond that uses them', async () => {
		const same = await enter(operator, campaignId, '0068');
		expect(same.status).toBe(409);
		expect(same.data).toMatchObject({
			errors: {
				baseNumber: ['Los números 0068, 4939 ya están en uso en otro bono de esta campaña.']
			},
			conflicts: [{ field: 'baseNumber', bondId: firstBondId, numbers: ['0068', '4939'] }]
		});

		// 0129's associated number (5000) is the base number of another bond.
		const owner = await enter(operator, campaignId, '5000');
		const ownerId = (owner.created as { id: string }).id;
		const crossing = await enter(operator, campaignId, '0129');
		expect(crossing.status).toBe(409);
		expect(crossing.data).toMatchObject({
			errors: { baseNumber: ['El número 5000 ya está en uso en otro bono de esta campaña.'] },
			conflicts: [{ field: 'baseNumber', bondId: ownerId, numbers: ['5000'] }]
		});

		const code = await enter(operator, campaignId, '0200', 'another', { internalCode: 'E-1' });
		expect(code.status).toBe(409);
		expect(code.data).toMatchObject({
			errors: {
				internalCode: ['El código interno E-1 ya está en uso en otro bono de esta campaña.']
			},
			conflicts: [{ field: 'internalCode', bondId: firstBondId, numbers: [] }]
		});
	});

	it('rejects an overflowing base number with the highest allowed one', async () => {
		const result = await enter(operator, campaignId, '5129');
		expect(result.status).toBe(400);
		expect((result.data?.errors as Record<string, string[]>).baseNumber[0]).toContain(
			'el número base más alto permitido es 5128'
		);
	});

	it('freezes the rules of the draft once it has bonds (form hidden, action refused)', async () => {
		const page = (await campaignLoad(event(admin, campaignId, ''))) as unknown as {
			campaign: { updatedAt: string; status: string };
			hasBonds: boolean;
			can: { editRules: boolean };
		};
		expect(page.campaign.status).toBe('draft');
		expect(page.hasBonds).toBe(true);
		expect(page.can.editRules).toBe(false);

		const result = (await campaignActions.rules(
			event(admin, campaignId, '', {
				action: 'rules',
				fields: {
					simpleBondValue: '70.000,00',
					installmentCount: '10',
					numberDigits: '4',
					maxNumber: '9999',
					associatedNumberOffset: '4871',
					overflowPolicy: 'reject',
					barcodeMode: 'base_number',
					changeReason: '',
					confirmRulesChange: 'yes',
					expectedUpdatedAt: page.campaign.updatedAt
				}
			})
		)) as ActionResult;
		expect(result.status).toBe(409);
		expect(result.data?.message).toBe(CAMPAIGN_MESSAGES.rulesFrozenByBonds);
	});

	it('works for a 5-digit campaign', async () => {
		const fiveDigits = await createCampaign('5 digits', 5);
		const result = await enter(operator, fiveDigits, '68');
		expect(result).toMatchObject({
			success: true,
			created: { baseFormatted: '00068', associatedFormatted: '48778' }
		});
	});

	it('refuses to load bonds once the campaign is annulled', async () => {
		const annulled = await createCampaign('annulled', 4);
		const { error } = await admin.client.rpc('campaign_transition', {
			p_id: annulled,
			p_to_status: 'annulled',
			p_reason: 'Integration test',
			p_request_id: rid('annul')
		});
		expect(error).toBeNull();

		const entry = (await bondEntryLoad(event(operator, annulled, '/bonds/new'))) as unknown as {
			canLoad: boolean;
			lockedMessage: string;
		};
		expect(entry.canLoad).toBe(false);
		expect(entry.lockedMessage).toMatch(/La campaña está anulada\.$/);

		const result = await enter(operator, annulled, '0068');
		expect(result.status).toBe(409);

		const page = (await campaignLoad(event(admin, annulled, ''))) as unknown as {
			can: { loadBonds: boolean };
		};
		expect(page.can.loadBonds).toBe(false);
	});
});
