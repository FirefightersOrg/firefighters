import type { DeliveryNoteReason } from './deliveries';

/**
 * How a delivery is shown (UX plan PR 16, audit A15): the bonds of a delivery as the ranges the
 * operator has in the hand («0211 a 0215, 5 bonos») instead of one line per bond, and the sentences
 * and button names built from them. Pure: the page posts the same bond ids as before.
 */

/** What the grouping needs from a bond. */
export interface RangeBond {
	id: string;
	kind: string;
	units: number;
	/** Participating base numbers (a pata has several). */
	baseNumbers: readonly number[];
}

export interface BondRange {
	/** Stable key: the id of the first bond. */
	key: string;
	/** `range`: consecutive simple bonds; `single`: one simple bond; `pata`: one bond with several numbers. */
	kind: 'range' | 'single' | 'pata';
	/** First and last base number (equal for a single bond). */
	from: number | null;
	to: number | null;
	/** The base numbers of a pata, in order; empty for the other kinds. */
	numbers: number[];
	bondIds: string[];
	/** Bonds in the range. */
	count: number;
	/** Commercial units in the range (a pata counts each of its numbers). */
	units: number;
}

const isSimple = (bond: RangeBond) => bond.kind === 'simple' && bond.baseNumbers.length === 1;
const firstNumber = (bond: RangeBond) =>
	bond.baseNumbers.length ? Math.min(...bond.baseNumbers) : Number.POSITIVE_INFINITY;

/**
 * Groups bonds into ranges of consecutive base numbers, in number order. Only simple bonds join a
 * range; a pata (or a bond with no number) is always its own entry.
 */
export function groupBondRanges(bonds: readonly RangeBond[]): BondRange[] {
	const sorted = [...bonds].sort((a, b) => firstNumber(a) - firstNumber(b));
	const ranges: BondRange[] = [];
	for (const bond of sorted) {
		const last = ranges.at(-1);
		if (isSimple(bond)) {
			const number = bond.baseNumbers[0];
			if (last && last.kind !== 'pata' && last.to !== null && number === last.to + 1) {
				last.kind = 'range';
				last.to = number;
				last.bondIds.push(bond.id);
				last.count += 1;
				last.units += bond.units;
				continue;
			}
			ranges.push({
				key: bond.id,
				kind: 'single',
				from: number,
				to: number,
				numbers: [],
				bondIds: [bond.id],
				count: 1,
				units: bond.units
			});
			continue;
		}
		const numbers = [...bond.baseNumbers].sort((a, b) => a - b);
		ranges.push({
			key: bond.id,
			kind: 'pata',
			from: numbers[0] ?? null,
			to: numbers.at(-1) ?? null,
			numbers,
			bondIds: [bond.id],
			count: 1,
			units: bond.units
		});
	}
	return ranges;
}

type Format = (value: number) => string;

/** «0211 a 0215», «0220», «0100 + 0101» (a pata). */
export function rangeLabel(range: BondRange, format: Format): string {
	if (range.kind === 'pata')
		return range.numbers.length ? range.numbers.map(format).join(' + ') : 'sin número';
	if (range.from === null || range.to === null) return 'sin número';
	return range.kind === 'range'
		? `${format(range.from)} a ${format(range.to)}`
		: format(range.from);
}

export const bondCountLabel = (count: number) => (count === 1 ? '1 bono' : `${count} bonos`);

/** «5 bonos», «1 bono», «Pata de 2 números». */
export function rangeCountLabel(range: BondRange): string {
	return range.kind === 'pata'
		? `Pata de ${range.numbers.length} números`
		: bondCountLabel(range.count);
}

/** The accessible name of the control that removes a range. */
export function removeRangeLabel(range: BondRange, format: Format): string {
	const label = rangeLabel(range, format);
	if (range.kind === 'pata') return `Quitar la pata ${label}`;
	return range.kind === 'range' ? `Quitar los bonos ${label}` : `Quitar el bono ${label}`;
}

