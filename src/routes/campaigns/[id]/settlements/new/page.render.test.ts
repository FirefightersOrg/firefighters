/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
describe('new settlement render', () =>
	it('renders collector and notes fields', () => {
		const body = render(Page, {
			props: {
				data: {
					campaign: { id: 'c', name: 'Campaign' },
					collectors: [{ id: 'x', displayName: 'Ana' }],
					notesMax: 2000
				},
				params: { id: 'c' }
			} as any
		}).body;
		expect(body).toContain('Ana');
		expect(body).toContain('name="notes"');
		expect(body).toContain('Abrir rendición');
	}));
it('renders validation feedback', () => {
	const body = render(Page, {
		props: {
			data: { campaign: { id: 'c', name: 'Campaign' }, collectors: [], notesMax: 2000 },
			form: { errors: { collectorId: ['Choose one.'] } },
			params: { id: 'c' }
		} as any
	}).body;
	expect(body).toContain('Choose one.');
});
