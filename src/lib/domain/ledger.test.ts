import { describe, expect, it } from 'vitest';
import {
	calculateLedgerBalance,
	LEDGER_DIRECTIONS,
	LEDGER_DIRECTION_LABELS,
	LEDGER_ENTRY_TYPES,
	LEDGER_ENTRY_TYPE_LABELS,
	LEDGER_REASON_MAX,
	LEDGER_STATUSES,
	LEDGER_STATUS_LABELS
} from './ledger';

describe('ledger domain', () => {
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
});
