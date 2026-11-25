import { describe, expect, it } from 'vitest';
import { buildCsv } from './csv-export';
import {
	excelCellValue,
	isExportFormat,
	isReportExportKey,
	REPORT_EXPORT_KEYS,
	REPORT_EXPORTS,
	reportExportFileName
} from './report-exports';

describe('report export definitions', () => {
	it('defines every key, with unique non-empty headers', () => {
		expect(REPORT_EXPORT_KEYS).toHaveLength(10);
		for (const key of REPORT_EXPORT_KEYS) {
			const def = REPORT_EXPORTS[key];
			const headers = def.columns.map((c) => c.header);
			expect(headers.length).toBeGreaterThan(0);
			expect(new Set(headers).size).toBe(headers.length);
			expect(['report.view_operational', 'report.view_financial']).toContain(def.permission);
		}
	});

	it('maps the four operational reports to the operational permission', () => {
		for (const key of [
			'bonds-by-status',
			'bonds-by-collector',
			'installments',
			'collector-monthly'
		] as const) {
			expect(REPORT_EXPORTS[key].permission).toBe('report.view_operational');
		}
		for (const key of REPORT_EXPORT_KEYS.filter(
			(k) =>
				!['bonds-by-status', 'bonds-by-collector', 'installments', 'collector-monthly'].includes(k)
		)) {
			expect(REPORT_EXPORTS[key].permission).toBe('report.view_financial');
		}
	});

	it('validates keys and formats', () => {
		expect(isReportExportKey('prizes')).toBe(true);
		expect(isReportExportKey('../etc')).toBe(false);
		expect(isExportFormat('xlsx')).toBe(true);
		expect(isExportFormat('pdf')).toBe(false);
	});

	it('names the file with the Buenos Aires date and the format', () => {
		expect(
			reportExportFileName('prizes', 'c0000000-0000-0000-0000-000000000001', '2027-03-04', 'xlsx')
		).toBe('report-prizes-c0000000-2027-03-04.xlsx');
	});
});

describe('CSV rendering', () => {
	const roster = REPORT_EXPORTS['draw-roster'];

	it('keeps amounts exact, neutralizes formulas and writes the BOM', () => {
		const csv = buildCsv(roster.columns, [
			{
				numberValue: 7,
				eligible: false,
				ineligibilityReason: '=HYPERLINK("x")',
				buyerName: '+Eva, "Paz"',
				collectorName: null
			}
		]);
		expect(csv.startsWith('﻿Number,Eligible,')).toBe(true);
		expect(csv).toContain('7,No,"\'=HYPERLINK(""x"")","\'+Eva, ""Paz""",\r\n');
	});

	it('writes amounts as canonical strings (negative balances are not text)', () => {
		const csv = buildCsv(REPORT_EXPORTS['collector-accounts'].columns, [
			{
				collectorId: 'x',
				collectorName: '@Ana',
				entryCount: 1,
				creditTotal: '1.10',
				debitTotal: '2.20',
				balance: '-1.10',
				lastEntryOn: '2027-01-02'
			}
		]);
		expect(csv).toContain("'@Ana,1,1.10,2.20,-1.10,2027-01-02");
	});
});

describe('Excel cell values', () => {
	const columns = REPORT_EXPORTS['collector-ledger'].columns;
	const byHeader = (h: string) => columns.find((c) => c.header === h)!;
	const row = {
		entryId: 'e',
		occurredOn: '2027-01-02',
		occurredTime: '10:00',
		entryType: 'cash_settled',
		direction: 'collector_debit',
		amount: '5.50',
		status: 'recorded',
		settlementNumber: 3,
		reason: '=1+1',
		runningBalance: '-4.25'
	};

	it('writes amounts and counts as numbers', () => {
		expect(excelCellValue(byHeader('Amount'), row)).toBe(5.5);
		expect(excelCellValue(byHeader('Running balance'), row)).toBe(-4.25);
		expect(excelCellValue(byHeader('Settlement'), row)).toBe(3);
		expect(excelCellValue(byHeader('Settlement'), { ...row, settlementNumber: null })).toBeNull();
	});

	it('neutralizes formulas in text cells, in Excel too', () => {
		expect(excelCellValue(byHeader('Reason'), row)).toBe("'=1+1");
		for (const value of ['+1', '-1', '@x', '\tx', '\rx']) {
			expect(excelCellValue(byHeader('Reason'), { ...row, reason: value })).toBe(`'${value}`);
		}
		expect(excelCellValue(byHeader('Reason'), { ...row, reason: 'plain' })).toBe('plain');
		expect(excelCellValue(byHeader('Reason'), { ...row, reason: null })).toBeNull();
	});
});
