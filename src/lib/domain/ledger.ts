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
	transfer_received_by_firefighters: 'Transferencia recibida por Bomberos',
	adjustment_in_favor_of_collector: 'Ajuste a favor del cobrador',
	adjustment_in_favor_of_firefighters: 'Ajuste a favor de Bomberos',
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

/**
 * Whom a balance favours, in words. The figure beside it goes without a sign: the record never
 * shows a bare minus for a balance (UX plan PR 15).
 */
export function ledgerBalanceLabel(balance: number): string {
	if (balance > 0) return 'Saldo a favor del cobrador';
	if (balance < 0) return 'Saldo a favor de Bomberos';
	return 'Sin saldo';
}

export interface LedgerSheetEntry extends LedgerBalanceEntry {
	entryType: string;
}

export interface LedgerSheetRow {
	label: string;
	/** A decimal string, without a sign. */
	value: string;
	/** `line` adds up in favour of the collector, `deduction` in favour of the institution. */
	kind: 'line' | 'deduction' | 'lead';
}

export interface LedgerSheet {
	/** The movements by kind, then the balance: the lines less the deductions are the lead. */
	rows: LedgerSheetRow[];
	/** Reference amounts (cash handed in, transfers received): they are not part of the sum. */
	secondary: { label: string; value: string }[];
	/** Positive in favour of the collector. */
	balanceCents: number;
}

/** How each kind of movement is named when several are added up, and the way it usually goes. */
const SHEET_LABELS: Record<string, { label: string; usual: LedgerDirection | null }> = {
	commission_generated: { label: 'Comisiones generadas', usual: 'collector_credit' },
	adjustment_in_favor_of_collector: {
		label: 'Ajustes a favor del cobrador',
		usual: 'collector_credit'
	},
	commission_settled: { label: 'Comisiones liquidadas', usual: 'collector_debit' },
	adjustment_in_favor_of_firefighters: {
		label: 'Ajustes a favor de Bomberos',
		usual: 'collector_debit'
	},
	annulment: { label: 'Anulaciones', usual: null },
	cash_settled: { label: 'Efectivo rendido', usual: null },
	transfer_received_by_firefighters: {
		label: 'Transferencias recibidas por Bomberos',
		usual: null
	}
};
const SHEET_ORDER = Object.keys(SHEET_LABELS);

/**
 * The current account as a sheet that adds up (UX plan PR 15): the movements that count, by kind,
 * with what favours the collector as lines and what favours the institution as deductions, and
 * the balance as the lead. Built with the rule of `calculateLedgerBalance` (annulled and reference
 * movements do not count), in cents, so the rows always add up to the lead. Presentation only: the
 * database balance stays authoritative.
 */
export function ledgerSheet(entries: readonly LedgerSheetEntry[]): LedgerSheet {
	const cents = (amount: string | number) =>
		Math.round((typeof amount === 'string' ? Number(amount) : amount) * 100);
	const decimal = (value: number) => (value / 100).toFixed(2);
	const totals = new Map<string, number>();
	const reference = new Map<string, number>();
	for (const entry of entries) {
		if (entry.status === 'annulled') continue;
		if (entry.affectsBalance === false) {
			reference.set(entry.entryType, (reference.get(entry.entryType) ?? 0) + cents(entry.amount));
			continue;
		}
		const key = `${entry.entryType}|${entry.direction}`;
		totals.set(key, (totals.get(key) ?? 0) + cents(entry.amount));
	}
	const rank = (type: string) =>
		SHEET_ORDER.includes(type) ? SHEET_ORDER.indexOf(type) : SHEET_ORDER.length;
	const groups = [...totals].map(([key, total]) => {
		const [type, direction] = key.split('|') as [string, LedgerDirection];
		const known = SHEET_LABELS[type];
		const base = known?.label ?? 'Otros movimientos';
		// A kind that goes the way it usually does is named alone; otherwise the row says whom it
		// favours, so two rows never share a name.
		const label =
			known?.usual === direction
				? base
				: `${base} a favor ${direction === 'collector_credit' ? 'del cobrador' : 'de Bomberos'}`;
		return { type, direction, label, total };
	});
	const side = (direction: LedgerDirection, kind: 'line' | 'deduction'): LedgerSheetRow[] =>
		groups
			.filter((group) => group.direction === direction)
			.sort((a, b) => rank(a.type) - rank(b.type))
			.map((group) => ({ label: group.label, value: decimal(group.total), kind }));
	const balanceCents = groups.reduce(
		(sum, group) => sum + (group.direction === 'collector_credit' ? group.total : -group.total),
		0
	);
	return {
		rows: [
			...side('collector_credit', 'line'),
			...side('collector_debit', 'deduction'),
			{
				label: ledgerBalanceLabel(balanceCents),
				value: decimal(Math.abs(balanceCents)),
				kind: 'lead'
			}
		],
		secondary: [...reference]
			.sort(([a], [b]) => rank(a) - rank(b))
			.map(([type, total]) => ({
				label: SHEET_LABELS[type]?.label ?? 'Otros movimientos de referencia',
				value: decimal(total)
			})),
		balanceCents
	};
}
