import { describe, expect, it } from 'vitest';
import { BondServiceError } from '$lib/server/services/bonds';
import {
	bondServiceFailure,
	campaignLockedMessage,
	conflictLinks,
	duplicateNumbersFieldMessage
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
