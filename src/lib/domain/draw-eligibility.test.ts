import { describe, expect, it } from 'vitest';
import {
	ExtraordinaryNumberAssignmentError,
	assignExtraordinaryNumbers,
	evaluateDrawEligibility,
	type DrawEligibilityInput,
	type DrawType
} from './draw-eligibility';

function eligibilityInput(type: DrawType): DrawEligibilityInput {
	return {
		draw: {
			type,
			paymentCutoffAt: '2026-12-01T02:59:59.000Z',
			requiredInstallmentNumber: 2
		},
		bond: {
			commercialStatus: 'sold',
			annulled: false,
			kind: 'simple',
			baseNumberCount: 1
		},
		sale: {
			paymentMode: 'installments',
			installments: [
				{ number: 1, amount: '100.00' },
				{ number: 2, amount: '100.00' },
				{ number: 3, amount: '100.00' }
			]
		},
		payments: [
			{
				status: 'confirmed',
				paymentDate: '2026-11-30',
				createdAt: '2026-12-20T12:00:00Z',
				applications: [
					{ installmentNumber: 1, amountApplied: '100.00' },
					{ installmentNumber: 2, amountApplied: '100.00' },
					{ installmentNumber: 3, amountApplied: '100.00' }
				]
			}
		],
		previousWins: []
	};
}

describe('evaluateDrawEligibility', () => {
	it('accepts a monthly bond whose required installments are covered', () => {
		expect(evaluateDrawEligibility(eligibilityInput('monthly'))).toEqual({ eligible: true });
	});

	it('rejects a monthly bond when cent-exact partial applications do not cover an installment', () => {
		const input = eligibilityInput('monthly');
		input.payments = [
			{
				...input.payments[0],
				applications: [
					{ installmentNumber: 1, amountApplied: '33.33' },
					{ installmentNumber: 1, amountApplied: '66.66' },
					{ installmentNumber: 2, amountApplied: '100.00' }
				]
			}
		];
		expect(evaluateDrawEligibility(input)).toEqual({
			eligible: false,
			reason: 'installments_not_covered'
		});
	});

	it.each(['draft', 'pending_in_settlement', 'annulled', 'adjusted'] as const)(
		'excludes %s payments',
		(status) => {
			const input = eligibilityInput('monthly');
			input.payments = input.payments.map((payment) => ({ ...payment, status }));
			expect(evaluateDrawEligibility(input)).toEqual({
				eligible: false,
				reason: 'installments_not_covered'
			});
		}
	);

	it('uses the Buenos Aires payment date through the inclusive cutoff boundary', () => {
		const beforeMidnight = eligibilityInput('monthly');
		beforeMidnight.draw.paymentCutoffAt = '2026-12-01T02:59:59.999Z'; // Nov 30 in Buenos Aires
		beforeMidnight.payments = beforeMidnight.payments.map((payment) => ({
			...payment,
			paymentDate: '2026-12-01'
		}));
		expect(evaluateDrawEligibility(beforeMidnight)).toEqual({
			eligible: false,
			reason: 'installments_not_covered'
		});

		const atMidnight = { ...beforeMidnight, draw: { ...beforeMidnight.draw } };
		atMidnight.draw.paymentCutoffAt = '2026-12-01T03:00:00.000Z'; // Dec 1 at 00:00 in BA
		expect(evaluateDrawEligibility(atMidnight)).toEqual({ eligible: true });
	});

	it('does not use createdAt as the payment cutoff timestamp', () => {
		const input = eligibilityInput('monthly');
		input.payments = input.payments.map((payment) => ({
			...payment,
			createdAt: '2027-01-01T00:00:00.000Z'
		}));
		expect(evaluateDrawEligibility(input)).toEqual({ eligible: true });
	});

	it('requires a sold and non-annulled bond', () => {
		const notSold = eligibilityInput('monthly');
		notSold.bond.commercialStatus = 'available';
		expect(evaluateDrawEligibility(notSold)).toEqual({ eligible: false, reason: 'not_sold' });

		const annulled = eligibilityInput('monthly');
		annulled.bond.annulled = true;
		expect(evaluateDrawEligibility(annulled)).toEqual({ eligible: false, reason: 'annulled' });
	});

	it.each(['extraordinary_full_payment', 'final'] as const)(
		'requires every installment for a %s draw',
		(type) => {
			const input = eligibilityInput(type);
			input.payments = [
				{
					...input.payments[0],
					applications: input.payments[0].applications.slice(0, 2)
				}
			];
			expect(evaluateDrawEligibility(input)).toEqual({
				eligible: false,
				reason: 'not_fully_paid'
			});
			expect(evaluateDrawEligibility(eligibilityInput(type))).toEqual({ eligible: true });
		}
	);

	it('accepts a full-payment sale paid in one upfront installment', () => {
		const input = eligibilityInput('extraordinary_full_payment');
		input.sale = {
			paymentMode: 'full_payment',
			installments: [{ number: 1, amount: '300.00' }]
		};
		input.payments = [
			{
				...input.payments[0],
				applications: [{ installmentNumber: 1, amountApplied: '300.00' }]
			}
		];
		expect(evaluateDrawEligibility(input)).toEqual({ eligible: true });
	});

	it('uses the configured consolation installment rule', () => {
		const input = eligibilityInput('consolation');
		input.draw.requiredInstallmentNumber = 1;
		input.draw.consolationRule = { requiredInstallmentNumber: 2 };
		input.payments = [
			{
				...input.payments[0],
				applications: input.payments[0].applications.slice(0, 1)
			}
		];
		expect(evaluateDrawEligibility(input)).toEqual({
			eligible: false,
			reason: 'installments_not_covered'
		});
	});

	it('excludes a previous winner only when that draw excludes from consolation', () => {
		const allowed = eligibilityInput('consolation');
		allowed.previousWins = [{ drawType: 'monthly', excludesFromConsolation: false }];
		expect(evaluateDrawEligibility(allowed)).toEqual({ eligible: true });

		const excluded = eligibilityInput('consolation');
		excluded.previousWins = [{ drawType: 'monthly', excludesFromConsolation: true }];
		expect(evaluateDrawEligibility(excluded)).toEqual({
			eligible: false,
			reason: 'already_won'
		});
	});
});

