import { describe, expect, it } from 'vitest';
import { BondServiceError } from '$lib/server/services/bonds';
import {
	bondServiceFailure,
	campaignLockedMessage,
	conflictLinks,
	duplicateNumbersFieldMessage,
	withoutBondIds
} from './route-helpers';

const A = 'b0000000-0000-0000-0000-00000000000a';
const B = 'b0000000-0000-0000-0000-00000000000b';
const conflict = (number: number, formatted: string, bondId: string) => ({
	number,
	formatted,
	bondId,
	numberKind: 'base' as const
});

describe('bond route helpers', () => {
	it('words duplicate numbers without bond ids', () => {
		expect(duplicateNumbersFieldMessage([conflict(68, '0068', A)])).toBe(
			'Number 0068 is already used by another bond in this campaign.'
		);
		expect(duplicateNumbersFieldMessage([conflict(68, '0068', A), conflict(4939, '4939', A)])).toBe(
			'Numbers 0068, 4939 are already used by another bond in this campaign.'
		);
		expect(duplicateNumbersFieldMessage([conflict(68, '0068', A), conflict(5000, '5000', B)])).toBe(
			'Numbers 0068, 5000 are already used by other bonds in this campaign.'
		);
	});

	it('groups conflicts by the bond that uses them', () => {
		expect(
			conflictLinks('baseNumber', [
				conflict(68, '0068', A),
				conflict(5000, '5000', B),
				conflict(4939, '4939', A)
			])
		).toEqual([
			{ field: 'baseNumber', bondId: A, numbers: ['0068', '4939'] },
			{ field: 'baseNumber', bondId: B, numbers: ['5000'] }
		]);
	});

	it('explains the campaign status', () => {
		expect(campaignLockedMessage('annulled')).toMatch(/This campaign is annulled\.$/);
	});

	it('maps form-level service errors and rethrows anything else', () => {
		const result = bondServiceFailure(
			'create',
			new BondServiceError('internal', 'Something went wrong. Please try again.')
		);
		expect(result.status).toBe(500);
		expect(result.data).toMatchObject({ message: 'Something went wrong. Please try again.' });
		expect(() => bondServiceFailure('create', new Error('boom'))).toThrow('boom');
	});
});

describe('withoutBondIds', () => {
	it('removes bond ids from database messages', () => {
		expect(withoutBondIds(`Bond 0068 (${A}) is already annulled.`)).toBe(
			'Bond 0068 is already annulled.'
		);
		expect(withoutBondIds(`Bond 0068 (${A}) already belongs to manually grouped pata ${B}.`)).toBe(
			'Bond 0068 already belongs to a manually grouped pata.'
		);
		expect(withoutBondIds(`Only an available pata can be ungrouped (pata ${B} is sold).`)).toBe(
			'Only an available pata can be ungrouped (this pata is sold).'
		);
		expect(withoutBondIds(`Bond ${A} is listed more than once.`)).toBe(
			'A bond is listed more than once.'
		);
		expect(withoutBondIds('Nothing to remove.')).toBe('Nothing to remove.');
	});
});
