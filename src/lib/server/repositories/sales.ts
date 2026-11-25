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
	bondNumberPairs: { base: number; associated: number | null }[];
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
		bond_numbers: {
			id: string;
			number_value: number;
			number_kind: string;
			source_base_number_id: string | null;
		}[];
	} | null;
};
type SaleBondNumber = NonNullable<SaleListRow['bonds']>['bond_numbers'][number];

const buyerName = (buyer: SaleListRow['buyers']) =>
	buyer?.business_name ||
	[buyer?.first_name, buyer?.last_name].filter(Boolean).join(' ') ||
	'Unknown buyer';

function bondNumberPairs(numbers: SaleBondNumber[] | undefined) {
	const associatedByBase = new Map(
		(numbers ?? [])
			.filter((number) => number.number_kind === 'associated' && number.source_base_number_id)
			.map((number) => [number.source_base_number_id!, number.number_value])
	);
	return (numbers ?? [])
		.filter((number) => number.number_kind === 'base')
		.map((number) => ({
			base: number.number_value,
			associated: associatedByBase.get(number.id) ?? null
		}))
		.sort((a, b) => a.base - b.base);
}

function mapListRow(row: SaleListRow): SaleListItem {
	return {
		sale: mapSaleRow(row),
		bondId: row.bond_id,
		bondNumbers: (row.bonds?.bond_numbers ?? [])
			.filter((number) => number.number_kind === 'base')
			.map((number) => number.number_value)
			.sort((a, b) => a - b),
		bondNumberPairs: bondNumberPairs(row.bonds?.bond_numbers),
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
		buyerId?: string | null;
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
	// A buyer search filters through the embedded buyer, which must then be an inner join (an
	// outer embed would only blank the buyer and still return every sale).
	const buyerEmbed = options.buyerSearch ? 'buyers!inner' : 'buyers';
	let query = supabase
		.from('sales')
		.select(
			`*, ${buyerEmbed}(first_name,last_name,business_name), collectors(display_name), bonds!inner(financial_status_snapshot,bond_numbers(id,number_value,number_kind,source_base_number_id))`,
			{ count: 'exact' }
		)
		.eq('campaign_id', campaignId);
	if (options.collectorId) query = query.eq('collector_id', options.collectorId);
	if (options.buyerId) query = query.eq('buyer_id', options.buyerId);
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

/** SAN-106: the manual, final uncollectible mark of a sale (null when not marked). */
export interface UncollectibleMark {
	markedAt: string;
	reason: string;
}
export type SaleDetail = SaleListItem & {
	plan: PaymentPlan;
	installments: Installment[];
	uncollectible: UncollectibleMark | null;
};
type UncollectibleRow = {
	uncollectible_at?: string | null;
	uncollectible_reason?: string | null;
};

export async function getSaleDetail(
	supabase: SupabaseClient,
	campaignId: string,
	saleId: string
): Promise<RepositoryResult<SaleDetail | null>> {
	const { data, error } = await supabase
		.from('sales')
		.select(
			'*, buyers(first_name,last_name,business_name), collectors(display_name), bonds!inner(financial_status_snapshot,bond_numbers(id,number_value,number_kind,source_base_number_id)), payment_plans(*, installments(*))'
		)
		.eq('campaign_id', campaignId)
		.eq('id', saleId)
		.limit(1)
		.overrideTypes<
			(SaleListRow &
				UncollectibleRow & { payment_plans: (PlanRow & { installments: InstallmentRow[] })[] })[],
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
			installments: plan.installments
				.map(mapInstallmentRow)
				.sort((a, b) => a.installmentNumber - b.installmentNumber),
			uncollectible:
				sale.uncollectible_at && sale.uncollectible_reason
					? { markedAt: sale.uncollectible_at, reason: sale.uncollectible_reason }
					: null
		},
		error: null
	};
}

/** A bond found by the sale flow's search, sellable or not (with the reason it cannot be sold). */
export interface SaleCandidate {
	id: string;
	kind: 'simple' | 'pata';
	baseNumbers: number[];
	associatedNumbers: number[];
	commercialStatus: string;
	collectorId: string | null;
	totalValue: string;
	commercialUnitCount: number;
	sellable: boolean;
	/** Why it cannot be sold (null when sellable). */
	reason: string | null;
}

const NOT_SELLABLE: Record<string, string> = {
	available: 'Todavía no se entregó a un cobrador: primero hay que entregarlo.',
	created: 'Todavía no se entregó a un cobrador: primero hay que entregarlo.',
	returned: 'Fue devuelto y no está en poder de un cobrador.',
	sold: 'Ya está vendido.',
	lost: 'Se marcó como extraviado.',
	annulled: 'Fue anulado.',
	closed: 'Está cerrado.'
};

/**
 * Bonds of the campaign matching a base or associated number, an exact barcode / internal code, or
 * an id, in any status, so the flow can say why a bond cannot be sold. `sale_register` remains the
 * authoritative check.
 */
