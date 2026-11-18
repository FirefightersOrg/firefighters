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
	barcodePattern: null,
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
			annulReason: null,
			annulledFromStatus: null
		},
		numbers: [
			{ formatted: '0068', kind: 'base', released: false, ownerBondId: BOND_ID },
			{ formatted: '4939', kind: 'associated', released: false, ownerBondId: BOND_ID }
		],
		group: { members: [], memberOf: null, pastPatas: [] },
		barcode: { barcode: null, internalCode: 'INT-1', modeLabel: 'Barcode is the base number' },
		collector: { id: null },
		buyer: { id: null },
		audit: { allowed: false, entries: [], truncated: false },
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
					annulReason: 'Loaded twice',
					annulledFromStatus: 'available'
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
		expect(done).toContain('Annulled from');
		expect(done).toContain('its numbers and codes were freed');
	});

	it('an annulled sale: numbers and codes stay held', () => {
		const body = renderPage(
			record({
				general: {
					...record().general,
					commercialStatus: 'annulled',
					annulledAt: '2026-11-17T13:00:00+00:00',
					annulReason: 'Sale cancelled',
					annulledFromStatus: 'sold'
				}
			})
		);
		expect(body).toContain('Annulled from');
		expect(body).toContain('its numbers and codes stay held');
		expect(body).not.toContain('were freed');
		expect(body).not.toContain('Released');
	});

	it('a member of a manual pata: links to the pata, no actions', () => {
		const body = renderPage(
			record({
				group: {
					members: [],
					memberOf: { pataId: PATA_ID, label: '0068 + 0069' },
					pastPatas: []
				}
			})
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
					pastPatas: [],
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
	it('renders the 13 numbered sections in order, with an index of anchors', () => {
		const body = renderPage(record());
		const titles = [
			'General data',
			'Participating numbers',
			'Barcode',
			'Current collector',
			'Current buyer',
			'Sale',
			'Installments',
			'Payments',
			'Settlements',
			'Commissions',
			'Draws and rosters',
			'Prizes',
			'Audit'
		];
		const ids = [
			'general',
			'numbers',
			'barcode',
			'collector',
			'buyer',
			'sale',
			'installments',
			'payments',
			'settlements',
			'commissions',
			'draws',
			'prizes',
			'audit'
		];
		let last = -1;
		ids.forEach((id, i) => {
			const at = body.indexOf(`<section id="${id}"`);
			expect(at, id).toBeGreaterThan(last);
			last = at;
			expect(body).toContain(`aria-labelledby="${id}-title"`);
			expect(body).toContain(`href="#${id}"`);
			expect(body).toMatch(
				new RegExp(`<h2 id="${id}-title"[^>]*>\\s*<span[^>]*>${i + 1}\\.</span>\\s*${titles[i]}`)
			);
		});
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds"`);
	});

	it('later-phase sections show empty states; collector and buyer are not set', () => {
		const body = renderPage(record());
		expect(body).toContain('Not delivered to a collector.');
		expect(body).toContain('No buyer: the bond is not sold.');
		expect(body).toContain('This bond has not been sold.');
		expect(body).toContain('No installment plan.');
		expect(body).toContain('No payments recorded.');
		expect(body).toContain('Not included in any settlement.');
		expect(body).toContain('No commissions generated.');
		expect(body).toContain('Not included in any draw roster.');
		expect(body).toContain('No prizes.');
		expect(body).toContain('Barcode is the base number');
		expect(body).toContain('No barcode was recorded for this bond.');
		expect(body).toContain('No payments');
	});

	it('audit: a note without audit.view; entries with actor, reason and pata link', () => {
		expect(renderPage(record())).toContain('You do not have permission to view the audit log.');

		const body = renderPage(
			record({
				audit: {
					allowed: true,
					truncated: false,
					entries: [
						{
							id: 'a2',
							action: 'bond.group',
							actionLabel: 'Grouped into a pata',
							createdAt: '2026-11-17T13:00:00+00:00',
							actorLabel: 'Operator One',
							reason: null,
							summary: 'This bond was grouped into pata 0068 + 0069',
							viaPata: { pataId: PATA_ID, label: '0068 + 0069' },
							oldValue: null,
							newValue: '{\n  "members": []\n}',
							requestId: 'req-2'
						},
						{
							id: 'a1',
							action: 'bond.create',
							actionLabel: 'Loaded',
							createdAt: '2026-11-17T12:00:00+00:00',
							actorLabel: 'A user',
							reason: 'Batch 3',
							summary: 'Numbers 0068, 4939',
							viaPata: null,
							oldValue: null,
							newValue: '{}',
							requestId: null
						}
					]
				}
			})
		);
		expect(body).not.toContain('You do not have permission to view the audit log.');
		expect(body.indexOf('data-audit-action="bond.group"')).toBeLessThan(
			body.indexOf('data-audit-action="bond.create"')
		);
		expect(body).toContain('Operator One');
		expect(body).toContain('Reason: Batch 3');
		expect(body).toContain('Numbers 0068, 4939');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${PATA_ID}"`);

		const empty = renderPage(record({ audit: { allowed: true, entries: [], truncated: false } }));
		expect(empty).toContain('No audit entries for this bond.');
	});

	it('a simple bond that was in an ungrouped pata shows it as history', () => {
		const body = renderPage(
			record({
				group: {
					members: [],
					memberOf: null,
					pastPatas: [
						{
							pataId: PATA_ID,
							label: '0068 + 0069',
							groupedAt: '2026-11-16T12:00:00+00:00',
							ungroupedAt: '2026-11-16T15:00:00+00:00',
							reason: 'Wrong bonds'
						}
					]
				}
			})
		);
		expect(body).toContain('Previous patas');
		expect(body).toContain('Not in a pata.');
		expect(body).toContain('Wrong bonds');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${PATA_ID}"`);
	});
});
