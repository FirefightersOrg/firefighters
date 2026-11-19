/** Immutable collector current-account entries (SAN-67). */
export const LEDGER_ENTRY_TYPES = [
	'commission_generated',
	'commission_settled',
	'cash_settled',
	'transfer_received_by_firefighters',
	'adjustment_in_favor_of_collector',
	'adjustment_in_favor_of_firefighters',
	'annulment'
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];
export const LEDGER_ENTRY_TYPE_LABELS: Record<LedgerEntryType, string> = {
	commission_generated: 'Commission generated',
	commission_settled: 'Commission settled',
	cash_settled: 'Cash settled',
	transfer_received_by_firefighters: 'Transfer received by Firefighters',
	adjustment_in_favor_of_collector: 'Adjustment in favor of collector',
	adjustment_in_favor_of_firefighters: 'Adjustment in favor of Firefighters',
	annulment: 'Annulment'
};

export const LEDGER_DIRECTIONS = ['collector_credit', 'collector_debit'] as const;
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];
export const LEDGER_DIRECTION_LABELS: Record<LedgerDirection, string> = {
	collector_credit: 'Credit to collector',
	collector_debit: 'Debit to collector'
};

export const LEDGER_STATUSES = ['recorded', 'annulled', 'compensated'] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];
export const LEDGER_STATUS_LABELS: Record<LedgerStatus, string> = {
	recorded: 'Recorded',
	annulled: 'Annulled',
	compensated: 'Compensated'
};

export const LEDGER_REASON_MAX = 1000;

export interface LedgerBalanceEntry {
	direction: LedgerDirection;
	amount: string | number;
	status: LedgerStatus;
}

/** Non-annulled credits less non-annulled debits; amounts are unsigned. */
export const calculateLedgerBalance = (entries: readonly LedgerBalanceEntry[]) =>
	entries.reduce((balance, entry) => {
		if (entry.status === 'annulled') return balance;
		const amount = typeof entry.amount === 'string' ? Number(entry.amount) : entry.amount;
		return balance + (entry.direction === 'collector_credit' ? amount : -amount);
	}, 0);
