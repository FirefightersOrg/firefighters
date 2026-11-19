import type { SupabaseClient } from '@supabase/supabase-js';
import type { Installment, PaymentPlan, Sale } from '$lib/domain/sales';
import { toDecimalString } from '$lib/domain/money';
import type { RepositoryResult } from './campaigns';
import type { FinancialStatus } from '$lib/domain/financial-status';

interface SaleRow {
	id: string;
	campaign_id: string;
	bond_id: string;
	buyer_id: string;
	collector_id: string;
	sold_at: string;
	payment_mode: Sale['paymentMode'];
	total_amount: string | number;
	status: Sale['status'];
	created_by: string;
	created_at: string;
	updated_at: string;
}
interface PlanRow {
	id: string;
	sale_id: string;
	installment_count: number;
	total_amount: string | number;
	status: PaymentPlan['status'];
	created_at: string;
}
interface InstallmentRow {
	id: string;
	payment_plan_id: string;
	installment_number: number;
	due_date: string;
	amount: string | number;
	status: Installment['status'];
	updated_at: string;
}
export function mapSaleRow(row: SaleRow): Sale {
	return {
		id: row.id,
		campaignId: row.campaign_id,
		bondId: row.bond_id,
		buyerId: row.buyer_id,
		collectorId: row.collector_id,
		soldAt: row.sold_at,
		paymentMode: row.payment_mode,
		totalAmount: toDecimalString(row.total_amount),
		status: row.status,
		createdBy: row.created_by,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}
export function mapInstallmentRow(row: InstallmentRow): Installment {
	return {
		id: row.id,
		paymentPlanId: row.payment_plan_id,
		installmentNumber: row.installment_number,
		dueDate: row.due_date,
		amount: toDecimalString(row.amount),
		status: row.status,
		updatedAt: row.updated_at
	};
}
export async function getActiveSaleForBond(
	supabase: SupabaseClient,
	bondId: string
): Promise<RepositoryResult<{ sale: Sale; plan: PaymentPlan } | null>> {
	const { data, error } = await supabase
		.from('sales')
		.select('*, payment_plans(*)')
		.eq('bond_id', bondId)
		.eq('status', 'active')
		.limit(1)
		.overrideTypes<(SaleRow & { payment_plans: PlanRow[] })[], { merge: false }>();
	if (error) return { data: null, error };
	const sale = data?.[0];
	if (!sale) return { data: null, error: null };
	// A corrected sale may keep annulled plans: only the active one is the sale's plan.
	const plan = sale.payment_plans.find((candidate) => candidate.status === 'active');
	if (!plan) return { data: null, error: new Error('Active sale has no active payment plan') };
	return {
		data: {
			sale: mapSaleRow(sale),
			plan: {
				id: plan.id,
				saleId: plan.sale_id,
				installmentCount: plan.installment_count,
				totalAmount: toDecimalString(plan.total_amount),
				status: plan.status,
				createdAt: plan.created_at
			}
		},
		error: null
	};
}
/** The installments of a sale's active payment plan, by number. */
export async function listInstallmentsForSale(
	supabase: SupabaseClient,
	saleId: string
): Promise<RepositoryResult<Installment[]>> {
	const { data, error } = await supabase
		.from('installments')
		.select('*, payment_plans!inner(sale_id, status)')
		.eq('payment_plans.sale_id', saleId)
		// The installments of the sale's active plan (annulled plans keep theirs as history).
		.eq('payment_plans.status', 'active')
		.order('installment_number')
		.overrideTypes<InstallmentRow[], { merge: false }>();
	return error ? { data: null, error } : { data: (data ?? []).map(mapInstallmentRow), error: null };
}

export interface SaleListItem {
	sale: Sale;
	bondId: string;
	bondNumbers: number[];
	buyerName: string;
	collectorName: string;
	financialStatus: FinancialStatus;
}

type SaleListRow = SaleRow & {
	buyers: {
		first_name: string | null;
		last_name: string | null;
		business_name: string | null;
	} | null;
	collectors: { display_name: string } | null;
	bonds: {
		financial_status_snapshot: FinancialStatus;
		bond_numbers: { number_value: number; number_kind: string }[];
	} | null;
};

const buyerName = (buyer: SaleListRow['buyers']) =>
	buyer?.business_name ||
	[buyer?.first_name, buyer?.last_name].filter(Boolean).join(' ') ||
	'Unknown buyer';

function mapListRow(row: SaleListRow): SaleListItem {
	return {
		sale: mapSaleRow(row),
		bondId: row.bond_id,
		bondNumbers: (row.bonds?.bond_numbers ?? [])
			.filter((number) => number.number_kind === 'base')
			.map((number) => number.number_value)
			.sort((a, b) => a - b),
		buyerName: buyerName(row.buyers),
		collectorName: row.collectors?.display_name ?? 'Unknown collector',
		financialStatus: row.bonds?.financial_status_snapshot ?? 'no_payments'
	};
}

/** Sales in a campaign, newest first. Financial-status filtering uses the bond snapshot. */
export async function listSales(
	supabase: SupabaseClient,
	campaignId: string,
	options: {
		collectorId?: string | null;
		buyerSearch?: string | null;
		paymentMode?: Sale['paymentMode'] | null;
		financialStatus?: FinancialStatus | null;
		page?: number;
		pageSize?: number;
	} = {}
): Promise<
	RepositoryResult<{ items: SaleListItem[]; total: number; page: number; pageSize: number }>
> {
	const page = Math.max(1, options.page ?? 1);
	const pageSize = options.pageSize ?? 25;
	let query = supabase
		.from('sales')
		.select(
			'*, buyers(first_name,last_name,business_name), collectors(display_name), bonds!inner(financial_status_snapshot,bond_numbers(number_value,number_kind))',
			{ count: 'exact' }
		)
		.eq('campaign_id', campaignId);
	if (options.collectorId) query = query.eq('collector_id', options.collectorId);
	if (options.paymentMode) query = query.eq('payment_mode', options.paymentMode);
	if (options.financialStatus)
		query = query.eq('bonds.financial_status_snapshot', options.financialStatus);
	if (options.buyerSearch) {
		const escaped = options.buyerSearch.replace(/[%_,()]/g, '\\$&');
		query = query.or(
			`first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,business_name.ilike.%${escaped}%`,
			{ referencedTable: 'buyers' }
		);
	}
	const { data, error, count } = await query
		.order('sold_at', { ascending: false })
		.order('id', { ascending: false })
		.range((page - 1) * pageSize, page * pageSize - 1)
		.overrideTypes<SaleListRow[], { merge: false }>();
	return error
		? { data: null, error }
		: {
				data: { items: (data ?? []).map(mapListRow), total: count ?? 0, page, pageSize },
				error: null
			};
}

export async function getSaleDetail(
	supabase: SupabaseClient,
	campaignId: string,
	saleId: string
): Promise<
	RepositoryResult<(SaleListItem & { plan: PaymentPlan; installments: Installment[] }) | null>
> {
	const { data, error } = await supabase
		.from('sales')
		.select(
			'*, buyers(first_name,last_name,business_name), collectors(display_name), bonds!inner(financial_status_snapshot,bond_numbers(number_value,number_kind)), payment_plans(*, installments(*))'
		)
		.eq('campaign_id', campaignId)
		.eq('id', saleId)
		.limit(1)
		.overrideTypes<
			(SaleListRow & { payment_plans: (PlanRow & { installments: InstallmentRow[] })[] })[],
			{ merge: false }
		>();
	if (error) return { data: null, error };
	const sale = data?.[0];
	if (!sale) return { data: null, error: null };
	const plan = sale.payment_plans.find((candidate) => candidate.status === 'active');
	if (!plan) return { data: null, error: new Error('Sale has no active payment plan') };
	return {
		data: {
			...mapListRow(sale),
			plan: {
				id: plan.id,
				saleId: plan.sale_id,
				installmentCount: plan.installment_count,
				totalAmount: toDecimalString(plan.total_amount),
				status: plan.status,
				createdAt: plan.created_at
			},
			installments: plan.installments.map(mapInstallmentRow)
		},
		error: null
	};
}

export async function findDeliveredBondsForSale(
	supabase: SupabaseClient,
	campaignId: string,
	queryText: string
): Promise<RepositoryResult<{ id: string; collectorId: string; baseNumbers: number[] }[]>> {
	// Kept deliberately small: this lookup is only a guided-flow search, while sale_register is
	// the authoritative availability check.
	let query = supabase
		.from('bonds')
		.select(
			'id,campaign_id,current_collector_id,commercial_status,group_pata_id,bond_numbers(number_value,number_kind)'
		)
		.eq('campaign_id', campaignId)
		.eq('commercial_status', 'delivered_to_collector')
		.is('group_pata_id', null)
		.limit(30);
	const number = Number(queryText);
	if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(queryText)) query = query.eq('id', queryText);
	else if (Number.isInteger(number)) query = query.eq('bond_numbers.number_value', number);
	const { data, error } = await query.overrideTypes<
		{
			id: string;
			current_collector_id: string;
			bond_numbers: { number_value: number; number_kind: string }[];
		}[],
		{ merge: false }
	>();
	return error
		? { data: null, error }
		: {
				data: (data ?? []).map((row) => ({
					id: row.id,
					collectorId: row.current_collector_id,
					baseNumbers: row.bond_numbers
						.filter((number) => number.number_kind === 'base')
						.map((number) => number.number_value)
						.sort((a, b) => a - b)
				})),
				error: null
			};
}
