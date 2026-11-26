/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { NO_ACCESS_COLLECTOR } from '$lib/domain/parties';
import { formatMoney } from '$lib/format';
import Page from './+page.svelte';
const id = 'f0000000-0000-0000-0000-000000000001';
const closed = {
	id: 's',
	settlementNumber: 5,
	collectorId: 'c',
	collectorName: 'Ana',
	status: 'closed',
	openedAt: '2026-01-01T02:59:59Z',
	closedAt: '2026-01-02',
	totals: { totalAmount: '180000.00' }
};
const open = {
	...closed,
	id: 'o',
	settlementNumber: 9,
	collectorId: 'b',
	collectorName: 'Beto',
	status: 'open',
	closedAt: null,
	totals: { totalAmount: '0.00' }
};
const noFilters = { collector: '', status: '', from: '', to: '' };
const data = (create: boolean, over: Record<string, unknown> = {}) => ({
	campaign: { id, name: 'Campaign' },
	collectors: [{ id: 'c', displayName: 'Ana' }],
	filters: noFilters,
	can: { create },
	settlements: [closed],
	...over
});
const page = (create = true, over: Record<string, unknown> = {}) =>
	render(Page, { props: { data: data(create, over), params: { id } } as any }).body;
const text = (body: string) =>
	body
		.replace(/<!--.*?-->/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ');

describe('settlements list render', () => {
	it('renders rows and filters', () => {
		const body = page();
		expect(body).toContain('Ana');
		expect(body).toContain('31/12/2025');
		expect(body).toContain('Rendiciones');
		expect(body).toContain('name="status"');
		expect(body).toContain('/settlements/new');
	});
	it('hides the new link without settlement.create', () =>
		expect(page(false)).not.toContain('/settlements/new'));
	it('keeps the selected status filter', () => {
		expect(page(true, { filters: { ...noFilters, status: 'closed' } })).toMatch(
			/value="closed"[^>]*selected/
		);
	});

	it('names each settlement with its collector, its state and, once closed, its total', () => {
		const body = page(true, { settlements: [open, closed] });
		expect(body).toMatch(
			new RegExp(`<a[^>]*href="/campaigns/${id}/settlements/o"[^>]*>Rendición 9</a>`)
		);
		expect(text(body)).toContain('Rendición 9 de Beto');
		expect(text(body)).toContain('Rendición 5 de Ana');
		expect(text(body)).toContain('Abierta el 31/12/2025');
		expect(text(body)).toContain('Cerrada el 02/01/2026');
		expect(text(body)).toContain('2 rendiciones, 1 abierta');
		// Whole pesos; an open settlement has no total yet, so it never reads «$ 0».
		expect(body).toContain(formatMoney('180000'));
		expect(body).not.toContain(formatMoney('180000', { decimals: 'always' }));
		expect(body).not.toContain(formatMoney('0'));
		expect(text(body)).toContain('se calcula al cerrar');
		expect(body).not.toContain('#9');
		expect(body).not.toMatch(/href="[^"]*\/collectors\//);
	});

	it('keeps the order it is given: the repository puts the open ones first', () => {
		const body = text(page(true, { settlements: [open, closed] }));
		expect(body.indexOf('Rendición 9')).toBeLessThan(body.indexOf('Rendición 5'));
	});

	it('shows the Spanish stand-in, with no name in the sentence, for a collector it cannot read', () => {
		const body = page(true, { settlements: [{ ...closed, collectorName: NO_ACCESS_COLLECTOR }] });
		expect(text(body)).toContain(NO_ACCESS_COLLECTOR);
		expect(text(body)).not.toContain(`de ${NO_ACCESS_COLLECTOR}`);
		expect(body).not.toContain('Unknown');
	});

	it('shows what is applied as chips that keep the other filters', () => {
		const filters = { collector: 'c', status: 'open', from: '2026-11-01', to: '2026-11-30' };
		const body = page(true, { filters, settlements: [open] });
		expect(body).toContain('aria-label="Quitar el filtro Cobrador: Ana"');
		expect(body).toContain('aria-label="Quitar el filtro Estado: Abierta"');
		expect(body).toContain('aria-label="Quitar el filtro Abierta desde: 01/11/2026"');
		expect(body).toContain('aria-label="Quitar el filtro Abierta hasta: 30/11/2026"');
		expect(body).toContain(
			`href="/campaigns/${id}/settlements?collector=c&amp;from=2026-11-01&amp;to=2026-11-30"`
		);
		expect(body).toMatch(/<input[^>]*name="from"[^>]*value="2026-11-01"/);
		expect(text(body)).toContain('4 filtros aplicados');
		// Only open ones are listed: they are not counted apart.
		expect(text(body)).toContain('1 rendición');
		expect(text(body)).not.toContain('1 rendición, 1 abierta');
	});

	it('says what to do when there are no settlements, and what to change when nothing matches', () => {
		const empty = text(page(true, { settlements: [] }));
		expect(empty).toContain('Todavía no hay rendiciones');
		expect(empty).toContain('Abrir una rendición para cargar los pagos que entrega un cobrador.');
		expect(empty).not.toContain('Quitar todos');
		const noMatch = text(
			page(true, { settlements: [], filters: { ...noFilters, status: 'open' } })
		);
		expect(noMatch).toContain('Ninguna rendición coincide con los filtros');
		expect(noMatch).toContain('Quitar todos');
	});
});
