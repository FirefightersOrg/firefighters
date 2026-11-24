/**
 * Report exports (pure, client-safe). SAN-87.
 *
 * One definition per exportable report: the permission that views it, its file name and its
 * columns. CSV and Excel share the columns. Free-text columns are neutralized against formula
 * injection in both formats; amount, count and date columns are not text. Amounts stay canonical
 * strings in CSV (exact to the cent) and become numbers in Excel.
 */
import { BOND_COMMERCIAL_STATUS_LABELS, BOND_FINANCIAL_STATUS_LABELS } from './bonds';
import type { BondCommercialStatus, BondFinancialStatus } from './bonds';
import type { CsvColumn } from './csv-export';
import { DRAW_STATUS_LABELS, DRAW_TYPE_LABELS, type DrawStatus, type DrawType } from './draws';
import {
	PAYMENT_METHOD_LABELS,
	SETTLEMENT_STATUS_LABELS,
	type CollectorAccountRow,
	type CollectorLedgerRow,
	type DrawRosterEntryRow,
	type PaymentMethod,
	type PaymentsByDateRow,
	type PrizeReportRow,
	type SettlementsByCollectorRow,
	type SettlementStatus
} from './financial-reports';
import { LEDGER_DIRECTION_LABELS, LEDGER_ENTRY_TYPE_LABELS, LEDGER_STATUS_LABELS } from './ledger';
import type { LedgerDirection, LedgerEntryType, LedgerStatus } from './ledger';
import { PRIZE_STATUS_LABELS, WINNING_NUMBER_STATUS_LABELS } from './prizes';
import type { PrizeStatus, WinningNumberStatus } from './prizes';
import {
	INSTALLMENT_BUCKET_LABELS,
	type BondsByCollectorRow,
	type BondsByStatusRow,
	type CollectorMonthlyRow,
	type InstallmentBucketRow
} from './reports';

export interface ExportColumn<Row> extends CsvColumn<Row> {
	/** Amount or count: written as a number in Excel (never neutralized). */
	numeric?: boolean;
}

export const REPORT_EXPORT_KEYS = [
	'bonds-by-status',
	'bonds-by-collector',
	'installments',
	'collector-monthly',
	'payments-by-date',
	'settlements-by-collector',
	'collector-accounts',
	'collector-ledger',
	'draw-roster',
	'prizes'
] as const;
export type ReportExportKey = (typeof REPORT_EXPORT_KEYS)[number];

export const isReportExportKey = (value: string): value is ReportExportKey =>
	(REPORT_EXPORT_KEYS as readonly string[]).includes(value);

export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const isExportFormat = (value: string): value is ExportFormat =>
	(EXPORT_FORMATS as readonly string[]).includes(value);

export type ReportExportPermission = 'report.view_operational' | 'report.view_financial';

export interface ReportExportDefinition<Row> {
	title: string;
	permission: ReportExportPermission;
	columns: readonly ExportColumn<Row>[];
}

const label = <K extends string>(labels: Record<K, string>, value: string | null) =>
	value === null ? '' : (labels[value as K] ?? value);

const bondsByStatus: ReportExportDefinition<BondsByStatusRow> = {
	title: 'Bonds by status',
	permission: 'report.view_operational',
	columns: [
		{
			header: 'Commercial status',
			value: (r) => label<BondCommercialStatus>(BOND_COMMERCIAL_STATUS_LABELS, r.commercialStatus)
		},
		{
			header: 'Financial status',
			value: (r) => label<BondFinancialStatus>(BOND_FINANCIAL_STATUS_LABELS, r.financialStatus)
		},
		{ header: 'Bonds', numeric: true, value: (r) => r.bondCount },
		{ header: 'Total value', numeric: true, value: (r) => r.totalValue }
	]
};

const bondsByCollector: ReportExportDefinition<BondsByCollectorRow> = {
	title: 'Bonds by collector',
	permission: 'report.view_operational',
	columns: [
		{ header: 'Collector', text: true, value: (r) => r.collectorName ?? 'Unassigned' },
		{ header: 'Bonds', numeric: true, value: (r) => r.bondCount },
		{ header: 'Delivered', numeric: true, value: (r) => r.deliveredCount },
		{ header: 'Sold', numeric: true, value: (r) => r.soldCount },
		{ header: 'Returned', numeric: true, value: (r) => r.returnedCount },
		{ header: 'Total value', numeric: true, value: (r) => r.totalValue },
		{ header: 'Sold value', numeric: true, value: (r) => r.soldValue }
	]
};

