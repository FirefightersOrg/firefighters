/**
 * What the rows of the collectors, buyers and draws lists say (UX plan PR 14b). Pure functions, so
 * the words are tested apart from the pages.
 */
import { formatNumber } from '$lib/format';
import type { DrawStatus } from './draws';

/** A count of bonds in words: «Sin bonos», «1 bono», «35 bonos». */
export function bondCountWords(count: number): string {
	if (!Number.isFinite(count) || count <= 0) return 'Sin bonos';
	return count === 1 ? '1 bono' : `${formatNumber(count)} bonos`;
}

export interface BalanceWords {
	/** Whose favour the balance is in, in the words of the collector's account (docs/copy.md). */
	label: string;
	/** The figure without a sign; null when there is no balance. */
	amount: number | null;
}

/**
 * A collector's balance in words, with the figure without a sign: a positive balance is money
 * Bomberos owes the collector, a negative one is money the collector owes. Null when the balance
 * was not read (the role cannot see it), so the page shows nothing instead of «Sin saldo».
 */
export function collectorBalanceWords(
	balance: string | number | null | undefined
): BalanceWords | null {
	if (balance === null || balance === undefined || balance === '') return null;
	const value = typeof balance === 'number' ? balance : Number(balance);
	if (!Number.isFinite(value)) return null;
	const cents = Math.round(value * 100);
	if (cents === 0) return { label: 'Sin saldo', amount: null };
	return {
		label: cents > 0 ? 'A favor del cobrador' : 'A cargo del cobrador',
		amount: Math.abs(cents) / 100
	};
}

/**
 * What a `tel:` link dials for a phone as people type it («2364 55-9034» is «2364559034»), or null
 * when it has no digits.
 */
export function dialNumber(phone: string | null | undefined): string | null {
	const dialable = (phone ?? '').replace(/[^\d+]/g, '');
	return /\d/.test(dialable) ? dialable : null;
}

/** Draws that have not been held yet; the rest are completed, closed or annulled. */
const PENDING_DRAW_STATUSES: readonly DrawStatus[] = [
	'scheduled',
	'roster_generated',
	'roster_frozen'
];

/**
 * The draws as a calendar: the ones still to be held with the next one first, then the ones already
 * held or annulled with the latest first. The order inside each group only depends on the date; ties
 * keep the order they came in.
 */
export function splitDraws<T extends { status: DrawStatus; drawDate: string }>(
	draws: readonly T[]
): { pending: T[]; done: T[] } {
	const byDate = (a: T, b: T) => a.drawDate.localeCompare(b.drawDate);
	return {
		pending: draws.filter((draw) => PENDING_DRAW_STATUSES.includes(draw.status)).sort(byDate),
		done: draws
			.filter((draw) => !PENDING_DRAW_STATUSES.includes(draw.status))
			.sort((a, b) => byDate(b, a))
	};
}

/** «Mostrando 26–50 de 87 compradores»: which rows of a paged list are on screen. */
export function showingWords(
	pagination: { page: number; pageSize: number; total: number },
	noun: { one: string; many: string }
): string {
	const first = (pagination.page - 1) * pagination.pageSize + 1;
	const last = Math.min(pagination.total, pagination.page * pagination.pageSize);
	return (
		`Mostrando ${formatNumber(first)}–${formatNumber(last)} de ` +
		`${formatNumber(pagination.total)} ${pagination.total === 1 ? noun.one : noun.many}`
	);
}

/**
 * A list's URL with its filters kept and, past the first page, the page. Empty values are left out,
 * so a list without filters has a clean address.
 */
export function listSearch(values: Record<string, string>, page = 1): string {
	const pairs = Object.entries(values).filter(([, value]) => value);
	if (page > 1) pairs.push(['page', String(page)]);
	const search = pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
	return search ? `?${search}` : '';
}
