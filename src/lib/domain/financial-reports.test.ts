import { describe, expect, it } from 'vitest';
import {
	countPrizesByStatus,
	formatSignedMoney,
	parseFinancialFilters,
	pivotPaymentsByDate,
	sumSignedAmounts,
	totalCollectorAccounts,
	totalSettlements,
	type PrizeReportRow
} from './financial-reports';

const GUID = 'c0000000-0000-0000-0000-000000000001';
const parse = (query: string) => parseFinancialFilters(new URLSearchParams(query));

describe('parseFinancialFilters', () => {
	it('treats empty values as no filter', () => {
		expect(parse('')).toEqual({
			ok: true,
			filters: {
				collectorId: null,
				method: null,
				settlementStatus: null,
				from: null,
				to: null,
				drawId: null,
				eligibility: null,
				prizeStatus: null
			}
		});
		expect(parse('collector=&method=&from=&draw=')).toMatchObject({ ok: true });
	});

	it('parses every filter', () => {
		expect(
			parse(
				`collector=${GUID}&method=cash&settlement=closed&from=2027-01-01&to=2027-01-31&draw=${GUID}&eligibility=ineligible&prize=delivered`
			)
		).toEqual({
			ok: true,
			filters: {
				collectorId: GUID,
				method: 'cash',
				settlementStatus: 'closed',
				from: '2027-01-01',
				to: '2027-01-31',
				drawId: GUID,
				eligibility: 'ineligible',
				prizeStatus: 'delivered'
			}
		});
	});

	it.each([
		'collector=nope',
		'draw=nope',
		'method=card',
		'settlement=bogus',
		'eligibility=maybe',
		'prize=bogus',
		'from=2027-02-30',
		'to=yesterday',
		'from=2027-02-10&to=2027-02-01'
	])('rejects %s', (query) => {
		expect(parse(query)).toMatchObject({ ok: false });
	});
});

describe('amount helpers', () => {
	it('sums signed amounts exactly', () => {
		expect(sumSignedAmounts(['0.10', '0.20'])).toBe('0.30');
		expect(sumSignedAmounts(['5.00', '-7.50'])).toBe('-2.50');
		expect(sumSignedAmounts([])).toBe('0.00');
		expect(() => sumSignedAmounts(['abc'])).toThrow(RangeError);
	});

	it('formats negative amounts', () => {
		expect(formatSignedMoney('1500.00')).toBe('$\u00a01.500,00');
		expect(formatSignedMoney('-15.50')).toBe('-$\u00a015,50');
	});
});

describe('pivotPaymentsByDate', () => {
	it('merges cash and transfer per day and totals', () => {
		const { days, totals } = pivotPaymentsByDate([
			{ paymentDate: '2027-03-02', paymentMethod: 'transfer', paymentCount: 1, total: '40.00' },
			{ paymentDate: '2027-03-01', paymentMethod: 'cash', paymentCount: 2, total: '100.10' },
			{ paymentDate: '2027-03-02', paymentMethod: 'cash', paymentCount: 1, total: '0.20' }
		]);
		expect(days).toEqual([
			{ paymentDate: '2027-03-01', cash: '100.10', transfer: '0.00', total: '100.10', count: 2 },
			{ paymentDate: '2027-03-02', cash: '0.20', transfer: '40.00', total: '40.20', count: 2 }
		]);
		expect(totals).toEqual({ cash: '100.30', transfer: '40.00', total: '140.30', count: 4 });
	});

	it('is empty without rows', () => {
		expect(pivotPaymentsByDate([]).totals).toEqual({
			cash: '0.00',
			transfer: '0.00',
			total: '0.00',
			count: 0
		});
	});
});

describe('totals', () => {
	it('totals settlements', () => {
		const row = (n: number, amount: string) => ({
			collectorId: GUID,
			collectorName: 'Ana',
			status: 'closed',
			settlementCount: n,
			totalCash: amount,
			totalTransfer: '0.00',
			totalAmount: amount,
			commissionAmount: '1.10',
			commissionPaidAmount: '0.00',
			netToFirefighters: amount
		});
		const totals = totalSettlements([row(1, '10.10'), row(2, '0.20')]);
		expect(totals.settlementCount).toBe(3);
		expect(totals.totalAmount).toBe('10.30');
		expect(totals.commissionAmount).toBe('2.20');
	});

	it('totals collector accounts with negative balances', () => {
		const totals = totalCollectorAccounts([
			{
				collectorId: GUID,
				collectorName: 'Ana',
				entryCount: 2,
				creditTotal: '5.00',
				debitTotal: '12.00',
				balance: '-7.00',
				lastEntryOn: null
			},
			{
				collectorId: GUID,
				collectorName: 'Beto',
				entryCount: 1,
				creditTotal: '3.00',
				debitTotal: '0.00',
				balance: '3.00',
				lastEntryOn: null
			}
		]);
		expect(totals).toEqual({
			entryCount: 3,
			creditTotal: '8.00',
			debitTotal: '12.00',
			balance: '-4.00'
		});
	});

	it('counts prizes by status', () => {
		const prize = (prizeStatus: string) => ({ prizeStatus }) as PrizeReportRow;
		expect(
			countPrizesByStatus([prize('delivered'), prize('annulled'), prize('delivered')])
		).toEqual({ delivered: 2, annulled: 1 });
	});
});
