/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

describe('sale detail', () => {
	it('renders base and associated bond numbers with campaign numbering', () => {
		const body = render(Page, {
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
					financialStatusSnapshot: 'no_payments'
				},
				params: { id: 'c', saleId: 's' }
			} as any
		}).body;
		expect(body).toContain('0068 / 4939');
	});
});
