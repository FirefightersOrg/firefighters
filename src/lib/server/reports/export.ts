/**
 * Report exports (SAN-87): loads the rows of a report with the active filters and renders them
 * as CSV (BOM, formula-neutralized text) or Excel (`exceljs`, formula-neutralized text, amounts as
 * numbers). Reuses the repositories of the report views, so an export always matches the screen.
 */
import ExcelJS from 'exceljs';
import { buildCsv } from '$lib/domain/csv-export';
import type { FinancialFilters } from '$lib/domain/financial-reports';
import {
	excelCellValue,
	REPORT_EXPORTS,
	type ExportColumn,
	type ReportExportKey
} from '$lib/domain/report-exports';
import type { ReportFilters } from '$lib/domain/reports';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	getCollectorAccounts,
	getCollectorLedger,
	getDrawRosterEntries,
	getPaymentsByDate,
	getPrizesReport,
	getSettlementsByCollector
} from '$lib/server/repositories/financial-reports';
import {
	getBondsByCollector,
	getBondsByStatus,
	getCollectorMonthly,
	getInstallmentsReport,
	getOverdueSales
} from '$lib/server/repositories/reports';
import type { RepositoryResult } from '$lib/server/repositories/campaigns';

export interface ReportDataset {
	title: string;
	columns: readonly ExportColumn<never>[];
	rows: readonly unknown[];
}

export type ReportDatasetResult =
	| { ok: true; dataset: ReportDataset }
	| { ok: false; kind: 'invalid'; message: string }
	| { ok: false; kind: 'failed'; error: { code?: string; message?: string } };

/** Loads one report's rows. `invalid` = a filter the report needs is missing (HTTP 400). */
export async function loadReportDataset(
	supabase: SupabaseClient,
	key: ReportExportKey,
	campaignId: string,
	operational: ReportFilters,
	financial: FinancialFilters
): Promise<ReportDatasetResult> {
	let result: RepositoryResult<unknown[]>;
	switch (key) {
		case 'bonds-by-status':
			result = await getBondsByStatus(supabase, campaignId, operational);
			break;
		case 'bonds-by-collector':
			result = await getBondsByCollector(supabase, campaignId, operational);
			break;
		case 'installments':
			result = await getInstallmentsReport(supabase, campaignId, operational);
			break;
		case 'overdue-sales':
			// Paged inside (every sale over the campaign's N, no row cap); same N and filter as the screen.
			result = await getOverdueSales(supabase, campaignId, operational);
			break;
		case 'collector-monthly':
			result = await getCollectorMonthly(supabase, campaignId, operational);
			break;
		case 'payments-by-date':
			result = await getPaymentsByDate(supabase, campaignId, financial);
			break;
		case 'settlements-by-collector':
			result = await getSettlementsByCollector(supabase, campaignId, financial);
			break;
		case 'collector-accounts':
			result = await getCollectorAccounts(supabase, campaignId, financial);
			break;
		case 'collector-ledger':
			if (!financial.collectorId) {
				return {
					ok: false,
					kind: 'invalid',
					message: 'Choose a collector to export the account detail.'
				};
			}
			result = await getCollectorLedger(
				supabase,
				campaignId,
				financial.collectorId,
				financial,
				'all'
			);
			break;
		case 'draw-roster':
			if (!financial.drawId) {
				return { ok: false, kind: 'invalid', message: 'Choose a draw to export its roster.' };
			}
			result = await getDrawRosterEntries(supabase, campaignId, financial.drawId, financial, 'all');
			break;
		case 'prizes':
			result = await getPrizesReport(supabase, campaignId, financial);
			break;
	}
	if (result.error) return { ok: false, kind: 'failed', error: result.error };
	const def = REPORT_EXPORTS[key];
	return {
		ok: true,
		dataset: { title: def.title, columns: def.columns, rows: result.data }
	};
}

export function datasetToCsv(dataset: ReportDataset): string {
	return buildCsv(dataset.columns as readonly ExportColumn<unknown>[], dataset.rows);
}

/** Excel limits a sheet name to 31 characters and forbids `: \ / ? * [ ]`. */
const sheetName = (title: string) => title.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);

export async function datasetToXlsx(dataset: ReportDataset): Promise<Uint8Array> {
	const columns = dataset.columns as readonly ExportColumn<unknown>[];
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet(sheetName(dataset.title));
	sheet.addRow(columns.map((c) => c.header)).font = { bold: true };
	for (const row of dataset.rows) {
		const added = sheet.addRow(columns.map((c) => excelCellValue(c, row)));
		columns.forEach((c, i) => {
			// Counts (JS numbers) are integers; amounts (decimal strings) have two decimals.
			if (c.numeric)
				added.getCell(i + 1).numFmt = typeof c.value(row as never) === 'number' ? '0' : '#,##0.00';
		});
	}
	columns.forEach((c, i) => {
		sheet.getColumn(i + 1).width = Math.max(12, c.header.length + 2);
	});
	sheet.views = [{ state: 'frozen', ySplit: 1 }];
	const buffer = await workbook.xlsx.writeBuffer();
	return new Uint8Array(buffer as ArrayBuffer);
}
