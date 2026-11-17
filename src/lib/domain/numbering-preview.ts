/**
 * Numbering preview (pure): what a numbering configuration means in practice, for the live
 * preview of the campaign forms and the read-only summary of a campaign.
 *
 * Every value comes from the domain helpers in `numbering.ts` (`formatCampaignNumber`,
 * `calculateAssociatedNumber`, `getMaxValidBaseNumber`), so the preview cannot drift from the
 * rules applied when bonds are loaded.
 */
import {
	calculateAssociatedNumber,
	formatCampaignNumber,
	getMaxValidBaseNumber,
	validateNumberingConfig,
	type CampaignNumberingConfig,
	type NumberingConfigIssue
} from './numbering';

/** Base numbers shown as examples, when they are valid for the configuration. */
export const NUMBERING_PREVIEW_SAMPLE_BASES: readonly number[] = [0, 68, 1658];

export interface NumberPair {
	base: number;
	/** Base number with leading zeros (`"0068"`). */
	baseFormatted: string;
	associated: number;
	/** Associated number with leading zeros (`"4939"`). */
	associatedFormatted: string;
}

export interface NumberingOverflowExample {
	/** First base number whose associated number would exceed the maximum. */
	base: number;
	baseFormatted: string;
	/** `base + offset`: greater than `maxNumber`, so it is shown without padding. */
	associated: number;
	maxNumber: number;
}

export type NumberingPreview =
	| { ok: false; issues: NumberingConfigIssue[] }
	| {
			ok: true;
			/** `base → associated` examples, ascending, always ending with the max valid base. */
			examples: NumberPair[];
			/** Highest base number whose associated number still fits (`maxNumber - offset`). */
			maxValidBase: NumberPair;
			/** How many base numbers can be used (`0..maxValidBase`). */
			usableBaseCount: number;
			/** The first base that would overflow, or null when none does (offset 0). */
			overflowExample: NumberingOverflowExample | null;
	  };

function pair(base: number, config: CampaignNumberingConfig): NumberPair {
	const associated = calculateAssociatedNumber(base, config);
	return {
		base,
		baseFormatted: formatCampaignNumber(base, config),
		associated,
		associatedFormatted: formatCampaignNumber(associated, config)
	};
}

/**
 * Builds the preview of a numbering configuration. Never throws: an invalid configuration
 * returns its problems (`validateNumberingConfig`) instead.
 *
 * Example (MVP config, 4 digits / max 9999 / offset 4871): examples `0000 → 4871`,
 * `0068 → 4939`, `1658 → 6529`, `5128 → 9999`; max valid base 5128; 5129 usable base numbers;
 * overflow example `5129 → 10000 > 9999`.
 */
export function buildNumberingPreview(config: CampaignNumberingConfig): NumberingPreview {
	const issues = validateNumberingConfig(config);
	if (issues.length > 0) return { ok: false, issues };

	const maxValidBase = getMaxValidBaseNumber(config);
	const bases = [
		...new Set([
			...NUMBERING_PREVIEW_SAMPLE_BASES.filter((base) => base < maxValidBase),
			maxValidBase
		])
	];

	const firstOverflow = maxValidBase + 1;
	const overflowExample =
		firstOverflow <= config.maxNumber
			? {
					base: firstOverflow,
					baseFormatted: formatCampaignNumber(firstOverflow, config),
					associated: firstOverflow + config.associatedNumberOffset,
					maxNumber: config.maxNumber
				}
			: null;

	return {
		ok: true,
		examples: bases.map((base) => pair(base, config)),
		maxValidBase: pair(maxValidBase, config),
		usableBaseCount: maxValidBase + 1,
		overflowExample
	};
}
