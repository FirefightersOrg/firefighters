/**
 * Draw eligibility (SAN-76). The extraordinary draw uses each bond's own numbers (SAN-152).
 *
 * Pure domain logic only: SAN-77 owns roster generation and persistence.
 */
import { parseMoneyToCents } from './money';

/**
 * Mirrors the `draws.draw_type` CHECK introduced by SAN-75. It is local on purpose so SAN-76
 * does not depend on or conflict with SAN-75's `src/lib/domain/draws.ts`.
 */
export type DrawType = 'monthly' | 'extraordinary_full_payment' | 'final' | 'consolation';

export const DRAW_TYPES: readonly DrawType[] = [
	'monthly',
	'extraordinary_full_payment',
	'final',
	'consolation'
];

export type DrawIneligibilityReason =
	| 'not_sold'
	| 'annulled'
	| 'installments_not_covered'
	| 'not_fully_paid'
	| 'already_won'
	/** Consolation draw configured without any required installment (review of #77). */
	| 'missing_required_installment'
	/** The sale is marked uncollectible (follow-up of SAN-106, #50). */
	| 'uncollectible';

/** English labels match the language used by the existing application UI. */
/** Spanish labels shown in screens, certificates and exports (docs/copy.md). */
export const DRAW_INELIGIBILITY_REASON_LABELS: Record<DrawIneligibilityReason, string> = {
	not_sold: 'Bono no vendido',
	annulled: 'Bono anulado',
	installments_not_covered: 'Cuotas requeridas no cubiertas',
	not_fully_paid: 'Bono sin pago total',
	already_won: 'El bono ya ganó un sorteo excluyente',
	missing_required_installment: 'El sorteo no tiene cuota requerida configurada',
	uncollectible: 'Venta marcada como incobrable'
};

export interface DrawEligibilityDrawSnapshot {
	type: DrawType;
	/** ISO timestamptz. Its Buenos Aires calendar day is the inclusive payment-date cutoff. */
	paymentCutoffAt: string;
	requiredInstallmentNumber: number | null;
	consolationRule?: {
		requiredInstallmentNumber?: number;
		required_installment_number?: number;
	} | null;
}

export type DrawBondCommercialStatus =
	| 'created'
	| 'available'
	| 'delivered_to_collector'
	| 'sold'
	| 'returned'
	| 'lost'
	| 'annulled'
	| 'closed';

export interface DrawEligibilityBondSnapshot {
	status?: DrawBondCommercialStatus;
	commercialStatus?: DrawBondCommercialStatus;
	commercial_status?: DrawBondCommercialStatus;
	annulled: boolean;
	kind: 'simple' | 'pata';
	baseNumberCount: number;
}

export interface DrawEligibilityInstallmentSnapshot {
	number: number;
	/** Canonical decimal amount, such as `"1500.00"`. */
	amount: string;
}

export interface DrawEligibilitySalePlanSnapshot {
	paymentMode?: 'full_payment' | 'installments';
	payment_mode?: 'full_payment' | 'installments';
	installments: readonly DrawEligibilityInstallmentSnapshot[];
	/** The sale is marked uncollectible: not eligible while the mark lasts. */
	uncollectible?: boolean;
}

export interface DrawEligibilityPaymentApplicationSnapshot {
	installmentNumber: number;
	/** Canonical decimal amount, such as `"1500.00"`. */
	amountApplied: string;
}

export interface DrawEligibilityPaymentSnapshot {
	status: 'draft' | 'pending_in_settlement' | 'confirmed' | 'annulled' | 'adjusted';
	/** Buenos Aires calendar date (`YYYY-MM-DD`); this, not `createdAt`, determines the cutoff. */
	paymentDate: string;
	/** Audit timestamp only. Confirmation time is not currently stored on payments. */
	createdAt: string;
	applications: readonly DrawEligibilityPaymentApplicationSnapshot[];
}

export interface DrawEligibilityPreviousWinSnapshot {
	drawType: DrawType;
	excludesFromConsolation: boolean;
}

interface DrawEligibilityInputBase {
	draw: DrawEligibilityDrawSnapshot;
	bond: DrawEligibilityBondSnapshot;
	payments: readonly DrawEligibilityPaymentSnapshot[];
	previousWins: readonly DrawEligibilityPreviousWinSnapshot[];
}

/** The aliases ease mapping repository snapshots without changing the pure rule. */
export type DrawEligibilityInput = DrawEligibilityInputBase &
	(
		| { sale: DrawEligibilitySalePlanSnapshot; salePlan?: never; plan?: never }
		| { sale?: never; salePlan: DrawEligibilitySalePlanSnapshot; plan?: never }
		| { sale?: never; salePlan?: never; plan: DrawEligibilitySalePlanSnapshot }
	);

export type DrawEligibilityResult =
	{ eligible: true } | { eligible: false; reason: DrawIneligibilityReason };

const ARGENTINA_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Payments store a Buenos Aires calendar date but no confirmation timestamp. Therefore the
 * business cutoff compares `paymentDate` with the cutoff's calendar day in Buenos Aires,
 * inclusively. `createdAt` is deliberately irrelevant.
 */
