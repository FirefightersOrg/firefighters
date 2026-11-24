import { describe, expect, it } from 'vitest';
import {
	wonPrizeCount,
	PRIZE_NAME_MAX,
	PRIZE_DESCRIPTION_MAX,
	PRIZE_NOTES_MAX,
	PRIZE_REASON_MAX,
	PRIZE_POSITION_MIN,
	WINNING_NUMBER_MIN,
	PRIZE_STATUSES,
	PRIZE_STATUS_LABELS,
	PRIZE_TRANSITIONS,
	WINNING_NUMBER_STATUSES,
	WINNING_NUMBER_STATUS_LABELS,
	WINNING_NUMBER_TRANSITIONS,
	PRIZE_AWARD_STATUSES,
	PRIZE_AWARD_STATUS_LABELS,
	PRIZE_AWARD_TRANSITIONS,
	canTransitionPrize,
	canTransitionWinningNumber,
	canTransitionPrizeAward
} from './prizes';

describe('prize storage contracts', () => {
	it('mirrors SQL limits and supplies all labels', () => {
		expect([PRIZE_NAME_MAX, PRIZE_DESCRIPTION_MAX, PRIZE_NOTES_MAX, PRIZE_REASON_MAX]).toEqual([
			200, 1000, 1000, 1000
		]);
		expect(PRIZE_POSITION_MIN).toBe(1);
		expect(WINNING_NUMBER_MIN).toBe(0);
		expect(Object.keys(PRIZE_STATUS_LABELS)).toEqual([...PRIZE_STATUSES]);
		expect(Object.keys(WINNING_NUMBER_STATUS_LABELS)).toEqual([...WINNING_NUMBER_STATUSES]);
		expect(Object.keys(PRIZE_AWARD_STATUS_LABELS)).toEqual([...PRIZE_AWARD_STATUSES]);
	});
	it('permits exactly documented prize transitions', () => {
		expect(PRIZE_TRANSITIONS).toEqual({
			pending_validation: ['awarded', 'unawarded', 'annulled'],
			awarded: ['pending_delivery', 'annulled'],
			pending_delivery: ['delivered', 'annulled'],
			delivered: [],
			unawarded: ['annulled'],
			annulled: []
		});
		for (const from of PRIZE_STATUSES)
			for (const to of PRIZE_STATUSES)
				expect(canTransitionPrize(from, to)).toBe(PRIZE_TRANSITIONS[from].includes(to));
	});
	it('resolves review only against frozen eligibility; resolved results are terminal', () => {
		expect(WINNING_NUMBER_TRANSITIONS).toEqual({
			pending_review: ['eligible_winner', 'not_eligible'],
			eligible_winner: [],
			not_eligible: [],
			no_match: []
		});
		for (const from of WINNING_NUMBER_STATUSES)
			for (const to of WINNING_NUMBER_STATUSES)
				expect(canTransitionWinningNumber(from, to)).toBe(
					WINNING_NUMBER_TRANSITIONS[from].includes(to)
				);
	});
	it('never reopens delivered or annulled awards', () => {
		expect(PRIZE_AWARD_TRANSITIONS).toEqual({
			awarded: ['delivered', 'annulled'],
			delivered: [],
			annulled: []
		});
		for (const from of PRIZE_AWARD_STATUSES)
			for (const to of PRIZE_AWARD_STATUSES)
				expect(canTransitionPrizeAward(from, to)).toBe(PRIZE_AWARD_TRANSITIONS[from].includes(to));
	});
});

describe('wonPrizeCount (SAN-82 review)', () => {
	it('never counts annulled prizes as won', () => {
		expect(
			wonPrizeCount([
				{ status: 'delivered' },
				{ status: 'annulled' },
				{ status: 'pending_delivery' }
			])
		).toBe(2);
		expect(wonPrizeCount([{ status: 'annulled' }])).toBe(0);
		expect(wonPrizeCount(null)).toBe(0);
	});
});
