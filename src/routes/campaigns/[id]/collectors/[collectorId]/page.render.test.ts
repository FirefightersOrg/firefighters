import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { CAMPAIGN_ID, campaignRow } from '../../../test-helpers';

const COLLECTOR_ID = 'c0000000-0000-0000-0000-000000000001';

function page(manage: boolean) {
	return render(Page, {
		props: {
			data: {
				campaign: { id: CAMPAIGN_ID, name: campaignRow().name },
				collector: {
					id: COLLECTOR_ID,
					displayName: 'Ada Collector',
					phone: null,
					email: null,
					address: null,
					userProfileId: null,
					status: 'active',
					createdBy: null,
					createdAt: '',
					updatedAt: ''
				},
				bonds: [],
				buyers: [],
				profiles: [],
				can: { manage, audit: false },
				audit: null
			},
			form: null,
			params: { id: CAMPAIGN_ID, collectorId: COLLECTOR_ID }
		} as never
	}).body;
}

describe('/campaigns/[id]/collectors/[collectorId] page', () => {
	it('renders the eight sections with their empty states', () => {
		const body = page(false);
		for (const title of [
			'General data',
			'Assigned bonds',
			'Associated buyers',
			'Pending installments',
			'Settlements',
			'Current account',
			'Monthly report',
			'Audit'
		])
			expect(body).toContain(title);
		expect(body).toContain('No bonds are assigned in this campaign.');
		expect(body).toContain('No associated buyers.');
		expect(body).toContain('No data yet.');
		expect(body).toContain('You do not have permission to view the audit log.');
	});

	it('renders editing only for collector managers', () => {
		expect(page(false)).not.toContain('Save changes');
		expect(page(true)).toContain('action="?/update"');
		expect(page(true)).toContain('Save changes');
	});
});
