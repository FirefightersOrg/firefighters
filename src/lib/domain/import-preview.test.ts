import { describe, expect, it } from 'vitest';
import {
	canConfirmImport,
	canValidateImport,
	formatImportNumber,
	importSessionPermission,
	importSummarySentences,
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

	it('opens the preview with what would be created and what blocks it', () => {
		const counts = {
			simpleItems: 10,
			pataGroups: 1,
			participatingNumbers: 1284,
			errors: 0,
			warnings: 0,
			pending: 0
		};
		expect(importSummarySentences(counts)).toEqual([
			'Se crearían 11 bonos (10 simples y 1 pata), con 1.284 números participantes.'
		]);
		expect(importSummarySentences({ ...counts, errors: 1, warnings: 3 })).toEqual([
			'Hay 11 bonos (10 simples y 1 pata), con 1.284 números participantes.',
			'1 fila tiene un error que impide confirmar.',
			'3 filas tienen observaciones para revisar.'
		]);
		expect(
			importSummarySentences({ ...counts, simpleItems: 1, pataGroups: 0, participatingNumbers: 2 })
		).toEqual(['Se crearía 1 bono (1 simple), con 2 números participantes.']);
	});

	it('says so when the batch is empty', () => {
		const empty = {
			simpleItems: 0,
			pataGroups: 0,
			participatingNumbers: 0,
			errors: 0,
			warnings: 0,
			pending: 0
		};
		expect(importSummarySentences(empty)).toEqual(['Todavía no hay filas para crear bonos.']);
		expect(importSummarySentences({ ...empty, errors: 2 })[0]).toBe(
			'Todavía no hay filas válidas para crear bonos.'
		);
	});
});
