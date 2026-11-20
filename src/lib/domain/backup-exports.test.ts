import { describe, expect, it } from 'vitest';
import { buildCsv } from './csv-export';
import { parseCsv } from './csv';
import {
	BACKUP_EXPORTS,
	BACKUP_EXPORT_KINDS,
	exportFileName,
	isBackupExportKind,
	buenosAiresDateTime,
	parseExportPeriod,
	snapshotBuyerName
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
		expect(isBackupExportKind('frozen-rosters')).toBe(true);
		expect(isBackupExportKind('winners-prizes')).toBe(false);
		for (const kind of BACKUP_EXPORT_KINDS) {
			expect(BACKUP_EXPORTS[kind].order.at(-1)).toMatch(/^(id|settlement_number|number_value)$/);
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

describe('frozen roster export mapping', () => {
	const row = {
		id: 'e1',
		draw_roster_id: 'r1',
		bond_id: 'b1',
		number_value: 42,
		eligible: false,
		ineligibility_reason: '=not_sold',
		buyer_snapshot: {
			id: 'by1',
			first_name: 'Ana',
			last_name: '-Perez',
			business_name: null,
			document_number: '30111222',
			tax_id: null
		},
		collector_snapshot: { id: 'c1', display_name: '@Cobrador' },
		draw_rosters: {
			id: 'r1',
			status: 'frozen',
			// 2027-03-01 01:30 UTC is still 28 February in Buenos Aires.
			frozen_at: '2027-03-01T01:30:00+00:00',
			draws: { id: 'd1', name: '+Sorteo 1', draw_type: 'monthly', draw_date: '2027-03-05' }
		}
	};
	it('maps draw, roster, number, snapshots and neutralizes text', () => {
		const rows = parseCsv(buildCsv(BACKUP_EXPORTS['frozen-rosters'].columns, [row])).map(
			(r) => r.cells
		);
		const get = (h: string) => rows[1]![rows[0]!.indexOf(h)];
		expect(get('draw_id')).toBe('d1');
		expect(get('roster_id')).toBe('r1');
		expect(get('draw_name')).toBe("'+Sorteo 1");
		expect(get('draw_date')).toBe('2027-03-05');
		expect(get('frozen_at')).toBe('2027-02-28 22:30:00');
		expect(get('number')).toBe('42');
		expect(get('ineligibility_reason')).toBe("'=not_sold");
		expect(get('buyer')).toBe("'-Perez, Ana");
		expect(get('buyer_document')).toBe('30111222');
		expect(get('collector')).toBe("'@Cobrador");
	});
	it('tolerates empty snapshots and bad timestamps', () => {
		const rows = parseCsv(
			buildCsv(BACKUP_EXPORTS['frozen-rosters'].columns, [
				{ ...row, buyer_snapshot: {}, collector_snapshot: {} }
			])
		).map((r) => r.cells);
		expect(rows[1]![rows[0]!.indexOf('buyer')]).toBe('');
		expect(snapshotBuyerName({})).toBeNull();
		expect(snapshotBuyerName({ business_name: 'ACME', first_name: 'x' })).toBe('ACME');
		expect(buenosAiresDateTime(null)).toBeNull();
		expect(buenosAiresDateTime('garbage')).toBeNull();
	});
});
