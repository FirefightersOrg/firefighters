import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import PataNumbersPreview from '$lib/components/bonds/PataNumbersPreview.svelte';
import type { Campaign } from '$lib/domain/campaigns';
import Page from './+page.svelte';

const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';
const A = 'b0000000-0000-0000-0000-000000000001';
const B = 'b0000000-0000-0000-0000-000000000002';
const C = 'b0000000-0000-0000-0000-000000000003';
const PATA = 'b0000000-0000-0000-0000-0000000000bb';

function campaign(overrides: Partial<Campaign> = {}): Campaign {
	return {
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
		updatedAt: '2026-11-17T10:00:00+00:00',
		...overrides
	};
}

const member = (id: string, base: string, assoc: string, problem: string | null = null) => ({
	id,
	baseFormatted: base,
	associatedFormatted: assoc,
	internalCode: null,
	problem,
	pataId: problem?.includes('pata') ? PATA : null
});

function grouping(overrides: Record<string, unknown> = {}) {
	return {
		query: '',
		searchError: null,
		searchLimit: 20,
		results: [{ id: C, baseFormatted: '0012', associatedFormatted: '4883', internalCode: 'X-1' }],
		selected: [member(A, '0010', '4881'), member(B, '0011', '4882')],
		unitCount: 2,
		totalValue: '120000.00',
		...overrides
	};
}

