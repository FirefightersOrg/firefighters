import { describe, expect, it } from 'vitest';
import {
	buildStatusMatrix,
	formatMonthLabel,
	isValidDate,
	parseReportFilters,
	pivotInstallments,
	sumAmounts,
	todayInBuenosAires,
	totalBondsByCollector,
	totalCollectorMonthly,
	type CollectorMonthlyRow,
	type InstallmentBucketRow
} from './reports';

const COLLECTOR = 'c0000000-0000-0000-0000-000000000001';
const parse = (qs: string) => parseReportFilters(new URLSearchParams(qs), '2026-11-24');

describe('parseReportFilters', () => {
	it('defaults to no filters and the current month', () => {
		expect(parse('')).toEqual({
			ok: true,
			filters: {
				collectorId: null,
				kind: null,
				commercialStatus: null,
				financialStatus: null,
				month: '2026-11',
				from: null,
				to: null
			}
		});
	});

	it('treats empty values as no filter and reads every filter', () => {
		const result = parse(
			`collector=${COLLECTOR}&kind=pata&status=sold&financial=overdue&month=2027-02&from=2027-02-01&to=2027-02-28`
		);
		expect(result).toMatchObject({
			ok: true,
			filters: {
				collectorId: COLLECTOR,
				kind: 'pata',
				commercialStatus: 'sold',
				financialStatus: 'overdue',
				month: '2027-02',
				from: '2027-02-01',
				to: '2027-02-28'
			}
		});
		expect(parse('collector=&kind=&status=&financial=&month=&from=&to=')).toMatchObject({
			ok: true,
			filters: { collectorId: null, kind: null, month: '2026-11' }
		});
	});

	it.each([
		['collector=nope', 'collector'],
		['kind=triple', 'bond type'],
		['status=gone', 'commercial'],
		['financial=gone', 'financial'],
		['month=2026-13', 'month'],
		['month=2026-1', 'month'],
		['from=2026-02-30', 'date range'],
		['to=yesterday', 'date range'],
		['from=2026-12-01&to=2026-11-01', 'from is after to']
	])('rejects %s', (qs, text) => {
		const result = parse(qs);
		expect(result.ok).toBe(false);
		expect(!result.ok && result.message.toLowerCase()).toContain(text);
	});
});

describe('dates', () => {
	it('uses the Buenos Aires calendar date, not UTC', () => {
		// 01:30 UTC on the 25th is still the 24th in Buenos Aires (UTC-3).
		expect(todayInBuenosAires(new Date('2026-11-25T01:30:00Z'))).toBe('2026-11-24');
		expect(todayInBuenosAires(new Date('2026-11-25T03:00:00Z'))).toBe('2026-11-25');
	});
	it('validates calendar dates', () => {
		expect(isValidDate('2028-02-29')).toBe(true);
		expect(isValidDate('2027-02-29')).toBe(false);
		expect(isValidDate('2027-2-1')).toBe(false);
	});
	it('labels a month', () => {
		expect(formatMonthLabel('2026-03')).toBe('March 2026');
	});
});

describe('sumAmounts', () => {
	it('adds exactly to the cent', () => {
		expect(sumAmounts(['0.10', '0.20'])).toBe('0.30');
		expect(sumAmounts([])).toBe('0.00');
		expect(sumAmounts(['100', '50.5'])).toBe('150.50');
	});
	it('refuses a malformed amount', () => {
		expect(() => sumAmounts(['1,00'])).toThrow(RangeError);
	});
});

describe('buildStatusMatrix', () => {
	const matrix = buildStatusMatrix([
		{
			commercialStatus: 'available',
			financialStatus: 'no_payments',
			bondCount: 3,
			totalValue: '300.00'
		},
		{ commercialStatus: 'sold', financialStatus: 'overdue', bondCount: 2, totalValue: '200.00' },
		{ commercialStatus: 'sold', financialStatus: 'no_payments', bondCount: 1, totalValue: '100.00' }
	]);
	it('orders statuses by the catalog and keeps only those present', () => {
		expect(matrix.commercialStatuses).toEqual(['available', 'sold']);
		expect(matrix.financialStatuses).toEqual(['no_payments', 'overdue']);
	});
	it('totals by commercial status, financial status and overall', () => {
		expect(matrix.cells.sold).toEqual({ overdue: 2, no_payments: 1 });
		expect(matrix.commercialTotals.sold).toEqual({ bondCount: 3, totalValue: '300.00' });
		expect(matrix.financialTotals).toEqual({ no_payments: 4, overdue: 2 });
		expect(matrix.bondCount).toBe(6);
		expect(matrix.totalValue).toBe('600.00');
	});
	it('is empty without rows', () => {
		expect(buildStatusMatrix([])).toMatchObject({ bondCount: 0, totalValue: '0.00' });
	});
});

