import { formatDate, formatMoney } from '$lib/format';
import {
	debtSentence,
	installmentRows,
	type BondSummaryInstallment,
	type BondSummaryRow
} from './bond-summary';
import { centsToDecimalString } from './money';
import type { SaleStatus } from './sales';

/**
 * The buyer record's summary (UX plan PR 15, audit A12): which bonds the buyer bought in the
 * campaign, what is owed on each and in all, and who collects them. Each sale's debt is said with
 * the sentence of the bond and sale records (`debtSentence`), built from the same installment rows,
 * so the three records cannot disagree. Pure: the page only renders it.
 */

export interface BuyerSaleInput {
	saleId: string;
	status: SaleStatus;
	/** The bond as printed («0190», or «0190 + 0191» for a pata). */
	bond: string;
	collectorId: string;
	/** Null when the role cannot read the collector. */
	collectorName: string | null;
	/** When it was sold (an ISO timestamp or `YYYY-MM-DD`). */
	soldAt: string;
	/** The sale's total, as a decimal string. */
	totalAmount: string;
	/**
	 * The active plan's installments, with what the payments applied to each. Null when the record
	 * did not read them (it reads the most recent sales): the sale is then listed without a debt.
	 */
	installments: readonly BondSummaryInstallment[] | null;
	uncollectible?: boolean;
}

export interface BuyerSummaryInput {
	name: string;
	/** The buyer's sales in the campaign, newest first. */
	sales: readonly BuyerSaleInput[];
	/** Today in Buenos Aires (`YYYY-MM-DD`). */
	today: string;
}

/** A piece of a sentence. With `ref`, the page may link it to the collector's record. */
export interface BuyerPart {
	text: string;
	ref?: 'collector';
}

export interface BuyerSaleSummary {
	saleId: string;
	bond: string;
	active: boolean;
	/** «Lo compró el 16/10/2026 en 6 cuotas, por $ 60.000.» */
	terms: string;
	/** What is paid and owed, in the words of the sale record; null when it was not read. */
	debt: string | null;
	collectorId: string;
	collectorName: string | null;
	/** What is left to collect on it (0 when paid, given up, annulled or not read). */
	debtCents: number;
	overdue: boolean;
	uncollectible: boolean;
}

/** An installment that still owes something, of any of the buyer's sales. */
export interface BuyerPendingInstallment extends BondSummaryRow {
	saleId: string;
	bond: string;
}

export interface BuyerSummary {
	sentences: BuyerPart[][];
	/** Active sales first, each group newest first. */
	sales: BuyerSaleSummary[];
	/** Unpaid installments of the sales that are still collected, by due date. */
	pending: BuyerPendingInstallment[];
	/** How many bonds the buyer has in the campaign (active sales). */
	bondCount: number;
	debtCents: number;
	overdueCents: number;
	uncollectibleCents: number;
	/** What the active sales add up to, as a decimal string: the lead figure once nothing is owed. */
	totalAmount: string;
	/** The collector to settle with, when everything that is owed is collected by one. */
	payCollectorId: string | null;
	/** False when a sale was listed without its installments: the totals leave it out. */
	complete: boolean;
}

const pesos = (cents: number) => formatMoney(centsToDecimalString(cents));
const text = (value: string): BuyerPart => ({ text: value });

