/**
 * Campaign numbering rules (pure domain logic, no framework or database imports).
 *
 * Every campaign defines its own numbering configuration (see `docs/open-questions.md`,
 * "Numbering per campaign"). The digit count is never hardcoded: a 4-digit campaign
 * formats 68 as "0068", a 5-digit campaign formats it as "00068".
 *
 * Numbers are stored internally as integers; leading zeros are a presentation concern
 * handled by {@link formatCampaignNumber} and {@link parseCampaignNumber}.
 *
 * Rule, by `associated_number_mode` (the SQL twin is `public.bond_associated_number`):
 *   - `linear` (default): `associated = base + associated_number_offset`. With the MVP
 *     overflow policy (`reject`), a base number whose associated number would exceed
 *     `max_number` is blocked.
 *   - `circular`: with `B = (max_number + 1) / 2` bonds, `associated = B + ((base + offset) mod B)`
 *     for bases `0..B-1` and `0 <= offset < B`. The associated numbers cover `B..2B-1` exactly once,
 *     so bases and associated numbers together cover `0..2B-1` without collisions or gaps.
 *
 * The config checks in {@link validateNumberingConfig} mirror the `campaigns` table
 * constraints and column type (1 <= number_digits <= 10, 0 < max_number <= 2147483647 — the
 * Postgres `integer` maximum, see {@link MAX_CAMPAIGN_NUMBER} — max_number < 10^number_digits,
 * associated_number_offset >= 0, associated_number_offset <= max_number).
 */
import { DomainError } from './errors';

/** What happens when `base + offset > maxNumber`. MVP only supports blocking the load. */
export type OverflowPolicy = 'reject';

export const OVERFLOW_POLICIES: readonly OverflowPolicy[] = ['reject'];

/** How the associated number is derived from the base number (see the module comment). */
export type AssociatedNumberMode = 'linear' | 'circular';

export const ASSOCIATED_NUMBER_MODES: readonly AssociatedNumberMode[] = ['linear', 'circular'];

/**
 * Widest supported digit count. `max_number` is a Postgres `integer` (at most 2147483647,
 * 10 digits), so a wider format could never be filled. Mirrors `campaigns_number_digits_range`.
 */
export const MAX_NUMBER_DIGITS = 10;

/**
 * Highest storable campaign number: `max_number` (and every number derived from it) is a
 * Postgres `integer`, whose maximum is 2147483647. A 10-digit config therefore cannot use the
 * full 10-digit range (9999999999); anything above this would fail on insert.
 */
export const MAX_CAMPAIGN_NUMBER = 2147483647;

export interface CampaignNumberingConfig {
	/** Visible digit count; values are left-padded with zeros to this width. */
	numberDigits: number;
	/** Highest valid campaign number (inclusive). Must fit in `numberDigits` digits. */
	maxNumber: number;
	/** Added to a base number to obtain its associated number. */
	associatedNumberOffset: number;
	/** `linear`: base + offset. `circular`: B + ((base + offset) mod B), B = (maxNumber + 1) / 2. */
	associatedNumberMode: AssociatedNumberMode;
	overflowPolicy: OverflowPolicy;
}

/**
 * Circular mode block size `B = (maxNumber + 1) / 2`: the number of bonds (bases `0..B-1`).
 * Only meaningful when `maxNumber + 1` is even (checked by {@link validateNumberingConfig}).
 */
export function circularBlockSize(maxNumber: number): number {
	return Math.floor((maxNumber + 1) / 2);
}

/** MVP configuration: 4 digits, 0000–9999, associated number = base + 4871. */
export const DEFAULT_NUMBERING_CONFIG: Readonly<CampaignNumberingConfig> = Object.freeze({
	numberDigits: 4,
	maxNumber: 9999,
	associatedNumberOffset: 4871,
	associatedNumberMode: 'linear',
	overflowPolicy: 'reject'
});

export type NumberingErrorCode =
	| 'not_integer'
	| 'negative_number'
	| 'out_of_range'
	| 'overflow'
	| 'invalid_format'
	| 'invalid_config';

export class NumberingError extends DomainError<NumberingErrorCode> {}

export interface NumberingConfigIssue {
	field: keyof CampaignNumberingConfig;
	message: string;
}

/**
 * Returns every problem found in a numbering configuration (empty array = valid).
 * Safe to call with untrusted runtime data (e.g. a form submission or DB row).
 */