describe('assignExtraordinaryNumbers', () => {
	const eligibleBonds = [
		{
			bondId: 'pata-b',
			kind: 'pata' as const,
			baseNumbers: [
				{ id: 'base-9', value: 9 },
				{ id: 'base-4', value: 4 }
			]
		},
		{
			bondId: 'simple-a',
			kind: 'simple' as const,
			baseNumbers: [{ id: 'base-2', value: 2 }]
		}
	];

	it('assigns one number to a simple bond and one per pata base in deterministic order', () => {
		expect(assignExtraordinaryNumbers({ eligibleBonds, takenNumbers: [], maxNumber: 10 })).toEqual([
			{ bondId: 'simple-a', sourceBaseNumberId: 'base-2', value: 0 },
			{ bondId: 'pata-b', sourceBaseNumberId: 'base-4', value: 1 },
			{ bondId: 'pata-b', sourceBaseNumberId: 'base-9', value: 2 }
		]);
	});

	it('respects all taken numbers and numbers assigned earlier in the same call', () => {
		expect(
			assignExtraordinaryNumbers({
				eligibleBonds,
				takenNumbers: [0, 1, 3, 4, 8],
				maxNumber: 10
			}).map((assignment) => assignment.value)
		).toEqual([2, 5, 6]);
	});

	it('is deterministic when input bonds and bases are reordered', () => {
		const first = assignExtraordinaryNumbers({ eligibleBonds, takenNumbers: [0], maxNumber: 10 });
		const reordered = assignExtraordinaryNumbers({
			eligibleBonds: [
				eligibleBonds[1],
				{ ...eligibleBonds[0], baseNumbers: eligibleBonds[0].baseNumbers.slice().reverse() }
			],
			takenNumbers: [0],
			maxNumber: 10
		});
		expect(reordered).toEqual(first);
	});

	it('throws a typed exhaustion error without returning a partial result', () => {
		expect(() =>
			assignExtraordinaryNumbers({
				eligibleBonds,
				takenNumbers: [0, 1],
				maxNumber: 2
			})
		).toThrowError(ExtraordinaryNumberAssignmentError);
		try {
			assignExtraordinaryNumbers({ eligibleBonds, takenNumbers: [0, 1], maxNumber: 2 });
		} catch (error) {
			expect(error).toMatchObject({
				code: 'not_enough_free_numbers',
				required: 3,
				available: 1
			});
		}
	});
});
