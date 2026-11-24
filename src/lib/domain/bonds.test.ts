import { describe, expect, it } from 'vitest';
import {
	assertNoCampaignConflicts,
	BondError,
	bondTotalValueCents,
	composePrintedBond,
	findCampaignConflicts,
	findIntraBondCollisions,
	participatingNumberPairs,
	participatingNumbers,
	validateBondNumbers,
	validateManualGrouping,
	type GroupingCandidate
} from './bonds';
import { DEFAULT_NUMBERING_CONFIG, type CampaignNumberingConfig } from './numbering';

const FOUR: CampaignNumberingConfig = DEFAULT_NUMBERING_CONFIG;
const FIVE: CampaignNumberingConfig = {
	...DEFAULT_NUMBERING_CONFIG,
	numberDigits: 5,
	maxNumber: 99999
};
const ZERO_OFFSET: CampaignNumberingConfig = {
	...DEFAULT_NUMBERING_CONFIG,
	associatedNumberOffset: 0
};

function bondError(fn: () => unknown): BondError {
	try {
		fn();
	} catch (err) {
		expect(err).toBeInstanceOf(BondError);
		return err as BondError;
	}
	throw new Error('expected a BondError');
}

describe('participating numbers', () => {
	it('pairs each base number with base + offset, in order', () => {
		expect(participatingNumberPairs([300, 68], FOUR)).toEqual([
			{ base: 300, associated: 5171 },
			{ base: 68, associated: 4939 }
		]);
		expect(participatingNumbers([{ base: 68, associated: 4939 }])).toEqual([
			{ value: 68, kind: 'base', base: 68 },
			{ value: 4939, kind: 'associated', base: 68 }
		]);
	});

	it('requires at least one base number', () => {
		expect(bondError(() => participatingNumberPairs([], FOUR)).code).toBe('no_base_numbers');
	});

	it.each([[-1], [1.5], [Number.NaN]])('rejects %s as a base number', (value) => {
		expect(bondError(() => participatingNumberPairs([value], FOUR)).code).toBe('invalid_number');
	});

	it('rejects numbers above max_number, formatted with the campaign digits', () => {
		const err = bondError(() => participatingNumberPairs([10000], FOUR));
		expect(err.code).toBe('out_of_range');
		expect(err.message).toBe('El número 10000 supera el número máximo de la campaña 9999');
	});

	it('accepts the highest base number and rejects the first overflowing one (4 digits)', () => {
		expect(participatingNumberPairs([5128], FOUR)).toEqual([{ base: 5128, associated: 9999 }]);
		const err = bondError(() => participatingNumberPairs([5129], FOUR));
		expect(err.code).toBe('overflow');
		expect(err.message).toBe(
			'El número base 5129 desborda: su número asociado 10000 supera el número máximo de la campaña ' +
				'9999 (el número base más alto permitido es 5128)'
		);
		expect(err.details.number).toBe('5129');
	});

	it('handles 5-digit campaigns (padding and range)', () => {
		expect(participatingNumberPairs([68, 95128], FIVE)).toEqual([
			{ base: 68, associated: 4939 },
			{ base: 95128, associated: 99999 }
		]);
		const err = bondError(() => participatingNumberPairs([95129], FIVE));
		expect(err.code).toBe('overflow');
		expect(err.message).toContain(
			'su número asociado 100000 supera el número máximo de la campaña 99999'
		);
		expect(bondError(() => participatingNumberPairs([5], { ...FIVE, maxNumber: 4 })).code).toBe(
			'invalid_config'
		);
	});
});

describe('intra-bond collisions', () => {
	it('finds nothing for a consistent pata', () => {
		expect(findIntraBondCollisions(participatingNumberPairs([1, 2, 3], FOUR), FOUR)).toEqual([]);
	});

	it('finds a repeated base', () => {
		const err = bondError(() => validateBondNumbers([5, 7, 5], FOUR));
		expect(err.code).toBe('duplicate_in_bond');
		expect(err.message).toBe(
			'El número 0005 aparece más de una vez en este bono (2 como base, 0 como asociado)'
		);
		expect(err.details.number).toBe('0005');
	});

	it("finds a base equal to another base's associated number", () => {
		expect(findIntraBondCollisions(participatingNumberPairs([10, 4881], FOUR), FOUR)).toEqual([
			{ value: 4881, formatted: '4881', baseCount: 1, associatedCount: 1 }
		]);
	});

	it('finds a base equal to its own associated number with offset 0', () => {
		const err = bondError(() => validateBondNumbers([7], ZERO_OFFSET));
		expect(err.message).toBe(
			'El número 0007 aparece más de una vez en este bono (1 como base, 1 como asociado)'
		);
	});
});

