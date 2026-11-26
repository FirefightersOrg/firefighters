import { formatNumber } from '$lib/format';

/**
 * URLs and counts of a filtered list (UX plan PR 14). The filters of a list live in its query
 * string, so every link the list draws to itself (another page, the list without one filter) has to
 * carry the ones that stay. Empty values are left out; `page` is written only from page 2 on.
 *
 * The pathname is the caller's `resolve()`d route; only a search string is appended, which
 * `ResolvedPathname` does not model, hence the return type follows the pathname's.
 */
export function listUrl<Path extends string>(
	pathname: Path,
	values: Record<string, string | null | undefined>,
	change: { page?: number; without?: string } = {}
): Path {
	const pairs = Object.entries(values).filter(
		(pair): pair is [string, string] => !!pair[1] && pair[0] !== change.without
	);
	if (change.page && change.page > 1) pairs.push(['page', String(change.page)]);
	const search = pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
	return (search ? `${pathname}?${search}` : pathname) as Path;
}

/** «Mostrando 26–50 de 147 ventas»: which rows of the whole list this page holds. */
export function showingRange(
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
