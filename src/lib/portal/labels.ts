import { formatPaddedNumber } from '$lib/format';

/** Bond label of a sale: its base numbers, zero-padded with the campaign's digits ("0068, 0069"). */
export function bondLabel(numbers: readonly number[], digits: number): string {
	return numbers.length ? numbers.map((n) => formatPaddedNumber(n, digits)).join(', ') : '—';
}

/**
 * What the collector sees for a collection it registered. The money only counts after the operator closes a
 * settlement, so both a draft and a payment included in an open settlement read as "Pendiente de rendición".
 */
export function submissionStatusLabel(status: string): string {
	if (status === 'confirmed') return 'Confirmado';
	if (status === 'annulled') return 'Rechazado';
	return 'Pendiente de rendición';
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
