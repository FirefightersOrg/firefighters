/**
 * Financial and draw reports (SAN-87): calls the read-only `report_*` SQL functions. Each function
 * checks `report.view_financial` and aggregates in SQL. The two row-level reports (collector
 * ledger and roster entries) are paged with `p_limit`/`p_offset`, so no PostgREST row cap hides
 * rows: the page asks for one limited slice, the export reads every page.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	REPORT_PAGE_SIZE,
	type CollectorAccountRow,
	type CollectorLedgerRow,
	type DrawRosterEntryRow,
	type DrawRosterSummaryRow,
	type FinancialFilters,
	type PaymentsByDateRow,
	type PrizeReportRow,
	type SettlementsByCollectorRow
} from '$lib/domain/financial-reports';
import type { RepositoryResult } from './campaigns';

type Raw = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? '0.00');
const optStr = (v: unknown) => (v === null || v === undefined ? null : String(v));

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

/** Reads every page of a paged report function until a short page. */
async function callAll(
	supabase: SupabaseClient,
	fn: string,
	args: Record<string, unknown>
): Promise<RepositoryResult<Raw[]>> {
	const all: Raw[] = [];
	for (let offset = 0; ; offset += REPORT_PAGE_SIZE) {
		const page = await call(supabase, fn, { ...args, p_limit: REPORT_PAGE_SIZE, p_offset: offset });
		if (page.error) return page;
		all.push(...page.data);
		if (page.data.length < REPORT_PAGE_SIZE) return { data: all, error: null };
	}
}

export async function getPaymentsByDate(
	supabase: SupabaseClient,
	campaignId: string,
	f: FinancialFilters
): Promise<RepositoryResult<PaymentsByDateRow[]>> {
	return mapRows(
		await call(supabase, 'report_payments_by_date', {
			p_campaign_id: campaignId,
			p_collector_id: f.collectorId,
			p_method: f.method,
			p_from: f.from,
			p_to: f.to
		}),
		(r) => ({
			paymentDate: String(r.payment_date),
			paymentMethod: String(r.payment_method),
			paymentCount: num(r.payment_count),
			total: str(r.total)
		})
	);
}

export async function getSettlementsByCollector(
	supabase: SupabaseClient,
	campaignId: string,
	f: FinancialFilters
): Promise<RepositoryResult<SettlementsByCollectorRow[]>> {
	return mapRows(
		await call(supabase, 'report_settlements_by_collector', {
			p_campaign_id: campaignId,
			p_collector_id: f.collectorId,
			p_status: f.settlementStatus,
			p_from: f.from,
			p_to: f.to
		}),
		(r) => ({
			collectorId: String(r.collector_id),
			collectorName: String(r.collector_name),
			status: String(r.status),
			settlementCount: num(r.settlement_count),
			totalCash: str(r.total_cash),
			totalTransfer: str(r.total_transfer),
			totalAmount: str(r.total_amount),
			commissionAmount: str(r.commission_amount),
			commissionPaidAmount: str(r.commission_paid_amount),
			netToFirefighters: str(r.net_to_firefighters)
		})
	);
}

export async function getCollectorAccounts(
	supabase: SupabaseClient,
	campaignId: string,
	f: FinancialFilters
): Promise<RepositoryResult<CollectorAccountRow[]>> {
	return mapRows(
		await call(supabase, 'report_collector_accounts', {
			p_campaign_id: campaignId,
			p_collector_id: f.collectorId
		}),
		(r) => ({
			collectorId: String(r.collector_id),
			collectorName: String(r.collector_name),
			entryCount: num(r.entry_count),
			creditTotal: str(r.credit_total),
			debitTotal: str(r.debit_total),
			balance: str(r.balance),
			lastEntryOn: optStr(r.last_entry_on)
		})
	);
}

const mapLedger = (r: Raw): CollectorLedgerRow => ({
	entryId: String(r.entry_id),
	occurredOn: String(r.occurred_on),
	occurredTime: String(r.occurred_time),
	entryType: String(r.entry_type),
	direction: String(r.direction),
	amount: str(r.amount),
	status: String(r.status),
	settlementNumber: r.settlement_number === null ? null : num(r.settlement_number),
	reason: optStr(r.reason),
	runningBalance: str(r.running_balance),
	affectsBalance: r.affects_balance !== false
});

export async function getCollectorLedger(
	supabase: SupabaseClient,
	campaignId: string,
	collectorId: string,
	f: FinancialFilters,
	limit: number | 'all'
): Promise<RepositoryResult<CollectorLedgerRow[]>> {
	const args = {
		p_campaign_id: campaignId,
		p_collector_id: collectorId,
		p_from: f.from,
		p_to: f.to
	};
	const result =
		limit === 'all'
			? await callAll(supabase, 'report_collector_ledger', args)
			: await call(supabase, 'report_collector_ledger', { ...args, p_limit: limit, p_offset: 0 });
	return mapRows(result, mapLedger);
}

export async function getDrawRosters(
	supabase: SupabaseClient,
	campaignId: string,
	drawId: string | null
): Promise<RepositoryResult<DrawRosterSummaryRow[]>> {
	return mapRows(
		await call(supabase, 'report_draw_rosters', { p_campaign_id: campaignId, p_draw_id: drawId }),
		(r) => ({
			drawId: String(r.draw_id),
			drawName: String(r.draw_name),
			drawType: String(r.draw_type),
			drawDate: String(r.draw_date),
			drawStatus: String(r.draw_status),
			rosterStatus: optStr(r.roster_status),
			eligibleCount: num(r.eligible_count),
			ineligibleCount: num(r.ineligible_count)
		})
	);
}

const mapEntry = (r: Raw): DrawRosterEntryRow => ({
	numberValue: num(r.number_value),
	eligible: r.eligible === true,
	ineligibilityReason: optStr(r.ineligibility_reason),
	buyerName: optStr(r.buyer_name),
	collectorName: optStr(r.collector_name)
});

export async function getDrawRosterEntries(
	supabase: SupabaseClient,
	campaignId: string,
	drawId: string,
	f: FinancialFilters,
	limit: number | 'all'
): Promise<RepositoryResult<DrawRosterEntryRow[]>> {
	const args = {
		p_campaign_id: campaignId,
		p_draw_id: drawId,
		p_eligible: f.eligibility === null ? null : f.eligibility === 'eligible'
	};
	const result =
		limit === 'all'
			? await callAll(supabase, 'report_draw_roster_entries', args)
			: await call(supabase, 'report_draw_roster_entries', {
					...args,
					p_limit: limit,
					p_offset: 0
				});
	return mapRows(result, mapEntry);
}

export async function getPrizesReport(
	supabase: SupabaseClient,
	campaignId: string,
	f: FinancialFilters
): Promise<RepositoryResult<PrizeReportRow[]>> {
	return mapRows(
		await call(supabase, 'report_prizes', {
			p_campaign_id: campaignId,
			p_draw_id: f.drawId,
			p_status: f.prizeStatus
		}),
		(r) => ({
			prizeId: String(r.prize_id),
			drawId: String(r.draw_id),
			drawName: String(r.draw_name),
			drawDate: String(r.draw_date),
			position: num(r.prize_position),
			prizeName: String(r.prize_name),
			prizeStatus: String(r.prize_status),
			winningNumber: r.winning_number === null ? null : num(r.winning_number),
			resultStatus: optStr(r.result_status),
			buyerName: optStr(r.buyer_name),
			collectorName: optStr(r.collector_name),
			awardStatus: optStr(r.award_status),
			awardedOn: optStr(r.awarded_on),
			deliveredOn: optStr(r.delivered_on)
		})
	);
}