export function validateNumberingConfig(config: CampaignNumberingConfig): NumberingConfigIssue[] {
	const issues: NumberingConfigIssue[] = [];
	const { numberDigits, maxNumber, associatedNumberOffset, overflowPolicy } = config;
	const mode: unknown = config.associatedNumberMode;

	const digitsIsPositiveInt = Number.isSafeInteger(numberDigits) && numberDigits > 0;
	const digitsOk = digitsIsPositiveInt && numberDigits <= MAX_NUMBER_DIGITS;
	if (!digitsIsPositiveInt) {
		issues.push({ field: 'numberDigits', message: 'numberDigits must be a positive integer' });
	} else if (!digitsOk) {
		issues.push({
			field: 'numberDigits',
			message: `numberDigits must not exceed ${MAX_NUMBER_DIGITS}`
		});
	}

	const maxIsPositiveInt = Number.isSafeInteger(maxNumber) && maxNumber > 0;
	if (!maxIsPositiveInt) {
		issues.push({ field: 'maxNumber', message: 'maxNumber must be a positive integer' });
	} else if (maxNumber > MAX_CAMPAIGN_NUMBER) {
		issues.push({
			field: 'maxNumber',
			message: `maxNumber must not exceed ${MAX_CAMPAIGN_NUMBER} (Postgres integer maximum)`
		});
	} else if (digitsOk && maxNumber >= 10 ** numberDigits) {
		issues.push({
			field: 'maxNumber',
			message: `maxNumber must fit in ${numberDigits} digits (at most ${10 ** numberDigits - 1})`
		});
	}

	if (!Number.isSafeInteger(associatedNumberOffset) || associatedNumberOffset < 0) {
		issues.push({
			field: 'associatedNumberOffset',
			message: 'associatedNumberOffset must be a non-negative integer'
		});
	} else if (maxIsPositiveInt && associatedNumberOffset > maxNumber) {
		issues.push({
			field: 'associatedNumberOffset',
			message: `associatedNumberOffset must not exceed maxNumber (${maxNumber})`
		});
	}

	if (!(ASSOCIATED_NUMBER_MODES as readonly unknown[]).includes(mode)) {
		issues.push({
			field: 'associatedNumberMode',
			message: `associatedNumberMode must be one of: ${ASSOCIATED_NUMBER_MODES.join(', ')}`
		});
	} else if (mode === 'circular' && maxIsPositiveInt && maxNumber <= MAX_CAMPAIGN_NUMBER) {
		if ((maxNumber + 1) % 2 !== 0) {
			issues.push({
				field: 'maxNumber',
				message: 'maxNumber + 1 must be even in circular mode (maxNumber + 1 = 2 x B)'
			});
		} else if (
			Number.isSafeInteger(associatedNumberOffset) &&
			associatedNumberOffset >= 0 &&
			associatedNumberOffset >= circularBlockSize(maxNumber)
		) {
			issues.push({
				field: 'associatedNumberOffset',
				message: `associatedNumberOffset must be below B (${circularBlockSize(maxNumber)}) in circular mode`
			});
		}
	}

	if (!OVERFLOW_POLICIES.includes(overflowPolicy)) {
		issues.push({
			field: 'overflowPolicy',
			message: `overflowPolicy must be one of: ${OVERFLOW_POLICIES.join(', ')}`
		});
	}

	return issues;
}

/** Throws `NumberingError('invalid_config')` listing every issue if the config is invalid. */
export function assertValidNumberingConfig(config: CampaignNumberingConfig): void {
	const issues = validateNumberingConfig(config);
	if (issues.length > 0) {
		throw new NumberingError(
			'invalid_config',
			`Invalid numbering configuration: ${issues.map((issue) => issue.message).join('; ')}`
		);
	}
}

/** Throws unless `value` is an integer in `[0, config.maxNumber]`. Assumes a valid config. */
function assertNumberInRange(value: number, config: CampaignNumberingConfig, label: string): void {
	if (!Number.isSafeInteger(value)) {
		throw new NumberingError('not_integer', `${label} must be an integer, got ${String(value)}`);
	}
	if (value < 0) {
		throw new NumberingError('negative_number', `${label} must not be negative, got ${value}`);
	}
	if (value > config.maxNumber) {
		throw new NumberingError(
			'out_of_range',
			`${label} ${value} exceeds the campaign maximum ${config.maxNumber}`
		);
	}
}

/**
 * Whether `value` is a valid campaign number: an integer with `0 <= value <= maxNumber`.
 * @throws NumberingError('invalid_config') if the config itself is invalid.
 */
export function validateNumberRange(value: number, config: CampaignNumberingConfig): boolean {
	assertValidNumberingConfig(config);
	return Number.isSafeInteger(value) && value >= 0 && value <= config.maxNumber;
}

/**
 * Highest valid base number: `maxNumber - offset` in linear mode (for the MVP config 5128, as
 * 5128 + 4871 = 9999) and `B - 1` in circular mode (every base `0..B-1` is valid).
 * @throws NumberingError('invalid_config') if the config itself is invalid.
 */
export function getMaxValidBaseNumber(config: CampaignNumberingConfig): number {
	assertValidNumberingConfig(config);
	return config.associatedNumberMode === 'circular'
		? circularBlockSize(config.maxNumber) - 1
		: config.maxNumber - config.associatedNumberOffset;
}

/**
 * Raw associated number of `baseNumber` by mode, mirroring `public.bond_associated_number`
 * (the one SQL formula). No range check: linear may return a value above `maxNumber` (the
 * caller applies the overflow policy) and circular returns `null` for a base outside `0..B-1`.
 * Also `null` for a non-integer or negative base. Assumes a valid config.
 */
