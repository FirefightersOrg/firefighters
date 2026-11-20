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
	it('names files by kind, campaign and day', () => {
		expect(exportFileName('payments', 'c1', '2027-05-01')).toBe('payments-c1-2027-05-01.csv');
	});
});
