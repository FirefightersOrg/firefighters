import type { Campaign } from '$lib/domain/campaigns';
import { toCampaignDay } from '$lib/domain/campaigns';
import { DEFAULT_NUMBERING_CONFIG } from '$lib/domain/numbering';

/** Raw input values (strings, as typed) of the general part of a campaign form. */
export interface CampaignGeneralValues {
	name: string;
	startsOn: string;
	endsOn: string;
}

/** Raw input values (strings, as typed) of the rules part of a campaign form. */
export interface CampaignRulesValues {
	simpleBondValue: string;
	installmentCount: string;
	numberDigits: string;
	maxNumber: string;
	associatedNumberOffset: string;
	overflowPolicy: string;
	barcodeMode: string;
}

/** Empty general values for a new campaign. */
export function emptyGeneralValues(): CampaignGeneralValues {
	return { name: '', startsOn: '', endsOn: '' };
}

/** Rules for a new campaign: numbering from `DEFAULT_NUMBERING_CONFIG`, no barcode mode yet. */
export function defaultRulesValues(): CampaignRulesValues {
	return {
		simpleBondValue: '',
		installmentCount: '',
		numberDigits: String(DEFAULT_NUMBERING_CONFIG.numberDigits),
		maxNumber: String(DEFAULT_NUMBERING_CONFIG.maxNumber),
		associatedNumberOffset: String(DEFAULT_NUMBERING_CONFIG.associatedNumberOffset),
		overflowPolicy: DEFAULT_NUMBERING_CONFIG.overflowPolicy,
		barcodeMode: ''
	};
}

export function generalValuesOf(campaign: Campaign): CampaignGeneralValues {
	return {
		name: campaign.name,
		startsOn: toCampaignDay(campaign.startsAt) ?? '',
		endsOn: toCampaignDay(campaign.endsAt) ?? ''
	};
}

export function rulesValuesOf(campaign: Campaign): CampaignRulesValues {
	return {
		simpleBondValue: campaign.simpleBondValue,
		installmentCount: String(campaign.installmentCount),
		numberDigits: String(campaign.numberDigits),
		maxNumber: String(campaign.maxNumber),
		associatedNumberOffset: String(campaign.associatedNumberOffset),
		overflowPolicy: campaign.overflowPolicy,
		barcodeMode: campaign.barcodeMode
	};
}

/** Overlays submitted values (returned by a failed action) on top of `base`. */
export function withSubmitted<T extends object>(base: T, submitted?: Record<string, string>): T {
	if (!submitted) return base;
	const result = { ...base } as Record<string, unknown>;
	for (const key of Object.keys(base)) {
		if (typeof submitted[key] === 'string') result[key] = submitted[key];
	}
	return result as T;
}
