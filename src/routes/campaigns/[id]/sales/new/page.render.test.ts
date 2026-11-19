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
				canCreateBuyer: true,
				today: '2027-01-01'
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
		expect(body).toContain('firstDueDate');
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
