/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
const id = 'f0000000-0000-0000-0000-000000000001';
const data = (create: boolean) => ({
	campaign: { id, name: 'Campaign' },
	collectors: [{ id: 'c', displayName: 'Ana' }],
	filters: { collector: '', status: '', from: '', to: '' },
	can: { create },
	settlements: [
		{
			id: 's',
			settlementNumber: 5,
			collectorName: 'Ana',
			status: 'closed',
			openedAt: '2026-01-01T02:59:59Z',
			closedAt: '2026-01-02',
			totals: { totalAmount: '12.00' }
		}
	]
});
describe('settlements list render', () => {
	it('renders rows and filters', () => {
		const body = render(Page, { props: { data: data(true), params: { id } } as any }).body;
		expect(body).toContain('Ana');
		expect(body).toContain('31/12/2025');
		expect(body).toContain('Rendiciones');
		expect(body).toContain('name="status"');
		expect(body).toContain('/settlements/new');
	});
	it('hides the new link without settlement.create', () =>
		expect(
			render(Page, { props: { data: data(false), params: { id } } as any }).body
		).not.toContain('/settlements/new'));
	it('keeps the selected status filter', () => {
		const selected = {
			...data(true),
			filters: { collector: '', status: 'closed', from: '', to: '' }
		};
		expect(render(Page, { props: { data: selected, params: { id } } as any }).body).toMatch(
			/value="closed"[^>]*selected/
		);
	});
});
