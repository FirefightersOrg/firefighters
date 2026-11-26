import { describe, expect, it } from 'vitest';
import {
	deliverLabel,
	deliveryNoteSentence,
	groupBondRanges,
	lookupMessage,
	missingInRange,
	rangeCountLabel,
	rangeLabel,
	removeRangeLabel,
	type RangeBond
} from './delivery-summary';

const simple = (number: number): RangeBond => ({
	id: `b${number}`,
	kind: 'simple',
	units: 1,
	baseNumbers: [number]
});
const pata = (...numbers: number[]): RangeBond => ({
	id: `p${numbers[0]}`,
	kind: 'pata',
	units: numbers.length,
	baseNumbers: numbers
});
const pad = (value: number) => String(value).padStart(4, '0');
const run = (from: number, to: number) =>
	Array.from({ length: to - from + 1 }, (_, i) => simple(from + i));

describe('groupBondRanges', () => {
	it('turns 35 consecutive bonds into one range', () => {
		const ranges = groupBondRanges(run(211, 245));
		expect(ranges).toHaveLength(1);
		expect(ranges[0]).toMatchObject({ kind: 'range', from: 211, to: 245, count: 35, units: 35 });
		expect(ranges[0].bondIds).toHaveLength(35);
		expect(rangeLabel(ranges[0], pad)).toBe('0211 a 0245');
		expect(rangeCountLabel(ranges[0])).toBe('35 bonos');
	});

	it('orders by number whatever the order they were added in, and splits at a gap', () => {
		const ranges = groupBondRanges([simple(215), simple(211), simple(212), simple(220)]);
		expect(ranges.map((range) => rangeLabel(range, pad))).toEqual(['0211 a 0212', '0215', '0220']);
		expect(ranges.map((range) => range.kind)).toEqual(['range', 'single', 'single']);
		expect(ranges[0].bondIds).toEqual(['b211', 'b212']);
		expect(rangeCountLabel(ranges[1])).toBe('1 bono');
	});

	it('keeps a pata as its own entry, even between consecutive numbers', () => {
		const ranges = groupBondRanges([simple(99), pata(100, 101), simple(102), simple(103)]);
		expect(ranges.map((range) => range.kind)).toEqual(['single', 'pata', 'range']);
		expect(rangeLabel(ranges[1], pad)).toBe('0100 + 0101');
		expect(rangeCountLabel(ranges[1])).toBe('Pata de 2 números');
		expect(ranges[1]).toMatchObject({ count: 1, units: 2 });
		expect(ranges[2]).toMatchObject({ from: 102, to: 103, count: 2 });
	});

	it('does not lose a bond without numbers', () => {
		const ranges = groupBondRanges([{ id: 'x', kind: 'simple', units: 1, baseNumbers: [] }]);
		expect(ranges).toHaveLength(1);
		expect(ranges[0].bondIds).toEqual(['x']);
		expect(rangeLabel(ranges[0], pad)).toBe('sin número');
	});

	it('every bond is in exactly one range', () => {
		const bonds = [...run(1, 10), pata(20, 21, 22), ...run(30, 31), simple(50)];
		const ids = groupBondRanges(bonds).flatMap((range) => range.bondIds);
		expect(ids.sort()).toEqual(bonds.map((bond) => bond.id).sort());
	});
});

describe('names', () => {
	it('names the control that removes each kind of range', () => {
		const [range, single, group] = groupBondRanges([...run(211, 215), simple(220), pata(300, 301)]);
		expect(removeRangeLabel(range, pad)).toBe('Quitar los bonos 0211 a 0215');
		expect(removeRangeLabel(single, pad)).toBe('Quitar el bono 0220');
		expect(removeRangeLabel(group, pad)).toBe('Quitar la pata 0300 + 0301');
	});

	it('the button says how many bonds and to whom', () => {
		expect(deliverLabel(35, 'Jorge Medina')).toBe('Entregar 35 bonos a Jorge Medina');
		expect(deliverLabel(1, 'Jorge Medina')).toBe('Entregar 1 bono a Jorge Medina');
		expect(deliverLabel(35, null)).toBe('Entregar 35 bonos');
		expect(deliverLabel(0, 'Jorge Medina')).toBe('Entregar bonos a Jorge Medina');
		expect(deliverLabel(0, '')).toBe('Entregar bonos');
	});
});

