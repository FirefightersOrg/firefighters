/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
describe('roster render', () => {
	it('renders frozen, extraordinary, ineligible, filters and pagination states', () => {
		const body = render(Page, {
			props: {
				data: {
					campaign: { id: 'c' },
					draw: { id: 'd', name: 'Draw' },
					roster: { status: 'frozen' },
					filters: { q: '', eligibility: '' },
					pagination: { page: 1, pages: 2, total: 1 },
					entries: [
						{
							id: 'e',
							formattedNumber: '0002',
							numberKind: 'extraordinary',
							bondLabel: 'B-2',
							buyerName: 'Ana',
							collectorName: 'Luis',
							eligible: false,
							reasonLabel: 'Bono sin pago total'
						}
					]
				}
			} as any
		}).body;
		expect(body).toContain('Padrón congelado');
		expect(body).toContain('Extra (sorteo anterior)');
		expect(body).toContain('Bono sin pago total');
		expect(body).toContain('Siguiente');
	});
	it('shows no extra badge for rosters built from the bonds own numbers', () => {
		const body = render(Page, {
			props: {
				data: {
					campaign: { id: 'c' },
					draw: { id: 'd', name: 'Draw' },
					roster: { status: 'generated' },
					filters: { q: '', eligibility: '' },
					pagination: { page: 1, pages: 1, total: 1 },
					entries: [
						{
							id: 'e',
							formattedNumber: '0002',
							numberKind: 'associated',
							bondLabel: 'B-2',
							buyerName: 'Ana',
							collectorName: 'Luis',
							eligible: true,
							reasonLabel: ''
						}
					]
				}
			} as any
		}).body;
		expect(body).toContain('0002');
		expect(body).not.toContain('Extra');
	});
	describe('stacked rows and the way on (UX plan PR 16)', () => {
		const entry = (extra: Record<string, unknown> = {}) => ({
			id: 'e',
			formattedNumber: '0002',
			numberKind: 'base',
			bondLabel: 'B-2',
			buyerName: 'Ana Gómez',
			collectorName: 'Luis Paz',
			eligible: true,
			reasonLabel: null,
			...extra
		});
		const body = (extra: Record<string, unknown> = {}) =>
			render(Page, {
				props: {
					data: {
						campaign: { id: 'c' },
						draw: { id: 'd', name: 'Draw', status: 'roster_frozen' },
						roster: { status: 'frozen' },
						filters: { q: '', eligibility: '' },
						pagination: { page: 1, pages: 1, total: 1 },
						entries: [entry()],
						canLoadWinner: true,
						...extra
					}
				} as any
			}).body;

		it('is a stacked table with the number in the figure face and who on one line', () => {
			const html = body();
			expect(html).toContain('data-stack="true"');
			expect(html).toMatch(/data-bond-number[^>]*>\s*<span[^>]*font-figure[^>]*>0002</);
			expect(html).toContain('Ana Gómez, lo cobra Luis Paz');
			expect(html).toContain('Habilitado');
		});
		it('a bond nobody bought says who has it, and why it is not eligible', () => {
			const html = body({
				entries: [
					entry({ buyerName: 'Sin comprador', eligible: false, reasonLabel: 'Bono no vendido' })
				]
			});
			expect(html).toContain('Lo tiene Luis Paz');
			expect(html).toContain('No habilitado');
			expect(html).toContain('Bono no vendido');
		});
		it('a frozen roster leads to the winners with a button', () => {
			expect(body()).toMatch(/href="\/campaigns\/c\/draws\/d\/winners"[^>]*bg-primary/);
			expect(body()).toContain('Cargar ganadores');
			expect(body({ canLoadWinner: false })).toContain('Ver ganadores y premios');
			const finished = body({ draw: { id: 'd', name: 'Draw', status: 'completed' } });
			expect(finished).toContain('Ver ganadores y premios');
			expect(finished).not.toContain('Cargar ganadores');
		});
		it('a generated roster says it can still change and where it is frozen', () => {
			const html = body({
				draw: { id: 'd', name: 'Draw', status: 'roster_generated' },
				roster: { status: 'generated' }
			});
			expect(html).toContain('Este padrón todavía puede cambiar');
			expect(html).not.toContain('/winners');
		});
		it('keeps the filters in the page links and shows the applied one as a chip', () => {
			const html = body({
				filters: { q: 'ana', eligibility: 'eligible' },
				pagination: { page: 1, pages: 3, total: 120 }
			});
			expect(html).toContain('Elegibilidad: Habilitados');
			expect(html).toContain('?q=ana&amp;eligibility=eligible&amp;page=2');
			expect(html).toContain('120 números coinciden con la búsqueda.');
		});
	});
});
