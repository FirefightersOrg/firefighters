import { describe, expect, it } from 'vitest';
import { DEFAULT_NUMBERING_CONFIG } from '$lib/domain/numbering';
import type { GroupingMember } from '$lib/server/repositories/bonds';
import {
	describeGroupingMembers,
	GROUPING_MAX_SELECTED,
	groupingProblem,
	groupingProblemMessage,
	groupingTotals,
	selectedBondIds
} from './grouping';

const CAMPAIGN = 'f0000000-0000-0000-0000-000000000001';
const A = 'b0000000-0000-0000-0000-000000000001';
const B = 'b0000000-0000-0000-0000-000000000002';

const member = (overrides: Partial<GroupingMember> = {}): GroupingMember => ({
	id: A,
	campaignId: CAMPAIGN,
	kind: 'simple',
	commercialStatus: 'available',
	internalCode: null,
	baseNumber: 68,
	activeGroupPataId: null,
	...overrides
});

describe('grouping helpers', () => {
	it('keeps distinct valid ids, lower-cased, in order, capped', () => {
		expect(selectedBondIds([A.toUpperCase(), 'nope', `${B},${A}`, ''])).toEqual([A, B]);
		const many = Array.from(
			{ length: GROUPING_MAX_SELECTED + 5 },
			(_, i) => `b0000000-0000-0000-0000-${String(i).padStart(12, '0')}`
		);
		expect(selectedBondIds(many)).toHaveLength(GROUPING_MAX_SELECTED);
	});

	it('explains why a bond cannot be grouped', () => {
		expect(groupingProblem(member(), CAMPAIGN)).toBeNull();
		expect(groupingProblem(undefined, CAMPAIGN)).toBe('Bond not found.');
		expect(groupingProblem(member({ campaignId: B }), CAMPAIGN)).toBe(
			'It belongs to another campaign.'
		);
		expect(groupingProblem(member({ kind: 'pata' }), CAMPAIGN)).toBe(
			'It is a pata: only simple bonds can be grouped.'
		);
		expect(groupingProblem(member({ commercialStatus: 'annulled' }), CAMPAIGN)).toBe(
			'It is annulled: only available bonds can be grouped.'
		);
		expect(groupingProblem(member({ activeGroupPataId: B }), CAMPAIGN)).toBe(
			'It already belongs to a pata. Ungroup that pata first.'
		);
	});

	it('describes picked bonds with formatted numbers, unknown ones included', () => {
		const views = describeGroupingMembers([A, B], [member()], CAMPAIGN, DEFAULT_NUMBERING_CONFIG);
		expect(views).toEqual([
			{
				id: A,
				baseFormatted: '0068',
				associatedFormatted: '4939',
				internalCode: null,
				problem: null,
				pataId: null
			},
			{
				id: B,
				baseFormatted: null,
				associatedFormatted: null,
				internalCode: null,
				problem: 'Bond not found.',
				pataId: null
			}
		]);
		expect(groupingProblemMessage(views[1])).toBe('A selected bond: Bond not found.');
	});

	it('computes N and the total value', () => {
		expect(groupingTotals(0, '60000.00')).toEqual({ unitCount: 0, totalValue: null });
		expect(groupingTotals(3, '60000.00')).toEqual({ unitCount: 3, totalValue: '180000.00' });
	});
});
