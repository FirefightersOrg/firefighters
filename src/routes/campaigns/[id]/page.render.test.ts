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
		createdBy: null,
		createdAt: V1,
		updatedAt: V1,
		...overrides
	};
}

const can = { editName: true, editDates: true, editRules: true, transitions: [] };

function renderPage(loaded: Campaign, form: Record<string, unknown> | null = null) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
	const props = { data: { campaign: loaded, can }, form, params: { id: loaded.id } } as any;
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
		expect(inputValue(body, 'rules', 'simpleBondValue')).toBe('60000.00');
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
});
