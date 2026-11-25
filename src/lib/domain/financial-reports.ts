/**
 * Financial and draw reports (pure, client-safe). SAN-87.
 *
 * The SQL functions `report_*` do the aggregation; this module parses the filters, types the rows
 * and builds the totals. Amounts are canonical decimal strings (balances may carry a leading `-`)
 * and are summed in cents, never as floats. Dates are Buenos Aires calendar dates.
 */
import { z } from 'zod';
import { isValidDate } from './reports';
import { formatMoney, parseMoneyToCents, centsToDecimalString } from './money';

export const PAYMENT_METHODS = ['cash', 'transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
	cash: 'Cash',
	transfer: 'Transfer'
};

export const SETTLEMENT_STATUSES = ['open', 'closed', 'corrected', 'annulled'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
	open: 'Open',
	closed: 'Closed',
	corrected: 'Corrected',
	annulled: 'Annulled'
};

export const ROSTER_ELIGIBILITY_FILTERS = ['eligible', 'ineligible'] as const;
export type RosterEligibilityFilter = (typeof ROSTER_ELIGIBILITY_FILTERS)[number];

/** Rows of the roster the page shows (the full roster goes to the export). */
export const ROSTER_PAGE_LIMIT = 500;
/** Must not exceed PostgREST `max_rows` (1000 in supabase/config.toml). */
export const REPORT_PAGE_SIZE = 1000;

export interface FinancialFilters {
	collectorId: string | null;
	method: PaymentMethod | null;
	settlementStatus: SettlementStatus | null;
	/** Date range (inclusive, `YYYY-MM-DD`): payment date, settlement opening, ledger date. */
	from: string | null;
	to: string | null;
	drawId: string | null;
	eligibility: RosterEligibilityFilter | null;
	prizeStatus: string | null;
}

export type FinancialFilterResult =
	{ ok: true; filters: FinancialFilters } | { ok: false; message: string };

const PRIZE_STATUS_VALUES = [
	'pending_validation',
	'awarded',
	'pending_delivery',
	'delivered',
	'unawarded',
	'annulled'
];

/** Parses the query string of the financial reports page and the exports. Empty = no filter. */
export function parseFinancialFilters(params: URLSearchParams): FinancialFilterResult {
	const text = (name: string) => params.get(name)?.trim() || null;
	const guid = (name: string) => {
		const value = text(name);
		return value && !z.guid().safeParse(value).success ? undefined : value;
	};
	const collectorId = guid('collector');
	if (collectorId === undefined) return { ok: false, message: 'Invalid collector filter.' };
	const drawId = guid('draw');
	if (drawId === undefined) return { ok: false, message: 'Invalid draw filter.' };
	const method = text('method');
	if (method && !(PAYMENT_METHODS as readonly string[]).includes(method)) {
		return { ok: false, message: 'Invalid payment method filter.' };
	}
	const settlementStatus = text('settlement');
	if (settlementStatus && !(SETTLEMENT_STATUSES as readonly string[]).includes(settlementStatus)) {
		return { ok: false, message: 'Invalid settlement status filter.' };
	}
	const eligibility = text('eligibility');
	if (eligibility && !(ROSTER_ELIGIBILITY_FILTERS as readonly string[]).includes(eligibility)) {
		return { ok: false, message: 'Invalid eligibility filter.' };
	}
	const prizeStatus = text('prize');
	if (prizeStatus && !PRIZE_STATUS_VALUES.includes(prizeStatus)) {
		return { ok: false, message: 'Invalid prize status filter.' };
	}
	const from = text('from');
	const to = text('to');
	if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
		return { ok: false, message: 'Invalid date range: use YYYY-MM-DD.' };
	}
	if (from && to && from > to) {
		return { ok: false, message: 'Invalid date range: from is after to.' };
	}
	return {
		ok: true,
		filters: {
			collectorId,
			method: method as PaymentMethod | null,
			settlementStatus: settlementStatus as SettlementStatus | null,
			from,
			to,
			drawId,
			eligibility: eligibility as RosterEligibilityFilter | null,
			prizeStatus
		}
	};
}

// ---------------------------------------------------------------------------
// Rows returned by the SQL functions (camelCase, amounts as canonical strings)
// ---------------------------------------------------------------------------

export interface PaymentsByDateRow {
	paymentDate: string;
	paymentMethod: string;
	paymentCount: number;
	total: string;
}

export interface SettlementsByCollectorRow {
	collectorId: string;
	collectorName: string;
	status: string;
	settlementCount: number;
	totalCash: string;
	totalTransfer: string;
	totalAmount: string;
	commissionAmount: string;
	commissionPaidAmount: string;
	netToFirefighters: string;
}

export interface CollectorAccountRow {
	collectorId: string;
	collectorName: string;
	entryCount: number;
	creditTotal: string;
	debitTotal: string;
	balance: string;
	lastEntryOn: string | null;
}

