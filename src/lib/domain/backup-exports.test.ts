import { describe, expect, it } from 'vitest';
import { buildCsv } from './csv-export';
import {
	BACKUP_EXPORTS,
	BACKUP_EXPORT_KINDS,
	exportFileName,
	isBackupExportKind,
	parseExportPeriod
} from './backup-exports';

describe('parseExportPeriod', () => {
	it('rejects impossible calendar dates', () => {
		for (const d of ['2027-02-29', '2027-02-30', '2027-04-31', '2027-13-01']) {
			expect(parseExportPeriod(d, null)).toBeNull();
			expect(parseExportPeriod(null, d)).toBeNull();
		}
		expect(parseExportPeriod('2028-02-29', null)).toEqual({ from: '2028-02-29', to: null });
	});

	it('accepts empty, partial and full periods', () => {
		expect(parseExportPeriod(null, null)).toEqual({ from: null, to: null });
		expect(parseExportPeriod('2027-01-01', '')).toEqual({ from: '2027-01-01', to: null });
		expect(parseExportPeriod('2027-01-01', '2027-01-31')).toEqual({
			from: '2027-01-01',
			to: '2027-01-31'
		});
	});
	it('rejects malformed, impossible and inverted dates', () => {
		expect(parseExportPeriod('01/01/2027', null)).toBeNull();
		expect(parseExportPeriod('2027-13-40', null)).toBeNull();
		expect(parseExportPeriod('2027-02-01', '2027-01-01')).toBeNull();
	});
});

describe('exports', () => {
	it('knows its kinds and the stable orders end in a unique key', () => {
		expect(isBackupExportKind('bonds')).toBe(true);
		expect(isBackupExportKind('frozen-rosters')).toBe(false);
		for (const kind of BACKUP_EXPORT_KINDS) {
			expect(BACKUP_EXPORTS[kind].order.at(-1)).toMatch(/^(id|settlement_number)$/);
		}
	});
	it('builds a CSV from a bond row, keeping exact amounts and neutralizing text', () => {
		const csv = buildCsv(BACKUP_EXPORTS.bonds.columns, [
			{
				id: 'b1',
				kind: 'simple',
				internal_code: '=cmd',
				total_value: '60000.00',
				bond_numbers: [
					{ number_kind: 'base', number_value: 7, released_at: null },
					{ number_kind: 'associated', number_value: 4878, released_at: '2027-01-01' }
				]
			}
		]);
		const [header, line] = csv.replace('﻿', '').split('\r\n');
		expect(header).toContain('total_value');
		expect(line).toContain("'=cmd");
		expect(line).toContain('60000.00');
		expect(line).toContain('base:7');
		expect(line).not.toContain('4878');
	});
	it('exports the correction links and settlement corrections', () => {
		const header = (kind: (typeof BACKUP_EXPORT_KINDS)[number]) =>
			BACKUP_EXPORTS[kind].columns.map((c) => c.header);
		expect(header('payments')).toContain('replaces_payment_id');
		expect(BACKUP_EXPORTS.payments.select).toContain('replaces_payment_id');
		expect(header('collector-ledger')).toContain('corrects_sale_id');
		expect(BACKUP_EXPORTS['collector-ledger'].select).toContain('corrects_sale_id');
		const def = BACKUP_EXPORTS['settlement-corrections'];
		expect(def.order).toEqual(['created_at', 'id']);
		expect(def.campaignColumn).toBe('settlements.campaign_id');
		const csv = buildCsv(def.columns, [
			{
				id: 'k1',
				settlement_id: 's1',
				commission_delta: '-150.00',
				cash_retained_delta: '25.50',
				reason: '=HYPERLINK("x")',
				created_by: 'u1',
				created_at: '2027-05-01T00:00:00Z',
				settlements: { settlement_number: 7, collector_id: 'c1' }
			}
		]);
		const [head, line] = csv.replace('﻿', '').split('\r\n');
		expect(head).toContain('withheld_commission_delta');
		expect(line).toContain('-150.00');
		expect(line).toContain('25.50');
		expect(line).toContain("'=HYPERLINK");
	});
	it('names files by kind, campaign and day', () => {
		expect(exportFileName('payments', 'c1', '2027-05-01')).toBe('payments-c1-2027-05-01.csv');
	});
});
