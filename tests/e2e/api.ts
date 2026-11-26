import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ADMIN, baDay } from './helpers';

/**
 * Test data through the same audited SQL functions the app calls (as `scripts/seed-demo.ts` does),
 * signed in as the seeded admin. Specs use it to build the state a test needs when the UI flow that
 * creates that state is not what the test checks (SAN-166). It refuses to run against a non-local
 * Supabase, like the other E2E helpers.
 */
const options = { auth: { autoRefreshToken: false, persistSession: false } };

export function localSupabase() {
	const status = (): Record<string, string | undefined> => {
		try {
			const workdir = process.env.SUPABASE_WORKDIR;
			return parseEnv(
				execFileSync(
					'supabase',
					['status', '-o', 'env', ...(workdir ? ['--workdir', workdir] : [])],
					{
						encoding: 'utf8',
						stdio: ['ignore', 'pipe', 'ignore']
					}
				)
			);
		} catch {
			return {};
		}
	};
	const needStatus =
		!process.env.PUBLIC_SUPABASE_URL ||
		!process.env.PUBLIC_SUPABASE_ANON_KEY ||
		!process.env.SUPABASE_SERVICE_ROLE_KEY;
	const fromStatus = needStatus ? status() : {};
	const url = process.env.PUBLIC_SUPABASE_URL ?? fromStatus.API_URL ?? 'http://127.0.0.1:54321';
	if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url))
		throw new Error(`Refusing to seed a non-local Supabase: ${url}`);
	return {
		url,
		anonKey: process.env.PUBLIC_SUPABASE_ANON_KEY || fromStatus.ANON_KEY || '',
		serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || fromStatus.SERVICE_ROLE_KEY || ''
	};
}

export function serviceClient(): SupabaseClient {
	const { url, serviceKey } = localSupabase();
	return createClient(url, serviceKey, options);
}

let adminClient: Promise<SupabaseClient> | undefined;
/** The seeded admin, signed in (cached per worker process). */
export function admin(): Promise<SupabaseClient> {
	adminClient ??= (async () => {
		const { url, anonKey } = localSupabase();
		const auth = createClient(url, anonKey, options);
		const { data, error } = await auth.auth.signInWithPassword(ADMIN);
		if (error || !data.session) throw new Error(`Could not sign in the admin: ${error?.message}`);
		return createClient(url, anonKey, {
			...options,
			global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
		});
	})();
	return adminClient;
}

let counter = 0;
const requestId = (label: string) => `e2e-${label}-${Date.now()}-${(counter += 1)}`;

export async function rpc<T = string>(
	name: string,
	args: Record<string, unknown>,
	client?: SupabaseClient
): Promise<T> {
	const { data, error } = await (client ?? (await admin())).rpc(name, {
		...args,
		p_request_id: requestId(name)
	});
	if (error) throw new Error(`${name}: ${error.message}`);
	return data as T;
}

/** A one-installment campaign (4-digit numbers, associated number = base + 5000), left in draft. */
export async function apiDraftCampaign(name: string) {
	return rpc('campaign_create', {
		p_name: name,
		p_starts_at: `${baDay(-1)}T03:00:00Z`,
		p_ends_at: `${baDay(60)}T03:00:00Z`,
		p_simple_bond_value: '1000.00',
		p_installment_count: 1,
		p_number_digits: 4,
		p_max_number: 9999,
		p_associated_number_offset: 5000,
		p_overflow_policy: 'reject',
		p_barcode_mode: 'base_number'
	});
}

export async function apiActiveCampaign(name: string) {
	const id = await apiDraftCampaign(name);
	await rpc('campaign_transition', { p_id: id, p_to_status: 'active' });
	return id;
}

export const apiCollector = (name: string) =>
	rpc('collector_create', {
		p_display_name: name,
		p_phone: null,
		p_address: null,
		p_user_profile_id: null
	});

export const apiBond = (campaignId: string, base: number) =>
	rpc('bond_create', { p_campaign_id: campaignId, p_base_numbers: [base] });

export const apiBuyer = (firstName: string, lastName: string) =>
	rpc('buyer_create', {
		p_type: 'individual',
		p_first_name: firstName,
		p_last_name: lastName,
		p_document_number: null,
		p_tax_id: null,
		p_business_name: null,
		p_phone: null,
		p_address: null,
		p_usual_collector_id: null
	});

/** Delivers `bondId` to `collectorId` and sells it (full payment) to a new buyer. */
export async function apiDeliverAndSell(campaignId: string, collectorId: string, bondId: string) {
	const noteId = await rpc('bond_deliver', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId,
		p_bond_ids: [bondId],
		p_notes: null
	});
	const buyerId = await apiBuyer('Ana', `Comprador ${Date.now()}`);
	const saleId = await rpc('sale_register', {
		p_campaign_id: campaignId,
		p_bond_id: bondId,
		p_buyer_id: buyerId,
		p_payment_mode: 'full_payment',
		p_first_due_date: null,
		p_sale_date: baDay(0)
	});
	return { noteId, saleId, buyerId };
}

/** Opens a settlement for the collector. */
export const apiOpenSettlement = (campaignId: string, collectorId: string) =>
	rpc('settlement_open', {
		p_campaign_id: campaignId,
		p_collector_id: collectorId,
		p_notes: null
	});

/** Delivers, sells, records the cash payment of the first installment and closes the settlement. */
export async function apiDeliverSellAndSettle(
	campaignId: string,
	collectorId: string,
	bondId: string
) {
	const { noteId, saleId, buyerId } = await apiDeliverAndSell(campaignId, collectorId, bondId);
	const settlementId = await apiOpenSettlement(campaignId, collectorId);
	const service = serviceClient();
	const plan = await service.from('payment_plans').select('id').eq('sale_id', saleId).single();
	if (plan.error) throw new Error(plan.error.message);
	const installment = await service
		.from('installments')
		.select('id, amount')
		.eq('payment_plan_id', plan.data.id)
		.order('installment_number')
		.limit(1)
		.single();
	if (installment.error) throw new Error(installment.error.message);
	const amount = Number(installment.data.amount).toFixed(2);
	const paymentId = await rpc('settlement_add_payment', {
		p_settlement_id: settlementId,
		p_sale_id: saleId,
		p_amount: amount,
		p_payment_method: 'cash',
		p_applications: [{ installment_id: installment.data.id, amount_applied: amount }],
		p_payment_date: baDay(0)
	});
	await rpc('settlement_close', { p_settlement_id: settlementId });
	return { noteId, saleId, buyerId, settlementId, paymentId };
}

/** A final draw whose cutoff (today, Buenos Aires) covers today's confirmed payments. */
export const apiDraw = (campaignId: string, name: string, requiredInstallment: number | null) =>
	rpc('draw_create', {
		p_campaign_id: campaignId,
		p_draw_type: 'final',
		p_name: name,
		p_draw_date: baDay(1),
		p_payment_cutoff_at: `${baDay(0)}T23:59:00-03:00`,
		p_required_installment_number: requiredInstallment,
		p_eligibility_rule: {}
	});
