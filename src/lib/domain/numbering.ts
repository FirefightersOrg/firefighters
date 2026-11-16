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
 * Rule: `associated_number = base_number + associated_number_offset`. With the MVP
 * overflow policy (`reject`), a base number whose associated number would exceed
 * `max_number` is blocked.
 *
 * The config checks in {@link validateNumberingConfig} mirror the `campaigns` table
 * constraints (number_digits > 0, max_number > 0, max_number < 10^number_digits,
 * associated_number_offset >= 0, associated_number_offset <= max_number).
 */
import { DomainError } from './errors';

/** What happens when `base + offset > maxNumber`. MVP only supports blocking the load. */
export type OverflowPolicy = 'reject';

export const OVERFLOW_POLICIES: readonly OverflowPolicy[] = ['reject'];

export interface CampaignNumberingConfig {
	/** Visible digit count; values are left-padded with zeros to this width. */
	numberDigits: number;
	/** Highest valid campaign number (inclusive). Must fit in `numberDigits` digits. */
	maxNumber: number;
	/** Added to a base number to obtain its associated number. */
	associatedNumberOffset: number;
	overflowPolicy: OverflowPolicy;
}

/** MVP configuration: 4 digits, 0000–9999, associated number = base + 4871. */
export const DEFAULT_NUMBERING_CONFIG: Readonly<CampaignNumberingConfig> = Object.freeze({
	numberDigits: 4,
	maxNumber: 9999,
	associatedNumberOffset: 4871,
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

	const digitsOk = Number.isSafeInteger(numberDigits) && numberDigits > 0;
	if (!digitsOk) {
		issues.push({ field: 'numberDigits', message: 'numberDigits must be a positive integer' });
	}

	const maxIsPositiveInt = Number.isSafeInteger(maxNumber) && maxNumber > 0;
	if (!maxIsPositiveInt) {
		issues.push({ field: 'maxNumber', message: 'maxNumber must be a positive integer' });
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
 * Highest base number whose associated number still fits (`maxNumber - offset`).
 * For the MVP config this is 5128 (5128 + 4871 = 9999).
 * @throws NumberingError('invalid_config') if the config itself is invalid.
 */
export function getMaxValidBaseNumber(config: CampaignNumberingConfig): number {
	assertValidNumberingConfig(config);
	return config.maxNumber - config.associatedNumberOffset;
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
 * `associated_number = base_number + associated_number_offset`.
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

	const associated = baseNumber + config.associatedNumberOffset;
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