describe('lookupMessage', () => {
	const message = (input: Partial<Parameters<typeof lookupMessage>[0]>) =>
		lookupMessage({ found: [], added: 0, format: pad, ...input });

	it('says how many were added', () => {
		expect(message({ found: [simple(7)], added: 1 })).toBe('1 bono agregado.');
		expect(message({ found: run(211, 215), added: 5, range: { from: 211, to: 215 } })).toBe(
			'5 bonos agregados.'
		);
	});

	it('says when nothing matches or everything was already there', () => {
		expect(message({})).toBe('Ningún bono disponible coincide.');
		expect(message({ found: [simple(7)], added: 0 })).toBe('Ya está en la lista.');
		expect(message({ found: run(1, 3), added: 0 })).toBe('Ya están en la lista.');
		expect(message({ found: run(1, 3), added: 2 })).toBe(
			'2 bonos agregados. 1 ya estaba en la lista.'
		);
	});

	it('names the numbers of the range that are not available', () => {
		const found = [...run(211, 219), ...run(221, 245)];
		expect(message({ found, added: 34, range: { from: 211, to: 245 } })).toBe(
			'34 bonos agregados. El 0220 no está disponible.'
		);
		expect(
			message({
				found: [simple(1), simple(3), simple(6)],
				added: 3,
				range: { from: 1, to: 6 }
			})
		).toBe('3 bonos agregados. No están disponibles: 0002 y 0004 a 0005.');
		expect(message({ found: [simple(1)], added: 1, range: { from: 1, to: 10 } })).toBe(
			'1 bono agregado. No están disponibles: 0002 a 0010.'
		);
		expect(message({ found: run(211, 240), added: 30, range: { from: 201, to: 240 } })).toBe(
			'30 bonos agregados. No están disponibles: 0201 a 0210.'
		);
		expect(
			message({
				found: [simple(1), simple(3), simple(5), simple(7), simple(9)],
				added: 5,
				range: { from: 1, to: 9 }
			})
		).toBe('5 bonos agregados. 4 números de ese rango no están disponibles.');
	});

	it('counts the numbers of a pata as present, and skips the gaps of a truncated lookup', () => {
		expect(missingInRange(100, 102, [pata(100, 101), simple(102)])).toEqual([]);
		expect(missingInRange(5, 4, [])).toEqual([]);
		expect(missingInRange(1, 100000, [])).toEqual([]);
		expect(
			message({ found: run(1, 3), added: 3, range: { from: 1, to: 900 }, truncated: true })
		).toBe('3 bonos agregados. Se muestran las primeras 500 coincidencias; acotar el rango.');
	});
});

describe('deliveryNoteSentence', () => {
	const at = '24/11/2026, 10:02';
	it.each([
		['delivery', 35, 'Jorge Medina', 'Se entregaron 35 bonos a Jorge Medina el 24/11/2026, 10:02.'],
		['delivery', 1, 'Jorge Medina', 'Se entregó 1 bono a Jorge Medina el 24/11/2026, 10:02.'],
		['delivery', 2, null, 'Se entregaron 2 bonos el 24/11/2026, 10:02.'],
		['reassignment', 3, 'Raúl Sosa', 'Se reasignaron 3 bonos a Raúl Sosa el 24/11/2026, 10:02.'],
		['reassignment', 1, null, 'Se reasignó 1 bono el 24/11/2026, 10:02.'],
		['return', 4, 'Raúl Sosa', 'Raúl Sosa devolvió 4 bonos el 24/11/2026, 10:02.'],
		['return', 1, null, 'Se devolvió 1 bono el 24/11/2026, 10:02.'],
		['return', 2, null, 'Se devolvieron 2 bonos el 24/11/2026, 10:02.']
	] as const)('%s of %i', (reason, bondCount, collectorName, expected) => {
		expect(deliveryNoteSentence({ reason, bondCount, collectorName, issuedAt: at })).toBe(expected);
	});
});
