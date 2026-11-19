/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

const id = 'f0000000-0000-0000-0000-000000000001';
const campaign = {
	id,
	name: 'Campaign',
	numberDigits: 4,
	maxNumber: 9999,
	associatedNumberOffset: 4871,
	overflowPolicy: 'reject'
};
const item = {
	sale: { id: 's', paymentMode: 'full_payment', totalAmount: '60000.00' },
	bondNumberPairs: [
		{ base: 68, associated: 4939 },
		{ base: 69, associated: 4940 }
	],
	buyerName: 'Ada',
	collectorName: 'Ana',
	financialStatus: 'no_payments'
};

describe('sales list', () => {
	it('renders each base and associated bond-number pair with campaign numbering', () => {
		const body = render(Page, {
			props: {
				data: {
					campaign,
					sales: [item],
					collectors: [],
					filters: { collector: '', buyer: '', paymentMode: '', financialStatus: '' },
					pagination: { page: 1, pageCount: 1 },
					can: { create: true }
				},
				params: { id }
			} as any
		}).body;
		expect(body).toContain('0068 / 4939, 0069 / 4940');
	});

	it('keeps the applied financial-status filter selected, with pagination links', () => {
		const body = render(Page, {
			props: {
				data: {
					campaign,
					sales: [item],
					collectors: [{ id: 'c1', displayName: 'Ana' }],
					filters: { collector: 'c1', buyer: '', paymentMode: '', financialStatus: 'overdue' },
					pagination: { page: 1, pageCount: 2 },
					can: { create: true }
				},
				params: { id }
			} as any
		}).body;
		expect(body).toMatch(/<option value="overdue"[^>]*selected/);
		expect(body).not.toMatch(/<option value="no_payments"[^>]*selected/);
		expect(body).toContain('financialStatus=overdue');
	});
});
