import { parseMoneyInput, parseMoneyToCents } from './money';

/**
 * What the open settlement needs to enter a payment by bond number (UX plan PR 7): the collector's
 * sales with debt, found by number in the browser. Pure functions; the server validates the same
 * fields again in the `add` action.
 */

/** What the repository puts in `buyer` when the caller's role cannot read the buyer. Never shown. */
export const UNREADABLE_BUYER = 'Unknown buyer';

/** One unpaid installment of one of the collector's active sales. */
export interface PaymentCandidate {
	id: string;
	saleId: string;
	/** The bond's base number(s), as printed («0024»). */
	bond: string;
	buyer: string;
	dueDate: string;
	/** What is still owed on the installment, as a decimal string. */
	amount: string;
	status: string;
	number: number;
}

export interface CandidateSale {
	saleId: string;
	bond: string;
	/** Null when the role cannot read the buyer. */
	buyer: string | null;
	/** In the order to pay them: by installment number. */
	installments: PaymentCandidate[];
	debtCents: number;
	overdueCents: number;
}

const cents = (value: string | number | null | undefined) =>
	parseMoneyToCents(String(value ?? '')) ?? 0;

/** The candidates as sales, in the order their first installment came. */
export function groupCandidatesBySale(candidates: readonly PaymentCandidate[]): CandidateSale[] {
	const sales = new Map<string, CandidateSale>();
	for (const candidate of candidates) {
		let sale = sales.get(candidate.saleId);
		if (!sale) {
			sale = {
				saleId: candidate.saleId,
				bond: candidate.bond,
				buyer: candidate.buyer && candidate.buyer !== UNREADABLE_BUYER ? candidate.buyer : null,
				installments: [],
				debtCents: 0,
				overdueCents: 0
			};
			sales.set(candidate.saleId, sale);
		}
		sale.installments.push(candidate);
		sale.debtCents += cents(candidate.amount);
		if (candidate.status === 'overdue') sale.overdueCents += cents(candidate.amount);
	}
	for (const sale of sales.values()) sale.installments.sort((a, b) => a.number - b.number);
	return [...sales.values()];
}

/**
 * The number somebody typed, as digits («24», « 0024 » and «n.º 24» are the same bond). Null when
 * there is no digit in it.
 */
export function bondQueryNumber(query: string): number | null {
	const digits = query.replace(/\D/g, '');
	return digits === '' ? null : Number(digits);
}

/**
 * The sales whose bond has that base number. Compared as numbers, so leading zeros do not matter.
 * More than one result means the number is not enough to tell them apart: the caller must not pick.
 */
export function findSalesByBondNumber(
	sales: readonly CandidateSale[],
	query: string
): CandidateSale[] {
	const wanted = bondQueryNumber(query);
	if (wanted === null) return [];
	return sales.filter((sale) =>
		sale.bond
			.split(',')
			.map((part) => part.trim())
			.some((part) => /^\d+$/.test(part) && Number(part) === wanted)
	);
}

/** «Cuota 4», «Cuotas 2 y 3», «Cuotas 1, 2 y 3». Empty when the payment has no installment. */
export function installmentsLabel(numbers: readonly number[]): string {
	const sorted = [...numbers].sort((a, b) => a - b);
	if (sorted.length === 0) return '';
	if (sorted.length === 1) return `Cuota ${sorted[0]}`;
	return `Cuotas ${sorted.slice(0, -1).join(', ')} y ${sorted.at(-1)}`;
}

/** The sum, in cents, of the amounts of the checked installments. Invalid amounts count as zero. */
export function selectedTotalCents(
	installments: readonly PaymentCandidate[],
	checked: Readonly<Record<string, boolean>>,
	amounts: Readonly<Record<string, string>>
): number {
	return installments
		.filter((installment) => checked[installment.id])
		.reduce(
			(sum, installment) =>
				sum + (parseMoneyInput(amounts[installment.id] ?? installment.amount) ?? 0),
			0
		);
}

/**
 * The cash the collector hands over: the cash collected less the commission kept from it. Transfers
 * go straight to the institution, so they are not part of it. Never negative.
 */
export function cashToHandOverCents(totals: {
	totalCash: string | number;
	commissionPaidAmount: string | number;
}): number {
	return Math.max(0, cents(totals.totalCash) - cents(totals.commissionPaidAmount));
}