function cutoffDayInBuenosAires(paymentCutoffAt: string): string {
	const timestamp = Date.parse(paymentCutoffAt);
	if (!Number.isFinite(timestamp)) throw new RangeError('Invalid payment cutoff timestamp');
	return new Date(timestamp - ARGENTINA_OFFSET_MS).toISOString().slice(0, 10);
}

function canonicalCents(amount: string, label: string): number {
	const cents = parseMoneyToCents(amount);
	if (cents === null) throw new RangeError(`Invalid ${label}: ${amount}`);
	return cents;
}

function salePlanFrom(input: DrawEligibilityInput): DrawEligibilitySalePlanSnapshot {
	if ('sale' in input && input.sale) return input.sale;
	if ('salePlan' in input && input.salePlan) return input.salePlan;
	if ('plan' in input && input.plan) return input.plan;
	throw new RangeError('A sale/payment-plan snapshot is required');
}

function bondCommercialStatus(
	bond: DrawEligibilityBondSnapshot
): DrawBondCommercialStatus | undefined {
	return bond.commercialStatus ?? bond.commercial_status ?? bond.status;
}

function coveredInstallments(
	input: DrawEligibilityInput
): Map<number, { requiredCents: number; appliedCents: number }> {
	const cutoffDay = cutoffDayInBuenosAires(input.draw.paymentCutoffAt);
	const plan = salePlanFrom(input);
	const coverage = new Map<number, { requiredCents: number; appliedCents: number }>();

	for (const installment of plan.installments) {
		if (!Number.isSafeInteger(installment.number) || installment.number < 1) {
			throw new RangeError(`Invalid installment number: ${installment.number}`);
		}
		if (coverage.has(installment.number)) {
			throw new RangeError(`Duplicate installment number: ${installment.number}`);
		}
		coverage.set(installment.number, {
			requiredCents: canonicalCents(installment.amount, 'installment amount'),
			appliedCents: 0
		});
	}

	for (const payment of input.payments) {
		if (payment.status !== 'confirmed' || payment.paymentDate > cutoffDay) continue;
		for (const application of payment.applications) {
			const installment = coverage.get(application.installmentNumber);
			if (!installment) continue;
			installment.appliedCents += canonicalCents(application.amountApplied, 'applied amount');
			if (!Number.isSafeInteger(installment.appliedCents)) {
				throw new RangeError('Applied installment total exceeds safe integer cents');
			}
		}
	}

	return coverage;
}

function installmentsThroughAreCovered(
	coverage: ReadonlyMap<number, { requiredCents: number; appliedCents: number }>,
	requiredInstallmentNumber: number | null | undefined
): boolean {
	if (
		requiredInstallmentNumber === null ||
		requiredInstallmentNumber === undefined ||
		!Number.isSafeInteger(requiredInstallmentNumber) ||
		requiredInstallmentNumber < 1
	) {
		throw new RangeError('A positive required installment number is required');
	}
	for (let number = 1; number <= requiredInstallmentNumber; number += 1) {
		const installment = coverage.get(number);
		if (!installment || installment.appliedCents < installment.requiredCents) return false;
	}
	return true;
}

function isFullyPaid(
	coverage: ReadonlyMap<number, { requiredCents: number; appliedCents: number }>
): boolean {
	return (
		coverage.size > 0 &&
		[...coverage.values()].every(
			(installment) => installment.appliedCents >= installment.requiredCents
		)
	);
}

/**
 * Evaluates one bond against one draw snapshot. The result contains only stable reason codes;
 * labels are separate so frozen rosters need not persist presentation text.
 */
export function evaluateDrawEligibility(input: DrawEligibilityInput): DrawEligibilityResult {
	const status = bondCommercialStatus(input.bond);
	if (input.bond.annulled || status === 'annulled') return { eligible: false, reason: 'annulled' };
	if (status !== 'sold') return { eligible: false, reason: 'not_sold' };
	if (salePlanFrom(input).uncollectible) return { eligible: false, reason: 'uncollectible' };

	const coverage = coveredInstallments(input);
	switch (input.draw.type) {
		case 'monthly':
			return installmentsThroughAreCovered(coverage, input.draw.requiredInstallmentNumber)
				? { eligible: true }
				: { eligible: false, reason: 'installments_not_covered' };
		case 'extraordinary_full_payment':
		case 'final':
			return isFullyPaid(coverage)
				? { eligible: true }
				: { eligible: false, reason: 'not_fully_paid' };
		case 'consolation': {
			if (input.previousWins.some((win) => win.excludesFromConsolation)) {
				return { eligible: false, reason: 'already_won' };
			}
			const rule = input.draw.consolationRule;
			const required =
				rule?.requiredInstallmentNumber ??
				rule?.required_installment_number ??
				input.draw.requiredInstallmentNumber;
			// A misconfigured consolation draw must not abort a whole roster generation: report a
			// stable reason instead of throwing (configuration is also validated on draw create/update).
			if (
				required === null ||
				required === undefined ||
				!Number.isSafeInteger(required) ||
				required < 1
			) {
				return { eligible: false, reason: 'missing_required_installment' };
			}
			return installmentsThroughAreCovered(coverage, required)
				? { eligible: true }
				: { eligible: false, reason: 'installments_not_covered' };
		}
	}
}