const installments: ReportExportDefinition<InstallmentBucketRow> = {
	title: 'Installments',
	permission: 'report.view_operational',
	columns: [
		{ header: 'Collector', text: true, value: (r) => r.collectorName },
		{ header: 'Bucket', value: (r) => INSTALLMENT_BUCKET_LABELS[r.bucket] ?? r.bucket },
		{ header: 'Installments', numeric: true, value: (r) => r.installmentCount },
		{ header: 'Amount', numeric: true, value: (r) => r.amount }
	]
};

const collectorMonthly: ReportExportDefinition<CollectorMonthlyRow> = {
	title: 'Collector monthly summary',
	permission: 'report.view_operational',
	columns: [
		{ header: 'Collector', text: true, value: (r) => r.collectorName },
		{ header: 'Assigned bonds', numeric: true, value: (r) => r.assignedBonds },
		{ header: 'Sold bonds', numeric: true, value: (r) => r.soldBonds },
		{ header: 'Sold value', numeric: true, value: (r) => r.soldValue },
		{ header: 'Pending installments', numeric: true, value: (r) => r.pendingInstallments },
		{ header: 'Pending amount', numeric: true, value: (r) => r.pendingAmount },
		{ header: 'Overdue installments', numeric: true, value: (r) => r.overdueInstallments },
		{ header: 'Overdue amount', numeric: true, value: (r) => r.overdueAmount },
		{ header: 'Payments', numeric: true, value: (r) => r.paymentsCount },
		{ header: 'Payments total', numeric: true, value: (r) => r.paymentsTotal },
		{ header: 'Cash', numeric: true, value: (r) => r.paymentsCash },
		{ header: 'Transfer', numeric: true, value: (r) => r.paymentsTransfer }
	]
};

const paymentsByDate: ReportExportDefinition<PaymentsByDateRow> = {
	title: 'Payments by date',
	permission: 'report.view_financial',
	columns: [
		{ header: 'Payment date', value: (r) => r.paymentDate },
		{
			header: 'Method',
			value: (r) => label<PaymentMethod>(PAYMENT_METHOD_LABELS, r.paymentMethod)
		},
		{ header: 'Payments', numeric: true, value: (r) => r.paymentCount },
		{ header: 'Total', numeric: true, value: (r) => r.total }
	]
};

const settlementsByCollector: ReportExportDefinition<SettlementsByCollectorRow> = {
	title: 'Settlements by collector',
	permission: 'report.view_financial',
	columns: [
		{ header: 'Collector', text: true, value: (r) => r.collectorName },
		{
			header: 'Status',
			value: (r) => label<SettlementStatus>(SETTLEMENT_STATUS_LABELS, r.status)
		},
		{ header: 'Settlements', numeric: true, value: (r) => r.settlementCount },
		{ header: 'Cash', numeric: true, value: (r) => r.totalCash },
		{ header: 'Transfer', numeric: true, value: (r) => r.totalTransfer },
		{ header: 'Total', numeric: true, value: (r) => r.totalAmount },
		{ header: 'Commission', numeric: true, value: (r) => r.commissionAmount },
		{ header: 'Commission paid', numeric: true, value: (r) => r.commissionPaidAmount },
		{ header: 'Net to firefighters', numeric: true, value: (r) => r.netToFirefighters }
	]
};

const collectorAccounts: ReportExportDefinition<CollectorAccountRow> = {
	title: 'Collector current accounts',
	permission: 'report.view_financial',
	columns: [
		{ header: 'Collector', text: true, value: (r) => r.collectorName },
		{ header: 'Entries', numeric: true, value: (r) => r.entryCount },
		{ header: 'Credits', numeric: true, value: (r) => r.creditTotal },
		{ header: 'Debits', numeric: true, value: (r) => r.debitTotal },
		{ header: 'Balance', numeric: true, value: (r) => r.balance },
		{ header: 'Last entry', value: (r) => r.lastEntryOn }
	]
};

