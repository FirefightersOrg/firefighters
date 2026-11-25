import { describe, expect, it } from 'vitest';
import type { Campaign } from '$lib/domain/campaigns';
import { formatMoney } from '$lib/format';
import { diffCampaignRules } from './rules-diff';
import { rulesValuesOf, type CampaignRulesValues } from './types';

const money = (value: string) => formatMoney(value);

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
					associatedNumberMode: 'linear',
					barcodeMode: 'internal_code'
				})
			)
		).toEqual([
			{
				field: 'simpleBondValue',
				label: 'Valor del bono simple',
				from: money('60000.00'),
				to: money('72000.00')
			},
			{ field: 'installmentCount', label: 'Cantidad de cuotas', from: '10', to: '12' },
			// 72.000 / 12 = 6.000: unchanged, so not listed.
			{ field: 'numberDigits', label: 'Cantidad de dígitos', from: '4', to: '5' },
			{ field: 'maxNumber', label: 'Número máximo', from: '9999', to: '99999' },
			{
				field: 'associatedNumberOffset',
				label: 'Desfase del número asociado',
				from: '4871',
				to: '10000'
			},
			{
				field: 'barcodeMode',
				label: 'Modo de código de barras',
				from: 'El código de barras es el número base',
				to: 'Código interno'
			}
		]);
	});

	it('lists a barcode pattern change, and clears it for modes that do not use one', () => {
		const withPattern: Campaign = {
			...campaign,
			barcodeMode: 'internal_code',
			barcodePattern: '^BC-(\\d+)$'
		};
		expect(
			diffCampaignRules(
				campaign,
				values({ barcodeMode: 'internal_code', barcodePattern: '^X(\\d+)' })
			)
		).toContainEqual({
			field: 'barcodePattern',
			label: 'Patrón del código de barras',
			from: '(vacío)',
			to: '^X(\\d+)'
		});
		expect(
			diffCampaignRules(withPattern, {
				...rulesValuesOf(withPattern),
				barcodeMode: 'manual_mapping'
			})
		).toContainEqual({
			field: 'barcodePattern',
			label: 'Patrón del código de barras',
			from: '^BC-(\\d+)$',
			to: '(vacío)'
		});
		expect(diffCampaignRules(withPattern, rulesValuesOf(withPattern))).toEqual([]);
	});

	it('includes the calculated installment value when it changes', () => {
		expect(diffCampaignRules(campaign, values({ installmentCount: '12' }))).toEqual([
			{ field: 'installmentCount', label: 'Cantidad de cuotas', from: '10', to: '12' },
			{
				field: 'installmentValue',
				label: 'Valor de la cuota (calculado)',
				from: money('6000.00'),
				to: money('5000.00')
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
				label: 'Valor del bono simple',
				from: money('60000.00'),
				to: '60,000 (inválido)'
			},
			{ field: 'installmentCount', label: 'Cantidad de cuotas', from: '10', to: '(vacío)' },
			{
				field: 'overflowPolicy',
				label: 'Política de desborde',
				from: 'Rechazar (bloquea los números cuyo número asociado supera el máximo)',
				to: 'wrap'
			}
		]);
	});
});
