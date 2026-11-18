import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

const campaignId = 'f0000000-0000-0000-0000-000000000001';
const bondId = 'b0000000-0000-0000-0000-000000000001';
function page(campaignBonds: unknown[] = []) {
	return render(Page, {
		props: {
			data: {
				campaign: { id: campaignId, name: 'Campaign' },
				buyer: {
					id: 'b0000000-0000-0000-0000-000000000002',
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
					updatedAt: ''
				},
				collector: null,
				collectors: [],
				canManage: false,
				campaignBonds,
				historicalBonds: [],
				audit: null
			},
			form: null,
			params: {}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
		} as any
	}).body;
}
describe('buyer record page', () => {
	it('renders assigned bond numbers with their link', () => {
		const body = page([
			{
				id: bondId,
				campaignId,
				campaignName: 'Campaign',
				campaignNumberDigits: 4,
				baseNumbers: [68]
			}
		]);
		expect(body).toContain('0068');
		expect(body).toContain(`href="/campaigns/${campaignId}/bonds/${bondId}"`);
	});
	it('renders empty bond states', () => {
		const body = page();
		expect(body).toContain('No bonds purchased in this campaign.');
		expect(body).toContain('No historical numbers.');
	});
});
