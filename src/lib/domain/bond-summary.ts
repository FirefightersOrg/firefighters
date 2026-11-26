import { formatDate, formatMoney } from '$lib/format';
import type { BondCommercialStatus } from './bonds';
import { centsToDecimalString, parseMoneyToCents } from './money';
import type { InstallmentStatus } from './sales';

/**
 * The bond record's summary (UX plan PR 8, audit A3): one or two sentences built from data that
 * say where the bond is, who has it, who bought it and what is owed, plus the one next step that
 * applies. Pure, so the table of state to sentence is tested once and the page only renders it.
 */

export interface BondSummaryInstallment {
	number: number;
	/** `YYYY-MM-DD`. */
	dueDate: string;
	/** The installment's amount, as a decimal string. */
	amount: string;
	/** What non-annulled payments already applied to it, as a decimal string. */
	applied: string;
	status: InstallmentStatus;
}

export interface BondSummaryInput {
	commercialStatus: BondCommercialStatus;
	/** The collector's and the buyer's names, or null when there is none or the role cannot read it. */
	collectorName: string | null;
	buyerName: string | null;
	/** The active sale's installments (empty when the bond is not sold). */
	installments: readonly BondSummaryInstallment[];
	/** The sale was marked as uncollectible. */
	uncollectible?: boolean;
	annulledAt?: string | null;
	annulReason?: string | null;
	/** Today in Buenos Aires (`YYYY-MM-DD`): an unpaid installment due before it is overdue. */
	today: string;
}

/** A piece of a sentence. With `ref`, the page may link it to the buyer's or collector's record. */
export interface SummaryPart {
	text: string;
	ref?: 'buyer' | 'collector';
}

/** What to do next with the bond, by state. The page decides whether the role may do it. */
export type BondNextStep = 'deliver' | 'sell' | 'pay';

export interface BondSummaryRow extends BondSummaryInstallment {
	/** What is still owed, in cents (0 when paid). */
	owedCents: number;
	overdue: boolean;
}

export interface BondSummary {
	sentences: SummaryPart[][];
	rows: BondSummaryRow[];
	paidCount: number;
	debtCents: number;
	overdueCents: number;
	nextStep: BondNextStep | null;
}

