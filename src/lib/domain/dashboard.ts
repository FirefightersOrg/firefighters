/**
 * Campaign dashboard (pure, client-safe). SAN-85.
 *
 * The SQL `report_*` functions aggregate; this module only combines their rows into the figures
 * the dashboard shows. Amounts are canonical decimal strings summed in cents, never as floats.
 */
import type { BondsByStatusRow, InstallmentBucket } from './reports';
import { sumAmounts, todayInBuenosAires } from './reports';
import type {
	CollectorAccountRow,
	PaymentsByDateRow,
	SettlementsByCollectorRow
} from './financial-reports';
import { pivotPaymentsByDate, sumSignedAmounts } from './financial-reports';

export interface BondCounts {
	/** Every bond of the campaign except annulled ones. */
	total: number;
	/** Sold (a closed bond was sold). */
	sold: number;
	/** Available to deliver to a collector. */
	available: number;
	/** With a collector and not sold yet. */
	delivered: number;
	returned: number;
	annulled: number;
}

export function summarizeBonds(rows: readonly BondsByStatusRow[]): BondCounts {
	const count = (...statuses: string[]) =>
		rows.filter((r) => statuses.includes(r.commercialStatus)).reduce((n, r) => n + r.bondCount, 0);
	const all = rows.reduce((n, r) => n + r.bondCount, 0);
	return {
		total: all - count('annulled'),
		sold: count('sold', 'closed'),
		available: count('available'),
		delivered: count('delivered_to_collector'),
		returned: count('returned'),
		annulled: count('annulled')
	};
}

export interface RevenueSummary {
	expected: string;
	collected: string;
	pending: string;
	overdue: string;
	/** Collected over expected, 0 to 100 (whole percent, rounded down). */
	collectedPercent: number;
}

const toCents = (value: string) => Math.round(Number(value) * 100);

/** Installments of active sales by bucket (summed over collectors). */
export function summarizeRevenue(
	rows: readonly { bucket: InstallmentBucket; amount: string }[]
): RevenueSummary {
	const of = (...buckets: InstallmentBucket[]) =>
		sumAmounts(rows.filter((r) => buckets.includes(r.bucket)).map((r) => r.amount));
	const expected = of('pending', 'overdue', 'paid', 'advance');
	const collected = of('paid', 'advance');
	const expectedCents = toCents(expected);
	return {
		expected,
		collected,
		pending: of('pending', 'overdue'),
		overdue: of('overdue'),
		collectedPercent: expectedCents > 0 ? Math.floor((toCents(collected) * 100) / expectedCents) : 0
	};
}

export interface CashSummary {
	cash: string;
	transfer: string;
	total: string;
}

/** Confirmed payments (drafts and annulled ones are excluded by the SQL function). */
export function summarizeCash(rows: readonly PaymentsByDateRow[]): CashSummary {
	const { totals } = pivotPaymentsByDate(rows);
	return { cash: totals.cash, transfer: totals.transfer, total: totals.total };
}

export interface CommissionSummary {
	/** Commission of the closed settlements (generated). */
	generated: string;
	/** Commission already paid out (settled). */
	settled: string;
	/** Generated and not yet paid out. */
	pending: string;
	closedSettlements: number;
	openSettlements: number;
	/** Cash and transfer handed in through the closed settlements. */
	settledCash: string;
	settledTransfer: string;
}

/** Closed and corrected settlements count as rendered; open ones are only counted. */
const RENDERED_STATUSES = ['closed', 'corrected'];

export function summarizeCommissions(
	rows: readonly SettlementsByCollectorRow[]
): CommissionSummary {
	const rendered = rows.filter((r) => RENDERED_STATUSES.includes(r.status));
	const generated = sumSignedAmounts(rendered.map((r) => r.commissionAmount));
	const settled = sumSignedAmounts(rendered.map((r) => r.commissionPaidAmount));
	return {
		generated,
		settled,
		pending: centsToSigned(toCents(generated) - toCents(settled)),
		closedSettlements: rendered.reduce((n, r) => n + r.settlementCount, 0),
		openSettlements: rows
			.filter((r) => r.status === 'open')
			.reduce((n, r) => n + r.settlementCount, 0),
		settledCash: sumSignedAmounts(rendered.map((r) => r.totalCash)),
		settledTransfer: sumSignedAmounts(rendered.map((r) => r.totalTransfer))
	};
}

function centsToSigned(cents: number): string {
	const abs = Math.abs(cents);
	const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
	return cents < 0 ? `-${text}` : text;
}

export interface BalanceSummary {
	/** Collectors with a positive balance (the institution owes them commission). */
	creditors: number;
	/** Net balance of every collector account. */
	net: string;
	/** Largest balances by absolute value, for the summary table. */
	top: CollectorAccountRow[];
}

export const TOP_BALANCES = 5;

export function summarizeBalances(rows: readonly CollectorAccountRow[]): BalanceSummary {
	return {
		creditors: rows.filter((r) => toCents(r.balance) > 0).length,
		net: sumSignedAmounts(rows.map((r) => r.balance)),
		top: [...rows]
			.sort(
				(a, b) =>
					Math.abs(toCents(b.balance)) - Math.abs(toCents(a.balance)) ||
					a.collectorName.localeCompare(b.collectorName)
			)
			.slice(0, TOP_BALANCES)
	};
}

export interface Countdown {
	state: 'upcoming' | 'today' | 'passed';
	/** Whole calendar days to the cutoff day (Buenos Aires); 0 when today or passed. */
	days: number;
}

const DAY_MS = 86_400_000;
const dayNumber = (isoDate: string) => Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS);

/** Calendar countdown to the cutoff day (inclusive: payments of that day still count). */
export function cutoffCountdown(cutoffAt: string, now: Date = new Date()): Countdown {
	const diff =
		dayNumber(todayInBuenosAires(new Date(cutoffAt))) - dayNumber(todayInBuenosAires(now));
	if (diff < 0) return { state: 'passed', days: 0 };
	if (diff === 0) return { state: 'today', days: 0 };
	return { state: 'upcoming', days: diff };
}

export interface NextDraw {
	id: string;
	name: string;
	type: string;
	drawDate: string;
	paymentCutoffAt: string;
	requiredInstallmentNumber: number | null;
	status: string;
	atRiskCount: number;
}

export interface AtRiskBond {
	bondId: string;
	kind: string;
	baseNumber: number | null;
	collectorId: string | null;
	collectorName: string | null;
	missingInstallments: number;
	requiredInstallments: number | null;
	totalCount: number;
}

/** Rows of the at-risk list shown on the dashboard. */
export const AT_RISK_LIMIT = 25;

/** Spanish names of the draw types for the dashboard (docs/copy.md). */
export const DRAW_TYPE_LABELS_ES: Record<string, string> = {
	monthly: 'Sorteo mensual',
	extraordinary_full_payment: 'Sorteo extraordinario por pago total',
	final: 'Sorteo final',
	consolation: 'Sorteo de consuelo'
};

/** What the dashboard says about the cutoff of the next draw. */
export function countdownLabel(countdown: Countdown): string {
	if (countdown.state === 'passed') return 'La fecha de corte ya pasó';
	if (countdown.state === 'today') return 'La fecha de corte es hoy';
	return countdown.days === 1
		? 'Falta 1 día para la fecha de corte'
		: `Faltan ${countdown.days} días para la fecha de corte`;
}
