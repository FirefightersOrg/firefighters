import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

const id = 'f0000000-0000-0000-0000-000000000001';
const buyer = {
	id: 'b0000000-0000-0000-0000-000000000001',
	type: 'individual',
	firstName: 'Ada',
	lastName: 'Lovelace',
	businessName: null,
	documentNumber: '123',
	taxId: null,
	phone: null,
	address: null,
	usualCollectorId: null,
	notes: null,
	createdBy: null,
	createdAt: '',
	updatedAt: ''
};
function page(
	buyers = [buyer],
	query = { q: '', type: '' },
	pagination = { page: 1, pageSize: 25, total: buyers.length, pageCount: 1 }
) {
	return render(Page, {
		props: {
			data: {
				campaign: { id, name: 'Campaign', status: 'draft' },
				buyers,
				collectors: [],
				query,
				pagination,
				can: { manage: true }
			},
			form: null,
			params: { id }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
		} as any
	}).body;
}
describe('buyers page', () => {
	it('renders a buyer and its record link', () => {
		const body = page();
		expect(body).toContain('Lovelace, Ada');
		expect(body).toContain(`href="/campaigns/${id}/buyers/${buyer.id}"`);
	});
	it('renders the empty state', () =>
		expect(page([])).toContain('No hay compradores para estos filtros'));
	it('keeps filters in pagination links', () => {
		const body = page(
			[buyer],
			{ q: 'Ada Lovelace', type: 'individual' },
			{
				page: 2,
				pageSize: 25,
				total: 75,
				pageCount: 3
			}
		);
		expect(body).toContain('q=Ada%20Lovelace&amp;type=individual');
		expect(body).toContain('page=3');
		expect(body).toContain('Página 2 de 3');
		expect(body).toContain('← Anterior');
	});
});
