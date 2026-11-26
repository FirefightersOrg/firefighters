import { formatDateTime, formatMoney, formatNumber } from '$lib/format';
import { cutoffCountdown, type NextDraw, type SubmittedSummary } from './dashboard';
import { centsToDecimalString, parseMoneyToCents } from './money';

/**
 * «Para resolver» on the campaign home (UX plan PR 13): what is waiting for someone, each item with
 * the place that resolves it. Built from the figures the page already loads, so the list is empty
 * when nothing waits and the section is not drawn. Pure: the page resolves the targets to links.
 */

/** Where an item is resolved. The page turns it into a link (or into the list it opens in place). */
export type HomeTaskTarget =
	/** The collector's open settlement. */
	| { kind: 'settlement'; settlementId: string }
	/** A new settlement for that collector (there is none open). */
	| { kind: 'new-settlement'; collectorId: string }
	/** The settlements list, open ones only. */
	| { kind: 'open-settlements' }
	/** The bonds themselves, listed under the item: no screen lists them. */
	| { kind: 'at-risk-bonds' };

export interface HomeTask {
	key: string;
	title: string;
	detail: string;
	/** Null when the role cannot go where the item is resolved: it is told, without a link. */
	target: HomeTaskTarget | null;
	/** What following the target does, in words. */
	action: string;
}

export interface HomeTasksInput {
	/** Collector-submitted payments waiting (null without the operational report). */
	submitted: SubmittedSummary | null;
	nextDraw: NextDraw | null;
	/** Open settlements of the campaign (null when the role does not see settlements). */
	openSettlements: number | null;
	can: { viewSettlements: boolean; openSettlement: boolean };
	now?: Date;
}

const plural = (count: number, one: string, many: string) =>
	`${formatNumber(count)} ${count === 1 ? one : many}`;

export function homeTasks(input: HomeTasksInput): HomeTask[] {
	const tasks: HomeTask[] = [];

	for (const row of input.submitted?.byCollector ?? []) {
		if (row.count <= 0) continue;
		const one = row.count === 1;
		const amount = formatMoney(wholePesos(row.amount));
		const title = `${plural(row.count, 'cobro enviado', 'cobros enviados')} por ${row.collectorName} sin procesar`;
		if (!input.can.viewSettlements) {
			tasks.push({
				key: `submitted-${row.collectorId}`,
				title,
				detail: `${amount}. Se ${one ? 'incluye o se rechaza' : 'incluyen o se rechazan'} desde su rendición.`,
				target: null,
				action: ''
			});
		} else if (row.openSettlementId) {
			tasks.push({
				key: `submitted-${row.collectorId}`,
				title,
				detail: `${amount}. Su rendición no se puede cerrar hasta ${one ? 'incluirlo o rechazarlo' : 'incluirlos o rechazarlos'}.`,
				target: { kind: 'settlement', settlementId: row.openSettlementId },
				action: 'Abrir la rendición'
			});
		} else {
			tasks.push({
				key: `submitted-${row.collectorId}`,
				title,
				detail: `${amount}. No tiene una rendición abierta: hace falta una para ${one ? 'incluirlo o rechazarlo' : 'incluirlos o rechazarlos'}.`,
				target: input.can.openSettlement
					? { kind: 'new-settlement', collectorId: row.collectorId }
					: { kind: 'open-settlements' },
				action: input.can.openSettlement ? 'Abrir una rendición' : 'Ver rendiciones'
			});
		}
	}

	const draw = input.nextDraw;
	if (draw && draw.atRiskCount > 0) {
		const countdown = cutoffCountdown(draw.paymentCutoffAt, input.now);
		// Once the roster is frozen, or the cutoff passed, the bonds are out; before that, they may be.
		const out = draw.status === 'roster_frozen' || countdown.state === 'passed';
		const requires = draw.requiredInstallmentNumber
			? `El sorteo exige la cuota ${draw.requiredInstallmentNumber} paga.`
			: 'El sorteo exige el pago total.';
		const cutoff = formatDateTime(draw.paymentCutoffAt);
		const when = out
			? `El corte fue el ${cutoff}.`
			: countdown.state === 'today'
				? `El corte es hoy, ${cutoff}.`
				: `El corte es el ${cutoff}: ${countdown.days === 1 ? 'falta 1 día' : `faltan ${formatNumber(countdown.days)} días`}.`;
		const one = draw.atRiskCount === 1;
		tasks.push({
			key: `draw-${draw.id}`,
			title: `${plural(draw.atRiskCount, 'bono vendido', 'bonos vendidos')} ${
				out
					? one
						? 'no entra en'
						: 'no entran en'
					: one
						? 'puede quedar fuera de'
						: 'pueden quedar fuera de'
			} «${draw.name}»`,
			detail: `${requires} ${when}`,
			target: { kind: 'at-risk-bonds' },
			action: one ? 'Ver el bono' : 'Ver los bonos'
		});
	}

	if (input.can.viewSettlements && (input.openSettlements ?? 0) > 0) {
		const count = input.openSettlements as number;
		tasks.push({
			key: 'open-settlements',
			title: plural(count, 'rendición abierta', 'rendiciones abiertas'),
			detail:
				count === 1
					? 'Sus pagos quedan confirmados cuando se cierra.'
					: 'Sus pagos quedan confirmados cuando se cierran.',
			target: { kind: 'open-settlements' },
			action: count === 1 ? 'Ver la rendición' : 'Ver rendiciones'
		});
	}

	return tasks;
}

/**
 * A collector's balance for the home: its amount without a sign, and whether the collector owes it
 * (a balance in favour of the institution). The list is of balances in the collector's favour, so
 * only the other direction is said in words; a bare minus sign is never shown. Null when it is zero.
 */
export function balanceWords(balance: string): { amount: string; owes: boolean } | null {
	const negative = balance.trim().startsWith('-');
	const amount = negative ? balance.trim().slice(1) : balance.trim();
	if (!/[1-9]/.test(amount)) return null;
	return { amount, owes: negative };
}

/**
 * An amount rounded to whole pesos (half up, away from zero), as a decimal string. The home is a
 * summary: no figure on it carries cents. Anything that is not an amount is returned as given.
 */
export function wholePesos(value: string): string {
	const text = value.trim();
	const negative = text.startsWith('-');
	const cents = parseMoneyToCents(negative ? text.slice(1) : text);
	if (cents === null) return value;
	const rounded = Math.round(cents / 100) * 100;
	return `${negative && rounded > 0 ? '-' : ''}${centsToDecimalString(rounded)}`;
}
