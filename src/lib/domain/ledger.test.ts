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
	ledgerBalanceLabel,
	ledgerSheet,
	ledgerUncompensated,
	type LedgerSheetEntry
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

describe('ledgerSheet', () => {
	const entry = (
		entryType: string,
		direction: 'collector_credit' | 'collector_debit',
		amount: number | string,
		extra: Partial<LedgerSheetEntry> = {}
	): LedgerSheetEntry => ({ entryType, direction, amount, status: 'recorded', ...extra });
	/** Lines less deductions, in cents. */
	const sum = (rows: ReturnType<typeof ledgerSheet>['rows']) =>
		rows.reduce(
			(total, row) =>
				row.kind === 'lead'
					? total
					: total + Math.round(Number(row.value) * 100) * (row.kind === 'line' ? 1 : -1),
			0
		);

	it('adds up what favours the collector less what favours the institution', () => {
		const sheet = ledgerSheet([
			entry('commission_generated', 'collector_credit', 65000),
			entry('commission_settled', 'collector_debit', 51000),
			entry('commission_generated', 'collector_credit', '20000.00'),
			entry('adjustment_in_favor_of_collector', 'collector_credit', 2000.5),
			entry('adjustment_in_favor_of_firefighters', 'collector_debit', 500)
		]);
		expect(sheet.rows).toEqual([
			{ label: 'Comisiones generadas', value: '85000.00', kind: 'line' },
			{ label: 'Ajustes a favor del cobrador', value: '2000.50', kind: 'line' },
			{ label: 'Comisiones liquidadas', value: '51000.00', kind: 'deduction' },
			{ label: 'Ajustes a favor de Bomberos', value: '500.00', kind: 'deduction' },
			{ label: 'Saldo a favor del cobrador', value: '35500.50', kind: 'lead' }
		]);
		expect(sheet.balanceCents).toBe(3_550_050);
		expect(sum(sheet.rows)).toBe(sheet.balanceCents);
	});

	it('leaves out annulled movements and lists reference ones apart', () => {
		const sheet = ledgerSheet([
			entry('commission_generated', 'collector_credit', 100),
			entry('adjustment_in_favor_of_firefighters', 'collector_debit', 40, { status: 'annulled' }),
			entry('cash_settled', 'collector_debit', 900, { affectsBalance: false }),
			entry('transfer_received_by_firefighters', 'collector_debit', 300, {
				affectsBalance: false
			}),
			entry('cash_settled', 'collector_debit', 100, { affectsBalance: false }),
			entry('commission_settled', 'collector_debit', 30, { status: 'compensated' })
		]);
		expect(sheet.rows).toEqual([
			{ label: 'Comisiones generadas', value: '100.00', kind: 'line' },
			{ label: 'Comisiones liquidadas', value: '30.00', kind: 'deduction' },
			{ label: 'Saldo a favor del cobrador', value: '70.00', kind: 'lead' }
		]);
		expect(sheet.secondary).toEqual([
			{ label: 'Efectivo rendido', value: '1000.00' },
			{ label: 'Transferencias recibidas por Bomberos', value: '300.00' }
		]);
	});

	it('says whom the balance favours, with the figure without a sign', () => {
		const owed = ledgerSheet([
			entry('commission_generated', 'collector_credit', 10),
			entry('adjustment_in_favor_of_firefighters', 'collector_debit', 15.5)
		]);
		expect(owed.rows.at(-1)).toEqual({
			label: 'Saldo a favor de Bomberos',
			value: '5.50',
			kind: 'lead'
		});
		expect(owed.balanceCents).toBe(-550);
		expect(sum(owed.rows)).toBe(owed.balanceCents);
		expect(ledgerSheet([]).rows).toEqual([{ label: 'Sin saldo', value: '0.00', kind: 'lead' }]);
		expect(ledgerBalanceLabel(0.01)).toBe('Saldo a favor del cobrador');
		expect(ledgerBalanceLabel(-0.01)).toBe('Saldo a favor de Bomberos');
		expect(ledgerBalanceLabel(0)).toBe('Sin saldo');
	});

	it('names whom an annulment favours, so no two rows share a name', () => {
		const sheet = ledgerSheet([
			entry('annulment', 'collector_credit', 7),
			entry('annulment', 'collector_debit', 3),
			entry('commission_generated', 'collector_debit', 1)
		]);
		const labels = sheet.rows.map((row) => row.label);
		expect(labels).toEqual([
			'Anulaciones a favor del cobrador',
			'Comisiones generadas a favor de Bomberos',
			'Anulaciones a favor de Bomberos',
			'Saldo a favor del cobrador'
		]);
		expect(new Set(labels).size).toBe(labels.length);
		expect(sum(sheet.rows)).toBe(300);
	});

	it('matches calculateLedgerBalance', () => {
		const entries = [
			entry('commission_generated', 'collector_credit', '0.10'),
			entry('commission_generated', 'collector_credit', 0.2),
			entry('commission_settled', 'collector_debit', '0.30', { status: 'compensated' }),
			entry('annulment', 'collector_credit', 0.01, { status: 'annulled' }),
			entry('cash_settled', 'collector_debit', 5, { affectsBalance: false })
		];
		expect(ledgerSheet(entries).balanceCents / 100).toBe(calculateLedgerBalance(entries));
	});
});
