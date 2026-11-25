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
});