describe('campaign-wide conflicts', () => {
	const existing = [
		{ numberValue: 68, bondId: 'bond-a', numberKind: 'base' as const },
		{ numberValue: 4939, bondId: 'bond-a', numberKind: 'associated' as const },
		{ numberValue: 5000, bondId: 'bond-b', numberKind: 'base' as const }
	];

	it('lists every conflict sorted by number, with the bond that uses it', () => {
		const pairs = participatingNumberPairs([129, 68], FOUR);
		expect(findCampaignConflicts(pairs, existing, FOUR)).toEqual([
			{ value: 68, formatted: '0068', kind: 'base', bondId: 'bond-a', existingKind: 'base' },
			{
				value: 4939,
				formatted: '4939',
				kind: 'associated',
				bondId: 'bond-a',
				existingKind: 'associated'
			},
			{ value: 5000, formatted: '5000', kind: 'associated', bondId: 'bond-b', existingKind: 'base' }
		]);
	});

	it('throws naming the first number and its bond', () => {
		const err = bondError(() =>
			assertNoCampaignConflicts(participatingNumberPairs([4939], FOUR), existing, FOUR)
		);
		expect(err.code).toBe('duplicate_in_campaign');
		expect(err.message).toBe('El número 4939 ya está en uso en el bono bond-a');
		expect(err.details).toEqual({ number: '4939', bondId: 'bond-a' });
	});

	it('pads with the campaign digits (5 digits)', () => {
		const err = bondError(() =>
			assertNoCampaignConflicts(
				participatingNumberPairs([68], FIVE),
				[{ numberValue: 68, bondId: 'x', numberKind: 'base' }],
				FIVE
			)
		);
		expect(err.message).toBe('El número 00068 ya está en uso en el bono x');
	});

	it('passes when nothing is used', () => {
		expect(() =>
			assertNoCampaignConflicts(participatingNumberPairs([1, 2], FOUR), existing, FOUR)
		).not.toThrow();
	});
});

describe('value and composition', () => {
	it('multiplies the simple bond value by N in exact cents', () => {
		expect(bondTotalValueCents('60000.00', 3)).toBe(18_000_000);
		expect(bondTotalValueCents('0.10', 3)).toBe(30);
	});

	it.each([
		['abc', 1],
		['0.00', 1],
		['60000.00', 0],
		['999999999999.99', 2]
	])('rejects value %s x %s', (value, units) => {
		expect(bondError(() => bondTotalValueCents(value, units)).code).toBe('invalid_value');
	});

	it('composes a simple bond', () => {
		expect(composePrintedBond([68], { ...FOUR, simpleBondValue: '60000.00' })).toEqual({
			kind: 'simple',
			origin: 'printed',
			commercialUnitCount: 1,
			totalValue: '60000.00',
			pairs: [{ base: 68, associated: 4939 }]
		});
	});

	it('composes a printed pata of N', () => {
		const pata = composePrintedBond([100, 200, 300], { ...FOUR, simpleBondValue: '60000.50' });
		expect(pata.kind).toBe('pata');
		expect(pata.commercialUnitCount).toBe(3);
		expect(pata.totalValue).toBe('180001.50');
		expect(pata.pairs).toHaveLength(3);
	});
});

describe('manual grouping', () => {
	const member = (id: string, overrides: Partial<GroupingCandidate> = {}): GroupingCandidate => ({
		id,
		campaignId: 'c1',
		kind: 'simple',
		commercialStatus: 'available',
		activeGroupPataId: null,
		baseNumber: Number(id.replace(/\D/g, '')) || null,
		...overrides
	});

	it('composes a pata worth simple_bond_value * N', () => {
		expect(
			validateManualGrouping('c1', [member('s1'), member('s2'), member('s3')], '60000.00')
		).toEqual({
			kind: 'pata',
			origin: 'manual_grouping',
			commercialUnitCount: 3,
			totalValue: '180000.00'
		});
	});

	it.each<[string, GroupingCandidate[], string]>([
		['a single member', [member('s1')], 'group_too_small'],
		['no members', [], 'group_too_small'],
		['a repeated member', [member('s1'), member('s1')], 'group_duplicate_member'],
		[
			'another campaign',
			[member('s1'), member('s2', { campaignId: 'c2' })],
			'group_other_campaign'
		],
		['a pata member', [member('s1'), member('s2', { kind: 'pata' })], 'group_member_not_simple'],
		[
			'a delivered member',
			[member('s1'), member('s2', { commercialStatus: 'delivered_to_collector' })],
			'group_member_not_available'
		],
		[
			'an annulled member',
			[member('s1'), member('s2', { commercialStatus: 'annulled' })],
			'group_member_not_available'
		],
		[
			'an already grouped member',
			[member('s1'), member('s2', { activeGroupPataId: 'p9' })],
			'group_member_already_grouped'
		]
	])('rejects %s', (_label, members, code) => {
		expect(bondError(() => validateManualGrouping('c1', members, '60000.00')).code).toBe(code);
	});

	it('names an already grouped member by its padded number and the pata', () => {
		const err = bondError(() =>
			validateManualGrouping(
				'c1',
				[member('s1'), member('s68', { activeGroupPataId: 'p9' })],
				'60000.00',
				FOUR
			)
		);
		expect(err.message).toBe('El bono 0068 (s68) ya pertenece a la pata manual p9');
		expect(err.details).toEqual({ bondId: 's68', pataId: 'p9' });
	});
});
