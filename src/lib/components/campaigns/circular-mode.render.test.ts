import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Campaign } from '$lib/domain/campaigns';
import { campaignRulesSchema, previewNumberingInput } from '$lib/schemas/campaign';
import NumberingFields from './NumberingFields.svelte';
import NumberingPreview from './NumberingPreview.svelte';
import { diffCampaignRules } from './rules-diff';
import { rulesValuesOf } from './types';

// SAN-151: the circular associated number mode in the rules form.
const inputs = {
	numberDigits: '4',
	maxNumber: '9999',
	associatedNumberOffset: '4871',
	associatedNumberMode: 'circular',
	overflowPolicy: 'reject'
};

const previewHtml = (values: Parameters<typeof previewNumberingInput>[0]) =>
	render(NumberingPreview, { props: { preview: previewNumberingInput(values) } }).body;

describe('NumberingPreview in circular mode', () => {
	it('shows the wrap-around pairs and the covered range', () => {
		const body = previewHtml(inputs);
		for (const pair of ['0000', '9871', '0068', '9939', '0128', '9999', '0129', '5000']) {
			expect(body).toContain(pair);
		}
		expect(body).toContain('Modo circular');
		expect(body).toContain('5000–9999');
		expect(body).toContain('Cada número del rango se usa una sola vez');
		expect(body).not.toContain('Desborde');
	});

	it('keeps the linear preview (overflow example) when the mode is linear', () => {
		const body = previewHtml({ ...inputs, associatedNumberMode: 'linear' });
		expect(body).toContain('4871');
		expect(body).toContain('Desborde');
		expect(body).not.toContain('Modo circular');
	});

	it('explains the circular problems in Spanish', () => {
		expect(previewHtml({ ...inputs, maxNumber: '9998' })).toContain(
			'En modo circular, el número máximo más 1 debe ser par'
		);
		expect(previewHtml({ ...inputs, associatedNumberOffset: '5000' })).toContain(
			'En modo circular, el desfase debe ser menor que B (5000'
		);
	});
});

describe('NumberingFields', () => {
	it('offers the mode select and previews the circular example', () => {
		const body = render(NumberingFields, {
			props: { ...inputs, errors: {} }
		}).body;
		expect(body).toContain('Modo del número asociado');
		expect(body).toContain('name="associatedNumberMode"');
		expect(body).toContain('Lineal');
		expect(body).toContain('Circular');
		expect(body).toContain('B + ((base + desfase) mod B)');
		expect(body).toContain('9939');
	});
});

describe('campaign rules schema and diff', () => {
	const campaign: Campaign = {
		id: 'f0000000-0000-0000-0000-000000000001',
		name: 'Campaign 2027',
		status: 'draft',
		startsAt: null,
		endsAt: null,
		simpleBondValue: '60000.00',
		installmentCount: 10,
		installmentValue: '6000.00',
		numberDigits: 4,
		maxNumber: 9999,
		associatedNumberOffset: 4871,
		associatedNumberMode: 'linear',
		overflowPolicy: 'reject',
		barcodeMode: 'base_number',
		barcodePattern: null,
		createdBy: null,
		createdAt: '2026-11-16T12:00:00+00:00',
		updatedAt: '2026-11-16T12:00:00+00:00'
	};
	const form = {
		...rulesValuesOf(campaign),
		simpleBondValue: '60.000,00',
		associatedNumberMode: 'circular',
		expectedUpdatedAt: campaign.updatedAt
	};

	it('parses the mode and defaults a missing one to linear', () => {
		const circular = campaignRulesSchema.safeParse(form);
		expect(circular.success && circular.data.associatedNumberMode).toBe('circular');
		const { associatedNumberMode: _omit, ...withoutMode } = form;
		void _omit;
		const missing = campaignRulesSchema.safeParse(withoutMode);
		expect(missing.success && missing.data.associatedNumberMode).toBe('linear');
	});

	it('rejects an unknown mode and the invalid circular limits with Spanish messages', () => {
		const unknown = campaignRulesSchema.safeParse({ ...form, associatedNumberMode: 'spiral' });
		expect(unknown.success).toBe(false);
		const even = campaignRulesSchema.safeParse({ ...form, maxNumber: '9998' });
		expect(JSON.stringify(even.error?.issues)).toContain('debe ser par');
		const offset = campaignRulesSchema.safeParse({ ...form, associatedNumberOffset: '5000' });
		expect(JSON.stringify(offset.error?.issues)).toContain('menor que B');
	});

	it('lists the mode in the rules diff', () => {
		expect(diffCampaignRules(campaign, form)).toEqual([
			{
				field: 'associatedNumberMode',
				label: 'Modo del número asociado',
				from: 'Lineal (número base + desfase)',
				to: 'Circular (cubre todo el rango sin repetir)'
			}
		]);
		expect(diffCampaignRules(campaign, rulesValuesOf(campaign))).toEqual([]);
	});
});
