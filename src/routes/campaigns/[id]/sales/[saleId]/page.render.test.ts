import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
const campaign = 'f0000000-0000-0000-0000-000000000001';
const sale = 'a0000000-0000-0000-0000-000000000009';
describe('sale detail page', () => {
	it('renders sale links and installment schedule', () => {
		const body = render(Page, {
			props: {
				data: {
					campaign: { id: campaign, name: 'Campaign' },
					financialStatus: 'overdue',
					financialStatusSnapshot: 'overdue',
					sale: {
						bondId: 'b',
						bondNumbers: ['0068'],
						buyerName: 'Ada',
						collectorName: 'Ana',
						sale: {
							buyerId: 'u',
							collectorId: 'c',
							paymentMode: 'installments',
							totalAmount: '120000.00'
						},
						installments: [
							{
								id: 'i',
								installmentNumber: 1,
								dueDate: '2027-01-01',
								amount: '12000.00',
								status: 'pending'
							}
						]
					}
				},
				params: { id: campaign, saleId: sale }
			} as never
		}).body;
		expect(body).toContain('Installment schedule');
		expect(body).toContain('0068');
		expect(body).toContain('2027-01-01');
		expect(body).toContain('overdue');
	});
});
