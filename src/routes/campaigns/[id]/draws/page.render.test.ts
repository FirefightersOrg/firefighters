/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
const id = 'f0000000-0000-0000-0000-000000000001';
const data = (create: boolean) => ({
	campaign: { id, name: 'Campaign' },
	filters: { type: '', status: '' },
	can: { create },
	draws: [
		{ id: 'd', name: 'December', drawType: 'monthly', drawDate: '2026-12-10', status: 'scheduled' }
	]
});
describe('draws render', () => {
	it('renders filters and rows', () =>
		expect(render(Page, { props: { data: data(true) } as any }).body).toContain('December'));
	it('hides create without permission', () =>
		expect(render(Page, { props: { data: data(false) } as any }).body).not.toContain('/draws/new'));
});