export function associatedNumberFor(
	baseNumber: number,
	config: Pick<
		CampaignNumberingConfig,
		'maxNumber' | 'associatedNumberOffset' | 'associatedNumberMode'
	>
): number | null {
	if (!Number.isSafeInteger(baseNumber) || baseNumber < 0) return null;
	if (config.associatedNumberMode === 'circular') {
		const block = circularBlockSize(config.maxNumber);
		if (baseNumber >= block) return null;
		return block + ((baseNumber + config.associatedNumberOffset) % block);
	}
	return baseNumber + config.associatedNumberOffset;
}

/**
 * Whether `baseNumber` is a valid campaign number whose associated number does not exceed
 * `maxNumber`. Returns `false` for any invalid base number (negative, non-integer, out of range).
 * @throws NumberingError('invalid_config') if the config itself is invalid.
 */
export function validateNoOverflow(baseNumber: number, config: CampaignNumberingConfig): boolean {
	return validateNumberRange(baseNumber, config) && baseNumber <= getMaxValidBaseNumber(config);
}

/**
 * The associated number formula as text for the UI: `base + 4871` (linear) or
 * `5000 + ((base + 4871) mod 5000)` (circular). Assumes a valid config.
 */
export function associatedNumberRuleText(
	config: Pick<
		CampaignNumberingConfig,
		'maxNumber' | 'associatedNumberOffset' | 'associatedNumberMode'
	>
): string {
	if (config.associatedNumberMode === 'circular') {
		const block = circularBlockSize(config.maxNumber);
		return `${block} + ((base + ${config.associatedNumberOffset}) mod ${block})`;
	}
	return `base + ${config.associatedNumberOffset}`;
}

/**
 * Associated number by mode: `base + offset` (linear) or `B + ((base + offset) mod B)` (circular).
 *
 * @throws NumberingError with code `not_integer`, `negative_number` or `out_of_range` for an
 *   invalid base number; `overflow` when the associated number would exceed `maxNumber`
 *   (overflow policy `reject`); `invalid_config` if the config itself is invalid.
 */
export function calculateAssociatedNumber(
	baseNumber: number,
	config: CampaignNumberingConfig
): number {
	assertValidNumberingConfig(config);
	assertNumberInRange(baseNumber, config, 'Base number');

	const associated = associatedNumberFor(baseNumber, config);
	if (associated === null) {
		throw new NumberingError(
			'out_of_range',
			`Base number ${baseNumber} must be below ${circularBlockSize(config.maxNumber)} in circular mode`
		);
	}
	if (associated > config.maxNumber) {
		switch (config.overflowPolicy) {
			case 'reject':
				throw new NumberingError(
					'overflow',
					`Associated number ${associated} (${baseNumber} + ${config.associatedNumberOffset}) ` +
						`exceeds the campaign maximum ${config.maxNumber}; ` +
						`the highest allowed base number is ${getMaxValidBaseNumber(config)}`
				);
			default: {
				// Compile-time exhaustiveness: a new OverflowPolicy must be handled above.
				const unhandled: never = config.overflowPolicy;
				throw new NumberingError('invalid_config', `Unhandled overflow policy: ${unhandled}`);
			}
		}
	}
	return associated;
}

/**
 * Formats a campaign number with leading zeros to the campaign's digit count
 * (68 → "0068" with 4 digits, "00068" with 5 digits).
 *
 * @throws NumberingError with code `not_integer`, `negative_number` or `out_of_range` for an
 *   invalid value; `invalid_config` if the config itself is invalid.
 */
export function formatCampaignNumber(value: number, config: CampaignNumberingConfig): string {
	assertValidNumberingConfig(config);
	assertNumberInRange(value, config, 'Number');
	return String(value).padStart(config.numberDigits, '0');
}

/**
 * Parses user input such as "0068" or "68" into its integer value (68).
 *
 * Accepts only ASCII digits (surrounding whitespace is trimmed), with or without leading
 * zeros, up to `numberDigits` characters. Signs, decimals, exponents and inner spaces are
 * rejected.
 *
 * @throws NumberingError with code `invalid_format` for malformed input or too many digits;
 *   `out_of_range` when the value exceeds `maxNumber`; `invalid_config` if the config is invalid.
 */
export function parseCampaignNumber(input: string, config: CampaignNumberingConfig): number {
	assertValidNumberingConfig(config);

	const trimmed = input.trim();
	if (!/^\d+$/.test(trimmed)) {
		throw new NumberingError('invalid_format', `"${input}" is not a valid campaign number`);
	}
	if (trimmed.length > config.numberDigits) {
		throw new NumberingError(
			'invalid_format',
			`"${input}" has more than ${config.numberDigits} digits`
		);
	}

	const value = Number(trimmed);
	assertNumberInRange(value, config, 'Number');
	return value;
}
