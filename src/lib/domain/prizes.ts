/** SAN-80 storage and SAN-81 correction contracts. Text limits count Unicode code points. */
export const PRIZE_NAME_MAX = 200;
export const PRIZE_DESCRIPTION_MAX = 1000;
export const PRIZE_NOTES_MAX = 1000;
export const PRIZE_REASON_MAX = 1000;
export const WINNING_NUMBER_MIN = 0;
export const PRIZE_POSITION_MIN = 1;
export const PRIZE_STATUSES = [
	'pending_validation',
	'awarded',
	'pending_delivery',
	'delivered',
	'unawarded',
	'annulled'
] as const;
export type PrizeStatus = (typeof PRIZE_STATUSES)[number];
export const PRIZE_STATUS_LABELS: Record<PrizeStatus, string> = {
	pending_validation: 'Pendiente de validación',
	awarded: 'Adjudicado',
	pending_delivery: 'Pendiente de entrega',
	delivered: 'Entregado',
	unawarded: 'No adjudicado',
	annulled: 'Anulado'
};
export const PRIZE_TRANSITIONS: Record<PrizeStatus, readonly PrizeStatus[]> = {
	pending_validation: ['awarded', 'unawarded', 'annulled'],
	awarded: ['pending_delivery', 'annulled'],
	pending_delivery: ['delivered', 'annulled'],
	delivered: [],
	unawarded: ['annulled'],
	annulled: []
};
export const canTransitionPrize = (from: PrizeStatus, to: PrizeStatus) =>
	PRIZE_TRANSITIONS[from].includes(to);
export const WINNING_NUMBER_STATUSES = [
	'pending_review',
	'eligible_winner',
	'not_eligible',
	'no_match'
] as const;
export type WinningNumberStatus = (typeof WINNING_NUMBER_STATUSES)[number];
export const WINNING_NUMBER_STATUS_LABELS: Record<WinningNumberStatus, string> = {
	pending_review: 'Pendiente de revisión',
	eligible_winner: 'Ganador habilitado',
	not_eligible: 'No habilitado',
	no_match: 'Sin coincidencia'
};
export const WINNING_NUMBER_TRANSITIONS: Record<
	WinningNumberStatus,
	readonly WinningNumberStatus[]
> = {
	pending_review: ['eligible_winner', 'not_eligible'],
	eligible_winner: [],
	not_eligible: [],
	no_match: []
};
export const canTransitionWinningNumber = (from: WinningNumberStatus, to: WinningNumberStatus) =>
	WINNING_NUMBER_TRANSITIONS[from].includes(to);
export const PRIZE_AWARD_STATUSES = ['awarded', 'delivered', 'annulled'] as const;
export type PrizeAwardStatus = (typeof PRIZE_AWARD_STATUSES)[number];
export const PRIZE_AWARD_STATUS_LABELS: Record<PrizeAwardStatus, string> = {
	awarded: 'Adjudicado',
	delivered: 'Entregado',
	annulled: 'Anulado'
};
export const PRIZE_AWARD_TRANSITIONS: Record<PrizeAwardStatus, readonly PrizeAwardStatus[]> = {
	awarded: ['delivered', 'annulled'],
	delivered: [],
	annulled: []
};
export const canTransitionPrizeAward = (from: PrizeAwardStatus, to: PrizeAwardStatus) =>
	PRIZE_AWARD_TRANSITIONS[from].includes(to);

/**
 * Santi's decision (SAN-82 review): annulled prizes stay visible on bond/buyer records, labelled
 * "Annulled", but never count as won.
 */
export function wonPrizeCount(prizes: ReadonlyArray<{ status: string }> | null | undefined) {
	return (prizes ?? []).filter((prize) => prize.status !== 'annulled').length;
}
