import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { BondRecord } from '$lib/components/bonds/record/types';
import type { Campaign } from '$lib/domain/campaigns';
import Page from './+page.svelte';

const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';
const BOND_ID = 'b0000000-0000-0000-0000-000000000001';
const MEMBER_B = 'b0000000-0000-0000-0000-000000000002';
const PATA_ID = 'b0000000-0000-0000-0000-0000000000aa';

const campaign: Campaign = {
	id: CAMPAIGN_ID,
	name: 'Campaign 2027',
	status: 'active',
	startsAt: null,
	endsAt: null,
	simpleBondValue: '60000.00',
	installmentCount: 10,
	installmentValue: '6000.00',
	numberDigits: 4,
	maxNumber: 9999,
	associatedNumberOffset: 4871,
	overflowPolicy: 'reject',
	barcodeMode: 'base_number',
	createdBy: null,
	createdAt: '2026-11-17T10:00:00+00:00',
	updatedAt: '2026-11-17T10:00:00+00:00'
};

function record(overrides: Partial<BondRecord> = {}): BondRecord {
	return {
		general: {
			id: BOND_ID,
			kind: 'simple',
			origin: 'printed',
			typeLabel: 'Simple bond',
			commercialStatus: 'available',
			financialStatus: 'no_payments',
			unitCount: 1,
			totalValue: '60000.00',
			internalCode: 'INT-1',
			barcode: null,
			createdAt: '2026-11-17T12:00:00+00:00',
			annulledAt: null,
			annulReason: null
		},
		numbers: [
			{ formatted: '0068', kind: 'base', released: false, ownerBondId: BOND_ID },
			{ formatted: '4939', kind: 'associated', released: false, ownerBondId: BOND_ID }
		],
		group: { members: [], memberOf: null },
		actions: { ungroup: false, annul: false, lockedMessage: null },
		...overrides
	};
}

function renderPage(loaded: BondRecord, form: Record<string, unknown> | null = null) {
	const data = { campaign, record: loaded };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
	const props = { data, form, params: { id: CAMPAIGN_ID, bondId: loaded.general.id } } as any;
	return render(Page, { props }).body;
}

describe('/campaigns/[id]/bonds/[bondId] page', () => {
	it('shows the general data and the formatted numbers of a simple bond', () => {
		const body = renderPage(record());
		expect(body).toContain('Simple bond 0068');
		expect(body).toContain('General data');
		expect(body).toContain('$ 60.000,00');
		expect(body).toContain('INT-1');
		expect(body).toContain('4939');
		expect(body).toContain('Available');
		// No actions for this user.
		expect(body).not.toContain('Annul bond');
		expect(body).not.toContain('Ungroup pata');
	});

	it('offers annulment with a required reason and explains that the numbers are freed', () => {
		const body = renderPage(
			record({ actions: { ungroup: false, annul: true, lockedMessage: null } })
		);
		expect(body).toContain('Annul bond');
		expect(body).toContain('action="?/annul"');
		expect(body).toMatch(/<textarea[^>]*name="reason"[^>]*required/);
		expect(body).toContain('its numbers are freed');
	});

	it('shows the reason error and the success message', () => {
		const failed = renderPage(
			record({ actions: { ungroup: false, annul: true, lockedMessage: null } }),
			{
				form: 'annul',
				success: false,
				message: 'Please correct the highlighted fields.',
				errors: { reason: ['A reason is required to annul a bond'] }
			}
		);
		expect(failed).toContain('A reason is required to annul a bond');
		const done = renderPage(
			record({
				general: {
					...record().general,
					commercialStatus: 'annulled',
					annulledAt: '2026-11-17T13:00:00+00:00',
					annulReason: 'Loaded twice'
				},
				numbers: record().numbers.map((n) => ({ ...n, released: true }))
			}),
			{
				form: 'annul',
				success: true,
				message: 'Bond annulled. Its numbers are free and can be entered again.',
				errors: {}
			}
		);
		expect(done).toContain('Bond annulled.');
		expect(done).toContain('Loaded twice');
		expect(done).toContain('Released');
	});

	it('a member of a manual pata: links to the pata, no actions', () => {
		const body = renderPage(
			record({ group: { members: [], memberOf: { pataId: PATA_ID, label: '0068 + 0069' } } })
		);
		expect(body).toContain('In pata');
		expect(body).toContain('0068 + 0069');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${PATA_ID}"`);
		expect(body).not.toContain('Annul bond');
	});

	it('a manual pata: members with links, ungroup action and ungroup history', () => {
		const body = renderPage(
			record({
				general: {
					...record().general,
					id: PATA_ID,
					kind: 'pata',
					origin: 'manual_grouping',
					typeLabel: 'Manually grouped pata',
					unitCount: 2,
					totalValue: '120000.00'
				},
				numbers: [
					{ formatted: '0068', kind: 'base', released: false, ownerBondId: BOND_ID },
					{ formatted: '4939', kind: 'associated', released: false, ownerBondId: BOND_ID },
					{ formatted: '0069', kind: 'base', released: false, ownerBondId: MEMBER_B },
					{ formatted: '4940', kind: 'associated', released: false, ownerBondId: MEMBER_B }
				],
				group: {
					memberOf: null,
					members: [
						{
							bondId: BOND_ID,
							baseFormatted: '0068',
							associatedFormatted: '4939',
							groupedAt: '2026-11-17T12:00:00+00:00',
							ungroupedAt: null,
							reason: null
						},
						{
							bondId: MEMBER_B,
							baseFormatted: '0069',
							associatedFormatted: '4940',
							groupedAt: '2026-11-16T12:00:00+00:00',
							ungroupedAt: '2026-11-16T15:00:00+00:00',
							reason: 'Wrong bonds'
						}
					]
				},
				actions: { ungroup: true, annul: false, lockedMessage: null }
			})
		);
		expect(body).toContain('Manually grouped pata 0068 + 0069');
		expect(body).toContain('$ 120.000,00');
		expect(body).toContain('Members');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${MEMBER_B}"`);
		expect(body).toContain('Member bond');
		expect(body).toContain('Ungroup history');
		expect(body).toContain('Wrong bonds');
		expect(body).toContain('action="?/ungroup"');
		expect(body).toContain('Ungroup pata');
	});

	it('explains why an available bond cannot be changed in a closed campaign', () => {
		const body = renderPage(
			record({
				actions: {
					ungroup: false,
					annul: false,
					lockedMessage: 'Bonds can only be loaded or changed ... This campaign is closed.'
				}
			})
		);
		expect(body).toContain('This campaign is closed.');
		expect(body).not.toContain('action="?/annul"');
	});
});
