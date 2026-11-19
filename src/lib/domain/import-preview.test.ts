import { describe, expect, it } from 'vitest';
import {
	canConfirmImport,
	canValidateImport,
	formatImportNumber,
	importSessionPermission,
	parseImportItemFilter
} from './import-preview';

describe('import preview rules', () => {
	const summary = { status: 'validated' as const, errors: 0, liveItems: 3 };

	it('confirm needs a validated session with rows and no blocking error', () => {
		expect(canConfirmImport(summary)).toBe(true);
		expect(canConfirmImport({ ...summary, errors: 1 })).toBe(false);
		expect(canConfirmImport({ ...summary, status: 'draft' })).toBe(false);
		expect(canConfirmImport({ ...summary, liveItems: 0 })).toBe(false);
	});

	it('validate needs a draft with rows', () => {
		expect(canValidateImport({ ...summary, status: 'draft' })).toBe(true);
		expect(canValidateImport(summary)).toBe(false);
		expect(canValidateImport({ ...summary, status: 'draft', liveItems: 0 })).toBe(false);
	});

	it('maps sources to permissions and filters to known values', () => {
		expect(importSessionPermission('barcode_scan')).toBe('bond.scan');
		expect(importSessionPermission('excel_file')).toBe('bond.import');
		expect(parseImportItemFilter('error')).toBe('error');
		expect(parseImportItemFilter('pending')).toBe('all');
		expect(parseImportItemFilter(null)).toBe('all');
	});

	it('formats staged numbers, including those out of the campaign range', () => {
		expect(formatImportNumber(68, 4)).toBe('0068');
		expect(formatImportNumber(10371, 4)).toBe('10371');
		expect(formatImportNumber(null, 4)).toBe('—');
	});
});
