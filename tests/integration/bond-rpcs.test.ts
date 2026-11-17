import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_NUMBERING_CONFIG } from '$lib/domain/numbering';
import { getUserPermissions } from '$lib/server/auth/permissions';
import { getBondById, listBondNumbersByCampaign } from '$lib/server/repositories/bonds';
import {
	annulBond,
	BondServiceError,
	createBond,
	groupBondsIntoPata,
	ungroupPata
} from '$lib/server/services/bonds';
import {
	bondAnnulSchema,
	bondCreatePataSchema,
	bondCreateSimpleSchema,
	bondGroupSchema,
	bondUngroupSchema
} from '$lib/schemas/bond';
import { resolveSeedConfig } from '../../scripts/seed-admin';

/**
 * SAN-23: the bond services against the real local Supabase (PostgREST + the audited `bond_*`
 * SQL functions), with the seeded admin and operator. Checks what the pgTAP suite cannot: that
 * arrays reach the functions through PostgREST and that duplicate details (JSON in DETAIL) reach
 * the app as typed conflicts.
 *
 * Bonds and campaigns cannot be deleted: each run creates its own draft campaign named
 * `[it-bonds <run id>]`, so the numbers never collide with a previous run.
 */

const { supabaseUrl, anonKey, seedEnv } = inject('integrationEnv');
const seedConfig = resolveSeedConfig(seedEnv);
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
const config = DEFAULT_NUMBERING_CONFIG;
const empty = { internalCode: '', barcode: '', reason: '' };

interface Caller {
	client: SupabaseClient;
	permissions: string[];
}

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
	return { client, permissions: await getUserPermissions(client) };
}

let admin: Caller;
let operator: Caller;
let campaignId: string;

beforeAll(async () => {
	admin = await signIn(seedConfig.admin.email, seedConfig.admin.password);
	const op = seedConfig.fixtures.find((f) => f.roleNames.includes('operator'));
	if (!op) throw new Error('resolveSeedConfig returned no operator fixture');
	operator = await signIn(op.email, op.password);

	const { data, error } = await admin.client.rpc('campaign_create', {
		p_name: `[it-bonds ${RUN_ID}] Bonds`,
		p_simple_bond_value: '60000.00',
		p_installment_count: 10,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_request_id: `it-bonds-${RUN_ID}-campaign`
	});
	if (error) throw new Error(`campaign_create failed: ${error.message}`);
	campaignId = data as string;
});

const simple = (baseNumber: string, extra: Partial<typeof empty> = {}) =>
	bondCreateSimpleSchema(config).parse({ ...empty, ...extra, campaignId, baseNumber });

describe('bond services (local Supabase)', () => {
	it('creates a simple bond and a printed pata with numbers computed by the database', async () => {
		const ctx = { requestId: `it-bonds-${RUN_ID}-create`, permissions: operator.permissions };
		const id = await createBond(operator.client, simple('0068', { internalCode: 'INT-1' }), ctx);
		const pataId = await createBond(
			operator.client,
			bondCreatePataSchema(config).parse({ ...empty, campaignId, baseNumbers: '0100 0200' }),
			ctx
		);

		const bond = (await getBondById(operator.client, id)).data;
		expect(bond).toMatchObject({
			kind: 'simple',
			origin: 'printed',
			totalValue: '60000.00',
			commercialStatus: 'available',
			internalCode: 'INT-1',
			activeGroup: null
		});
		expect(bond?.numbers.map((n) => [n.numberValue, n.numberKind])).toEqual([
			[68, 'base'],
			[4939, 'associated']
		]);

		const pata = (await getBondById(operator.client, pataId)).data;
		expect(pata).toMatchObject({ kind: 'pata', commercialUnitCount: 2, totalValue: '120000.00' });

		const numbers = (await listBondNumbersByCampaign(operator.client, campaignId)).data;
		expect(numbers?.map((n) => n.numberValue)).toEqual([68, 100, 200, 4939, 4971, 5071]);
	});

	it('reports duplicates with the number and the bond that uses it', async () => {
		const existing = (await listBondNumbersByCampaign(operator.client, campaignId)).data ?? [];
		const owner = existing.find((n) => n.numberValue === 68)?.bondId;

		const err = await createBond(operator.client, simple('68')).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(BondServiceError);
		expect(err).toMatchObject({
			kind: 'conflict',
			field: 'baseNumber',
			message: `Numbers 0068, 4939 are already used by bond ${owner}.`,
			conflicts: [
				{ number: 68, formatted: '0068', bondId: owner, numberKind: 'base' },
				{ number: 4939, formatted: '4939', bondId: owner, numberKind: 'associated' }
			]
		});
		expect((err as BondServiceError).status).toBe(409);

		// A base number whose associated number belongs to another bond (5000 -> 9871, 129 -> 5000).
		const other = await createBond(operator.client, simple('5000'));
		await expect(createBond(operator.client, simple('0129'))).rejects.toMatchObject({
			message: `Number 5000 is already used by bond ${other}.`,
			conflicts: [{ number: 5000, bondId: other, numberKind: 'base' }]
		});

		await expect(
			createBond(operator.client, simple('1', { internalCode: 'INT-1' }))
		).rejects.toMatchObject({
			kind: 'conflict',
			field: 'internalCode',
			conflictingBondId: owner
		});
	});

	it('groups, ungroups, annuls and lets the numbers be entered again', async () => {
		const a = await createBond(operator.client, simple('1000'));
		const b = await createBond(operator.client, simple('1001'));
		const pataId = await groupBondsIntoPata(
			operator.client,
			bondGroupSchema.parse({ ...empty, campaignId, memberBondIds: [a, b] })
		);
		const member = (await getBondById(operator.client, a)).data;
		expect(member?.activeGroup?.pataBondId).toBe(pataId);
		expect((await getBondById(operator.client, pataId)).data).toMatchObject({
			origin: 'manual_grouping',
			totalValue: '120000.00'
		});

		// Grouped members cannot be annulled; operators cannot annul at all.
		await expect(
			annulBond(admin.client, bondAnnulSchema.parse({ bondId: a, reason: 'Mistake' }))
		).rejects.toMatchObject({ kind: 'conflict' });
		await expect(
			annulBond(operator.client, bondAnnulSchema.parse({ bondId: b, reason: 'Mistake' }))
		).rejects.toMatchObject({ kind: 'permission', status: 403 });

		await ungroupPata(
			operator.client,
			bondUngroupSchema.parse({ pataBondId: pataId, reason: 'Separate' })
		);
		expect((await getBondById(operator.client, a)).data?.activeGroup).toBeNull();
		expect((await getBondById(operator.client, pataId)).data?.commercialStatus).toBe('annulled');

		await annulBond(
			admin.client,
			bondAnnulSchema.parse({ bondId: a, reason: 'Loaded by mistake' })
		);
		const annulled = (await getBondById(operator.client, a)).data;
		expect(annulled?.commercialStatus).toBe('annulled');
		expect(annulled?.numbers.every((n) => n.releasedAt !== null)).toBe(true);

		const again = await createBond(operator.client, simple('1000'));
		expect(again).not.toBe(a);
	});
});
