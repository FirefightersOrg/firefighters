import { formatPaddedNumber } from '$lib/format';

/** Bond label of a sale: its base numbers, zero-padded with the campaign's digits ("0068, 0069"). */
export function bondLabel(numbers: readonly number[], digits: number): string {
	return numbers.length ? numbers.map((n) => formatPaddedNumber(n, digits)).join(', ') : '—';
}
