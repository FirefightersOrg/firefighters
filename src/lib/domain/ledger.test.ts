import { describe, expect, it } from 'vitest';
import {
	calculateLedgerBalance,
	LEDGER_DIRECTIONS,
	LEDGER_DIRECTION_LABELS,
	LEDGER_ENTRY_TYPES,
	LEDGER_ENTRY_TYPE_LABELS,
	LEDGER_REASON_MAX,
	LEDGER_STATUSES,
	LEDGER_STATUS_LABELS,
	ledgerUncompensated
} from './ledger';

describe('ledger domain', () => {
	it('sums fractional credits and debits in cents without floating-point drift', () => {
		expect(
			calculateLedgerBalance([
				{ direction: 'collector_credit', amount: '0.10', status: 'recorded' },
				{ direction: 'collector_credit', amount: 0.2, status: 'recorded' },
				{ direction: 'collector_debit', amount: '0.30', status: 'compensated' },
				{ direction: 'collector_credit', amount: 0.01, status: 'annulled' }
			])
		).toBe(0);
	});

	it('exports database entry checks and labels', () => {
		expect(LEDGER_ENTRY_TYPES).toHaveLength(7);
		expect(Object.keys(LEDGER_ENTRY_TYPE_LABELS)).toEqual([...LEDGER_ENTRY_TYPES]);
		expect(Object.keys(LEDGER_DIRECTION_LABELS)).toEqual([...LEDGER_DIRECTIONS]);
		expect(Object.keys(LEDGER_STATUS_LABELS)).toEqual([...LEDGER_STATUSES]);
		expect(LEDGER_REASON_MAX).toBe(1000);
	});

	it('calculates non-annulled credits less debits', () => {
		expect(
			calculateLedgerBalance([
				{ direction: 'collector_credit', amount: '100.50', status: 'recorded' },
				{ direction: 'collector_debit', amount: 25.25, status: 'compensated' },
				{ direction: 'collector_credit', amount: 500, status: 'annulled' }
			])
		).toBe(75.25);
	});

	it('reconstructs cash-retained versus transfer commission and ignores annulments', () => {
		// Both payments generate commission; only cash is settled at close.
		expect(
			calculateLedgerBalance([
				{ direction: 'collector_credit', amount: 10, status: 'recorded' },
				{ direction: 'collector_debit', amount: 4, status: 'recorded' },
				{ direction: 'collector_credit', amount: 6, status: 'recorded' },
				{ direction: 'collector_debit', amount: 99, status: 'annulled' }
			])
		).toBe(12);
	});

	it('leaves reference entries out of the balance (SAN-107)', () => {
		expect(
			calculateLedgerBalance([
				{ direction: 'collector_credit', amount: '40.00', status: 'recorded' },
				{ direction: 'collector_debit', amount: '20.00', status: 'recorded' },
				{
					direction: 'collector_credit',
					amount: '200.00',
					status: 'recorded',
					affectsBalance: false
				}
			])
		).toBe(20);
	});

	it('computes what is left of each entry after its compensations (SAN-108)', () => {
		const left = ledgerUncompensated([
			{ id: 'a', amount: '30.00', status: 'recorded', originalEntryId: null },
			{ id: 'b', amount: '10.10', status: 'recorded', originalEntryId: 'a' },
			{ id: 'c', amount: '9.90', status: 'recorded', originalEntryId: 'a' },
			{ id: 'd', amount: '5.00', status: 'annulled', originalEntryId: 'a' }
		]);
		expect(left.get('a')).toBe(10);
		expect(left.get('b')).toBe(10.1);
	});
});
