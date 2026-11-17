import type { Campaign } from '$lib/domain/campaigns';
import { toCampaignDay } from '$lib/domain/campaigns';
import { DEFAULT_NUMBERING_CONFIG } from '$lib/domain/numbering';
import { CAMPAIGN_VERSION_FIELD } from '$lib/schemas/campaign';

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

/**
 * `{#key}` for the campaign edit forms: changes whenever a load brings another campaign or a new
 * version of it (`updated_at`), so the forms re-mount and take their values and their version from
 * that same load. A failed submit does not change it, so a form keeps showing its own errors and
 * the values that were submitted.
 */
export function campaignEditFormKey(campaign: Pick<Campaign, 'id' | 'updatedAt'>): string {
	return `${campaign.id}@${campaign.updatedAt}`;
}

/** What a campaign edit form starts from: its input values and the version they are based on. */
export interface CampaignEditSnapshot<T> {
	values: T;
	/** The campaign's `updated_at` (exact string) the values belong to: the form's hidden version. */
	version: string;
}

/**
 * Initial state of a campaign edit form (optimistic concurrency): the loaded campaign's values
 * (`base`) and its `updated_at`, always from the same load, so a save can never send old values
 * with a newer version and silently overwrite a newer change.
 *
 * Values from a failed submit are shown again only when they were based on this same version
 * (e.g. a validation error rendered without JavaScript). Values based on an older version are
 * dropped in favour of the loaded ones; keeping them under the new version would be a lost update.
 */
export function campaignEditSnapshot<T extends object>(
	base: T,
	campaign: Pick<Campaign, 'updatedAt'>,
	submitted?: Record<string, string>
): CampaignEditSnapshot<T> {
	const sameVersion = submitted?.[CAMPAIGN_VERSION_FIELD] === campaign.updatedAt;
	return {
		values: sameVersion ? withSubmitted(base, submitted) : base,
		version: campaign.updatedAt
	};
}
