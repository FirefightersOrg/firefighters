import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getUserPermissions } from '$lib/server/auth/permissions';
import { createBuyer, createCollector } from '$lib/server/services/parties';
import { assignBondsToCollector } from '$lib/server/services/deliveries';
import { registerSale } from '$lib/server/services/sales';
import { resolveSeedConfig } from '../../scripts/seed-admin';

const { supabaseUrl, anonKey, seedEnv } = inject('integrationEnv');
const config = resolveSeedConfig(seedEnv);
const run = randomUUID().slice(0, 8);
interface Caller {
	client: SupabaseClient;
	permissions: string[];
}
async function signIn(email: string, password: string): Promise<Caller> {
	const client = createClient(supabaseUrl, anonKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
	const { data, error } = await client.auth.signInWithPassword({ email, password });
	if (error || !data.session) throw new Error(`Unable to sign in as ${email}`);
	const scoped = createClient(supabaseUrl, anonKey, {
		global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
	});
	return { client: scoped, permissions: await getUserPermissions(scoped) };
}
const ctx = (caller: Caller, label: string) => ({
	permissions: caller.permissions,
	requestId: `it-sale-${run}-${label}`
});
let admin: Caller;
let operator: Caller;
let campaignId: string;
let collectorId: string;
let buyerId: string;
let bondId: string;
beforeAll(async () => {
	admin = await signIn(config.admin.email, config.admin.password);
	operator = await signIn(
		config.fixtures.find((f) => f.roleNames.includes('operator'))!.email,
		config.fixtures.find((f) => f.roleNames.includes('operator'))!.password
	);
	const campaign = await admin.client.rpc('campaign_create', {
		p_name: `it sale ${run}`,
		p_simple_bond_value: '60000.00',
		p_installment_count: 10,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 4871,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number',
		p_starts_at: '2027-03-01T00:00:00-03:00',
		p_ends_at: '2027-12-31T23:59:59-03:00'
	});
	if (campaign.error) throw new Error(campaign.error.message);
	campaignId = campaign.data as string;
	const activation = await admin.client.rpc('campaign_transition', {
		p_id: campaignId,
		p_to_status: 'active',
		p_request_id: ctx(admin, 'active').requestId
	});
	if (activation.error) throw new Error(activation.error.message);
	collectorId = await createCollector(
		admin.client,
		{
			displayName: `Collector ${run}`,
			phone: null,
			email: null,
			address: null,
			userProfileId: null,
			status: 'active'
		},
		ctx(admin, 'collector')
	);
	buyerId = await createBuyer(
		admin.client,
		{
			type: 'individual',
			firstName: 'Sale',
			lastName: run,
			businessName: null,
			documentNumber: null,
			taxId: null,
			phone: null,
			address: null,
			usualCollectorId: null,
			notes: null
		},
		ctx(admin, 'buyer')
	);
	const bond = await admin.client.rpc('bond_create', {
		p_campaign_id: campaignId,
		p_base_numbers: [123],
		p_request_id: ctx(admin, 'bond').requestId
	});
	if (bond.error) throw new Error(bond.error.message);
	bondId = bond.data as string;
	await assignBondsToCollector(
		operator.client,
		{ campaignId, collectorId, bondIds: [bondId] },
		ctx(operator, 'deliver')
	);
});
describe('sale registration (local Supabase)', () => {
	it('creates a full-payment sale, plan, installment and sold bond', async () => {
		const saleId = await registerSale(
			operator.client,
			{ campaignId, bondId, buyerId, paymentMode: 'full_payment', firstDueDate: '2027-01-31' },
			ctx(operator, 'sale')
		);
		const { data: sale } = await admin.client
			.from('sales')
			.select('payment_mode, total_amount, collector_id')
			.eq('id', saleId)
			.single();
		const { data: installments } = await admin.client
			.from('installments')
			.select('installment_number, due_date, amount, payment_plans!inner(sale_id)')
			.eq('payment_plans.sale_id', saleId);
		const { data: bond } = await admin.client
			.from('bonds')
			.select('commercial_status, current_buyer_id, financial_status_snapshot')
			.eq('id', bondId)
			.single();
		expect(sale).toMatchObject({ payment_mode: 'full_payment', collector_id: collectorId });
		expect(installments).toMatchObject([
			{ installment_number: 1, due_date: '2027-01-31', amount: 60000 }
		]);
		expect(bond).toMatchObject({
			commercial_status: 'sold',
			current_buyer_id: buyerId,
			financial_status_snapshot: 'no_payments'
		});
	});
});
