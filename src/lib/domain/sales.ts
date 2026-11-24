import { centsToDecimalString, parseMoneyToCents } from './money';

/**
 * Sales, payment plans and installments (SAN-58): the shapes of the `sales`, `payment_plans` and
 * `installments` tables (`20261205000000_sales.sql`) and their documented transitions
 * (docs/state-machines.md "Installment"). Registering a sale is SAN-59; the installment amounts
 * of a campaign come from `splitIntoInstallments` (./installments).
 */

export const PAYMENT_MODES = ['full_payment', 'installments'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
	full_payment: 'Pago total',
	installments: 'En cuotas'
};

/** `corrected`: replaced by a new active sale (Phase 10). At most one active sale per bond. */
export const SALE_STATUSES = ['active', 'annulled', 'corrected'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
	active: 'Activa',
	annulled: 'Anulada',
	corrected: 'Corregida'
};

export const PAYMENT_PLAN_STATUSES = ['active', 'annulled'] as const;
export type PaymentPlanStatus = (typeof PAYMENT_PLAN_STATUSES)[number];

export const INSTALLMENT_STATUSES = [
	'pending',
	'paid',
	'paid_advance',
	'overdue',
	'annulled'
] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

export const INSTALLMENT_STATUS_LABELS: Record<InstallmentStatus, string> = {
	pending: 'Pendiente',
	paid: 'Pagada',
	paid_advance: 'Pagada por adelantado',
	overdue: 'Vencida',
	annulled: 'Anulada'
};

/** Allowed installment transitions; the database guard (`installments_guard_update`) matches. */
export const INSTALLMENT_TRANSITIONS: Record<InstallmentStatus, readonly InstallmentStatus[]> = {
	pending: ['paid', 'paid_advance', 'overdue'],
	overdue: ['paid'],
	paid: ['annulled'],
	paid_advance: ['annulled'],
	annulled: []
};

export function canTransitionInstallment(from: InstallmentStatus, to: InstallmentStatus): boolean {
	return INSTALLMENT_TRANSITIONS[from].includes(to);
}

/** Database limit on `payment_plans.installment_count`. */
export const MAX_INSTALLMENT_COUNT = 120;

/** Money values are canonical decimal strings with two places (`"60000.00"`), as in campaigns. */
export interface Sale {
	id: string;
	campaignId: string;
	bondId: string;
	buyerId: string;
	collectorId: string;
	soldAt: string;
	paymentMode: PaymentMode;
	totalAmount: string;
	status: SaleStatus;
	createdBy: string;
	createdAt: string;
	updatedAt: string;
}

export interface PaymentPlan {
	id: string;
	saleId: string;
	installmentCount: number;
	totalAmount: string;
	status: PaymentPlanStatus;
	createdAt: string;
}

export interface Installment {
	id: string;
	paymentPlanId: string;
	installmentNumber: number;
	/** `YYYY-MM-DD`. */
	dueDate: string;
	amount: string;
	status: InstallmentStatus;
	updatedAt: string;
}

export interface InstallmentScheduleItem {
	number: number;
	dueDate: string;
	amount: string;
}

function addMonthsClamped(date: string, months: number): string {
	const [year, month, day] = date.split('-').map(Number);
	const target = new Date(Date.UTC(year, month - 1 + months, 1));
	const lastDay = new Date(
		Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
	).getUTCDate();
	return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/** Mirrors `sale_register`: exact cents and PostgreSQL-style end-of-month clamping. */
export function buildInstallmentSchedule(input: {
	paymentMode: PaymentMode;
	firstDueDate: string;
	totalAmount: string;
	installmentCount: number;
	installmentValue: string;
	commercialUnitCount: number;
}): InstallmentScheduleItem[] {
	const totalCents = parseMoneyToCents(input.totalAmount);
	const installmentCents = parseMoneyToCents(input.installmentValue);
	if (totalCents === null || installmentCents === null || input.installmentCount < 1) {
		throw new RangeError('Invalid installment schedule');
	}
	const count = input.paymentMode === 'full_payment' ? 1 : input.installmentCount;
	const amount =
		input.paymentMode === 'full_payment'
			? totalCents
			: installmentCents * input.commercialUnitCount;
	if (amount * count !== totalCents)
		throw new RangeError('Installment schedule does not equal total');
	return Array.from({ length: count }, (_, index) => ({
		number: index + 1,
		dueDate: addMonthsClamped(input.firstDueDate, index),
		amount: centsToDecimalString(amount)
	}));
}
