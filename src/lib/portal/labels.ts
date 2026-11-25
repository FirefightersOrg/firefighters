import { formatPaddedNumber } from '$lib/format';

/** Bond label of a sale: its base numbers, zero-padded with the campaign's digits ("0068, 0069"). */
export function bondLabel(numbers: readonly number[], digits: number): string {
	return numbers.length ? numbers.map((n) => formatPaddedNumber(n, digits)).join(', ') : '—';
}

export type SubmissionTone = 'info' | 'warning' | 'success' | 'danger';

/**
 * What the collector sees for a collection, from the payment status (single map). A draft was sent and nobody
 * touched it ("Enviado"); once the operator includes it in an open settlement it is "En rendición"; the money
 * only counts after the settlement closes ("Confirmado"). Each state has its own word, so color is never the
 * only signal. `adjusted` is a confirmed payment that was corrected afterwards.
 */
export const SUBMISSION_STATUS: Record<string, { label: string; tone: SubmissionTone }> = {
	draft: { label: 'Enviado', tone: 'info' },
	pending_in_settlement: { label: 'En rendición', tone: 'warning' },
	confirmed: { label: 'Confirmado', tone: 'success' },
	adjusted: { label: 'Confirmado', tone: 'success' },
	annulled: { label: 'Rechazado', tone: 'danger' }
};

const SUBMISSION_FALLBACK = SUBMISSION_STATUS.draft;

export function submissionStatusLabel(status: string): string {
	return (SUBMISSION_STATUS[status] ?? SUBMISSION_FALLBACK).label;
}

export function submissionStatusTone(status: string): SubmissionTone {
	return (SUBMISSION_STATUS[status] ?? SUBMISSION_FALLBACK).tone;
}

/** Today in Buenos Aires as `YYYY-MM-DD` (the default and the upper bound of the collection date). */
export function buenosAiresToday(now: Date = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Argentina/Buenos_Aires',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(now);
}
