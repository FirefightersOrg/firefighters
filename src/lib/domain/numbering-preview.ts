/**
 * Numbering preview (pure): what a numbering configuration means in practice, for the live
 * preview of the campaign forms and the read-only summary of a campaign.
 *
 * Every value comes from the domain helpers in `numbering.ts` (`formatCampaignNumber`,
 * `calculateAssociatedNumber`, `getMaxValidBaseNumber`), so the preview cannot drift from the
 * rules applied when bonds are loaded.
 */
import {
	associatedNumberFor,
	calculateAssociatedNumber,
	circularBlockSize,
	formatCampaignNumber,
	getMaxValidBaseNumber,
	validateNumberingConfig,
	type AssociatedNumberMode,
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
			mode: AssociatedNumberMode;
			/** Circular mode: `B = (maxNumber + 1) / 2`, the number of bonds; null in linear mode. */
			blockSize: number | null;
			/** Circular mode: the associated numbers cover `B..2B-1` (formatted); null in linear. */
			associatedRange: { from: string; to: string } | null;
			/** `base → associated` examples, ascending, always ending with the max valid base. */
			examples: NumberPair[];
			/** Highest base number whose associated number still fits (`maxNumber - offset`). */
			maxValidBase: NumberPair;
			/** How many base numbers can be used (`0..maxValidBase`). */
			usableBaseCount: number;
			/** The first base that would overflow, or null when none does (offset 0; always in circular). */
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

	const circular = config.associatedNumberMode === 'circular';
	const maxValidBase = getMaxValidBaseNumber(config);
	// Circular mode also shows the bases around the point where the associated numbers reach the
	// top of the range (`B - offset - 1 → 2B - 1`) and restart at its bottom (`B - offset → B`).
	const block = circularBlockSize(config.maxNumber);
	const circularSamples = circular
		? [block - config.associatedNumberOffset - 1, block - config.associatedNumberOffset]
		: [];
	const bases = [
		...new Set([
			...[...NUMBERING_PREVIEW_SAMPLE_BASES, ...circularSamples].filter(
				(base) => base >= 0 && base < maxValidBase
			),
			maxValidBase
		])
	].sort((a, b) => a - b);

	const firstOverflow = maxValidBase + 1;
	const overflowAssociated = circular ? null : associatedNumberFor(firstOverflow, config);
	const overflowExample =
		overflowAssociated !== null && firstOverflow <= config.maxNumber
			? {
					base: firstOverflow,
					baseFormatted: formatCampaignNumber(firstOverflow, config),
					associated: overflowAssociated,
					maxNumber: config.maxNumber
				}
			: null;

	return {
		ok: true,
		mode: config.associatedNumberMode,
		blockSize: circular ? block : null,
		associatedRange: circular
			? {
					from: formatCampaignNumber(block, config),
					to: formatCampaignNumber(2 * block - 1, config)
				}
			: null,
		examples: bases.map((base) => pair(base, config)),
		maxValidBase: pair(maxValidBase, config),
		usableBaseCount: maxValidBase + 1,
		overflowExample
	};
}
