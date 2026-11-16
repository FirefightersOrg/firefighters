import { describe, expect, it } from 'vitest';
import type { Campaign } from '$lib/domain/campaigns';
import { diffCampaignRules } from './rules-diff';
import { rulesValuesOf, type CampaignRulesValues } from './types';

const NBSP = ' ';

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
	overflowPolicy: 'reject',
	barcodeMode: 'base_number',
	createdBy: null,
	createdAt: '2026-11-16T12:00:00+00:00',
	updatedAt: '2026-11-16T12:00:00+00:00'
};

const values = (overrides: Partial<CampaignRulesValues> = {}): CampaignRulesValues => ({
	...rulesValuesOf(campaign),
	...overrides
});

describe('rulesValuesOf', () => {
	it('prefills money in the Argentine input format', () => {
		expect(rulesValuesOf(campaign).simpleBondValue).toBe('60.000,00');
	});
});

describe('diffCampaignRules', () => {
	it('is empty when nothing changed, comparing by meaning rather than text', () => {
		expect(diffCampaignRules(campaign, values())).toEqual([]);
		expect(
			diffCampaignRules(
				campaign,
				values({ simpleBondValue: '60000', installmentCount: ' 010 ', maxNumber: '09999' })
			)
		).toEqual([]);
		expect(diffCampaignRules(campaign, values({ simpleBondValue: '$ 60.000' }))).toEqual([]);
	});

	it('lists changed fields old → new, with money in es-AR format', () => {
		expect(
			diffCampaignRules(
				campaign,
				values({
					simpleBondValue: '72.000',
					installmentCount: '12',
					numberDigits: '5',
					maxNumber: '99999',
					associatedNumberOffset: '10000',
					barcodeMode: 'internal_code'
				})
			)
		).toEqual([
			{
				field: 'simpleBondValue',
				label: 'Simple bond value',
				from: `$${NBSP}60.000,00`,
				to: `$${NBSP}72.000,00`
			},
			{ field: 'installmentCount', label: 'Number of installments', from: '10', to: '12' },
			// 72.000 / 12 = 6.000: unchanged, so not listed.
			{ field: 'numberDigits', label: 'Number of digits', from: '4', to: '5' },
			{ field: 'maxNumber', label: 'Maximum number', from: '9999', to: '99999' },
			{
				field: 'associatedNumberOffset',
				label: 'Associated number offset',
				from: '4871',
				to: '10000'
			},
			{
				field: 'barcodeMode',
				label: 'Barcode mode',
				from: 'Barcode is the base number',
				to: 'Internal code'
			}
		]);
	});

	it('includes the calculated installment value when it changes', () => {
		expect(diffCampaignRules(campaign, values({ installmentCount: '12' }))).toEqual([
			{ field: 'installmentCount', label: 'Number of installments', from: '10', to: '12' },
			{
				field: 'installmentValue',
				label: 'Installment value (calculated)',
				from: `$${NBSP}6.000,00`,
				to: `$${NBSP}5.000,00`
			}
		]);
	});

	it('shows unparseable or empty input as typed, marked invalid', () => {
		expect(
			diffCampaignRules(
				campaign,
				values({ simpleBondValue: '60,000', installmentCount: '', overflowPolicy: 'wrap' })
			)
		).toEqual([
			{
				field: 'simpleBondValue',
				label: 'Simple bond value',
				from: `$${NBSP}60.000,00`,
				to: '60,000 (invalid)'
			},
			{ field: 'installmentCount', label: 'Number of installments', from: '10', to: '(empty)' },
			{ field: 'overflowPolicy', label: 'Overflow policy', from: 'reject', to: 'wrap' }
		]);
	});
});
