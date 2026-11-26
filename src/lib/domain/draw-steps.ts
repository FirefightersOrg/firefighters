import type { DrawStatus } from './draws';
import type { PrizeStatus } from './prizes';

/**
 * The order of a draw (UX plan PR 16): generate the roster, freeze it, load the winners, complete
 * the draw. From the draw's state it says which steps are done, which one is next and what each one
 * means, so the draw record can answer «what do I do now?» with one button. Pure: it only reads.
 */

export interface DrawPrizeCounts {
	/** Prizes that are not annulled. */
	total: number;
	/** Still waiting for a winning number or a resolution. */
	unresolved: number;
	/** Awarded or left unawarded. */
	resolved: number;
	/** Awarded and not handed over yet. */
	pendingDelivery: number;
}

/** Counts the prizes of a draw the way `draw_complete` reads them (annulled prizes do not count). */
export function countDrawPrizes(
	prizes: ReadonlyArray<{ status: PrizeStatus | string }>
): DrawPrizeCounts {
	const live = prizes.filter((prize) => prize.status !== 'annulled');
	const unresolved = live.filter((prize) => prize.status === 'pending_validation').length;
	return {
		total: live.length,
		unresolved,
		resolved: live.length - unresolved,
		pendingDelivery: live.filter(
			(prize) => prize.status === 'awarded' || prize.status === 'pending_delivery'
		).length
	};
}

export type DrawStepKey = 'generate' | 'freeze' | 'winners' | 'complete';
export type DrawStepState = 'done' | 'current' | 'pending';

export interface DrawStep {
	key: DrawStepKey;
	/** What the step is, as an action («Generar el padrón»). */
	title: string;
	state: DrawStepState;
	/** One or two sentences: what was done and when, what the step does, or what it waits for. */
	detail: string;
}

export interface DrawProgress {
	/** Empty for an annulled draw: it has no next step. */
	steps: DrawStep[];
	/** The step to do now, or null when the draw is finished or annulled. */
	current: DrawStepKey | null;
	/**
	 * Whether `draw_complete` would accept the draw: at least one prize resolved and none waiting.
	 * Null when the prizes could not be read.
	 */
	readyToComplete: boolean | null;
}

const TITLES: Record<DrawStepKey, string> = {
	generate: 'Generar el padrón',
	freeze: 'Congelar el padrón',
	winners: 'Cargar los ganadores',
	complete: 'Completar el sorteo'
};
const ORDER: DrawStepKey[] = ['generate', 'freeze', 'winners', 'complete'];

const prizeCount = (count: number) => (count === 1 ? '1 premio' : `${count} premios`);

/** What the winners step says, from the prizes of the draw. */
function winnersDetail(prizes: DrawPrizeCounts | null, state: DrawStepState): string {
	if (state === 'pending') {
		const configured = prizes?.total
			? ` Ya hay ${prizeCount(prizes.total)} ${prizes.total === 1 ? 'configurado' : 'configurados'}.`
			: '';
		return `Los números ganadores se validan contra el padrón congelado.${configured}`;
	}
	if (!prizes) return 'Configurar los premios, cargar cada número ganador y resolverlo.';
	if (prizes.total === 0)
		return 'Todavía no hay premios configurados. Configurar el primero y cargar su número ganador.';
	if (prizes.unresolved > 0)
		return prizes.unresolved === 1
			? `Falta resolver 1 de ${prizeCount(prizes.total)}.`
			: `Falta resolver ${prizes.unresolved} de ${prizeCount(prizes.total)}.`;
	const resolved = prizes.total === 1 ? '1 premio resuelto.' : `${prizes.total} premios resueltos.`;
	if (prizes.pendingDelivery === 0) return resolved;
	return `${resolved} ${
		prizes.pendingDelivery === 1 ? 'Falta entregar 1.' : `Falta entregar ${prizes.pendingDelivery}.`
	}`;
}

export function drawProgress(input: {
	status: DrawStatus;
	/** Already formatted («24/11/2026, 10:02»), or null when it did not happen. */
	rosterGeneratedAt: string | null;
	rosterFrozenAt: string | null;
	/** Null when the prizes could not be read. */
	prizes: DrawPrizeCounts | null;
}): DrawProgress {
	const { status, rosterGeneratedAt, rosterFrozenAt, prizes } = input;
	const readyToComplete = prizes ? prizes.unresolved === 0 && prizes.resolved > 0 : null;
	if (status === 'annulled') return { steps: [], current: null, readyToComplete };

	const current: DrawStepKey | null =
		status === 'scheduled'
			? 'generate'
			: status === 'roster_generated'
				? 'freeze'
				: status === 'roster_frozen'
					? readyToComplete
						? 'complete'
						: 'winners'
					: null;
	const stateOf = (key: DrawStepKey): DrawStepState => {
		if (current === null) return 'done';
		if (key === current) return 'current';
		return ORDER.indexOf(key) < ORDER.indexOf(current) ? 'done' : 'pending';
	};
	const detailOf = (key: DrawStepKey, state: DrawStepState): string => {
		if (key === 'generate') {
			if (state === 'done')
				return rosterGeneratedAt ? `Generado el ${rosterGeneratedAt}.` : 'Generado.';
			return 'El padrón es la lista de los números que participan. Dice cuáles están habilitados según los pagos confirmados hasta el corte.';
		}
		if (key === 'freeze') {
			if (state === 'done')
				return rosterFrozenAt ? `Congelado el ${rosterFrozenAt}.` : 'Congelado.';
			if (state === 'current')
				return 'Hasta congelarlo, el padrón se puede volver a generar para tomar los pagos nuevos.';
			return 'Deja el padrón definitivo: los ganadores se validan contra él.';
		}
		if (key === 'winners') return winnersDetail(prizes, state);
		if (state === 'done') return status === 'closed' ? 'Sorteo cerrado.' : 'Sorteo realizado.';
		if (state === 'current')
			return 'Todos los premios están resueltos. Las entregas pendientes se pueden registrar después.';
		return 'Cuando todos los premios estén resueltos, adjudicados o sin adjudicar.';
	};
	return {
		steps: ORDER.map((key) => {
			const state = stateOf(key);
			return { key, title: TITLES[key], state, detail: detailOf(key, state) };
		}),
		current,
		readyToComplete
	};
}
