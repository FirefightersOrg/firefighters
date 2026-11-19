import { describe, expect, it } from 'vitest';
import {
	INSTALLMENT_STATUSES,
	INSTALLMENT_STATUS_LABELS,
	INSTALLMENT_TRANSITIONS,
	PAYMENT_MODE_LABELS,
	PAYMENT_MODES,
	SALE_STATUSES,
	SALE_STATUS_LABELS,
	buildInstallmentSchedule,
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

	it('builds exact schedules with end-of-month clamping', () => {
		expect(
			buildInstallmentSchedule({
				paymentMode: 'installments',
				firstDueDate: '2027-01-31',
				totalAmount: '300.00',
				installmentCount: 3,
				installmentValue: '100.00',
				commercialUnitCount: 1
			})
		).toEqual([
			{ number: 1, dueDate: '2027-01-31', amount: '100.00' },
			{ number: 2, dueDate: '2027-02-28', amount: '100.00' },
			{ number: 3, dueDate: '2027-03-31', amount: '100.00' }
		]);
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
