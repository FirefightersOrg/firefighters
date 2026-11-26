/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ListPage from './+page.svelte';
import NewPage from './new/+page.svelte';

const campaign = { id: 'c', name: 'Campaign' };

const note = {
	id: 'n1',
	noteNumber: 7,
	issuedAt: '2026-11-20T02:30:00Z',
	collectorId: 'col',
	collectorName: 'Ana',
	status: 'issued',
	reason: 'reassignment',
	bondCount: 1200,
	createdByName: 'Operador'
};
const list = (over: Record<string, unknown> = {}) =>
	render(ListPage, {
		props: {
			data: {
				campaign,
				notes: [note],
				collectors: [{ id: 'col', displayName: 'Ana' }],
				filters: {},
				pagination: { page: 1, pageSize: 25, total: 1, pageCount: 1 },
				can: { deliver: true },
				...over
			}
		} as any
	}).body;
const text = (body: string) =>
	body
		.replace(/<!--.*?-->/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ');

describe('deliveries render (SAN-135)', () => {
	it('lists notes with Spanish labels, a Buenos Aires date and right-aligned bond counts', () => {
		const body = list();
		expect(body).toContain('Remito 0007');
		expect(body).toContain('Reasignación');
		expect(body).toContain('19/11/2026, 23:30');
		expect(body).toContain('1.200');
		expect(body).toContain('/campaigns/c/deliveries/new');
		expect(body).toMatch(/<option value=""[^>]*>Todos<\/option>/);
	});
	it('shows an empty state and no clear link without filters', () => {
		const body = list({
			notes: [],
			collectors: [],
			pagination: { page: 1, pageSize: 25, total: 0, pageCount: 1 },
			can: { deliver: false }
		});
		expect(body).toContain('Todavía no hay remitos');
		expect(text(body)).toContain('Un remito se emite al entregar bonos a un cobrador');
		expect(body).not.toContain('Quitar todos');
		expect(body).not.toContain('/deliveries/new');
	});
	it('names the note as it is said: who the bonds go to, or who returns them, and how many', () => {
		const body = list({
			notes: [
				note,
				{
					...note,
					id: 'n2',
					noteNumber: 13,
					reason: 'return',
					collectorName: 'Lucía',
					bondCount: 1
				}
			],
			pagination: { page: 1, pageSize: 25, total: 2, pageCount: 1 }
		});
		expect(body).toMatch(/<a[^>]*href="\/campaigns\/c\/deliveries\/n1"[^>]*>Remito 0007<\/a>/);
		expect(text(body)).toContain('Remito 0007 a Ana');
		expect(text(body)).toContain('1.200 bonos');
		expect(text(body)).toContain('Reasignación del 19/11/2026');
		expect(text(body)).toContain('Remito 0013 de Lucía');
		expect(text(body)).toContain('1 bono ');
		expect(text(body)).toContain('Devolución del 19/11/2026');
		expect(text(body)).toContain('Mostrando 1–2 de 2 remitos');
		expect(body).not.toMatch(/href="[^"]*\/collectors\//);
	});
	it('leaves the collector out of the sentence when the role cannot read it, and marks an annulled note', () => {
		const body = list({ notes: [{ ...note, collectorName: null, status: 'annulled' }] });
		expect(text(body)).toContain('Sin acceso al cobrador');
		expect(text(body)).not.toMatch(/Remito 0007 (a|de) /);
		expect(text(body)).toContain('Anulado');
		expect(body).not.toContain('Unknown');
	});
	it('keeps every filter in the form, as chips and across pages', () => {
		const filters = { collector: 'col', number: '7', from: '2026-11-01', to: '2026-11-30' };
		const body = list({
			filters,
			pagination: { page: 1, pageSize: 25, total: 30, pageCount: 2 }
		});
		expect(body).toMatch(/<input[^>]*name="number"[^>]*value="7"/);
		expect(body).toMatch(/<option value="col"[^>]*selected/);
		expect(body).toMatch(/<input[^>]*name="from"[^>]*value="2026-11-01"/);
		expect(body).toContain(
			'/deliveries?collector=col&amp;number=7&amp;from=2026-11-01&amp;to=2026-11-30&amp;page=2'
		);
		expect(body).toContain('aria-label="Quitar el filtro Cobrador: Ana"');
		expect(body).toContain('aria-label="Quitar el filtro Emitido desde: 01/11/2026"');
		expect(body).toContain('aria-label="Quitar el filtro Emitido hasta: 30/11/2026"');
		expect(body).toContain('/deliveries?collector=col&amp;number=7&amp;to=2026-11-30"');
		expect(text(body)).toContain('Quitar todos');
		const noMatch = text(
			list({
				notes: [],
				filters: { number: '9999' },
				pagination: { page: 1, pageSize: 25, total: 0, pageCount: 1 }
			})
		);
		expect(noMatch).toContain('Ningún remito coincide con los filtros');
	});
	it('shows the locked message instead of the forms when deliveries are not allowed', () => {
		const body = render(NewPage, {
			props: {
				data: {
					campaign,
					canDeliver: false,
					lockedMessage: 'Los bonos se entregan solo con la campaña activa.',
					canSeeCollectors: true,
					collectors: []
				},
				form: null
			} as any
		}).body;
		expect(body).toContain('Los bonos se entregan solo con la campaña activa.');
		expect(body).not.toContain('?/deliver');
	});
	it('renders lookup and delivery forms with the scan hint', () => {
		const body = render(NewPage, {
			props: {
				data: {
					campaign,
					canDeliver: true,
					lockedMessage: '',
					canSeeCollectors: false,
					collectors: [{ id: 'col', displayName: 'Ana' }]
				},
				form: null
			} as any
		}).body;
		expect(body).toContain('?/lookup');
		expect(body).toContain('?/deliver');
		expect(body).toContain('escanear el código de barras');
		expect(body).toContain('Solo un administrador puede ver los cobradores.');
		// UX plan PR 16: the button names what it records; with no bonds yet it is «Entregar bonos».
		expect(body).toMatch(/<button[^>]*type="submit"[^>]*disabled[^>]*>[\s\S]*Entregar bonos/);
	});
});
