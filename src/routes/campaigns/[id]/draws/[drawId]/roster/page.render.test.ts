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
							reasonLabel: 'Bond not fully paid'
						}
					]
				}
			} as any
		}).body;
		expect(body).toContain('Frozen roster');
		expect(body).toContain('extraordinary');
		expect(body).toContain('Bond not fully paid');
		expect(body).toContain('Next');
	});
});
