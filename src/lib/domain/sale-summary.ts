import { formatDate, formatMoney } from '$lib/format';
import {
	debtSentence,
	installmentRows,
	type BondSummaryInstallment,
	type BondSummaryRow
} from './bond-summary';
import type { SaleStatus } from './sales';

/**
 * The sale record's summary (UX plan PR 12b, audit A10): who bought which bond, when, how and for
 * how much, who collects it and what is still owed. It is built from the same installment rows as
 * the bond record's summary, so the two records never disagree about a debt. Pure: the page only
 * renders it.
 */

export interface SaleSummaryInput {
	/** The bond as printed («0068», or «0068 + 0069» for a pata). */
	bond: string;
	/** Null when the role cannot read the buyer or the collector. */
	buyerName: string | null;
	collectorName: string | null;
	/** When it was sold (an ISO timestamp or `YYYY-MM-DD`). */
	soldAt: string;
	/** The sale's total, as a decimal string. */
	totalAmount: string;
	status: SaleStatus;
	installments: readonly BondSummaryInstallment[];
	uncollectible?: boolean;
	/** Today in Buenos Aires (`YYYY-MM-DD`). */
	today: string;
}

/** A piece of a sentence. With `ref`, the page may link it to that record. */
export interface SalePart {
	text: string;
	ref?: 'buyer' | 'collector' | 'bond';
}

export interface SaleSummary {
	sentences: SalePart[][];
	rows: BondSummaryRow[];
	debtCents: number;
	overdueCents: number;
	/** There is something to collect: the sale is active, owes money and was not written off. */
	collectable: boolean;
}

const text = (value: string): SalePart => ({ text: value });

export function saleSummary(input: SaleSummaryInput): SaleSummary {
	const rows = installmentRows(input.installments, input.today);
	const debtCents = rows.reduce((sum, row) => sum + row.owedCents, 0);
	const overdueCents = rows
		.filter((row) => row.overdue)
		.reduce((sum, row) => sum + row.owedCents, 0);
	const active = input.status === 'active';
	const bond: SalePart = { text: input.bond, ref: 'bond' };
	const terms = `el ${formatDate(input.soldAt)} ${
		rows.length <= 1 ? 'en un pago' : `en ${rows.length} cuotas`
	}, por ${formatMoney(input.totalAmount)}.`;

	const sentences: SalePart[][] = [
		input.buyerName
			? [{ text: input.buyerName, ref: 'buyer' }, text(' compró el bono '), bond, text(` ${terms}`)]
			: [text('El bono '), bond, text(` se vendió ${terms}`)]
	];
	if (input.collectorName)
		sentences.push([
			text(active && debtCents > 0 && !input.uncollectible ? 'Lo cobra ' : 'Lo cobró '),
			{ text: input.collectorName, ref: 'collector' },
			text('.')
		]);
	if (!active)
		sentences.push([
			text(
				input.status === 'annulled'
					? 'La venta fue anulada: no se cobra.'
					: 'La venta fue reemplazada por una corrección: no se cobra.'
			)
		]);
	else if (rows.length > 0) sentences.push([text(debtSentence(rows, input.uncollectible))]);

	return {
		sentences,
		rows,
		debtCents,
		overdueCents,
		collectable: active && debtCents > 0 && !input.uncollectible
	};
}

/** The sentences as plain text (for tests, titles and assistive tech). */
export function saleSummaryText(summary: SaleSummary): string {
	return summary.sentences.map((parts) => parts.map((part) => part.text).join('')).join(' ');
}