export interface CollectorLedgerRow {
	entryId: string;
	occurredOn: string;
	occurredTime: string;
	entryType: string;
	direction: string;
	amount: string;
	status: string;
	settlementNumber: number | null;
	reason: string | null;
	runningBalance: string;
	/** False for reference entries (SAN-107), which do not move the running balance. */
	affectsBalance: boolean;
}

export interface DrawRosterSummaryRow {
	drawId: string;
	drawName: string;
	drawType: string;
	drawDate: string;
	drawStatus: string;
	rosterStatus: string | null;
	eligibleCount: number;
	ineligibleCount: number;
}

export interface DrawRosterEntryRow {
	numberValue: number;
	eligible: boolean;
	ineligibilityReason: string | null;
	buyerName: string | null;
	collectorName: string | null;
}

export interface PrizeReportRow {
	prizeId: string;
	drawId: string;
	drawName: string;
	drawDate: string;
	position: number;
	prizeName: string;
	prizeStatus: string;
	winningNumber: number | null;
	resultStatus: string | null;
	buyerName: string | null;
	collectorName: string | null;
	awardStatus: string | null;
	awardedOn: string | null;
	deliveredOn: string | null;
}

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

function signedCents(value: string): number {
	const negative = value.startsWith('-');
	const cents = parseMoneyToCents(negative ? value.slice(1) : value);
	if (cents === null) throw new RangeError(`Invalid amount: ${value}`);
	return negative ? -cents : cents;
}

function signedString(cents: number): string {
	return cents < 0 ? `-${centsToDecimalString(-cents)}` : centsToDecimalString(cents);
}

/** Sum of canonical amounts that may be negative (balances), exact to the cent. */
export function sumSignedAmounts(values: readonly string[]): string {
	return signedString(values.reduce((cents, v) => cents + signedCents(v), 0));
}

/** Display format of a canonical amount that may be negative (`-5.5` -> `-$ 5,50`). */
export function formatSignedMoney(value: string): string {
	return value.startsWith('-') ? `-${formatMoney(value.slice(1))}` : formatMoney(value);
}

export interface PaymentsByDateDay {
	paymentDate: string;
	cash: string;
	transfer: string;
	total: string;
	count: number;
}

/** One row per day with the cash and transfer split, plus the grand totals. */
export function pivotPaymentsByDate(rows: readonly PaymentsByDateRow[]) {
	const byDay = new Map<string, PaymentsByDateDay>();
	for (const row of rows) {
		const day = byDay.get(row.paymentDate) ?? {
			paymentDate: row.paymentDate,
			cash: '0.00',
			transfer: '0.00',
			total: '0.00',
			count: 0
		};
		if (row.paymentMethod === 'cash') day.cash = sumSignedAmounts([day.cash, row.total]);
		else day.transfer = sumSignedAmounts([day.transfer, row.total]);
		day.total = sumSignedAmounts([day.total, row.total]);
		day.count += row.paymentCount;
		byDay.set(row.paymentDate, day);
	}
	const days = [...byDay.values()].sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));
	return {
		days,
		totals: {
			cash: sumSignedAmounts(days.map((d) => d.cash)),
			transfer: sumSignedAmounts(days.map((d) => d.transfer)),
			total: sumSignedAmounts(days.map((d) => d.total)),
			count: days.reduce((n, d) => n + d.count, 0)
		}
	};
}

export function totalSettlements(rows: readonly SettlementsByCollectorRow[]) {
	return {
		settlementCount: rows.reduce((n, r) => n + r.settlementCount, 0),
		totalCash: sumSignedAmounts(rows.map((r) => r.totalCash)),
		totalTransfer: sumSignedAmounts(rows.map((r) => r.totalTransfer)),
		totalAmount: sumSignedAmounts(rows.map((r) => r.totalAmount)),
		commissionAmount: sumSignedAmounts(rows.map((r) => r.commissionAmount)),
		commissionPaidAmount: sumSignedAmounts(rows.map((r) => r.commissionPaidAmount)),
		netToFirefighters: sumSignedAmounts(rows.map((r) => r.netToFirefighters))
	};
}

export function totalCollectorAccounts(rows: readonly CollectorAccountRow[]) {
	return {
		entryCount: rows.reduce((n, r) => n + r.entryCount, 0),
		creditTotal: sumSignedAmounts(rows.map((r) => r.creditTotal)),
		debitTotal: sumSignedAmounts(rows.map((r) => r.debitTotal)),
		balance: sumSignedAmounts(rows.map((r) => r.balance))
	};
}

/** Prize counts by status (annulled prizes are listed but never count as won). */
export function countPrizesByStatus(rows: readonly PrizeReportRow[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const row of rows) counts[row.prizeStatus] = (counts[row.prizeStatus] ?? 0) + 1;
	return counts;
}
