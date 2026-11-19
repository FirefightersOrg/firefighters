import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
const id = 'f0000000-0000-0000-0000-000000000001';
const sale = 's0000000-0000-0000-0000-000000000001';
function page(financialStatus = '') {
	return render(Page, {
		props: {
			data: {
				campaign: { id, name: 'Campaign' },
				can: { create: true },
				collectors: [{ id: 'c', displayName: 'Ana' }],
				filters: { collector: '', buyer: 'Ada', paymentMode: '', financialStatus },
				sales: [
					{
						sale: { id: sale, paymentMode: 'installments', totalAmount: '120.00' },
						bondNumbers: ['0068'],
						buyerName: 'Ada',
						collectorName: 'Ana',
						financialStatus: 'overdue'
					}
				],
				pagination: { page: 1, pageCount: 2 }
			}
		} as never
	}).body;
}
describe('sales list page', () => {
	it('renders filters, sale, and pagination', () => {
		const body = page();
		expect(body).toContain('Register sale');
		expect(body).toContain('Ada');
		expect(body).toContain('0068');
		expect(body).toContain('Page 1 of 2');
		expect(body).toContain(`/sales/${sale}`);
	});
	it('keeps the selected financial-status filter', () => {
		expect(page('overdue')).toContain('<option value="overdue" selected="">Overdue</option>');
	});
});