/** «Entregar 35 bonos a Jorge Medina»: the button says what is about to be recorded. */
export function deliverLabel(count: number, collectorName: string | null | undefined): string {
	const what = count > 0 ? bondCountLabel(count) : 'bonos';
	return collectorName ? `Entregar ${what} a ${collectorName}` : `Entregar ${what}`;
}

/** «0220», «0220 y 0231», «0220, 0225 y 0231». */
const listed = (items: string[]) =>
	items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`;

/** Above this many numbers a range is not checked for gaps (a delivery holds at most 500 bonds). */
const MISSING_RANGE_LIMIT = 2000;
/** Up to this many gaps (a number or a run of numbers) are named; beyond it only the count is said. */
const MISSING_NAMED = 3;

/** The numbers of `from..to` that no found bond carries: not available to deliver. */
export function missingInRange(from: number, to: number, found: readonly RangeBond[]): number[] {
	if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return [];
	if (to - from + 1 > MISSING_RANGE_LIMIT) return [];
	const present = new Set(found.flatMap((bond) => bond.baseNumbers));
	const missing: number[] = [];
	for (let number = from; number <= to; number++) if (!present.has(number)) missing.push(number);
	return missing;
}

/**
 * What a lookup did to the list, for the live region under the search: how many bonds were added,
 * how many were already there, and which numbers of the requested range are not available.
 */
export function lookupMessage(input: {
	found: readonly RangeBond[];
	/** The found bonds that were not in the list yet. */
	added: number;
	/** The requested range, when the lookup was one. */
	range?: { from: number; to: number } | null;
	/** The lookup has more matches than a delivery can hold. */
	truncated?: boolean;
	format: Format;
}): string {
	const { found, added, range, truncated, format } = input;
	if (found.length === 0) return 'Ningún bono disponible coincide.';
	const already = found.length - added;
	const parts: string[] = [];
	if (added > 0) parts.push(added === 1 ? '1 bono agregado.' : `${added} bonos agregados.`);
	if (already > 0)
		parts.push(
			added === 0
				? already === 1
					? 'Ya está en la lista.'
					: 'Ya están en la lista.'
				: already === 1
					? '1 ya estaba en la lista.'
					: `${already} ya estaban en la lista.`
		);
	if (truncated) {
		parts.push('Se muestran las primeras 500 coincidencias; acotar el rango.');
	} else if (range) {
		const missing = missingInRange(range.from, range.to, found);
		// The gaps as runs («0201 a 0210»), the way the list shows what was added.
		const gaps: [number, number][] = [];
		for (const number of missing) {
			const last = gaps.at(-1);
			if (last && number === last[1] + 1) last[1] = number;
			else gaps.push([number, number]);
		}
		const named = gaps.map(([from, to]) =>
			from === to ? format(from) : `${format(from)} a ${format(to)}`
		);
		if (missing.length === 1) parts.push(`El ${named[0]} no está disponible.`);
		else if (gaps.length > 0 && gaps.length <= MISSING_NAMED)
			parts.push(`No están disponibles: ${listed(named)}.`);
		else if (gaps.length > MISSING_NAMED)
			parts.push(`${missing.length} números de ese rango no están disponibles.`);
	}
	return parts.join(' ');
}

/**
 * The note in one sentence: what was done, how many bonds, to or by whom, and when. A collector
 * the role cannot read is left out.
 */
export function deliveryNoteSentence(input: {
	reason: DeliveryNoteReason;
	bondCount: number;
	collectorName: string | null;
	/** Already formatted («24/11/2026, 10:02»). */
	issuedAt: string;
}): string {
	const { reason, bondCount, collectorName, issuedAt } = input;
	const one = bondCount === 1;
	const what = bondCountLabel(bondCount);
	if (reason === 'return')
		return collectorName
			? `${collectorName} devolvió ${what} el ${issuedAt}.`
			: `Se ${one ? 'devolvió' : 'devolvieron'} ${what} el ${issuedAt}.`;
	const verb =
		reason === 'reassignment' ? (one ? 'reasignó' : 'reasignaron') : one ? 'entregó' : 'entregaron';
	return `Se ${verb} ${what}${collectorName ? ` a ${collectorName}` : ''} el ${issuedAt}.`;
}
