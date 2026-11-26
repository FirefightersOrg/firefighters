import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { actions as newActions } from '../../src/routes/campaigns/[id]/collectors/new/+page.server';
import { load as listLoad } from '../../src/routes/campaigns/[id]/collectors/+page.server';
import { actions as recordActions } from '../../src/routes/campaigns/[id]/collectors/[collectorId]/+page.server';
import { loadPermissions } from './permissions';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import type { UserProfile } from '../../src/app';

const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seedConfig = resolveSeedConfig(seedEnv);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
let sequence = 0;
const rid = (label: string) =>
	`it-collectors-${RUN_ID}-${String(++sequence).padStart(3, '0')}-${label}`;

interface Caller {
	user: User;
	client: SupabaseClient;
	profile: UserProfile;
	permissions: string[];
}

let service: SupabaseClient;
let admin: Caller;
let operator: Caller;
let readOnly: Caller;
let campaignId: string;
let firstCollectorId: string;
let linkedCollectorId: string;
let linkedProfileId: string;

async function signIn(email: string, password: string): Promise<Caller> {
	const anon = createClient(supabaseUrl, anonKey, options);
	const { data, error } = await anon.auth.signInWithPassword({ email, password });
	if (error || !data.session) throw new Error(`Could not sign in ${email}: ${error?.message}`);
	const client = createClient(supabaseUrl, anonKey, {
		...options,
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
	const { data: profile, error: profileError } = await service
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
	const found = seedConfig.fixtures.find((candidate) => candidate.roleNames.includes(role));
	if (!found) throw new Error(`No ${role} seeded fixture`);
	return found;
}

function event<E>(
	caller: Caller,
	path: string,
	params: Record<string, string>,
	fields?: Record<string, string>
): E {
	const url = new URL(`http://localhost${path}`);
	const body = new FormData();
	for (const [key, value] of Object.entries(fields ?? {})) body.set(key, value);
	return {
		locals: {
			supabase: caller.client,
			safeGetSession: async () => ({ session: null, user: caller.user }),
			session: null,
			user: caller.user,
			profile: caller.profile,
			permissions: caller.permissions,
			requestId: rid('request')
		},
		params,
		url,
		request: new Request(url, { method: fields ? 'POST' : 'GET', body: fields ? body : undefined })
	} as unknown as E;
}

const collectorFields = (name: string, userProfileId = '') => ({
	displayName: name,
	phone: '555-0100',
	email: `${name.replaceAll(' ', '.').toLowerCase()}@example.test`,
	address: 'Test street',
	status: 'active',
	userProfileId
});

async function create(caller: Caller, name: string, userProfileId = ''): Promise<string> {
	try {
		await newActions.default(
			event(
				caller,
				`/campaigns/${campaignId}/collectors/new`,
				{ id: campaignId },
				collectorFields(name, userProfileId)
			)
		);
		throw new Error('Expected a redirect after collector creation');
	} catch (result) {
		const redirect = result as { status?: number; location?: string };
		expect(redirect.status).toBe(303);
		return redirect.location!.split('/').at(-1)!;
	}
}

beforeAll(async () => {
	service = createClient(supabaseUrl, serviceRoleKey, options);
	admin = await signIn(seedConfig.admin.email, seedConfig.admin.password);
	operator = await signIn(fixture('operator').email, fixture('operator').password);
	readOnly = await signIn(fixture('read-only').email, fixture('read-only').password);
	const linkedEmail = `it-collector-linked-${RUN_ID}@example.test`;
	const { data: linkedUser, error: linkedUserError } = await service.auth.admin.createUser({
		email: linkedEmail,
		password: `Collector-${RUN_ID}!`,
		email_confirm: true
	});
	if (linkedUserError || !linkedUser.user)
		throw new Error(`Could not create linked collector user: ${linkedUserError?.message}`);
	const { data: linkedProfile, error: linkedProfileError } = await service
		.from('profiles')
		.insert({
			auth_user_id: linkedUser.user.id,
			full_name: `Linked collector ${RUN_ID}`,
			email: linkedEmail,
			status: 'active'
		})
		.select('id')
		.single();
	if (linkedProfileError || !linkedProfile)
		throw new Error(`Could not create linked collector profile: ${linkedProfileError?.message}`);
	linkedProfileId = linkedProfile.id;
	const { data, error } = await admin.client.rpc('campaign_create', {
		p_name: `[it-collectors ${RUN_ID}]`,
		p_simple_bond_value: '60000',
		p_installment_count: 10,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_request_id: rid('campaign')
	});
	if (error || typeof data !== 'string')
		throw new Error(`campaign_create failed: ${error?.message}`);
	campaignId = data;
});

describe('collectors (local Supabase)', () => {
	it('admin creates collectors with and without a linked user, searches, updates, and deactivates', async () => {
		firstCollectorId = await create(admin, `Collector ${RUN_ID}`);
		linkedCollectorId = await create(admin, `Linked ${RUN_ID}`, linkedProfileId);
		const list = (await listLoad(
			event(admin, `/campaigns/${campaignId}/collectors?q=${encodeURIComponent(RUN_ID)}`, {
				id: campaignId
			})
		)) as { collectors: { id: string }[] };
		expect(list.collectors.map((collector) => collector.id)).toEqual(
			expect.arrayContaining([firstCollectorId, linkedCollectorId])
		);
		const { data: first, error } = await service
			.from('collectors')
			.select('updated_at')
			.eq('id', firstCollectorId)
			.single();
		expect(error).toBeNull();
		const update = await recordActions.update(
			event(
				admin,
				`/campaigns/${campaignId}/collectors/${firstCollectorId}?/update`,
				{ id: campaignId, collectorId: firstCollectorId },
				{
					...collectorFields(`Updated ${RUN_ID}`),
					status: 'inactive',
					updatedAt: first!.updated_at
				}
			)
		);
		expect(update).toMatchObject({ success: true });
		const { data: updated } = await service
			.from('collectors')
			.select('display_name, status')
			.eq('id', firstCollectorId)
			.single();
		expect(updated).toMatchObject({ display_name: `Updated ${RUN_ID}`, status: 'inactive' });
	});

	it('enforces seeded-role access and writes collector.create / collector.update audits', async () => {
		await expect(
			newActions.default(
				event(
					operator,
					`/campaigns/${campaignId}/collectors/new`,
					{ id: campaignId },
					collectorFields(`Denied ${RUN_ID}`)
				)
			)
		).rejects.toMatchObject({ status: 403 });
		await expect(
			listLoad(event(readOnly, `/campaigns/${campaignId}/collectors`, { id: campaignId }))
		).resolves.toHaveProperty('collectors');

		// SAN-93 owns the operator view matrix. Until collector.view is granted, 403 is expected.
		if (
			operator.permissions.includes('collector.view') ||
			operator.permissions.includes('collector.manage')
		) {
			await expect(
				listLoad(event(operator, `/campaigns/${campaignId}/collectors`, { id: campaignId }))
			).resolves.toBeDefined();
		} else {
			await expect(
				listLoad(event(operator, `/campaigns/${campaignId}/collectors`, { id: campaignId }))
			).rejects.toMatchObject({ status: 403 });
		}
		const { data, error } = await service
			.from('audit_log')
			.select('action, entity_id')
			.eq('entity_type', 'collector')
			.in('entity_id', [firstCollectorId, linkedCollectorId]);
		expect(error).toBeNull();
		expect(data?.map((entry) => entry.action)).toEqual(
			expect.arrayContaining(['collector.create', 'collector.update'])
		);
	});
});
