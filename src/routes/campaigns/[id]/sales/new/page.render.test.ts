/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
const id = 'f0000000-0000-0000-0000-000000000001';
function page(form: any = null) {
	return render(Page, {
		props: {
			data: {
				campaign: {
					id,
					name: 'Campaign',
					simpleBondValue: '60000.00',
					installmentCount: 10,
					installmentValue: '6000.00'
				},
				buyers: [{ id: 'b', type: 'individual', firstName: 'Ada', lastName: 'Lovelace' }],
				buyerSearch: '',
				buyerTotal: 31,
				canCreateBuyer: true,
				today: '2027-01-01',
				firstDueDateBounds: { min: '2026-12-01', max: '2028-01-01' }
			},
			form,
			params: { id }
		} as never
	}).body;
}
describe('sale registration page', () => {
	it('renders lookup, inline buyer and registration workflow', () => {
		const body = page();
		expect(body).toContain('Find a delivered bond');
		expect(body).toContain('Create a buyer');
		expect(body).toContain('Confirm sale');
		expect(body).not.toContain('firstDueDate');
		expect(body).toContain('Collector: Select a bond to see its holder.');
		expect(body).not.toContain('Confirmed collector');
		expect(body).toContain('4. Schedule preview');
		expect(body).toContain('Showing first 1 of 31');
	});
	it('renders field errors with their accessible descriptions', () => {
		const body = page({
			form: 'sale',
			errors: {
				bondId: ['Choose a bond.'],
				buyerId: ['Choose a buyer.'],
				firstDueDate: ['Bad date.']
			}
		});
		expect(body).toContain('bondId-error');
		expect(body).toContain('aria-describedby="buyerId-error"');
		expect(body).not.toContain('firstDueDate-error');
	});
	it('renders lookup refusal and buyer duplicate warning', () => {
		expect(page({ form: 'lookup', found: [] }).toString()).toContain(
			'Available bonds must be delivered first'
		);
		expect(
			page({
				form: 'buyer',
				duplicates: [{ id: 'b', name: 'Ada' }],
				message: 'Duplicate'
			}).toString()
		).toContain('Duplicate');
	});
});
