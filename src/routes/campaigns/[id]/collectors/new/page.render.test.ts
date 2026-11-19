import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { CAMPAIGN_ID, campaignRow } from '../../../test-helpers';

describe('/campaigns/[id]/collectors/new page', () => {
	it('renders the collector form and optional linked-user empty state', () => {
		const body = render(Page, {
			props: {
				data: {
					campaign: { id: CAMPAIGN_ID, name: campaignRow().name },
					profiles: []
				},
				form: null,
				params: { id: CAMPAIGN_ID }
			} as never
		}).body;
		expect(body).toContain('New collector');
		expect(body).toContain('Display name');
		expect(body).toContain('Linked user (optional)');
		expect(body).toContain('<option value="">None</option>');
	});
});
