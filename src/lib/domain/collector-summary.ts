import { formatMoney } from '$lib/format';
import type { BondCommercialStatus } from './bonds';
import { centsToDecimalString, parseMoneyToCents } from './money';

/**
 * The collector record's summary (UX plan PR 15, audit A12): how many bonds the collector has and
 * how many are sold, what is left to collect and how much of it is overdue, and what the current
 * account says, in sentences built from data, plus the one next step that fits. Pure, so the table
 * of state to sentence is tested once and the page only renders it.
 */

/** One unpaid installment of a sale made through the collector. */
export interface CollectorDebt {
	/** `YYYY-MM-DD`. */
	dueDate: string;
	/** What is still owed on it, as a decimal string. */
	owed: string;
	status: string;
	/** The sale was given up as uncollectible: it is owed, but nobody is going to collect it. */
	uncollectible?: boolean;
}

export interface CollectorSummaryInput {
	name: string;
	/** How many bonds of the campaign the collector has (exact). */
	bondsTotal: number;
	/** The bonds the record lists: all of them, or the first ones when there are more than it reads. */
	bonds: readonly { commercialStatus: BondCommercialStatus }[];
	/** Every unpaid installment, or null when it could not be read. */
	debts: readonly CollectorDebt[] | null;
	/**
	 * The current account's balance: positive in favour of the collector, negative in favour of the
	 * institution. `null` when the role cannot read it or it could not be computed: it is then left
	 * out, never printed as zero.
	 */
	balance: number | null;
	/** Today in Buenos Aires (`YYYY-MM-DD`): an unpaid installment due before it is overdue. */
	today: string;
}

/** A piece of a sentence. With `ref`, the page may link it. */
export interface CollectorPart {
	text: string;
	ref?: 'ledger';
}

/** What to do next with the collector. The page decides whether the role may do it. */
export type CollectorNextStep = 'pay' | 'deliver';

export interface CollectorSummary {
	sentences: CollectorPart[][];
	/** Null when the record does not list every bond, so they cannot be counted by state. */
	soldCount: number | null;
	unsoldCount: number | null;
	/** What is left to collect, without the sales given up as uncollectible. */
	debtCents: number;
	overdueCents: number;
	/** How many installments that is. */
	debtCount: number;
	uncollectibleCents: number;
	/** Null when the balance is not known. */
	balanceCents: number | null;
	nextStep: CollectorNextStep;
}

const pesos = (cents: number) => formatMoney(centsToDecimalString(cents));
const text = (value: string): CollectorPart => ({ text: value });
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** «22 vendidos, 12 sin vender y 1 extraviado». */
function byState(groups: { count: number; one: string; many: string }[]): string {
	const said = groups
		.filter((group) => group.count > 0)
		.map((group) => `${group.count} ${plural(group.count, group.one, group.many)}`);
	return said.length <= 1 ? said.join('') : `${said.slice(0, -1).join(', ')} y ${said.at(-1)}`;
}

function bondsSentence(input: CollectorSummaryInput, sold: number, unsold: number): string {
	const total = input.bondsTotal;
	if (total === 0) return `${input.name} no tiene bonos de esta campaña.`;
	const lead = `${input.name} tiene ${total} ${plural(total, 'bono', 'bonos')}`;
	// More bonds than the record reads: the split by state would be of a part, so it is not said.
	if (input.bonds.length !== total) return `${lead}.`;
	const lost = input.bonds.filter((bond) => bond.commercialStatus === 'lost').length;
	const other = total - sold - unsold - lost;
	if (sold === total) return `${lead}, ${plural(total, 'vendido', 'todos vendidos')}.`;
	if (unsold === total) return `${lead}, ${plural(total, 'sin vender', 'todos sin vender')}.`;
	return `${lead}: ${byState([
		{ count: sold, one: 'vendido', many: 'vendidos' },
		{ count: unsold, one: 'sin vender', many: 'sin vender' },
		{ count: lost, one: 'extraviado', many: 'extraviados' },
		{ count: other, one: 'en otro estado', many: 'en otro estado' }
	])}.`;
}

export function collectorSummary(input: CollectorSummaryInput): CollectorSummary {
	const complete = input.bonds.length === input.bondsTotal;
	const sold = input.bonds.filter((bond) => bond.commercialStatus === 'sold').length;
	const unsold = input.bonds.filter(
		(bond) => bond.commercialStatus === 'delivered_to_collector'
	).length;

	const debts = (input.debts ?? []).map((debt) => ({
		...debt,
		cents: parseMoneyToCents(debt.owed) ?? 0
	}));
	const collectable = debts.filter((debt) => !debt.uncollectible && debt.cents > 0);
	const debtCents = collectable.reduce((sum, debt) => sum + debt.cents, 0);
	const overdueCents = collectable
		.filter((debt) => debt.status === 'overdue' || debt.dueDate < input.today)
		.reduce((sum, debt) => sum + debt.cents, 0);
	const uncollectibleCents = debts
		.filter((debt) => debt.uncollectible)
		.reduce((sum, debt) => sum + debt.cents, 0);

	const sentences: CollectorPart[][] = [[text(bondsSentence(input, sold, unsold))]];
	if (input.debts !== null) {
		if (debtCents > 0) {
			const tail =
				overdueCents === 0
					? '.'
					: overdueCents === debtCents
						? ', todo vencido.'
						: `, de los cuales ${pesos(overdueCents)} están vencidos.`;
			sentences.push([text(`Le falta cobrar ${pesos(debtCents)}${tail}`)]);
		} else if (sold > 0) sentences.push([text('No le falta cobrar nada.')]);
		if (uncollectibleCents > 0)
			sentences.push([
				text(
					`${debtCents > 0 ? 'Otros ' : ''}${pesos(uncollectibleCents)} se dieron por incobrables.`
				)
			]);
	}

	const balanceCents = input.balance === null ? null : Math.round(input.balance * 100);
	if (balanceCents !== null) {
		const account: CollectorPart = { text: 'cuenta corriente', ref: 'ledger' };
		if (balanceCents > 0)
			sentences.push([text(`Tiene ${pesos(balanceCents)} a su favor en la `), account, text('.')]);
		else if (balanceCents < 0)
			sentences.push([
				text('Su '),
				account,
				text(` tiene ${pesos(-balanceCents)} a favor de Bomberos.`)
			]);
		else sentences.push([text('Su '), account, text(' no tiene saldo.')]);
	}

	return {
		sentences,
		soldCount: complete ? sold : null,
		unsoldCount: complete ? unsold : null,
		debtCents,
		overdueCents,
		debtCount: collectable.length,
		uncollectibleCents,
		balanceCents,
		nextStep: debtCents > 0 ? 'pay' : 'deliver'
	};
}

/** The sentences as plain text (for tests, titles and assistive tech). */
export function collectorSummaryText(summary: CollectorSummary): string {
	return summary.sentences.map((parts) => parts.map((part) => part.text).join('')).join(' ');
}
