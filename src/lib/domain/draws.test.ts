import { describe, expect, it } from 'vitest';
import {
	DRAW_NAME_MAX,
	DRAW_REASON_MAX,
	DRAW_TYPES,
	DRAW_TYPE_LABELS,
	DRAW_STATUSES,
	DRAW_STATUS_LABELS,
	DRAW_TRANSITIONS,
	DRAW_ROSTER_STATUSES,
	DRAW_ROSTER_STATUS_LABELS,
	DRAW_ROSTER_TRANSITIONS,
	canTransitionDraw,
	canTransitionDrawRoster
} from './draws';

describe('draw storage domain', () => {
	it('mirrors database types and text limits', () => {
		expect(DRAW_TYPES).toEqual(['monthly', 'extraordinary_full_payment', 'final', 'consolation']);
		expect(Object.keys(DRAW_TYPE_LABELS)).toEqual([...DRAW_TYPES]);
		expect(Object.keys(DRAW_STATUS_LABELS)).toEqual([...DRAW_STATUSES]);
		expect(Object.keys(DRAW_ROSTER_STATUS_LABELS)).toEqual([...DRAW_ROSTER_STATUSES]);
		expect(DRAW_NAME_MAX).toBe(200);
		expect(DRAW_REASON_MAX).toBe(1000);
	});
	it('permits exactly the documented draw transitions', () => {
		expect(DRAW_TRANSITIONS).toEqual({
			scheduled: ['roster_generated', 'annulled'],
			roster_generated: ['roster_frozen'],
			roster_frozen: ['completed'],
			completed: ['closed'],
			closed: [],
			annulled: []
		});
		for (const from of DRAW_STATUSES)
			for (const to of DRAW_STATUSES)
				expect(canTransitionDraw(from, to)).toBe(DRAW_TRANSITIONS[from].includes(to));
	});
	it('never changes a frozen or superseded roster', () => {
		expect(DRAW_ROSTER_TRANSITIONS).toEqual({
			generated: ['frozen', 'superseded'],
			frozen: [],
			superseded: []
		});
		for (const from of DRAW_ROSTER_STATUSES)
			for (const to of DRAW_ROSTER_STATUSES)
				expect(canTransitionDrawRoster(from, to)).toBe(DRAW_ROSTER_TRANSITIONS[from].includes(to));
	});
	it('allows generated annulment only for extraordinary draws, never frozen draws', () => {
		for (const type of DRAW_TYPES) {
			expect(canTransitionDraw('roster_generated', 'annulled', type)).toBe(
				type === 'extraordinary_full_payment'
			);
			expect(canTransitionDraw('roster_frozen', 'annulled', type)).toBe(false);
		}
	});
});
