import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Campaign } from '$lib/domain/campaigns';
import Page from './+page.svelte';

const V1 = '2026-11-17T10:00:00.123456+00:00';
const V2 = '2026-11-17T10:05:00.654321+00:00';

function campaign(overrides: Partial<Campaign> = {}): Campaign {
	return {
		id: 'f0000000-0000-0000-0000-000000000001',
		name: 'Campaign 2026',
		status: 'draft',
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
		createdAt: V1,
		updatedAt: V1,
		...overrides
	};
}

const can = {
	editName: true,
	editDates: true,
	editRules: true,
	transitions: [],
	viewCommissions: false,
	viewBonds: false,
	loadBonds: false,
	viewCollectors: false,
	viewBuyers: false,
	viewDeliveries: false,
	viewSales: false
};

function renderPage(
	loaded: Campaign,
	form: Record<string, unknown> | null = null,
	extra: { hasBonds?: boolean; can?: Partial<typeof can> } = {}
) {
	const data = {
		campaign: loaded,
		hasBonds: extra.hasBonds ?? false,
		can: { ...can, ...extra.can }
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
	const props = { data, form, params: { id: loaded.id } } as any;
	return render(Page, { props }).body;
}

/** `value` of the input named `name` inside the form posting to `action`. */
function inputValue(body: string, action: string, name: string): string | undefined {
	const form = body.match(new RegExp(`<form[^>]*action="\\?/${action}"[\\s\\S]*?</form>`))?.[0];
	const input = form?.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];
	return input?.match(/value="([^"]*)"/)?.[1];
}

describe('campaign page edit forms (values and version come from the same load)', () => {
	it('posts the loaded version with the loaded values', () => {
		const body = renderPage(campaign());
		expect(inputValue(body, 'update', 'expectedUpdatedAt')).toBe(V1);
		expect(inputValue(body, 'update', 'name')).toBe('Campaign 2026');
		expect(inputValue(body, 'rules', 'expectedUpdatedAt')).toBe(V1);
		expect(inputValue(body, 'rules', 'installmentCount')).toBe('10');
	});

	it('refills a failed submit based on the loaded version (validation errors stay)', () => {
		const body = renderPage(campaign(), {
			form: 'general',
			success: false,
			message: 'Please fix the highlighted fields.',
			errors: { name: ['Name is required'] },
			values: { name: '', startsOn: '', endsOn: '', expectedUpdatedAt: V1 }
		});
		expect(inputValue(body, 'update', 'name')).toBe('');
		expect(inputValue(body, 'update', 'expectedUpdatedAt')).toBe(V1);
		expect(body).toContain('Name is required');
	});

	it('never pairs values submitted at an older version with the newer loaded version', () => {
		const reloaded = campaign({ name: 'Renamed elsewhere', updatedAt: V2 });
		const body = renderPage(reloaded, {
			form: 'general',
			success: false,
			message: 'This campaign was changed by someone else.',
			errors: {},
			values: { name: 'Old name', startsOn: '', endsOn: '', expectedUpdatedAt: V1 }
		});
		expect(inputValue(body, 'update', 'name')).toBe('Renamed elsewhere');
		expect(inputValue(body, 'update', 'expectedUpdatedAt')).toBe(V2);
	});

	describe('rules form (with its change reason)', () => {
		const rulesFailure = (expectedUpdatedAt: string) => ({
			form: 'rules',
			success: false,
			message: 'Please fix the highlighted fields.',
			errors: { confirmRulesChange: ['Confirm the rule changes before saving.'] },
			values: {
				simpleBondValue: '70000',
				installmentCount: '7',
				numberDigits: '4',
				maxNumber: '9999',
				associatedNumberOffset: '4871',
				overflowPolicy: 'reject',
				barcodeMode: 'base_number',
				changeReason: 'Board decision',
				confirmRulesChange: '',
				expectedUpdatedAt
			}
		});
		const reasonOf = (body: string) =>
			body.match(/<textarea[^>]*name="changeReason"[^>]*>([\s\S]*?)<\/textarea>/)?.[1];

		it('refills the submitted rules and reason when based on the loaded version', () => {
			const body = renderPage(campaign(), rulesFailure(V1));
			expect(inputValue(body, 'rules', 'installmentCount')).toBe('7');
			expect(reasonOf(body)).toBe('Board decision');
			expect(inputValue(body, 'rules', 'expectedUpdatedAt')).toBe(V1);
		});

		it('drops the submitted rules and reason when the campaign has a newer version', () => {
			const body = renderPage(campaign({ installmentCount: 12, updatedAt: V2 }), rulesFailure(V1));
			expect(inputValue(body, 'rules', 'installmentCount')).toBe('12');
			expect(reasonOf(body)).toBe('');
			expect(inputValue(body, 'rules', 'expectedUpdatedAt')).toBe(V2);
		});
	});
});

describe('campaign page: bonds', () => {
	it('shows the rules of a draft with bonds as frozen, explaining why, without the rules form', () => {
		const body = renderPage(campaign(), null, { hasBonds: true, can: { editRules: false } });
		expect(body).toContain('Rules are frozen.');
		expect(body).toContain('This campaign already has bonds');
		expect(body).toContain('even though the campaign is still a');
		expect(body).not.toMatch(/action="\?\/rules"/);
		// General data stays editable.
		expect(body).toMatch(/action="\?\/update"/);
	});

	it('explains the status when an active campaign has frozen rules', () => {
		const body = renderPage(campaign({ status: 'active' }), null, {
			hasBonds: true,
			can: { editRules: false }
		});
		expect(body).toContain('This campaign is active');
		expect(body).not.toContain('This campaign already has bonds');
	});

	it('links to bond loading only when allowed', () => {
		const href = '/campaigns/f0000000-0000-0000-0000-000000000001/bonds/new';
		expect(renderPage(campaign(), null, { can: { loadBonds: true } })).toContain(`href="${href}"`);
		expect(renderPage(campaign())).not.toContain(href);
	});

	it('links to the bonds list only with bond.view', () => {
		const href = 'href="/campaigns/f0000000-0000-0000-0000-000000000001/bonds"';
		expect(renderPage(campaign(), null, { can: { viewBonds: true } })).toContain(href);
		expect(renderPage(campaign())).not.toContain(href);
	});

	it('links to collectors and buyers only for users who can read them', () => {
		const collectors = 'href="/campaigns/f0000000-0000-0000-0000-000000000001/collectors"';
		const buyers = 'href="/campaigns/f0000000-0000-0000-0000-000000000001/buyers"';
		const none = renderPage(campaign(), null);
		expect(none).not.toContain(collectors);
		expect(none).not.toContain(buyers);
		const both = renderPage(campaign(), null, { can: { viewCollectors: true, viewBuyers: true } });
		expect(both).toContain(collectors);
		expect(both).toContain(buyers);
	});
});