function renderPage(
	options: {
		loaded?: Campaign;
		mode?: 'printed' | 'grouping';
		form?: Record<string, unknown> | null;
		grouping?: ReturnType<typeof grouping> | null;
		lockedMessage?: string | null;
	} = {}
) {
	const loaded = options.loaded ?? campaign();
	const mode = options.mode ?? 'printed';
	const data = {
		campaign: loaded,
		canLoad: !options.lockedMessage,
		lockedMessage: options.lockedMessage ?? null,
		mode,
		grouping: mode === 'grouping' ? (options.grouping ?? grouping()) : null
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
	const props = { data, form: options.form ?? null, params: { id: loaded.id } } as any;
	return render(Page, { props }).body;
}

describe('PataNumbersPreview', () => {
	it('shows the pairs, N, the participating number count and the es-AR total', () => {
		const body = render(PataNumbersPreview, {
			props: {
				rows: [
					{ key: '0', baseFormatted: '0068', associatedFormatted: '4939' },
					{ key: '1', baseFormatted: '0069', associatedFormatted: '4940' }
				],
				unitCount: 2,
				totalValue: '120000.00',
				simpleBondValue: '60000.00',
				emptyText: 'Nothing yet'
			}
		}).body;
		expect(body).toContain('0068');
		expect(body).toContain('4940');
		expect(body).toContain('$ 120.000,00');
		expect(body).toContain('$ 60.000,00 × 2');
		expect(body).toMatch(/Participating numbers<\/dt>\s*<dd[^>]*>\s*4\s*<\/dd>/);
	});

	it('lists problems and invalid rows', () => {
		const body = render(PataNumbersPreview, {
			props: {
				rows: [
					{ key: '0', baseFormatted: '5129', associatedFormatted: null, problem: 'Overflows' }
				],
				problems: ['A pata needs at least 2 base numbers'],
				unitCount: 1,
				totalValue: '60000.00',
				simpleBondValue: '60000.00',
				emptyText: 'Nothing yet'
			}
		}).body;
		expect(body).toContain('Overflows');
		expect(body).toContain('A pata needs at least 2 base numbers.');
	});
});

describe('/campaigns/[id]/bonds/pata/new page', () => {
	it('renders the printed pata form by default, with both mode links', () => {
		const body = renderPage();
		expect(body).toContain('Load a pata');
		expect(body).toMatch(/<textarea[^>]*name="baseNumbers"/);
		expect(body).toContain('action="?/printed"');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/pata/new?mode=printed"`);
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/pata/new?mode=grouping"`);
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/new"`);
		expect(body).toMatch(/<button[^>]*type="submit"[^>]*\sdisabled=""[^>]*>\s*Save pata/);
	});

	it('refills the base numbers and previews them, with campaign-wide duplicates linked', () => {
		const body = renderPage({
			form: {
				form: 'pata',
				success: false,
				message: 'Please correct the highlighted fields.',
				errors: { baseNumbers: ['Number 0068 is already used by another bond in this campaign.'] },
				conflicts: [{ field: 'baseNumbers', bondId: A, numbers: ['0068'] }],
				values: { baseNumbers: '68, 69', internalCode: '', barcode: '' }
			}
		});
		expect(body).toContain('68, 69</textarea>');
		expect(body).toContain('4939');
		expect(body).toContain('4940');
		expect(body).toContain('$ 120.000,00');
		expect(body).toContain('Number 0068 is already used by another bond in this campaign.');
		expect(body).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${A}"`);
		expect(body).toContain('View the bond that uses 0068');
	});

	it('flags an overflow and an intra-pata repetition live', () => {
		const overflow = renderPage({
			form: {
				form: 'pata',
				success: false,
				message: 'Please correct the highlighted fields.',
				errors: {},
				values: { baseNumbers: '68 5129', internalCode: '', barcode: '' }
			}
		});
		expect(overflow).toContain('the highest allowed base number is 5128');
		const repeated = renderPage({
			form: {
				form: 'pata',
				success: false,
				message: 'x',
				errors: {},
				values: { baseNumbers: '68 4939', internalCode: '', barcode: '' }
			}
		});
		expect(repeated).toContain('Number 4939 appears more than once in this pata');
	});

	it('warns that the first bond freezes a draft', () => {
		expect(renderPage({ loaded: campaign({ status: 'draft' }) })).toContain(
			'Saving the first bond freezes its rules'
		);
	});

	it('explains a locked campaign instead of the forms', () => {
		const body = renderPage({
			lockedMessage: 'Bonds can only be loaded ... This campaign is closed.'
		});
		expect(body).toContain('Patas cannot be loaded.');
		expect(body).not.toContain('<form');
	});

	it('grouping: search, results with Add links, picked bonds and the combined preview', () => {
		const body = renderPage({ mode: 'grouping' });
		expect(body).toContain('method="GET"');
		expect(body).toContain(`<input type="hidden" name="selected" value="${A}"`);
		expect(body).toContain(
			`href="/campaigns/${CAMPAIGN_ID}/bonds/pata/new?mode=grouping&amp;selected=${A}&amp;selected=${B}&amp;selected=${C}"`
		);
		expect(body).toContain('X-1');
		expect(body).toContain(`<input type="hidden" name="memberBondIds" value="${B}"`);
		expect(body).toContain(
			`action="?/group&amp;mode=grouping&amp;selected=${A}&amp;selected=${B}"`
		);
		expect(body).toContain('4881');
		expect(body).toContain('4882');
		expect(body).toContain('$ 120.000,00');
		expect(body).toMatch(/<button[^>]*type="submit"[^>]*>\s*Create pata/);
		expect(body).not.toMatch(/<button[^>]*type="submit"[^>]*\sdisabled=""[^>]*>\s*Create pata/);
	});

	it('grouping: cannot create with fewer than 2 bonds or with a bond that cannot be grouped', () => {
		const few = renderPage({
			mode: 'grouping',
			grouping: grouping({ selected: [member(A, '0010', '4881')], unitCount: 1 })
		});
		expect(few).toContain('A pata needs at least 2 simple bonds');
		expect(few).toMatch(/<button[^>]*type="submit"[^>]*\sdisabled=""[^>]*>\s*Create pata/);

		const grouped = renderPage({
			mode: 'grouping',
			grouping: grouping({
				selected: [
					member(A, '0010', '4881'),
					member(B, '0011', '4882', 'It already belongs to a pata. Ungroup that pata first.')
				]
			})
		});
		expect(grouped).toContain('It already belongs to a pata');
		expect(grouped).toContain(`href="/campaigns/${CAMPAIGN_ID}/bonds/${PATA}"`);
		expect(grouped).toMatch(/<button[^>]*type="submit"[^>]*\sdisabled=""[^>]*>\s*Create pata/);
	});

	it('grouping: shows server errors on the picked bonds with links to their pata', () => {
		const body = renderPage({
			mode: 'grouping',
			form: {
				form: 'group',
				success: false,
				message: 'Please correct the highlighted fields.',
				errors: {
					memberBondIds: ['Bond 0010: It already belongs to a pata. Ungroup that pata first.']
				},
				conflicts: [{ field: 'memberBondIds', bondId: PATA, numbers: ['0010'] }],
				values: { internalCode: '', barcode: '' }
			}
		});
		expect(body).toContain('Bond 0010: It already belongs to a pata.');
		expect(body).toContain('View the pata that bond 0010 belongs to');
	});

	it('grouping: explains a malformed search', () => {
		const body = renderPage({
			mode: 'grouping',
			grouping: grouping({
				searchError: '"x" is not a valid base number (use up to 4 digits).',
				results: []
			})
		});
		expect(body).toContain('is not a valid base number');
		expect(body).toContain('No simple bonds available for grouping.');
	});
});
