/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ListPage from './+page.svelte';
import NewPage from './new/+page.svelte';

const campaign = { id: 'c', name: 'Campaign' };

describe('deliveries render (SAN-135)', () => {
	it('lists notes with Spanish labels, a Buenos Aires date and right-aligned bond counts', () => {
		const body = render(ListPage, {
			props: {
				data: {
					campaign,
					notes: [
						{
							id: 'n1',
							noteNumber: 7,
							issuedAt: '2026-11-20T02:30:00Z',
							collectorName: 'Ana',
							reason: 'reassignment',
							bondCount: 1200,
							createdByName: 'Operador'
						}
					],
					collectors: [{ id: 'col', displayName: 'Ana' }],
					filters: {},
					pagination: { page: 1, pageCount: 1 },
					can: { deliver: true }
				}
			} as any
		}).body;
		expect(body).toContain('Remito 0007');
		expect(body).toContain('Reasignación');
		expect(body).toContain('19/11/2026, 23:30');
		expect(body).toContain('1.200');
		expect(body).toContain('/campaigns/c/deliveries/new');
		expect(body).toMatch(/<option value=""[^>]*>Todos<\/option>/);
	});
	it('shows an empty state and no clear button without filters', () => {
		const body = render(ListPage, {
			props: {
				data: {
					campaign,
					notes: [],
					collectors: [],
					filters: {},
					pagination: { page: 1, pageCount: 1 },
					can: { deliver: false }
				}
			} as any
		}).body;
		expect(body).toContain('Todavía no hay remitos');
		expect(body).not.toContain('Limpiar');
		expect(body).not.toContain('/deliveries/new');
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
		expect(body).toMatch(
			/<button[^>]*type="submit"[^>]*disabled[^>]*>[\s\S]*Entregar y emitir remito/
		);
	});
});
