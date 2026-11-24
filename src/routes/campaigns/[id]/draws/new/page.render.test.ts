/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
describe('new draw render', () => {
	it('renders all types and cutoff timezone guidance', () => {
		const body = render(Page, {
			props: {
				data: { campaign: { id: 'c', name: 'Campaign', installmentCount: 10 } },
				form: null
			} as any
		}).body;
		expect(body).toContain('Extraordinario por pago total');
		expect(body).toContain('Consuelo');
		expect(body).toContain('UTC−03');
	});
});
