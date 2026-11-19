import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { isRedirect } from '@sveltejs/kit';
import { actions as newBuyerActions } from '../../src/routes/campaigns/[id]/buyers/new/+page.server';
import { load as buyersLoad } from '../../src/routes/campaigns/[id]/buyers/+page.server';
import {
	actions as buyerActions,
	load as buyerLoad
} from '../../src/routes/campaigns/[id]/buyers/[buyerId]/+page.server';
import { getUserPermissions } from '$lib/server/auth/permissions';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import type { UserProfile } from '../../src/app';

const { supabaseUrl, anonKey, serviceRoleKey, seedEnv } = inject('integrationEnv');
const seedConfig = resolveSeedConfig(seedEnv);
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const RUN = `${Date.now()}-${randomUUID().slice(0, 8)}`;
let service: SupabaseClient;
let campaignId: string;
let seq = 0;
interface Caller {
	user: User;
	client: SupabaseClient;
	profile: UserProfile;
	permissions: string[];
}
let admin: Caller;
let operator: Caller;
let readOnly: Caller;

const fixture = (role: string) => {
	const value = seedConfig.fixtures.find((item) => item.roleNames.includes(role));
	if (!value) throw new Error(`No ${role} seed fixture`);
	return value;
};
async function signIn(email: string, password: string): Promise<Caller> {
	const auth = createClient(supabaseUrl, anonKey, options);
	const { data, error } = await auth.auth.signInWithPassword({ email, password });
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
		permissions: (await getUserPermissions(client)) ?? []
	};
}
function event(caller: Caller, suffix: string, fields?: Record<string, string>, buyerId?: string) {
	const url = new URL(
		`http://localhost/campaigns/${campaignId}${suffix}${fields ? '?/default' : ''}`
	);
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
			requestId: `it-buyers-${RUN}-${++seq}`
		},
		params: { id: campaignId, ...(buyerId ? { buyerId } : {}) },
		url,
		request: new Request(url, fields ? { method: 'POST', body } : undefined)
	} as never;
}
const individual = (overrides: Record<string, string> = {}) => ({
	type: 'individual',
	firstName: `Ada-${RUN}`,
	lastName: `Buyer-${RUN}`,
	businessName: 'discarded',
	documentNumber: `DNI-${RUN}`,
	taxId: 'discarded',
	phone: '',
	address: '',
	usualCollectorId: '',
	notes: '',
	...overrides
});
const business = (overrides: Record<string, string> = {}) => ({
	type: 'business',
	firstName: 'discarded',
	lastName: 'discarded',
	businessName: `Acme-${RUN}`,
	documentNumber: 'discarded',
	taxId: `CUIT-${RUN}`,
	phone: '',
	address: '',
	usualCollectorId: '',
	notes: '',
	...overrides
});
async function create(caller: Caller, values: Record<string, string>) {
	try {
		await newBuyerActions.default(event(caller, '/buyers/new', values));
		throw new Error('Expected buyer create redirect');
	} catch (err) {
		if (!isRedirect(err)) throw err;
		return err.location.split('/').at(-1)!;
	}
}

beforeAll(async () => {
	service = createClient(supabaseUrl, serviceRoleKey, options);
	admin = await signIn(seedConfig.admin.email, seedConfig.admin.password);
	operator = await signIn(fixture('operator').email, fixture('operator').password);
	readOnly = await signIn(fixture('read-only').email, fixture('read-only').password);
	const { data, error } = await admin.client.rpc('campaign_create', {
		p_name: `[it-buyers ${RUN}]`,
		p_simple_bond_value: '60000',
		p_installment_count: 10,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_request_id: `it-buyers-${RUN}-campaign`
	});
	if (error || !data) throw new Error(`campaign_create failed: ${error?.message}`);
	campaignId = data as string;
});

describe('buyers (local Supabase)', () => {
	it('operator creates individual and business buyers, searches and audits them', async () => {
		const individualId = await create(operator, individual());
		const businessId = await create(operator, business());
		const { data: rows, error } = await service
			.from('buyers')
			.select('id, first_name, business_name, document_number, tax_id')
			.in('id', [individualId, businessId]);
		expect(error).toBeNull();
		expect(rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: individualId, business_name: null, tax_id: null }),
				expect.objectContaining({ id: businessId, first_name: null, document_number: null })
			])
		);
		for (const q of [`Buyer-${RUN}`, `DNI-${RUN}`, `CUIT-${RUN}`]) {
			const page = (await buyersLoad(event(operator, `/buyers?q=${encodeURIComponent(q)}`))) as {
				buyers: unknown[];
			};
			expect(page.buyers.length).toBeGreaterThan(0);
		}
		const { data: audit } = await service
			.from('audit_log')
			.select('action, entity_id')
			.in('entity_id', [individualId, businessId])
			.eq('action', 'buyer.create');
		expect(audit).toHaveLength(2);

		const record = (await buyerLoad(
			event(operator, `/buyers/${individualId}`, undefined, individualId)
		)) as { buyer: { updatedAt: string } };
		const update = await buyerActions.update(
			event(
				operator,
				`/buyers/${individualId}`,
				{ ...individual({ lastName: `Edited-${RUN}` }), updatedAt: record.buyer.updatedAt },
				individualId
			)
		);
		expect(update).toMatchObject({ success: true });
		const { data: updates } = await service
			.from('audit_log')
			.select('action')
			.eq('entity_id', individualId)
			.eq('action', 'buyer.update');
		expect(updates).toHaveLength(1);
	});

	it('warns about duplicates and read-only cannot enter', async () => {
		const first = await create(operator, individual({ documentNumber: `DUP-${RUN}` }));
		const second = await create(
			operator,
			individual({ documentNumber: `OTHER-${RUN}`, firstName: `Other-${RUN}` })
		);
		const current = (await buyerLoad(event(operator, `/buyers/${second}`, undefined, second))) as {
			buyer: { updatedAt: string };
		};
		const duplicate = (await buyerActions.update(
			event(
				operator,
				`/buyers/${second}`,
				{
					...individual({ documentNumber: `DUP-${RUN}`, firstName: `Other-${RUN}` }),
					updatedAt: current.buyer.updatedAt
				},
				second
			)
		)) as { status: number };
		expect(duplicate.status).toBe(409);
		expect(first).toBeTruthy();
		await expect(buyersLoad(event(readOnly, '/buyers'))).rejects.toMatchObject({ status: 403 });
	});
});
