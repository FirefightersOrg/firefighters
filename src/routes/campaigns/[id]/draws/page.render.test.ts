/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
const id = 'f0000000-0000-0000-0000-000000000001';
const draw = (overrides: Record<string, unknown> = {}) => ({
	id: 'd',
	name: 'December',
	drawType: 'monthly',
	drawDate: '2026-12-10',
	paymentCutoffAt: '2026-12-08T23:59:00-03:00',
	status: 'scheduled',
	...overrides
});
const data = (create: boolean, draws = [draw()], filters = { type: '', status: '' }) => ({
	campaign: { id, name: 'Campaign' },
	filters,
	can: { create },
	draws
});
const body = (...args: Parameters<typeof data>) =>
	render(Page, { props: { data: data(...args) } as any }).body;
const text = (html: string) =>
	html
		.replace(/<!--.*?-->/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ');

describe('draws render', () => {
	it('renders filters and rows', () => expect(body(true)).toContain('December'));
	it('hides create without permission', () => expect(body(false)).not.toContain('/draws/new'));

	it('each row is the draw (the link to its record), its state, its date and the cutoff', () => {
		const html = body(true);
		expect(html).toMatch(new RegExp(`<a[^>]*href="/campaigns/${id}/draws/d"[^>]*>December</a>`));
		const row = text(html);
		expect(row).toContain('Programado');
		expect(row).toContain('10/12/2026');
		expect(row).toMatch(/08\/12\/2026, 23:59/);
		expect(row).toContain('Mensual');
		// Below 720px the row is stacked; the date and the cutoff are lines with their label.
		expect(html).toContain('data-stack="true"');
		expect(html).toContain('data-label="Fecha"');
		expect(html).toContain('data-label="Corte de pagos"');
	});

	it('is a calendar: what is still to be held first, the next one on top', () => {
		const html = text(
			body(true, [
				draw({ id: 'f', name: 'Draw of June', drawDate: '2027-06-24' }),
				draw({
					id: 'n',
					name: 'Draw of November',
					drawDate: '2026-12-08',
					status: 'roster_frozen'
				}),
				draw({ id: 'o', name: 'Draw of October', drawDate: '2026-10-28', status: 'completed' }),
				draw({ id: 's', name: 'Draw of September', drawDate: '2026-09-30', status: 'closed' })
			])
		);
		const order = [
			'Sorteos por realizar',
			'Draw of November',
			'Draw of June',
			'Sorteos realizados o anulados',
			'Draw of October',
			'Draw of September'
		].map((word) => html.indexOf(word));
		expect(order.every((index) => index >= 0)).toBe(true);
		expect(order).toEqual([...order].sort((a, b) => a - b));
		// The state says whether the roster is frozen, in words.
		expect(html).toContain('Padrón congelado');
	});

	it('says so when nothing is left to be held', () => {
		const html = text(body(true, [draw({ status: 'completed' })]));
		expect(html).toContain('No queda ningún sorteo por realizar.');
		expect(html).not.toContain('Sorteos por realizar');
	});

	it('the two filters are a folded GET form, refilled, and what is applied is a chip', () => {
		const html = body(true, [draw()], { type: 'monthly', status: 'scheduled' });
		expect(html).toMatch(/<form[^>]*method="GET"/);
		expect(html).toMatch(/<details[\s\S]*<select[^>]*name="type"[\s\S]*<select[^>]*name="status"/);
		expect(html).toMatch(/<option[^>]*value="monthly"[^>]*selected/);
		expect(html).toMatch(/<option[^>]*value="scheduled"[^>]*selected/);
		// Each chip removes its filter and keeps the other one.
		expect(html).toMatch(
			new RegExp(
				`<a[^>]*href="/campaigns/${id}/draws\\?status=scheduled"[^>]*aria-label="Quitar el filtro Tipo: Mensual"`
			)
		);
		expect(html).toMatch(
			new RegExp(
				`<a[^>]*href="/campaigns/${id}/draws\\?type=monthly"[^>]*aria-label="Quitar el filtro Estado: Programado"`
			)
		);
		expect(text(html)).toContain('2 filtros aplicados');
		expect(text(html)).toContain('Quitar todos');
	});

	it('a value the load does not filter by is not shown as a filter', () => {
		const html = text(body(true, [draw()], { type: 'nope', status: '' }));
		expect(html).not.toContain('Quitar el filtro');
		expect(html).not.toContain('filtro aplicado');
	});

	it('an empty list says what to do', () => {
		expect(text(body(true, []))).toContain('Crear el primero con «Nuevo sorteo».');
		const viewer = text(body(false, []));
		expect(viewer).toContain('Todavía no hay sorteos');
		expect(viewer).toContain('Los crea quien administra la campaña.');
		const filtered = body(true, [], { type: '', status: 'annulled' });
		expect(text(filtered)).toContain('Ningún sorteo coincide con los filtros');
		expect(filtered).toMatch(
			new RegExp(`<a[^>]*href="/campaigns/${id}/draws"[^>]*>[\\s\\S]*?Ver todos los sorteos`)
		);
	});
});
