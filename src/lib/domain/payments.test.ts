import { describe, expect, it } from 'vitest';
import {
	PAYMENT_METHOD_LABELS,
	PAYMENT_METHODS,
	PAYMENT_ANNULMENT_REASON_MAX,
	PAYMENT_STATUSES,
	PAYMENT_STATUS_LABELS,
	PAYMENT_TRANSITIONS,
	SETTLEMENT_STATUSES,
	SETTLEMENT_NOTES_MAX,
	SETTLEMENT_STATUS_LABELS,
	SETTLEMENT_TRANSITIONS,
	canTransitionPayment,
	canTransitionSettlement
} from './payments';
describe('payments domain', () => {
	it('mirrors payment checks, labels, and transitions', () => {
		expect(PAYMENT_METHODS).toEqual(['cash', 'transfer']);
		expect(Object.keys(PAYMENT_METHOD_LABELS)).toEqual([...PAYMENT_METHODS]);
		expect(Object.keys(PAYMENT_STATUS_LABELS)).toEqual([...PAYMENT_STATUSES]);
		expect(PAYMENT_TRANSITIONS).toEqual({
			draft: ['pending_in_settlement'],
			pending_in_settlement: ['confirmed', 'annulled'],
			confirmed: ['annulled', 'adjusted'],
			annulled: [],
			adjusted: []
		});
		expect(canTransitionPayment('draft', 'confirmed')).toBe(false);
		expect(PAYMENT_ANNULMENT_REASON_MAX).toBe(1000);
	});
	it('mirrors settlement checks, labels, and transitions', () => {
		expect(Object.keys(SETTLEMENT_STATUS_LABELS)).toEqual([...SETTLEMENT_STATUSES]);
		expect(SETTLEMENT_TRANSITIONS).toEqual({
			open: ['closed', 'annulled'],
			closed: ['corrected'],
			annulled: [],
			corrected: []
		});
		expect(canTransitionSettlement('closed', 'corrected')).toBe(true);
		expect(canTransitionSettlement('corrected', 'open')).toBe(false);
		expect(SETTLEMENT_NOTES_MAX).toBe(2000);
	});
});
