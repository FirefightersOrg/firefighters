/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

describe('sale detail', () => {
	const page = (correction: unknown = null) =>
		render(Page, {
			props: {
				data: {
					campaign: {
						id: 'c',
						name: 'Campaign',
						numberDigits: 4,
						maxNumber: 9999,
						associatedNumberOffset: 4871,
						overflowPolicy: 'reject'
					},
					sale: {
						bondId: 'b',
						bondNumberPairs: [{ base: 68, associated: 4939 }],
						sale: {
							buyerId: 'buyer',
							collectorId: 'collector',
							paymentMode: 'full_payment',
							totalAmount: '60000.00'
						},
						buyerName: 'Ada',
						collectorName: 'Ana',
						installments: []
					},
					financialStatusSnapshot: 'no_payments',
					correction
				},
				params: { id: 'c', saleId: 's' }
			} as any
		}).body;
	it('renders base and associated bond numbers with campaign numbering', () => {
		const body = page();
		expect(body).toContain('0068 / 4939');
	});
	it('shows permission-gated correction forms and the ledger-impact preview', () => {
		expect(page()).not.toContain('?/correctBuyer');
		const body = page({
			buyers: [{ id: 'new-buyer', firstName: 'Bea', lastName: 'Buyer', businessName: null }],
			collectors: [{ id: 'new-collector', displayName: 'Beto' }]
		});
		expect(body).toContain('?/correctBuyer');
		expect(body).toContain('?/correctCollector');
		expect(body).toContain('compensate historical commission');
		expect(body).toContain('database');
		expect(body).not.toContain('maxlength=');
	});
	it('warns when the buyer selector shows only part of the buyers', () => {
		const buyers = [{ id: 'b1', firstName: 'Bea', lastName: 'Buyer', businessName: null }];
		const truncated = page({ buyers, buyersTotal: 750, collectors: [] });
		expect(truncated).toContain('data-testid="buyers-truncated"');
		expect(truncated).toContain('Showing the first 1 of 750 buyers');
		expect(page({ buyers, buyersTotal: 1, collectors: [] })).not.toContain('buyers-truncated');
	});
});
