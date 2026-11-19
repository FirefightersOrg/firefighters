import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { mapCampaignRow } from '$lib/server/repositories/campaigns';
import { CAMPAIGN_ID, campaignRow } from '../../../test-helpers';

const COLLECTOR_ID = 'c0000000-0000-0000-0000-000000000001';

function page(manage: boolean, extra: Record<string, unknown> = {}) {
	return render(Page, {
		props: {
			data: {
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
				audit: null,
				campaign: mapCampaignRow(campaignRow()),
				bondsTotal: 0,
				buyersTotal: 0,
				custody: { can: { returnBonds: false, reassignBonds: false }, collectors: [] },
				...extra
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

	it('lists held bonds with their note and offers bulk return / reassign', () => {
		const bond = (id: string, base: number, status: string, note: number | null) => ({
			id,
			kind: 'simple',
			baseNumbers: [base],
			associatedNumbers: [base + 4871],
			commercialStatus: status,
			note: note ? { noteId: `n000000${note}-0000-0000-0000-000000000000`, noteNumber: note } : null
		});
		const body = page(false, {
			bonds: [
				bond('b0000000-0000-0000-0000-000000000001', 68, 'delivered_to_collector', 3),
				bond('b0000000-0000-0000-0000-000000000002', 70, 'sold', null)
			],
			bondsTotal: 2,
			custody: {
				can: { returnBonds: true, reassignBonds: true },
				collectors: [{ id: 'c0000000-0000-0000-0000-000000000002', displayName: 'Beto' }]
			}
		});
		expect(body).toContain('0068 / 4939');
		expect(body).toContain('0070 / 4941');
		expect(body).toContain(
			`/campaigns/${CAMPAIGN_ID}/deliveries/n0000003-0000-0000-0000-000000000000`
		);
		// Only the delivered bond can be selected.
		expect(body.match(/name="bondIds"/g)).toHaveLength(1);
		expect(body).toContain('formaction="?/returnBonds"');
		expect(body).toContain('formaction="?/reassignBonds"');
		expect(body).toContain('Beto');

		const readOnly = page(false, {
			bonds: [bond('b0000000-0000-0000-0000-000000000001', 68, 'delivered_to_collector', 3)],
			bondsTotal: 1
		});
		expect(readOnly).not.toContain('name="bondIds"');
		expect(readOnly).not.toContain('formaction=');
	});
});

describe('collector sale sections', () => {
	it('renders pending installments for collector sales', () => {
		const body = page(false, {
			installmentsTotal: 1,
			installments: [
				{
					id: 'i',
					saleId: 's',
					bondNumbers: ['0068'],
					buyerName: 'Ada',
					dueDate: '2027-01-01',
					amount: '6000.00',
					status: 'pending'
				}
			]
		});
		expect(body).toContain('2027-01-01');
		expect(body).toContain('Ada');
		expect(body).toContain(`/sales/s`);
	});

	it('shows the current account balance, its link and the special rules (SAN-69)', () => {
		const body = page(false, {
			ledger: { balance: 17.5 },
			specialRules: [
				{
					id: 'r1',
					ruleType: 'installment_first',
					installmentNumber: null,
					percentage: '20',
					fixedAmount: null,
					validFrom: '2026-01-01',
					validTo: null,
					status: 'active'
				}
			],
			can: { manage: false, audit: false, viewRules: true, manageRules: true }
		});
		expect(body).toMatch(/data-testid="collector-balance"[^>]*>[^<]*17[.,]50/);
		expect(body).toContain(`/campaigns/${CAMPAIGN_ID}/collectors/${COLLECTOR_ID}/ledger`);
		expect(body).toContain('data-testid="special-rules"');
		expect(body).toContain('Manage special rules');
	});

	it('hides the current account without ledger permissions', () => {
		const body = page(false);
		expect(body).toContain('You do not have permission to view the current account.');
		expect(body).not.toContain('/ledger');
	});
});
