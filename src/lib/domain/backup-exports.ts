/**
 * Operational backup exports (pure definitions, SAN-90; docs/backup-operations.md).
 *
 * Each export is a read of one table (RLS applies) in a stable order, written as CSV. Money columns
 * are selected with `::text` so amounts keep their exact two decimals.
 */
import type { CsvColumn } from './csv-export';

export const BACKUP_EXPORT_KINDS = [
	'bonds',
	'payments',
	'settlements',
	'collector-ledger',
	'settlement-corrections'
] as const;
export type BackupExportKind = (typeof BACKUP_EXPORT_KINDS)[number];

/** Exports of the six in docs/backup-operations.md that need Phase 11/12 tables. */
// TODO(SAN-90 follow-up): 'frozen-rosters' (Phase 11 roster tables) and 'winners-prizes'
// (Phase 12 winner/prize tables). Add them here once the tables exist.
export const PENDING_BACKUP_EXPORTS = ['frozen-rosters', 'winners-prizes'] as const;

export function isBackupExportKind(value: string): value is BackupExportKind {
	return (BACKUP_EXPORT_KINDS as readonly string[]).includes(value);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose rows come from PostgREST
export type ExportRow = Record<string, any>;

export interface BackupExportDefinition {
	kind: BackupExportKind;
	label: string;
	table: string;
	/** PostgREST select list (money cast to text, embeds for readable names). */
	select: string;
	/** Stable total order: unique tiebreaker last, so keyset pages never skip or repeat rows. Every column must be in `select` and non-null. */
	order: readonly string[];
	/** Permissions required besides `report.export` (all of them). */
	permissions: readonly (
		'bond.view' | 'payment.view' | 'settlement.view' | 'collector.ledger.view'
	)[];
	/** Column holding the campaign id; embedded path when the table has none. Default `campaign_id`. */
	campaignColumn?: string;
	/** Column filtered by the optional `from`/`to` period (date or timestamp). */
	periodColumn?: string;
	columns: readonly CsvColumn<ExportRow>[];
}

const col = (header: string, key: string, text = false): CsvColumn<ExportRow> => ({
	header,
	text,
	value: (r) => r[key]
});
const nested = (header: string, a: string, b: string, text = true): CsvColumn<ExportRow> => ({
	header,
	text,
	value: (r) => r[a]?.[b]
});

export const BACKUP_EXPORTS: Record<BackupExportKind, BackupExportDefinition> = {
	bonds: {
		kind: 'bonds',
		label: 'Bonds per campaign',
		table: 'bonds',
		select:
			'id, kind, origin, internal_code, barcode, commercial_status, financial_status_snapshot, current_collector_id, current_buyer_id, commercial_unit_count, total_value::text, annulled_at, annul_reason, created_at, bond_numbers(number_value, number_kind, released_at)',
		order: ['created_at', 'id'],
		permissions: ['bond.view'],
		columns: [
			col('bond_id', 'id'),
			col('kind', 'kind'),
			col('origin', 'origin'),
			col('internal_code', 'internal_code', true),
			col('barcode', 'barcode', true),
			col('commercial_status', 'commercial_status'),
			col('financial_status', 'financial_status_snapshot'),
			col('collector_id', 'current_collector_id'),
			col('buyer_id', 'current_buyer_id'),
			col('commercial_unit_count', 'commercial_unit_count'),
			col('total_value', 'total_value'),
			{
				header: 'numbers',
				value: (r) =>
					(r.bond_numbers ?? [])
						.filter((n: ExportRow) => !n.released_at)
						.map((n: ExportRow) => `${n.number_kind}:${n.number_value}`)
						.join(' ')
			},
			col('annulled_at', 'annulled_at'),
			col('annul_reason', 'annul_reason', true),
			col('created_at', 'created_at')
		]
	},
	payments: {
		kind: 'payments',
		label: 'Payments by period',
		table: 'payments',
		select:
			'id, sale_id, collector_id, buyer_id, settlement_id, replaces_payment_id, amount::text, payment_method, payment_date, status, created_at, annulled_at, annulment_reason',
		order: ['payment_date', 'created_at', 'id'],
		permissions: ['payment.view'],
		periodColumn: 'payment_date',
		columns: [
			col('payment_id', 'id'),
			col('payment_date', 'payment_date'),
			col('amount', 'amount'),
			col('method', 'payment_method'),
			col('status', 'status'),
			col('sale_id', 'sale_id'),
			col('collector_id', 'collector_id'),
			col('buyer_id', 'buyer_id'),
			col('settlement_id', 'settlement_id'),
			col('replaces_payment_id', 'replaces_payment_id'),
			col('created_at', 'created_at'),
			col('annulled_at', 'annulled_at'),
			col('annulment_reason', 'annulment_reason', true)
		]
	},
	settlements: {
		kind: 'settlements',
		label: 'Settlements',
		table: 'settlements',
		select:
			'id, settlement_number, collector_id, status, opened_at, closed_at, total_cash::text, total_transfer::text, total_amount::text, commission_amount::text, commission_paid_amount::text, net_to_firefighters::text, notes, collectors(display_name)',
		order: ['settlement_number', 'id'],
		permissions: ['settlement.view'],
		columns: [
			col('settlement_id', 'id'),
			col('settlement_number', 'settlement_number'),
			col('collector_id', 'collector_id'),
			nested('collector', 'collectors', 'display_name'),
			col('status', 'status'),
			col('opened_at', 'opened_at'),
			col('closed_at', 'closed_at'),
			col('total_cash', 'total_cash'),
			col('total_transfer', 'total_transfer'),
			col('total_amount', 'total_amount'),
			col('commission_amount', 'commission_amount'),
			col('commission_paid_amount', 'commission_paid_amount'),
			col('net_to_firefighters', 'net_to_firefighters'),
			col('notes', 'notes', true)
		]
	},
	'collector-ledger': {
		kind: 'collector-ledger',
		label: 'Collector current accounts',
		table: 'collector_ledger_entries',
		select:
			'id, collector_id, settlement_id, payment_id, corrects_sale_id, entry_type, direction, amount::text, status, occurred_at, reason, annulled_at, annul_reason, collectors(display_name)',
		order: ['collector_id', 'occurred_at', 'id'],
		permissions: ['collector.ledger.view'],
		periodColumn: 'occurred_at',
		columns: [
			col('entry_id', 'id'),
			col('collector_id', 'collector_id'),
			nested('collector', 'collectors', 'display_name'),
			col('occurred_at', 'occurred_at'),
			col('entry_type', 'entry_type'),
			col('direction', 'direction'),
			col('amount', 'amount'),
			col('status', 'status'),
			col('settlement_id', 'settlement_id'),
			col('payment_id', 'payment_id'),
			col('corrects_sale_id', 'corrects_sale_id'),
			col('reason', 'reason', true),
			col('annulled_at', 'annulled_at'),
			col('annul_reason', 'annul_reason', true)
		]
	},
	'settlement-corrections': {
		kind: 'settlement-corrections',
		label: 'Closed settlement corrections',
		table: 'settlement_corrections',
		// The table has no campaign_id: it is filtered through the inner-joined settlement.
		campaignColumn: 'settlements.campaign_id',
		select:
			'id, settlement_id, commission_delta::text, cash_retained_delta::text, reason, created_by, created_at, settlements!inner(campaign_id, settlement_number, collector_id)',
		order: ['created_at', 'id'],
		permissions: ['settlement.view'],
		columns: [
			col('correction_id', 'id'),
			col('settlement_id', 'settlement_id'),
			nested('settlement_number', 'settlements', 'settlement_number', false),
			nested('collector_id', 'settlements', 'collector_id', false),
			col('commission_delta', 'commission_delta'),
			col('withheld_commission_delta', 'cash_retained_delta'),
			col('reason', 'reason', true),
			col('created_by', 'created_by'),
			col('created_at', 'created_at')
		]
	}
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `from`/`to` are inclusive `YYYY-MM-DD` dates (Argentina local dates). Null when malformed. */
export function parseExportPeriod(
	from: string | null,
	to: string | null
): { from: string | null; to: string | null } | null {
	// Date.parse normalizes overflow dates (2027-02-30 -> 2027-03-02), so require a round trip.
	const ok = (v: string | null) => {
		if (v === null || v === '') return true;
		if (!DATE.test(v)) return false;
		const d = new Date(`${v}T00:00:00Z`);
		return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
	};
	if (!ok(from) || !ok(to)) return null;
	const f = from || null;
	const t = to || null;
	if (f && t && f > t) return null;
	return { from: f, to: t };
}

export function exportFileName(kind: BackupExportKind, campaignId: string, today: string): string {
	return `${kind}-${campaignId}-${today}.csv`;
}

/** Procedure before risky operations (docs/backup-operations.md). */
export const RISKY_OPERATION_STEPS = [
	'Export critical data (backup exports).',
	'Record the reason for the operation.',
	'Execute in a test environment if possible.',
	'Execute in production.',
	'Validate the main reports.',
	'Record the result.'
] as const;
