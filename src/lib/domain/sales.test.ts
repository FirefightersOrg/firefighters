import { describe, expect, it } from 'vitest';
import {
	INSTALLMENT_STATUSES,
	INSTALLMENT_STATUS_LABELS,
	INSTALLMENT_TRANSITIONS,
	PAYMENT_MODE_LABELS,
	PAYMENT_MODES,
	SALE_STATUSES,
	SALE_STATUS_LABELS,
	canTransitionInstallment
} from './sales';

describe('sales domain', () => {
	it('mirrors the database CHECK values and labels every one', () => {
		expect(PAYMENT_MODES).toEqual(['full_payment', 'installments']);
		expect(SALE_STATUSES).toEqual(['active', 'annulled', 'corrected']);
		expect(INSTALLMENT_STATUSES).toEqual([
			'pending',
			'paid',
			'paid_advance',
			'overdue',
			'annulled'
		]);
		expect(Object.keys(PAYMENT_MODE_LABELS)).toEqual([...PAYMENT_MODES]);
		expect(Object.keys(SALE_STATUS_LABELS)).toEqual([...SALE_STATUSES]);
		expect(Object.keys(INSTALLMENT_STATUS_LABELS)).toEqual([...INSTALLMENT_STATUSES]);
	});

	it('allows exactly the documented installment transitions', () => {
		const allowed = INSTALLMENT_STATUSES.flatMap((from) =>
			INSTALLMENT_STATUSES.filter((to) => canTransitionInstallment(from, to)).map(
				(to) => `${from}->${to}`
			)
		);
		expect(allowed.sort()).toEqual(
			[
				'pending->paid',
				'pending->paid_advance',
				'pending->overdue',
				'overdue->paid',
				'paid->annulled',
				'paid_advance->annulled'
			].sort()
		);
		expect(INSTALLMENT_TRANSITIONS.annulled).toEqual([]);
	});
});
