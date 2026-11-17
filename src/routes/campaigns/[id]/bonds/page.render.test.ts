import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Campaign } from '$lib/domain/campaigns';
import type { BondListItem } from '$lib/server/bonds/list';
import Page from './+page.svelte';

const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';
const BOND_ID = 'b0000000-0000-0000-0000-000000000001';
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

const EMPTY_VALUES = { base: '', associated: '', code: '', type: '', status: '', financial: '' };

function bond(overrides: Partial<BondListItem> = {}): BondListItem {
	return {
		id: BOND_ID,
		kind: 'simple',
		origin: 'printed',
		typeLabel: 'Simple bond',
		baseFormatted: ['0068'],
		associatedFormatted: ['4939'],
		internalCode: 'INT-1',
		barcode: null,
		commercialStatus: 'available',
		financialStatus: 'no_payments',
		unitCount: 1,
		totalValue: '60000.00',
		inPata: null,
		...overrides
	};
}

function renderPage(
	options: {
		bonds?: BondListItem[];
		values?: Partial<typeof EMPTY_VALUES>;
		errors?: Record<string, string>;
		page?: number;
		total?: number;
		canCreate?: boolean;
	} = {}
) {
	const bonds = options.bonds ?? [bond()];
	const total = options.total ?? bonds.length;
	const values = { ...EMPTY_VALUES, ...options.values };
	const data = {
		campaign,
		query: { values, errors: options.errors ?? {} },
		bonds,
		pagination: {
			page: options.page ?? 1,
			pageSize: 25,
			total,
			pageCount: Math.max(1, Math.ceil(total / 25))
		},
		filtered: Object.values(values).some(Boolean),
		can: { create: options.canCreate ?? false }
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
	const props = { data, form: null, params: { id: CAMPAIGN_ID } } as any;
	return render(Page, { props }).body;
}

describe('/campaigns/[id]/bonds page', () => {
	it('shows each bond with padded numbers, status badges, es-AR money and its record link', () => {
		const body = renderPage();
		expect(body).toContain('0068');
		expect(body).toContain('4939');
		expect(body).toContain('Simple bond');
		expect(body).toContain('INT-1');
		expect(body).toContain('Available');
		expect(body).toContain('No payments');
		expect(body).toContain('$\u00a060.000,00');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${BOND_ID}"`);
		expect(body).toContain('View record');
		expect(body).toContain('Showing 1–1 of 1 bond');
	});

	it('a grouped member says which pata it is in, with a link', () => {
		const body = renderPage({
			bonds: [bond({ inPata: { pataId: PATA_ID, label: '0068 + 0069' } })]
		});
		expect(body).toContain('In pata');
		expect(body).toContain('0068 + 0069');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${PATA_ID}"`);
	});

	it('is a GET form that refills the filters; collector and buyer are disabled', () => {
		const body = renderPage({
			values: { base: '68', code: 'BC-1', type: 'pata', status: 'sold', financial: 'overdue' }
		});
		expect(body).toMatch(/<form[^>]*method="GET"/);
		expect(body).toContain(`action="/campaigns/${CAMPAIGN_ID}/bonds"`);
		expect(body).toMatch(/<input[^>]*name="base"[^>]*value="68"/);
		expect(body).toMatch(/<input[^>]*name="code"[^>]*value="BC-1"/);
		expect(body).toMatch(/<option value="pata"\sselected="">/);
		expect(body).toMatch(/<option value="sold"\sselected="">/);
		expect(body).toMatch(/<option value="overdue"\sselected="">/);
		expect(body).toMatch(/<select id="filter-collector"[^>]*\sdisabled=""/);
		expect(body).toMatch(/<select id="filter-buyer"[^>]*\sdisabled=""/);
		expect(body).toContain(
			'Collector and buyer filters arrive with collectors and buyers in Phase 5.'
		);
		expect(body).toContain('Clear filters');
	});

	it('quick actions: create only when allowed; barcode and assignment disabled with their phase', () => {
		const viewer = renderPage();
		expect(viewer).not.toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/new"`);
		expect(viewer).not.toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/pata/new"`);
		expect(viewer).toMatch(
			/<button type="button"[^>]*\sdisabled=""[^>]*aria-describedby="barcode-action-note"[^>]*>\s*Load by barcode/
		);
		expect(viewer).toMatch(
			/<button type="button"[^>]*\sdisabled=""[^>]*aria-describedby="assign-action-note"[^>]*>\s*Assign to collector/
		);
		expect(viewer).toContain('Phase 4');
		expect(viewer).toContain('Phase 6');

		const operator = renderPage({ canCreate: true });
		expect(operator).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/new"`);
		expect(operator).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/pata/new"`);
		expect(operator).toContain('Create bond');
		expect(operator).toContain('Create pata');
	});

	it('paginates keeping the filters in the links', () => {
		const body = renderPage({ values: { status: 'available' }, page: 2, total: 60 });
		expect(body).toContain('Page 2 of 3');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds?status=available"`);
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds?status=available&amp;page=3"`);
		expect(body).toContain('Showing 26–50 of 60 bonds');
	});

	it('empty states and invalid filters', () => {
		expect(renderPage({ bonds: [] })).toContain('This campaign has no bonds yet.');
		expect(renderPage({ bonds: [], values: { base: '1' } })).toContain(
			'No bonds match these filters.'
		);
		const invalid = renderPage({
			bonds: [],
			values: { base: '12345' },
			errors: { base: 'Enter a number from 0000 to 9999.' }
		});
		expect(invalid).toContain('Enter a number from 0000 to 9999.');
		expect(invalid).toMatch(/<input[^>]*name="base"[^>]*aria-invalid="true"/);
		expect(invalid).toContain('Fix the highlighted filters to see bonds.');
		expect(renderPage({ bonds: [], total: 3, page: 9 })).toContain('No bonds on this page.');
	});
});
