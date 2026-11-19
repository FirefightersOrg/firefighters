import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

describe('new buyer page', () => {
	it('renders the buyer form', () => {
		const body = render(Page, {
			props: {
				data: {
					campaign: { id: 'f0000000-0000-0000-0000-000000000001', name: 'Campaign' },
					collectors: []
				},
				form: null,
				params: {}
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
			} as any
		}).body;
		expect(body).toContain('New buyer');
		expect(body).toContain('name="firstName"');
	});
});
