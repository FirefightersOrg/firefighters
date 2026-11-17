import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import BaseNumberPreview from '$lib/components/bonds/BaseNumberPreview.svelte';
import { previewBaseNumber } from '$lib/domain/bond-preview';
import type { Campaign } from '$lib/domain/campaigns';
import { DEFAULT_NUMBERING_CONFIG } from '$lib/domain/numbering';
import Page from './+page.svelte';

const CAMPAIGN_ID = 'f0000000-0000-0000-0000-000000000001';
const BOND_ID = 'b0000000-0000-0000-0000-000000000001';
const OTHER_BOND_ID = 'b0000000-0000-0000-0000-000000000002';

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
		createdBy: null,
		createdAt: '2026-11-17T10:00:00+00:00',
		updatedAt: '2026-11-17T10:00:00+00:00',
		...overrides
	};
}

function renderPage(
	loaded: Campaign,
	form: Record<string, unknown> | null = null,
	lockedMessage: string | null = null
) {
	const data = { campaign: loaded, canLoad: lockedMessage === null, lockedMessage };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
	const props = { data, form, params: { id: loaded.id } } as any;
	return render(Page, { props }).body;
}

const inputValue = (body: string, name: string) =>
	body.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0].match(/value="([^"]*)"/)?.[1];

describe('BaseNumberPreview', () => {
	const html = (input: string, config = DEFAULT_NUMBERING_CONFIG) =>
		render(BaseNumberPreview, { props: { preview: previewBaseNumber(input, config) } }).body;

	it('shows the padded base and associated numbers', () => {
		const body = html('68');
		expect(body).toContain('0068');
		expect(body).toContain('4939');
		expect(body).toContain('aria-live="polite"');
	});

	it('works for a 5-digit campaign', () => {
		const body = html('68', {
			numberDigits: 5,
			maxNumber: 99999,
			associatedNumberOffset: 48710,
			overflowPolicy: 'reject'
		});
		expect(body).toContain('00068');
		expect(body).toContain('48778');
	});

	it('explains an overflow or a malformed number', () => {
		expect(html('5129')).toContain(
			'its associated number 10000 exceeds the campaign maximum number 9999'
		);
		expect(html('12345')).toContain('is not a valid number (use up to 4 digits)');
	});

	it('invites to type when empty', () => {
		expect(html('')).toContain('Type the base number');
	});
});

describe('/campaigns/[id]/bonds/new page', () => {
	it('renders the entry form with "Save & add another" as the default (first) submit button', () => {
		const body = renderPage(campaign());
		const buttons = [...body.matchAll(/<button[^>]*name="intent"[^>]*value="(\w+)"/g)].map(
			(m) => m[1]
		);
		expect(buttons).toEqual(['another', 'save']);
		expect(body).toContain('Save &amp; add another');
		expect(body).toMatch(/<input[^>]*name="baseNumber"[^>]*required/);
		expect(body).toContain('name="internalCode"');
		expect(body).toContain('name="barcode"');
		// Usable range from the numbering preview.
		expect(body).toContain('0000–5128');
		expect(body).not.toContain('Saving the first bond freezes its rules');
	});

	it('warns that the first bond freezes the rules of a draft', () => {
		expect(renderPage(campaign({ status: 'draft' }))).toContain(
			'Saving the first bond freezes its rules'
		);
	});

	it('shows an explanation instead of the form when the campaign is locked', () => {
		const message =
			'Bonds can only be loaded or changed while the campaign is a draft or active. This campaign is closed.';
		const body = renderPage(campaign({ status: 'closed' }), null, message);
		expect(body).toContain('Bonds cannot be loaded.');
		expect(body).toContain(message);
		expect(body).not.toContain('<form');
	});

	it('confirms the bond just saved with "Save & add another", with an empty form', () => {
		const body = renderPage(campaign(), {
			form: 'create',
			success: true,
			message: 'Bond 0068 / 4939 saved.',
			errors: {},
			created: { id: BOND_ID, baseFormatted: '0068', associatedFormatted: '4939' }
		});
		expect(body).toContain('Bond 0068 / 4939 saved.');
		// No link to the bond record yet (the route arrives in SAN-25).
		expect(body).not.toContain(`/bonds/${BOND_ID}`);
		expect(body).toContain('Saved from this page');
		expect(inputValue(body, 'baseNumber')).toBe('');
	});

	it('shows a duplicate with the formatted numbers as text (no link to the bond yet)', () => {
		const body = renderPage(campaign(), {
			form: 'create',
			success: false,
			message: 'Please correct the highlighted fields.',
			errors: {
				baseNumber: ['Numbers 0068, 4939 are already used by another bond in this campaign.']
			},
			conflicts: [{ field: 'baseNumber', bondId: OTHER_BOND_ID, numbers: ['0068', '4939'] }],
			values: { baseNumber: '0068', internalCode: '', barcode: '' }
		});
		expect(inputValue(body, 'baseNumber')).toBe('0068');
		expect(body).toContain('Numbers 0068, 4939 are already used by another bond in this campaign.');
		expect(body).not.toContain(`/bonds/${OTHER_BOND_ID}`);
		expect(body).toMatch(/Another bond already uses\s*<span[^>]*>0068, 4939<\/span>/);
		expect(body).toMatch(/aria-describedby="baseNumber-preview baseNumber-error"/);
	});

	it('shows a form-level error (campaign status changed meanwhile)', () => {
		const body = renderPage(campaign(), {
			form: 'create',
			success: false,
			message: 'Bonds can only be loaded or changed while the campaign is a draft or active.',
			errors: {},
			values: { baseNumber: '0068', internalCode: '', barcode: '' }
		});
		expect(body).toContain('role="alert"');
		expect(body).toContain('Bonds can only be loaded or changed');
	});

	it('flags an overflow live and disables saving', () => {
		const body = renderPage(campaign(), {
			form: 'create',
			success: false,
			message: 'Please correct the highlighted fields.',
			errors: { baseNumber: ['Base number 5129 overflows'] },
			values: { baseNumber: '5129', internalCode: '', barcode: '' }
		});
		expect(body).toContain('the highest allowed base number is 5128');
		expect(body).toMatch(/<button[^>]*value="another"[^>]*disabled/);
	});
});