export async function findBondsForSale(
	supabase: SupabaseClient,
	campaignId: string,
	options: { number?: number | null; code?: string | null; id?: string | null }
): Promise<RepositoryResult<SaleCandidate[]>> {
	let query = supabase
		.from('bond_list')
		.select(
			'id, kind, commercial_status, current_collector_id, group_pata_id, base_numbers, associated_numbers, sort_number, total_value, commercial_unit_count'
		)
		.eq('campaign_id', campaignId);
	if (options.id) query = query.eq('id', options.id);
	else if (options.number != null)
		query = query.or(
			`base_numbers.cs.{${options.number}},associated_numbers.cs.{${options.number}}`
		);
	else if (options.code) {
		const code = options.code.replaceAll('"', '');
		query = query.or(`barcode.eq."${code}",internal_code.eq."${code}"`);
	} else return { data: [], error: null };
	const { data, error } = await query
		.order('sort_number', { ascending: true })
		.limit(30)
		.overrideTypes<
			{
				id: string;
				kind: 'simple' | 'pata';
				commercial_status: string;
				current_collector_id: string | null;
				group_pata_id: string | null;
				base_numbers: number[] | null;
				associated_numbers: number[] | null;
				total_value: string | number;
				commercial_unit_count: number;
			}[],
			{ merge: false }
		>();
	if (error) return { data: null, error };
	return {
		data: (data ?? []).map((row) => {
			const grouped = row.group_pata_id !== null;
			const delivered = row.commercial_status === 'delivered_to_collector';
			return {
				id: row.id,
				kind: row.kind,
				baseNumbers: row.base_numbers ?? [],
				associatedNumbers: row.associated_numbers ?? [],
				commercialStatus: row.commercial_status,
				collectorId: row.current_collector_id,
				totalValue: toDecimalString(row.total_value),
				commercialUnitCount: row.commercial_unit_count,
				sellable: delivered && !grouped,
				reason: grouped
					? 'It belongs to a manual pata: sell the pata instead.'
					: delivered
						? null
						: (NOT_SELLABLE[row.commercial_status] ?? 'It cannot be sold in its current status.')
			};
		}),
		error: null
	};
}

export interface RecordInstallment {
	id: string;
	saleId: string;
	bondId: string;
	bondNumbers: number[];
	buyerName?: string;
	dueDate: string;
	amount: string;
	status: Installment['status'];
}
interface CollectorInstallmentRow {
	id: string;
	due_date: string;
	amount: string | number;
	status: Installment['status'];
	payment_plans: {
		sales: {
			id: string;
			bond_id: string;
			bonds: { bond_numbers: { number_value: number; number_kind: string }[] } | null;
			buyers: SaleListRow['buyers'];
		};
	};
}

/** Most rows the buyer and collector records list (their totals are always exact). */
export const RECORD_LIST_LIMIT = 200;

function mapRecordInstallment(row: CollectorInstallmentRow): RecordInstallment {
	const sale = row.payment_plans.sales;
	return {
		id: row.id,
		saleId: sale.id,
		bondId: sale.bond_id,
		bondNumbers: (sale.bonds?.bond_numbers ?? [])
			.filter((number) => number.number_kind === 'base')
			.map((number) => number.number_value)
			.sort((x, y) => x - y),
		buyerName: buyerName(sale.buyers),
		dueDate: row.due_date,
		amount: toDecimalString(row.amount),
		status: row.status
	};
}

/** Pending and overdue installments of ACTIVE sales and plans, filtered in the database. */
async function listOpenInstallments(
	supabase: SupabaseClient,
	campaignId: string,
	filter: { buyerId?: string; collectorId?: string },
	limit: number
): Promise<RepositoryResult<{ items: RecordInstallment[]; total: number }>> {
	let query = supabase
		.from('installments')
		.select(
			'id,due_date,amount,status,payment_plans!inner(status,sales!inner(id,bond_id,campaign_id,collector_id,buyer_id,status,bonds!inner(bond_numbers(number_value,number_kind)),buyers(first_name,last_name,business_name)))',
			{ count: 'exact' }
		)
		.eq('payment_plans.status', 'active')
		.eq('payment_plans.sales.status', 'active')
		.eq('payment_plans.sales.campaign_id', campaignId)
		.in('status', ['pending', 'overdue']);
	if (filter.buyerId) query = query.eq('payment_plans.sales.buyer_id', filter.buyerId);
	if (filter.collectorId) query = query.eq('payment_plans.sales.collector_id', filter.collectorId);
	const { data, error, count } = await query
		.order('due_date')
		.order('id')
		.limit(limit)
		.overrideTypes<CollectorInstallmentRow[], { merge: false }>();
	if (error) return { data: null, error };
	return {
		data: { items: (data ?? []).map(mapRecordInstallment), total: count ?? 0 },
		error: null
	};
}

/**
 * A buyer's sales in one campaign (newest first) and the pending/overdue installments of the
 * active ones, each bounded to RECORD_LIST_LIMIT rows with exact totals.
 */
export async function listBuyerSalesAndInstallments(
	supabase: SupabaseClient,
	campaignId: string,
	buyerId: string
): Promise<
	RepositoryResult<{
		sales: SaleListItem[];
		salesTotal: number;
		installments: RecordInstallment[];
		installmentsTotal: number;
	}>
> {
	const [sales, installments] = await Promise.all([
		listSales(supabase, campaignId, { buyerId, pageSize: RECORD_LIST_LIMIT }),
		listOpenInstallments(supabase, campaignId, { buyerId }, RECORD_LIST_LIMIT)
	]);
	if (sales.error) return { data: null, error: sales.error };
	if (installments.error) return { data: null, error: installments.error };
	return {
		data: {
			sales: sales.data!.items,
			salesTotal: sales.data!.total,
			installments: installments.data!.items,
			installmentsTotal: installments.data!.total
		},
		error: null
	};
}

/** Pending/overdue installments of active sales made through a collector (bounded record view). */
export async function listCollectorPendingInstallments(
	supabase: SupabaseClient,
	campaignId: string,
	collectorId: string,
	limit = RECORD_LIST_LIMIT
): Promise<RepositoryResult<{ items: RecordInstallment[]; total: number }>> {
	return listOpenInstallments(supabase, campaignId, { collectorId }, limit);
}
