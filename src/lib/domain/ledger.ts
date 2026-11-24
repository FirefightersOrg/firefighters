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

/** Spanish UI labels (docs/copy.md). */
export const LEDGER_ENTRY_TYPE_LABELS_ES: Record<LedgerEntryType, string> = {
	commission_generated: 'Comisión generada',
	commission_settled: 'Comisión liquidada',
	cash_settled: 'Efectivo rendido',
	transfer_received_by_firefighters: 'Transferencia recibida por Firefighters',
	adjustment_in_favor_of_collector: 'Ajuste a favor del cobrador',
	adjustment_in_favor_of_firefighters: 'Ajuste a favor de Firefighters',
	annulment: 'Anulación'
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
	recorded: 'Registrado',
	annulled: 'Anulado',
	compensated: 'Compensado'
};

export const LEDGER_REASON_MAX = 1000;

export interface LedgerBalanceEntry {
	direction: LedgerDirection;
	amount: string | number;
	status: LedgerStatus;
}

/**
 * Presentation-only mirror of non-annulled credits less debits (unsigned numeric(12,2) amounts).
 * Sum integer cents to avoid fractional drift; database numeric remains authoritative
 * for financial decisions (large aggregate balances can exceed JS safe integers).
 */
export const calculateLedgerBalance = (entries: readonly LedgerBalanceEntry[]) =>
	entries.reduce((balance, entry) => {
		if (entry.status === 'annulled') return balance;
		const amount = typeof entry.amount === 'string' ? Number(entry.amount) : entry.amount;
		const cents = Math.round(amount * 100);
		return balance + (entry.direction === 'collector_credit' ? cents : -cents);
	}, 0) / 100;
