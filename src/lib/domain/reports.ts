/**
 * Operational reports (pure, client-safe). SAN-86.
 *
 * The SQL functions `report_*` do the aggregation; this module parses the filters of the page
 * and combines the returned rows (totals, pivots). Amounts are canonical decimal strings and are
 * summed in cents, never as floats. Months and dates are Buenos Aires calendar dates.
 */
import { z } from 'zod';
import {
	BOND_COMMERCIAL_STATUSES,
	BOND_FINANCIAL_STATUSES,
	BOND_KINDS,
	type BondCommercialStatus,
	type BondKind
} from './bonds';
import type { FinancialStatus } from './financial-status';
import { centsToDecimalString, parseMoneyToCents } from './money';

export const BUENOS_AIRES_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export interface ReportFilters {
	collectorId: string | null;
	kind: BondKind | null;
	commercialStatus: BondCommercialStatus | null;
	financialStatus: FinancialStatus | null;
	/** `YYYY-MM`: the month of the monthly summary (defaults to the current month). */
	month: string;
	/** Due-date range of the installments report (inclusive, `YYYY-MM-DD`). */
	from: string | null;
	to: string | null;
}

export type ReportFilterResult =
	{ ok: true; filters: ReportFilters } | { ok: false; message: string };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar date in Buenos Aires (`YYYY-MM-DD`). */
export function todayInBuenosAires(now: Date = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: BUENOS_AIRES_TIME_ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(now);
}

export function isValidDate(value: string): boolean {
	if (!DATE.test(value)) return false;
	const d = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** First day of a `YYYY-MM` month, as the date the SQL functions take. */
export function monthStart(month: string): string {
	return `${month}-01`;
}

/** Parses the query string of the reports page. Empty values mean "no filter". */
export function parseReportFilters(params: URLSearchParams, today: string): ReportFilterResult {
	const text = (name: string) => params.get(name)?.trim() || null;
	const collectorId = text('collector');
	if (collectorId && !z.guid().safeParse(collectorId).success) {
		return { ok: false, message: 'Invalid collector filter.' };
	}
	const kind = text('kind');
	if (kind && !(BOND_KINDS as readonly string[]).includes(kind)) {
		return { ok: false, message: 'Invalid bond type filter.' };
	}
	const commercialStatus = text('status');
	if (
		commercialStatus &&
		!(BOND_COMMERCIAL_STATUSES as readonly string[]).includes(commercialStatus)
	) {
		return { ok: false, message: 'Invalid commercial status filter.' };
	}
	const financialStatus = text('financial');
	if (
		financialStatus &&
		!(BOND_FINANCIAL_STATUSES as readonly string[]).includes(financialStatus)
	) {
		return { ok: false, message: 'Invalid financial status filter.' };
	}
	const month = text('month') ?? today.slice(0, 7);
	if (!MONTH.test(month)) return { ok: false, message: 'Invalid month: use YYYY-MM.' };
	const from = text('from');
	const to = text('to');
	if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
		return { ok: false, message: 'Invalid date range: use YYYY-MM-DD.' };
	}
	if (from && to && from > to)
		return { ok: false, message: 'Invalid date range: from is after to.' };
	return {
		ok: true,
		filters: {
			collectorId,
			kind: kind as BondKind | null,
			commercialStatus: commercialStatus as BondCommercialStatus | null,
			financialStatus: financialStatus as FinancialStatus | null,
			month,
			from,
			to
		}
	};
}

// ---------------------------------------------------------------------------
// Rows returned by the SQL functions (camelCase, amounts as canonical strings)
// ---------------------------------------------------------------------------

export interface BondsByStatusRow {
	commercialStatus: string;
	financialStatus: string;
	bondCount: number;
	totalValue: string;
}

export interface BondsByCollectorRow {
	collectorId: string | null;
	collectorName: string | null;
	bondCount: number;
	deliveredCount: number;
	soldCount: number;
	returnedCount: number;
	totalValue: string;
	soldValue: string;
}

export const INSTALLMENT_BUCKETS = ['pending', 'overdue', 'paid', 'advance'] as const;
export type InstallmentBucket = (typeof INSTALLMENT_BUCKETS)[number];

export const INSTALLMENT_BUCKET_LABELS: Record<InstallmentBucket, string> = {
	pending: 'Pendientes',
	overdue: 'Vencidas',
	paid: 'Pagadas',
	advance: 'Pagadas por adelantado'
};

export interface InstallmentBucketRow {
	collectorId: string;
	collectorName: string;
	bucket: InstallmentBucket;
	installmentCount: number;
	amount: string;
}

export interface CollectorMonthlyRow {
	collectorId: string;
	collectorName: string;
	assignedBonds: number;
	soldBonds: number;
	soldValue: string;
	pendingInstallments: number;
	pendingAmount: string;
	overdueInstallments: number;
	overdueAmount: string;
	paymentsCount: number;
	paymentsTotal: string;
	paymentsCash: string;
	paymentsTransfer: string;
}

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

/** Sum of canonical amounts, exact to the cent. A malformed amount throws (never hidden). */
export function sumAmounts(values: readonly string[]): string {
	let cents = 0;
	for (const value of values) {
		const parsed = parseMoneyToCents(value);
		if (parsed === null) throw new RangeError(`Invalid amount: ${value}`);
		cents += parsed;
	}
	return centsToDecimalString(cents);
}

export interface StatusMatrix {
	commercialStatuses: string[];
	financialStatuses: string[];
	/** `cells[commercial][financial]` = count (missing = 0). */
	cells: Record<string, Record<string, number>>;
	commercialTotals: Record<string, { bondCount: number; totalValue: string }>;
	financialTotals: Record<string, number>;
	bondCount: number;
	totalValue: string;
}

