import { describe, expect, it } from 'vitest';
import {
	countdownLabel,
	cutoffCountdown,
	summarizeBalances,
	summarizeBonds,
	summarizeCash,
	summarizeCommissions,
	summarizeRevenue,
	summarizeSubmitted,
	TOP_BALANCES
} from './dashboard';

describe('summarizeSubmitted (SAN-156)', () => {
	it('adds up count and amount in cents and keeps the per-collector rows', () => {
		const rows = [
			{
				collectorId: 'a',
				collectorName: 'Ana',
				count: 2,
				amount: '100.10',
				openSettlementId: 's1'
			},
			{ collectorId: 'b', collectorName: 'Beto', count: 1, amount: '0.20', openSettlementId: null }
		];
		expect(summarizeSubmitted(rows)).toEqual({ count: 3, amount: '100.30', byCollector: rows });
	});
	it('is empty when nothing is pending', () => {
		expect(summarizeSubmitted([])).toEqual({ count: 0, amount: '0.00', byCollector: [] });
	});
});

const bondRow = (commercialStatus: string, bondCount: number, financialStatus = 'unpaid') => ({
	commercialStatus,
	financialStatus,
	bondCount,
	totalValue: '0.00'
});

describe('summarizeBonds', () => {
	it('counts sold (sold and closed), available and delivered; annulled bonds leave the total', () => {
		const summary = summarizeBonds([
			bondRow('available', 10),
			bondRow('delivered_to_collector', 4),
			bondRow('sold', 3, 'unpaid'),
			bondRow('sold', 2, 'paid'),
			bondRow('closed', 1),
			bondRow('returned', 2),
			bondRow('annulled', 5)
		]);
		expect(summary).toEqual({
			total: 22,
			sold: 6,
			available: 10,
			delivered: 4,
			returned: 2,
			annulled: 5
		});
	});

	it('is all zeros without rows', () => {
		expect(summarizeBonds([]).total).toBe(0);
	});
});

describe('summarizeRevenue', () => {
	it('splits expected, collected and pending exactly to the cent', () => {
		const summary = summarizeRevenue([
			{ bucket: 'paid', amount: '100.10' },
			{ bucket: 'advance', amount: '50.20' },
			{ bucket: 'overdue', amount: '30.30' },
			{ bucket: 'pending', amount: '119.40' }
		]);
		expect(summary).toEqual({
			expected: '300.00',
			collected: '150.30',
			pending: '149.70',
			overdue: '30.30',
			collectedPercent: 50
		});
	});

	it('has no percentage without expected revenue', () => {
		expect(summarizeRevenue([]).collectedPercent).toBe(0);
	});
});

describe('summarizeCash', () => {
	it('adds cash and transfer over every day', () => {
		const summary = summarizeCash([
			{ paymentDate: '2026-03-01', paymentMethod: 'cash', paymentCount: 2, total: '100.00' },
			{ paymentDate: '2026-03-01', paymentMethod: 'transfer', paymentCount: 1, total: '40.50' },
			{ paymentDate: '2026-03-02', paymentMethod: 'cash', paymentCount: 1, total: '10.00' }
		]);
		expect(summary).toEqual({ cash: '110.00', transfer: '40.50', total: '150.50' });
	});
});

const settlement = (status: string, over: Partial<Record<string, string | number>> = {}) => ({
	collectorId: 'c1',
	collectorName: 'Ana',
	status,
	settlementCount: 1,
	totalCash: '100.00',
	totalTransfer: '20.00',
	totalAmount: '120.00',
	commissionAmount: '12.00',
	commissionPaidAmount: '5.00',
	netToFirefighters: '108.00',
	...over
});

describe('summarizeCommissions', () => {
	it('counts closed and corrected settlements; open ones are only counted', () => {
		const summary = summarizeCommissions([
			settlement('closed'),
			settlement('corrected', {
				settlementCount: 2,
				commissionAmount: '3.00',
				commissionPaidAmount: '3.00'
			}),
			settlement('open', { commissionAmount: '99.00' }),
			settlement('annulled', { commissionAmount: '77.00' })
		]);
		expect(summary).toMatchObject({
			generated: '15.00',
			settled: '8.00',
			pending: '7.00',
			closedSettlements: 3,
			openSettlements: 1,
			settledCash: '200.00',
			settledTransfer: '40.00'
		});
	});

	it('shows a negative pending amount when more was paid than generated', () => {
		const summary = summarizeCommissions([
			settlement('closed', { commissionAmount: '1.00', commissionPaidAmount: '3.50' })
		]);
		expect(summary.pending).toBe('-2.50');
	});
});

describe('summarizeBalances', () => {
	const account = (collectorName: string, balance: string) => ({
		collectorId: collectorName,
		collectorName,
		entryCount: 1,
		creditTotal: '0.00',
		debitTotal: '0.00',
		balance,
		lastEntryOn: null
	});

	it('nets the balances, counts creditors and keeps the largest by absolute value', () => {
		const rows = [
			account('Ana', '10.00'),
			account('Beto', '-250.00'),
			account('Carla', '0.00'),
			account('Dani', '40.00'),
			account('Eva', '5.00'),
			account('Fede', '1.00'),
			account('Gus', '-2.00')
		];
		const summary = summarizeBalances(rows);
		expect(summary.net).toBe('-196.00');
		expect(summary.creditors).toBe(4);
		expect(summary.top).toHaveLength(TOP_BALANCES);
		expect(summary.top.map((r) => r.collectorName)).toEqual(['Beto', 'Dani', 'Ana', 'Eva', 'Gus']);
	});
});

describe('cutoffCountdown', () => {
	// 2026-11-24 15:00 in Buenos Aires.
	const now = new Date('2026-11-24T18:00:00Z');

	it('counts calendar days in Buenos Aires', () => {
		expect(cutoffCountdown('2026-11-30T02:59:59Z', now)).toEqual({ state: 'upcoming', days: 5 });
	});

	it('is today until the end of the cutoff day (the day is inclusive)', () => {
		expect(cutoffCountdown('2026-11-25T02:59:00Z', now)).toEqual({ state: 'today', days: 0 });
	});

	it('is passed after the cutoff day', () => {
		expect(cutoffCountdown('2026-11-23T20:00:00Z', now)).toEqual({ state: 'passed', days: 0 });
	});

	it('labels each state in neutral Spanish', () => {
		expect(countdownLabel({ state: 'upcoming', days: 1 })).toBe(
			'Falta 1 día para la fecha de corte'
		);
		expect(countdownLabel({ state: 'upcoming', days: 5 })).toBe(
			'Faltan 5 días para la fecha de corte'
		);
		expect(countdownLabel({ state: 'today', days: 0 })).toBe('La fecha de corte es hoy');
		expect(countdownLabel({ state: 'passed', days: 0 })).toBe('La fecha de corte ya pasó');
	});
});
