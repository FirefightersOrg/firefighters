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
/** Spanish UI labels (docs/copy.md). */
export const LEDGER_ENTRY_TYPE_LABELS: Record<LedgerEntryType, string> = {
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
	collector_credit: 'A favor del cobrador',
	collector_debit: 'En contra del cobrador'
};

export const LEDGER_STATUSES = ['recorded', 'annulled', 'compensated'] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];
export const LEDGER_STATUS_LABELS: Record<LedgerStatus, string> = {
	recorded: 'Registrado',
	annulled: 'Anulado',
	compensated: 'Compensado'
};

export const LEDGER_REASON_MAX = 1000;

/**
 * Reference (memo) entries (SAN-107): `cash_settled` and `transfer_received_by_firefighters`
 * record what a settlement handed in. They appear in the account but never move its balance.
 */
export const LEDGER_REFERENCE_ENTRY_TYPES = [
	'cash_settled',
	'transfer_received_by_firefighters'
] as const;

export interface LedgerBalanceEntry {
	direction: LedgerDirection;
	amount: string | number;
	status: LedgerStatus;
	/** False for reference entries (SAN-107); missing means true. */
	affectsBalance?: boolean;
}

/**
 * Presentation-only mirror of non-annulled credits less debits (unsigned numeric(12,2) amounts).
 * Sum integer cents to avoid fractional drift; database numeric remains authoritative
 * for financial decisions (large aggregate balances can exceed JS safe integers).
 */
export const calculateLedgerBalance = (entries: readonly LedgerBalanceEntry[]) =>
	entries.reduce((balance, entry) => {
		if (entry.status === 'annulled' || entry.affectsBalance === false) return balance;
		const amount = typeof entry.amount === 'string' ? Number(entry.amount) : entry.amount;
		const cents = Math.round(amount * 100);
		return balance + (entry.direction === 'collector_credit' ? cents : -cents);
	}, 0) / 100;

export interface LedgerCompensationEntry {
	id: string;
	amount: string | number;
	status: LedgerStatus;
	originalEntryId: string | null;
}

/**
 * What is left of each entry after the entries that compensate it (SAN-108), in currency units.
 * Mirrors `collector_ledger_uncompensated`; the database stays authoritative.
 */
export function ledgerUncompensated(entries: readonly LedgerCompensationEntry[]) {
	const cents = (amount: string | number) =>
		Math.round((typeof amount === 'string' ? Number(amount) : amount) * 100);
	const used = new Map<string, number>();
	for (const entry of entries)
		if (entry.originalEntryId && entry.status !== 'annulled')
			used.set(entry.originalEntryId, (used.get(entry.originalEntryId) ?? 0) + cents(entry.amount));
	return new Map(entries.map((e) => [e.id, (cents(e.amount) - (used.get(e.id) ?? 0)) / 100]));
}
