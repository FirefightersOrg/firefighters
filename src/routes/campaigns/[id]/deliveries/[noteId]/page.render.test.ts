/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { NO_ACCESS_COLLECTOR } from '$lib/domain/parties';

const bond = (number: number, extra: Record<string, unknown> = {}) => ({
	id: `b${number}`,
	label: `${String(number).padStart(4, '0')} / ${number + 5000}`,
	kind: 'simple',
	units: 1,
	baseNumbers: [number],
	associatedNumbers: [number + 5000],
	...extra
});
const run = (from: number, to: number) =>
	Array.from({ length: to - from + 1 }, (_, i) => bond(from + i));

/** Delivery note record (UX plan PR 16). */
describe('delivery note record', () => {
	const body = (bonds: unknown[], note: Record<string, unknown> = {}) =>
		render(Page, {
			props: {
				data: {
					campaign: {
						id: 'c',
						name: 'Campaign',
						numberDigits: 4,
						maxNumber: 9999,
						associatedNumberOffset: 5000,
						associatedNumberMode: 'linear',
						overflowPolicy: 'reject'
					},
					note: {
						id: 'n',
						noteNumber: 7,
						status: 'issued',
						reason: 'delivery',
						issuedAt: '2026-11-24T13:02:00Z',
						collectorName: 'Jorge Medina',
						createdByName: 'Ana Operadora',
						notes: null,
						...note
					},
					bonds
				}
			} as any
		}).body;

	it('says the delivery in a sentence and shows 35 bonds as one range', () => {
		const html = body(run(211, 245));
		expect(html).toContain('Se entregaron 35 bonos a Jorge Medina el 24/11/2026, 10:02.');
		expect(html).toContain('Lo registró Ana Operadora.');
		expect(html.match(/data-range="/g)).toHaveLength(1);
		expect(html).toContain('data-range="0211 a 0245"');
		expect(html).toContain('35 bonos');
		// Every bond is still a link to its record, folded under the ranges.
		expect(html.match(/href="\/campaigns\/c\/bonds\/b\d+"/g)).toHaveLength(35);
		// The label built for the printed note is not shown here.
		expect(html).not.toContain('0211 / 5211');
	});

	it('«Imprimir» is the one primary action and opens the printable note', () => {
		const html = body(run(1, 2));
		const primary = [...html.matchAll(/<a[^>]*bg-primary [^>]*>([\s\S]*?)<\/a>/g)];
		expect(primary).toHaveLength(1);
		expect(primary[0][0]).toContain('href="/campaigns/c/deliveries/n/print"');
		expect(primary[0][1].replace(/<[^>]+>/g, '').trim()).toBe('Imprimir');
	});

	it('splits at a gap, keeps a pata apart and counts its units', () => {
		const html = body([
			...run(1, 3),
			bond(7),
			bond(20, { id: 'p', kind: 'pata', units: 2, baseNumbers: [20, 21] })
		]);
		expect(html).toContain('data-range="0001 a 0003"');
		expect(html).toContain('data-range="0007"');
		expect(html).toContain('data-range="0020 + 0021"');
		expect(html).toContain('Pata de 2 números');
		expect(html).toContain('5 bonos');
		expect(html).toContain('6 unidades contando las patas');
	});

	it('a return and a collector the role cannot read have their own sentence', () => {
		expect(body(run(1, 2), { reason: 'return' })).toContain(
			'Jorge Medina devolvió 2 bonos el 24/11/2026, 10:02.'
		);
		const hidden = body(run(1, 1), { collectorName: NO_ACCESS_COLLECTOR, createdByName: null });
		expect(hidden).toContain('Se entregó 1 bono el 24/11/2026, 10:02.');
		expect(hidden).not.toContain(NO_ACCESS_COLLECTOR);
		expect(hidden).not.toContain('Lo registró');
		// A single bond is its own link: nothing to unfold.
		expect(hidden).not.toContain('Abrir la ficha de un bono');
	});

	it('shows the observations and an annulled note', () => {
		const html = body(run(1, 2), { notes: 'Devueltos sin vender', status: 'annulled' });
		expect(html).toContain('Devueltos sin vender');
		expect(html).toContain('Remito anulado');
	});
});