const collectorLedger: ReportExportDefinition<CollectorLedgerRow> = {
	title: 'Collector current account detail',
	permission: 'report.view_financial',
	columns: [
		{ header: 'Date', value: (r) => r.occurredOn },
		{ header: 'Time', value: (r) => r.occurredTime },
		{
			header: 'Type',
			value: (r) => label<LedgerEntryType>(LEDGER_ENTRY_TYPE_LABELS, r.entryType)
		},
		{
			header: 'Direction',
			value: (r) => label<LedgerDirection>(LEDGER_DIRECTION_LABELS, r.direction)
		},
		{ header: 'Amount', numeric: true, value: (r) => r.amount },
		{ header: 'Status', value: (r) => label<LedgerStatus>(LEDGER_STATUS_LABELS, r.status) },
		{ header: 'Settlement', numeric: true, value: (r) => r.settlementNumber },
		{ header: 'Reason', text: true, value: (r) => r.reason },
		{ header: 'Running balance', numeric: true, value: (r) => r.runningBalance }
	]
};

const drawRoster: ReportExportDefinition<DrawRosterEntryRow> = {
	title: 'Draw roster',
	permission: 'report.view_financial',
	columns: [
		{ header: 'Number', numeric: true, value: (r) => r.numberValue },
		{ header: 'Eligible', value: (r) => (r.eligible ? 'Yes' : 'No') },
		{ header: 'Ineligibility reason', text: true, value: (r) => r.ineligibilityReason },
		{ header: 'Buyer', text: true, value: (r) => r.buyerName },
		{ header: 'Collector', text: true, value: (r) => r.collectorName }
	]
};

const prizes: ReportExportDefinition<PrizeReportRow> = {
	title: 'Winners and prizes',
	permission: 'report.view_financial',
	columns: [
		{ header: 'Draw', text: true, value: (r) => r.drawName },
		{ header: 'Draw date', value: (r) => r.drawDate },
		{ header: 'Position', numeric: true, value: (r) => r.position },
		{ header: 'Prize', text: true, value: (r) => r.prizeName },
		{
			header: 'Prize status',
			value: (r) => label<PrizeStatus>(PRIZE_STATUS_LABELS, r.prizeStatus)
		},
		{ header: 'Winning number', numeric: true, value: (r) => r.winningNumber },
		{
			header: 'Result',
			value: (r) => label<WinningNumberStatus>(WINNING_NUMBER_STATUS_LABELS, r.resultStatus)
		},
		{ header: 'Buyer', text: true, value: (r) => r.buyerName },
		{ header: 'Collector', text: true, value: (r) => r.collectorName },
		{ header: 'Awarded', value: (r) => r.awardedOn },
		{ header: 'Delivered', value: (r) => r.deliveredOn }
	]
};

/** Draw type and status labels, for the report views. */
export const drawTypeLabel = (value: string) => label<DrawType>(DRAW_TYPE_LABELS, value);
export const drawStatusLabel = (value: string) => label<DrawStatus>(DRAW_STATUS_LABELS, value);

export const REPORT_EXPORTS = {
	'bonds-by-status': bondsByStatus,
	'bonds-by-collector': bondsByCollector,
	installments,
	'collector-monthly': collectorMonthly,
	'payments-by-date': paymentsByDate,
	'settlements-by-collector': settlementsByCollector,
	'collector-accounts': collectorAccounts,
	'collector-ledger': collectorLedger,
	'draw-roster': drawRoster,
	prizes
} as const satisfies Record<ReportExportKey, ReportExportDefinition<never>>;

/** `reports-<key>-<campaign id prefix>-<YYYY-MM-DD>.<ext>` (date = Buenos Aires today). */
export function reportExportFileName(
	key: ReportExportKey,
	campaignId: string,
	today: string,
	format: ExportFormat
): string {
	return `report-${key}-${campaignId.slice(0, 8)}-${today}.${format}`;
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** Excel cell value of a column: amounts and counts as numbers, free text neutralized. */
export function excelCellValue<Row>(
	column: ExportColumn<Row>,
	row: Row
): string | number | boolean | null {
	const value = column.value(row);
	if (value === null || value === undefined) return null;
	if (column.numeric) {
		const n = Number(value);
		return Number.isFinite(n) ? n : String(value);
	}
	if (typeof value === 'string' && column.text && FORMULA_START.test(value)) return `'${value}`;
	return value;
}