describe('totalBondsByCollector', () => {
	it('sums every column', () => {
		const row = {
			collectorId: COLLECTOR,
			collectorName: 'Ana',
			bondCount: 3,
			deliveredCount: 1,
			soldCount: 2,
			returnedCount: 0,
			totalValue: '300.00',
			soldValue: '200.00'
		};
		expect(
			totalBondsByCollector([
				row,
				{ ...row, collectorId: null, collectorName: null, bondCount: 1, totalValue: '100.05' }
			])
		).toEqual({
			bondCount: 4,
			deliveredCount: 2,
			soldCount: 4,
			returnedCount: 0,
			totalValue: '400.05',
			soldValue: '400.00'
		});
	});
});

describe('pivotInstallments', () => {
	const rows: InstallmentBucketRow[] = [
		{
			collectorId: 'a',
			collectorName: 'Ana',
			bucket: 'overdue',
			installmentCount: 1,
			amount: '50.00'
		},
		{
			collectorId: 'a',
			collectorName: 'Ana',
			bucket: 'paid',
			installmentCount: 2,
			amount: '100.10'
		},
		{
			collectorId: 'b',
			collectorName: 'Beto',
			bucket: 'paid',
			installmentCount: 1,
			amount: '0.20'
		},
		{
			collectorId: 'b',
			collectorName: 'Beto',
			bucket: 'advance',
			installmentCount: 4,
			amount: '400.00'
		}
	];
	const pivot = pivotInstallments(rows);
	it('gives each collector all four buckets, zero when absent', () => {
		expect(pivot.collectors.map((c) => c.collectorName)).toEqual(['Ana', 'Beto']);
		expect(pivot.collectors[0]!.buckets.pending).toEqual({ count: 0, amount: '0.00' });
		expect(pivot.collectors[0]!.buckets.paid).toEqual({ count: 2, amount: '100.10' });
	});
	it('totals each bucket exactly', () => {
		expect(pivot.totals.paid).toEqual({ count: 3, amount: '100.30' });
		expect(pivot.totals.overdue).toEqual({ count: 1, amount: '50.00' });
		expect(pivot.totals.advance).toEqual({ count: 4, amount: '400.00' });
		expect(pivot.totals.pending).toEqual({ count: 0, amount: '0.00' });
	});
	it('merges repeated collector/bucket rows', () => {
		const merged = pivotInstallments([rows[1]!, rows[1]!]);
		expect(merged.collectors).toHaveLength(1);
		expect(merged.collectors[0]!.buckets.paid).toEqual({ count: 4, amount: '200.20' });
	});
});

describe('totalCollectorMonthly', () => {
	const row: CollectorMonthlyRow = {
		collectorId: COLLECTOR,
		collectorName: 'Ana',
		assignedBonds: 1,
		soldBonds: 2,
		soldValue: '200.00',
		pendingInstallments: 1,
		pendingAmount: '50.00',
		overdueInstallments: 1,
		overdueAmount: '50.00',
		paymentsCount: 2,
		paymentsTotal: '140.00',
		paymentsCash: '100.00',
		paymentsTransfer: '40.00'
	};
	it('sums counts and amounts', () => {
		expect(totalCollectorMonthly([row, row])).toEqual({
			assignedBonds: 2,
			soldBonds: 4,
			soldValue: '400.00',
			pendingInstallments: 2,
			pendingAmount: '100.00',
			overdueInstallments: 2,
			overdueAmount: '100.00',
			paymentsCount: 4,
			paymentsTotal: '280.00',
			paymentsCash: '200.00',
			paymentsTransfer: '80.00'
		});
	});
});
