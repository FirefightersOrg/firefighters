/**
 * Operational reports (SAN-86): calls the read-only `report_*` SQL functions. Each function
 * checks `report.view_operational` and aggregates in SQL, so no PostgREST row cap applies.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
	BondsByCollectorRow,
	BondsByStatusRow,
	CollectorMonthlyRow,
	InstallmentBucket,
	InstallmentBucketRow,
	ReportFilters
} from '$lib/domain/reports';
import { monthStart } from '$lib/domain/reports';
import type { RepositoryResult } from './campaigns';

type Raw = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? '0.00');

async function call(
	supabase: SupabaseClient,
	fn: string,
	args: Record<string, unknown>
): Promise<RepositoryResult<Raw[]>> {
	const { data, error } = await supabase.rpc(fn, args);
	if (error) return { data: null, error };
	return { data: (data ?? []) as Raw[], error: null };
}

function mapRows<T>(result: RepositoryResult<Raw[]>, map: (row: Raw) => T): RepositoryResult<T[]> {
	return result.error
		? { data: null, error: result.error }
		: { data: result.data.map(map), error: null };
}

const bondArgs = (campaignId: string, f: ReportFilters) => ({
	p_campaign_id: campaignId,
	p_collector_id: f.collectorId,
	p_kind: f.kind,
	p_commercial_status: f.commercialStatus,
	p_financial_status: f.financialStatus
});

export async function getBondsByStatus(
	supabase: SupabaseClient,
	campaignId: string,
	filters: ReportFilters
): Promise<RepositoryResult<BondsByStatusRow[]>> {
	return mapRows(
		await call(supabase, 'report_bonds_by_status', bondArgs(campaignId, filters)),
		(r) => ({
			commercialStatus: String(r.commercial_status),
			financialStatus: String(r.financial_status),
			bondCount: num(r.bond_count),
			totalValue: str(r.total_value)
		})
	);
}

export async function getBondsByCollector(
	supabase: SupabaseClient,
	campaignId: string,
	filters: ReportFilters
): Promise<RepositoryResult<BondsByCollectorRow[]>> {
	return mapRows(
		await call(supabase, 'report_bonds_by_collector', bondArgs(campaignId, filters)),
		(r) => ({
			collectorId: (r.collector_id as string | null) ?? null,
			collectorName: (r.collector_name as string | null) ?? null,
			bondCount: num(r.bond_count),
			deliveredCount: num(r.delivered_count),
			soldCount: num(r.sold_count),
			returnedCount: num(r.returned_count),
			totalValue: str(r.total_value),
			soldValue: str(r.sold_value)
		})
	);
}

export async function getInstallmentsReport(
	supabase: SupabaseClient,
	campaignId: string,
	filters: ReportFilters
): Promise<RepositoryResult<InstallmentBucketRow[]>> {
	return mapRows(
		await call(supabase, 'report_installments', {
			p_campaign_id: campaignId,
			p_collector_id: filters.collectorId,
			p_kind: filters.kind,
			p_from: filters.from,
			p_to: filters.to
		}),
		(r) => ({
			collectorId: String(r.collector_id),
			collectorName: String(r.collector_name),
			bucket: String(r.bucket) as InstallmentBucket,
			installmentCount: num(r.installment_count),
			amount: str(r.amount)
		})
	);
}

export async function getCollectorMonthly(
	supabase: SupabaseClient,
	campaignId: string,
	filters: ReportFilters
): Promise<RepositoryResult<CollectorMonthlyRow[]>> {
	return mapRows(
		await call(supabase, 'report_collector_monthly', {
			p_campaign_id: campaignId,
			p_month: monthStart(filters.month),
			p_collector_id: filters.collectorId
		}),
		(r) => ({
			collectorId: String(r.collector_id),
			collectorName: String(r.collector_name),
			assignedBonds: num(r.assigned_bonds),
			soldBonds: num(r.sold_bonds),
			soldValue: str(r.sold_value),
			pendingInstallments: num(r.pending_installments),
			pendingAmount: str(r.pending_amount),
			overdueInstallments: num(r.overdue_installments),
			overdueAmount: str(r.overdue_amount),
			paymentsCount: num(r.payments_count),
			paymentsTotal: str(r.payments_total),
			paymentsCash: str(r.payments_cash),
			paymentsTransfer: str(r.payments_transfer)
		})
	);
}
