import { parseMoneyToCents } from './money';
import type { InstallmentStatus, PaymentPlanStatus, SaleStatus } from './sales';

export const FINANCIAL_STATUSES = [
	'no_payments',
	'partial_payments',
	'up_to_date',
	'overdue',
	'fully_paid',
	'uncollectible',
	'annulled'
] as const;
export type FinancialStatus = (typeof FINANCIAL_STATUSES)[number];

export interface FinancialStatusInstallment {
	number: number;
	dueDate: string;
	amount: string;
	appliedAmount: string;
	status: InstallmentStatus;
}

/** Calculates the displayed financial state without relying on commercial bond state. */
export function calculateFinancialStatus(input: {
	saleStatus: SaleStatus;
	planStatus: PaymentPlanStatus;
	markedUncollectible: boolean;
	today: string;
	installments: readonly FinancialStatusInstallment[];
}): FinancialStatus {
	if (input.saleStatus === 'annulled' || input.planStatus === 'annulled') return 'annulled';
	if (input.markedUncollectible) return 'uncollectible';
	const installments = input.installments.filter((item) => item.status !== 'annulled');
	const paid = (item: FinancialStatusInstallment) => {
		const amount = parseMoneyToCents(item.amount);
		const applied = parseMoneyToCents(item.appliedAmount);
		if (amount === null || applied === null) throw new RangeError('Invalid installment amount');
		return item.status === 'paid' || item.status === 'paid_advance' || applied >= amount;
	};
	if (installments.length > 0 && installments.every(paid)) return 'fully_paid';
	if (installments.some((item) => !paid(item) && item.dueDate < input.today)) return 'overdue';
	if (
		installments.every(
			(item) =>
				item.status !== 'paid' &&
				item.status !== 'paid_advance' &&
				parseMoneyToCents(item.appliedAmount) === 0
		)
	)
		return 'no_payments';
	if (
		installments.some(paid) &&
		installments.filter((item) => item.dueDate <= input.today).every(paid)
	) {
		return 'up_to_date';
	}
	return 'partial_payments';
}