const cents = (value: string) => parseMoneyToCents(value) ?? 0;
const pesos = (value: number) => formatMoney(centsToDecimalString(value));
const text = (value: string): SummaryPart => ({ text: value });
const sentence = (value: string) =>
	/[.!?»]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`;

/** The installments that count (not annulled), in order, with what each still owes. */
export function installmentRows(
	installments: readonly BondSummaryInstallment[],
	today: string
): BondSummaryRow[] {
	return installments
		.filter((item) => item.status !== 'annulled')
		.map((item) => {
			const paid = item.status === 'paid' || item.status === 'paid_advance';
			const owedCents = paid ? 0 : Math.max(0, cents(item.amount) - cents(item.applied));
			return {
				...item,
				owedCents,
				overdue: owedCents > 0 && (item.status === 'overdue' || item.dueDate < today)
			};
		})
		.sort((a, b) => a.number - b.number);
}

/**
 * What is paid and what is owed, as one sentence. Shared by the bond record and the sale record, so
 * both say the same thing about the same installments.
 */
export function debtSentence(rows: readonly BondSummaryRow[], uncollectible = false): string {
	const debt = rows.reduce((sum, row) => sum + row.owedCents, 0);
	const overdue = rows.filter((row) => row.overdue).reduce((sum, row) => sum + row.owedCents, 0);
	const paidCount = rows.filter((row) => row.owedCents === 0).length;
	if (uncollectible) return `Se dio por incobrable: quedaron ${pesos(debt)} sin cobrar.`;
	if (debt === 0) return 'Está pagado.';
	if (rows.length <= 1) {
		const row = rows[0];
		const paid = cents(row.amount) - row.owedCents;
		const lead = paid > 0 ? `Pagó ${pesos(paid)} y debe ${pesos(debt)}` : `Debe ${pesos(debt)}`;
		return `${lead}, que ${row.overdue ? 'venció' : 'vence'} el ${formatDate(row.dueDate)}.`;
	}
	const lead =
		paidCount === 0
			? 'Todavía no pagó ninguna cuota'
			: `Pagó ${paidCount} ${paidCount === 1 ? 'cuota' : 'cuotas'}`;
	const tail =
		overdue === 0
			? '.'
			: overdue === debt
				? ', todo vencido.'
				: `, de los cuales ${pesos(overdue)} están vencidos.`;
	return `${lead} y debe ${pesos(debt)}${tail}`;
}

function soldSentences(input: BondSummaryInput, rows: BondSummaryRow[]): SummaryPart[][] {
	const debt = rows.reduce((sum, row) => sum + row.owedCents, 0);
	const mode = rows.length <= 1 ? ' en un pago.' : ` en ${rows.length} cuotas.`;
	const sentences: SummaryPart[][] = [
		input.buyerName
			? [text('Vendido a '), { text: input.buyerName, ref: 'buyer' }, text(mode)]
			: [text(`Vendido${mode}`)]
	];
	if (input.collectorName)
		sentences.push([
			text(debt > 0 && !input.uncollectible ? 'Lo cobra ' : 'Lo cobró '),
			{ text: input.collectorName, ref: 'collector' },
			text('.')
		]);
	sentences.push([text(debtSentence(rows, input.uncollectible))]);
	return sentences;
}

export function bondSummary(input: BondSummaryInput): BondSummary {
	const rows =
		input.commercialStatus === 'sold' ? installmentRows(input.installments, input.today) : [];
	const debtCents = rows.reduce((sum, row) => sum + row.owedCents, 0);
	const overdueCents = rows
		.filter((row) => row.overdue)
		.reduce((sum, row) => sum + row.owedCents, 0);
	const base = {
		rows,
		paidCount: rows.filter((row) => row.owedCents === 0).length,
		debtCents,
		overdueCents
	};
	const collector: SummaryPart | null = input.collectorName
		? { text: input.collectorName, ref: 'collector' }
		: null;

	switch (input.commercialStatus) {
		case 'created':
		case 'available':
			return {
				...base,
				sentences: [[text('Disponible. Todavía no se entregó a ningún cobrador.')]],
				nextStep: 'deliver'
			};
		case 'delivered_to_collector':
			return {
				...base,
				sentences: [
					collector
						? [text('Lo tiene '), collector, text('. Todavía no se vendió.')]
						: [text('Entregado a un cobrador. Todavía no se vendió.')]
				],
				nextStep: 'sell'
			};
		case 'sold':
			return {
				...base,
				sentences: soldSentences(input, rows),
				nextStep: debtCents > 0 && !input.uncollectible ? 'pay' : null
			};
		case 'returned':
			return {
				...base,
				sentences: [[text('Devuelto. No está en manos de ningún cobrador.')]],
				nextStep: null
			};
		case 'lost':
			return {
				...base,
				sentences: [
					collector ? [text('Extraviado. Lo tenía '), collector, text('.')] : [text('Extraviado.')]
				],
				nextStep: null
			};
		case 'annulled':
			return {
				...base,
				sentences: [
					[
						text(
							`Anulado${input.annulledAt ? ` el ${formatDate(input.annulledAt)}` : ''}.${
								input.annulReason?.trim() ? ` Motivo: ${sentence(input.annulReason)}` : ''
							}`
						)
					]
				],
				nextStep: null
			};
		case 'closed':
			return { ...base, sentences: [[text('Cerrado con la campaña.')]], nextStep: null };
	}
}

/** The sentences as plain text (for tests, titles and assistive tech). */
export function summaryText(summary: BondSummary): string {
	return summary.sentences.map((parts) => parts.map((part) => part.text).join('')).join(' ');
}