export function buyerSummary(input: BuyerSummaryInput): BuyerSummary {
	const pending: BuyerPendingInstallment[] = [];
	const sales = input.sales.map((sale): BuyerSaleSummary => {
		const active = sale.status === 'active';
		const rows = active && sale.installments ? installmentRows(sale.installments, input.today) : [];
		const owed = rows.reduce((sum, row) => sum + row.owedCents, 0);
		const uncollectible = active && !!sale.uncollectible;
		if (!uncollectible)
			for (const row of rows)
				if (row.owedCents > 0) pending.push({ ...row, saleId: sale.saleId, bond: sale.bond });
		const mode =
			!active || !sale.installments
				? ''
				: rows.length <= 1
					? ' en un pago'
					: ` en ${rows.length} cuotas`;
		return {
			saleId: sale.saleId,
			bond: sale.bond,
			active,
			terms: `Lo compró el ${formatDate(sale.soldAt)}${mode}, por ${formatMoney(sale.totalAmount)}.`,
			debt: !active
				? sale.status === 'annulled'
					? 'La venta fue anulada: no se cobra.'
					: 'La venta fue reemplazada por una corrección: no se cobra.'
				: sale.installments && rows.length > 0
					? debtSentence(rows, uncollectible)
					: null,
			collectorId: sale.collectorId,
			collectorName: sale.collectorName,
			debtCents: uncollectible ? 0 : owed,
			overdue: !uncollectible && rows.some((row) => row.overdue),
			uncollectible
		};
	});
	pending.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.bond.localeCompare(b.bond));

	const active = sales.filter((sale) => sale.active);
	const debtCents = active.reduce((sum, sale) => sum + sale.debtCents, 0);
	const overdueCents = pending
		.filter((row) => row.overdue)
		.reduce((sum, row) => sum + row.owedCents, 0);
	const uncollectibleCents = input.sales
		.filter((sale) => sale.status === 'active' && sale.uncollectible && sale.installments)
		.reduce(
			(sum, sale) =>
				sum +
				installmentRows(sale.installments!, input.today).reduce(
					(owed, row) => owed + row.owedCents,
					0
				),
			0
		);
	const complete = input.sales.every((sale) => sale.status !== 'active' || !!sale.installments);

	const sentences: BuyerPart[][] = [
		[
			text(
				active.length === 0
					? `${input.name} no compró bonos en esta campaña.`
					: active.length === 1
						? `${input.name} compró el bono ${active[0].bond} en esta campaña.`
						: `${input.name} compró ${active.length} bonos en esta campaña.`
			)
		]
	];
	if (active.length > 0) {
		if (debtCents > 0) {
			const tail =
				overdueCents === 0
					? '.'
					: overdueCents === debtCents
						? ', todo vencido.'
						: `, de los cuales ${pesos(overdueCents)} están vencidos.`;
			sentences.push([text(`Debe ${pesos(debtCents)}${tail}`)]);
		} else if (complete && uncollectibleCents === 0) sentences.push([text('No debe nada.')]);
		if (uncollectibleCents > 0)
			sentences.push([
				text(
					`${debtCents > 0 ? 'Otros ' : ''}${pesos(uncollectibleCents)} se dieron por incobrables.`
				)
			]);
		if (!complete) sentences.push([text('Esta cuenta no incluye sus ventas más antiguas.')]);
		// One collector for every bond: the record names them once.
		const collectors = new Set(active.map((sale) => sale.collectorId));
		const collector = active[0];
		if (collectors.size === 1 && collector.collectorName)
			sentences.push([
				text(`${active.length === 1 ? 'Lo' : 'Los'} ${debtCents > 0 ? 'cobra' : 'cobró'} `),
				{ text: collector.collectorName, ref: 'collector' },
				text('.')
			]);
	}

	const owing = new Set(
		active.filter((sale) => sale.debtCents > 0).map((sale) => sale.collectorId)
	);
	return {
		sentences,
		sales: [...active, ...sales.filter((sale) => !sale.active)],
		pending,
		bondCount: active.length,
		debtCents,
		overdueCents,
		uncollectibleCents,
		totalAmount: centsToDecimalString(
			input.sales
				.filter((sale) => sale.status === 'active')
				.reduce((sum, sale) => sum + Math.round(Number(sale.totalAmount) * 100), 0)
		),
		payCollectorId: owing.size === 1 ? [...owing][0] : null,
		complete
	};
}

/** The sentences as plain text (for tests, titles and assistive tech). */
export function buyerSummaryText(summary: BuyerSummary): string {
	return summary.sentences.map((parts) => parts.map((part) => part.text).join('')).join(' ');
}
