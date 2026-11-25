import { describe, expect, it } from 'vitest';
import { BondError, participatingNumberPairs, validateBondNumbers } from './bonds';
import {
	summarizeImportItems,
	validateImportBatch,
	type ImportBatchItem,
	type ImportRules
} from './imports';

// SAN-151: bonds and imports in circular mode (B = 5000, offset 4871).
const CONFIG = {
	numberDigits: 4,
	maxNumber: 9999,
	associatedNumberOffset: 4871,
	associatedNumberMode: 'circular',
	overflowPolicy: 'reject'
} as const;

const RULES: ImportRules = {
	barcodeMode: 'base_number',
	barcodePattern: null,
	numberDigits: 4,
	maxNumber: 9999,
	associatedNumberOffset: 4871,
	associatedNumberMode: 'circular'
};

const staged = (rowNumber: number, baseNumber: number | null): ImportBatchItem => ({
	key: String(rowNumber),
	rowNumber,
	itemType: 'simple',
	groupKey: null,
	baseNumber,
	barcode: null,
	errorCode: null,
	errorMessage: null
});

function bondErrorCode(fn: () => unknown): string | undefined {
	try {
		fn();
	} catch (error) {
		if (error instanceof BondError) return error.code;
		throw error;
	}
	return undefined;
}

describe('bonds in circular mode', () => {
	it('pairs the wrap-around bases (0000 -> 9871, 0068 -> 9939)', () => {
		expect(participatingNumberPairs([0, 68, 128, 129], CONFIG)).toEqual([
			{ base: 0, associated: 9871 },
			{ base: 68, associated: 9939 },
			{ base: 128, associated: 9999 },
			{ base: 129, associated: 5000 }
		]);
	});

	it('accepts the bases that overflow in linear mode (the 129 critical bonds)', () => {
		expect(validateBondNumbers([0], CONFIG)).toEqual([{ base: 0, associated: 9871 }]);
		const linear = { ...CONFIG, associatedNumberMode: 'linear' } as const;
		expect(bondErrorCode(() => validateBondNumbers([5129], linear))).toBe('overflow');
	});

	it('rejects a base from B up with the highest allowed base in the message', () => {
		expect(bondErrorCode(() => validateBondNumbers([5000], CONFIG))).toBe('overflow');
		expect(() => validateBondNumbers([5000], CONFIG)).toThrow(
			'el número base más alto permitido es 4999'
		);
	});
});

describe('imports in circular mode', () => {
	it('accepts every base below B and rejects the others as out of range', () => {
		const result = validateImportBatch([staged(1, 0), staged(2, 4999), staged(3, 5000)], RULES);
		expect(result.items.map((i) => [i.rowNumber, i.status, i.errorCode])).toEqual([
			[1, 'valid', null],
			[2, 'valid', null],
			[3, 'error', 'number_out_of_range']
		]);
		expect(result.items[2].errorMessage).toBe(
			'Number 5000 does not fit the campaign (circular mode: base numbers go up to 4999).'
		);
	});

	it('does not flag a conflict for bases that collide only in linear mode', () => {
		// Linear: 0 + 4871 = 4871 is also a base, so the two rows would conflict. Circular: 9871.
		const rows = [staged(1, 0), staged(2, 4871)];
		const circular = validateImportBatch(rows, RULES);
		expect(circular.items.map((i) => i.status)).toEqual(['valid', 'valid']);
		const linear = validateImportBatch(rows, { ...RULES, associatedNumberMode: 'linear' });
		expect(linear.items.map((i) => i.errorCode)).toEqual(['number_conflict', 'number_conflict']);
	});

	it('reports the associated number already used by an existing bond', () => {
		const result = validateImportBatch([staged(1, 68)], RULES, {
			numbers: new Map([[9939, 'bond-1']]),
			barcodes: new Map()
		});
		expect(result.items[0].errorCode).toBe('number_in_use');
		expect(result.items[0].errorMessage).toContain('9939');
	});

	it('counts the participating numbers with the circular formula', () => {
		const summary = summarizeImportItems(
			[
				{ status: 'valid', itemType: 'simple', groupKey: null, baseNumber: 0, errorCode: null },
				{ status: 'valid', itemType: 'simple', groupKey: null, baseNumber: 68, errorCode: null },
				// Outside 0..B-1: has no associated number, only itself.
				{
					status: 'error',
					itemType: 'simple',
					groupKey: null,
					baseNumber: 5000,
					errorCode: 'number_out_of_range'
				}
			],
			RULES
		);
		expect(summary.participatingNumbers).toBe(5);
	});
});
