import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { CAMPAIGN_ID, campaignRow } from '../../test-helpers';

function page(manage: boolean) {
	return render(Page, {
		props: {
			data: {
				campaign: { id: CAMPAIGN_ID, name: campaignRow().name },
				collectors: [],
				pagination: { total: 0, page: 1, pageCount: 1, pageSize: 25 },
				query: { q: '', status: '' },
				can: { manage }
			},
			form: null,
			params: { id: CAMPAIGN_ID }
		} as never
	}).body;
}

describe('/campaigns/[id]/collectors page', () => {
	it('renders search, status filter, and its empty state', () => {
		const body = page(false);
		expect(body).toContain('Buscar');
		expect(body).toContain('Estado');
		expect(body).toContain('No hay cobradores para estos filtros');
	});

	it('shows Nuevo cobrador only to collector managers', () => {
		expect(page(false)).not.toContain('Nuevo cobrador');
		expect(page(true)).toContain(`href="/campaigns/${CAMPAIGN_ID}/collectors/new"`);
	});
});