/** Pivots the bonds-by-status rows: commercial status down, financial status across, in catalog order. */
export function buildStatusMatrix(rows: readonly BondsByStatusRow[]): StatusMatrix {
	const commercialStatuses = BOND_COMMERCIAL_STATUSES.filter((s) =>
		rows.some((r) => r.commercialStatus === s)
	) as string[];
	const financialStatuses = BOND_FINANCIAL_STATUSES.filter((s) =>
		rows.some((r) => r.financialStatus === s)
	) as string[];
	const cells: StatusMatrix['cells'] = {};
	const financialTotals: Record<string, number> = {};
	const valuesByCommercial: Record<string, string[]> = {};
	const countByCommercial: Record<string, number> = {};
	for (const row of rows) {
		(cells[row.commercialStatus] ??= {})[row.financialStatus] = row.bondCount;
		financialTotals[row.financialStatus] =
			(financialTotals[row.financialStatus] ?? 0) + row.bondCount;
		(valuesByCommercial[row.commercialStatus] ??= []).push(row.totalValue);
		countByCommercial[row.commercialStatus] =
			(countByCommercial[row.commercialStatus] ?? 0) + row.bondCount;
	}
	const commercialTotals: StatusMatrix['commercialTotals'] = {};
	for (const status of commercialStatuses) {
		commercialTotals[status] = {
			bondCount: countByCommercial[status] ?? 0,
			totalValue: sumAmounts(valuesByCommercial[status] ?? [])
		};
	}
	return {
		commercialStatuses,
		financialStatuses,
		cells,
		commercialTotals,
		financialTotals,
		bondCount: rows.reduce((n, r) => n + r.bondCount, 0),
		totalValue: sumAmounts(rows.map((r) => r.totalValue))
	};
}

export interface BondsByCollectorTotals {
	bondCount: number;
	deliveredCount: number;
	soldCount: number;
	returnedCount: number;
	totalValue: string;
	soldValue: string;
}

export function totalBondsByCollector(
	rows: readonly BondsByCollectorRow[]
): BondsByCollectorTotals {
	return {
		bondCount: rows.reduce((n, r) => n + r.bondCount, 0),
		deliveredCount: rows.reduce((n, r) => n + r.deliveredCount, 0),
		soldCount: rows.reduce((n, r) => n + r.soldCount, 0),
		returnedCount: rows.reduce((n, r) => n + r.returnedCount, 0),
		totalValue: sumAmounts(rows.map((r) => r.totalValue)),
		soldValue: sumAmounts(rows.map((r) => r.soldValue))
	};
}

export interface InstallmentCell {
	count: number;
	amount: string;
}
export interface InstallmentsByCollector {
	collectorId: string;
	collectorName: string;
	buckets: Record<InstallmentBucket, InstallmentCell>;
}

const emptyBuckets = (): Record<InstallmentBucket, InstallmentCell> => ({
	pending: { count: 0, amount: '0.00' },
	overdue: { count: 0, amount: '0.00' },
	paid: { count: 0, amount: '0.00' },
	advance: { count: 0, amount: '0.00' }
});

/** One row per collector with the four buckets (zero when absent), plus the grand totals. */
export function pivotInstallments(rows: readonly InstallmentBucketRow[]): {
	collectors: InstallmentsByCollector[];
	totals: Record<InstallmentBucket, InstallmentCell>;
} {
	const byCollector = new Map<string, InstallmentsByCollector>();
	for (const row of rows) {
		let entry = byCollector.get(row.collectorId);
		if (!entry) {
			entry = {
				collectorId: row.collectorId,
				collectorName: row.collectorName,
				buckets: emptyBuckets()
			};
			byCollector.set(row.collectorId, entry);
		}
		const cell = entry.buckets[row.bucket];
		entry.buckets[row.bucket] = {
			count: cell.count + row.installmentCount,
			amount: sumAmounts([cell.amount, row.amount])
		};
	}
	const collectors = [...byCollector.values()];
	const totals = emptyBuckets();
	for (const bucket of INSTALLMENT_BUCKETS) {
		totals[bucket] = {
			count: collectors.reduce((n, c) => n + c.buckets[bucket].count, 0),
			amount: sumAmounts(collectors.map((c) => c.buckets[bucket].amount))
		};
	}
	return { collectors, totals };
}

export function totalCollectorMonthly(rows: readonly CollectorMonthlyRow[]) {
	return {
		assignedBonds: rows.reduce((n, r) => n + r.assignedBonds, 0),
		soldBonds: rows.reduce((n, r) => n + r.soldBonds, 0),
		soldValue: sumAmounts(rows.map((r) => r.soldValue)),
		pendingInstallments: rows.reduce((n, r) => n + r.pendingInstallments, 0),
		pendingAmount: sumAmounts(rows.map((r) => r.pendingAmount)),
		overdueInstallments: rows.reduce((n, r) => n + r.overdueInstallments, 0),
		overdueAmount: sumAmounts(rows.map((r) => r.overdueAmount)),
		paymentsCount: rows.reduce((n, r) => n + r.paymentsCount, 0),
		paymentsTotal: sumAmounts(rows.map((r) => r.paymentsTotal)),
		paymentsCash: sumAmounts(rows.map((r) => r.paymentsCash)),
		paymentsTransfer: sumAmounts(rows.map((r) => r.paymentsTransfer))
	};
}

/** `2026-03` -> `March 2026`. */
export function formatMonthLabel(month: string): string {
	const [year, m] = month.split('-').map(Number);
	return new Intl.DateTimeFormat('es-AR', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(Date.UTC(year!, m! - 1, 1)));
}
