/**
 * Barcode interpretation per campaign `barcode_mode` (pure, client-safe). SAN-45.
 *
 * Mirrors how `import_session_add_scan` (migration `20261126000000_import_staging.sql`) resolves a
 * scanned code to a base number, with the same `parse_*` error codes and messages:
 *
 * - `base_number`: the barcode IS the base number: 1 to 10 ASCII digits that fit a Postgres
 *   `integer` (zero padding allowed: "0068" and "68" are both 68). Otherwise
 *   `parse_code_not_a_number`. Whether the number fits the campaign is checked later
 *   (`number_out_of_range`).
 * - `manual_mapping`: the barcode says nothing about the number; the operator (or the file's
 *   `numero_base` column) supplies it, otherwise `parse_base_number_required`.
 * - `internal_code` / `external_legacy_code`: the campaign's `barcodePattern` is a regular
 *   expression whose FIRST capture group is the base number (same digit rule as above), otherwise
 *   `parse_code_not_recognized`. Without a pattern they behave like `manual_mapping`.
 *
 * Postgres patterns are ARE (Advanced Regular Expressions); JavaScript `RegExp` agrees with them on
 * the common subset (literals, `^`, `$`, `.`, `\d`, `\s`, bracket expressions such as `[0-9A-Z]`,
 * groups `(...)` and `(?:...)`, alternation, greedy quantifiers and `{m,n}`). Constructs whose
 * meaning differs (`\b` is a backspace in ARE, `\y` `\m` `\M` `\A` `\Z` are ARE-only escapes, POSIX
 * classes such as `[[:digit:]]`, `***` directors, embedded options `(?i)`, lazy quantifiers, which
 * ARE resolves per whole expression) make {@link compileBarcodePattern} return `null`: the app then
 * cannot read the barcode (`undetermined`).
 */
import type { BarcodeMode } from './campaigns';
import { barcodeModeUsesPattern } from './campaigns';
import type { CampaignNumberingConfig } from './numbering';

/** Longest barcode / pata group code (same limit as `import_session_items` CHECKs). */
export const BARCODE_MAX_LENGTH = 200;
/** Largest base number a row can carry (Postgres `integer`). */
export const IMPORT_MAX_BASE_NUMBER = 2147483647;

export interface BarcodeRules extends Pick<CampaignNumberingConfig, 'numberDigits'> {
	barcodeMode: BarcodeMode;
	barcodePattern: string | null;
}

/** Number padded like the campaign shows it (same as SQL `bond_format_number`). */
export function padNumber(value: number, digits: number): string {
	return value < 0 ? String(value) : String(value).padStart(digits, '0');
}

/**
 * `text` as a base number: 1 to 10 ASCII digits that fit an `integer` (the database's
 * `^[0-9]{1,10}$` + `<= 2147483647`), else `null`.
 */
export function parseBaseNumberText(text: string): number | null {
	if (!/^[0-9]{1,10}$/.test(text)) return null;
	const value = Number(text);
	return value <= IMPORT_MAX_BASE_NUMBER ? value : null;
}

// Escapes and constructs whose meaning differs between ARE and JavaScript, or that JavaScript
// does not support (see the module comment).
const NON_PORTABLE = [
	/\\[bByYmMAZ]/, // word boundaries / anchors / backspace
	/\[\[[:.=]/, // POSIX classes, collating elements, equivalence classes
	/^\*\*\*/, // ARE directors (***=, ***:)
	/\(\?(?![:=!])/, // embedded options and lookbehind (only (?: (?= (?! are portable)
	/[*+?}]\?/, // lazy quantifiers: ARE decides greediness for the whole expression
	/\\[0-9]/ // back references / octal escapes
];

/**
 * The campaign pattern as a JavaScript `RegExp`, or `null` when it uses a construct whose meaning
 * differs from Postgres (or does not compile in JavaScript). `null` input → `null`.
 */
export function compileBarcodePattern(pattern: string | null): RegExp | null {
	if (pattern === null) return null;
	// Strip escaped backslashes first so "\\b" (a literal backslash then "b") is not flagged.
	const scan = pattern.replace(/\\\\/g, '');
	if (NON_PORTABLE.some((re) => re.test(scan))) return null;
	try {
		return new RegExp(pattern);
	} catch {
		return null;
	}
}

/** Whether the app can apply the pattern exactly like the database does. */
export function isBarcodePatternPortable(pattern: string): boolean {
	return compileBarcodePattern(pattern) !== null;
}

/** Whether the base number must come from the operator / the file (the barcode has none). */
export function barcodeNeedsManualNumber(
	rules: Pick<BarcodeRules, 'barcodeMode' | 'barcodePattern'>
) {
	return (
		rules.barcodeMode === 'manual_mapping' ||
		(barcodeModeUsesPattern(rules.barcodeMode) && rules.barcodePattern === null)
	);
}

export type BarcodeReadErrorCode = 'parse_code_not_a_number' | 'parse_code_not_recognized';

/** What a barcode says about the base number. */
export type BarcodeReading =
	/** The barcode carries the base number. */
	| { kind: 'number'; value: number }
	/** The mode does not read numbers from barcodes (manual mapping / no pattern). */
	| { kind: 'none' }
	| { kind: 'error'; code: BarcodeReadErrorCode; message: string }
	/** The pattern is not portable to JavaScript: the app cannot read it. */
	| { kind: 'undetermined' };

/**
 * Reads the base number carried by `barcode` (already trimmed, non-empty), like
 * `import_session_add_scan`. Does not check the campaign range. `compiled` lets callers compile
 * the pattern once per batch.
 */
export function readBarcode(
	barcode: string,
	rules: BarcodeRules,
	compiled: RegExp | null = compileBarcodePattern(rules.barcodePattern)
): BarcodeReading {
	if (rules.barcodeMode === 'base_number') {
		const value = parseBaseNumberText(barcode);
		return value === null
			? {
					kind: 'error',
					code: 'parse_code_not_a_number',
					message: `Barcode ${barcode} is not a base number.`
				}
			: { kind: 'number', value };
	}
	if (barcodeNeedsManualNumber(rules)) return { kind: 'none' };
	if (compiled === null) return { kind: 'undetermined' };

	const captured = compiled.exec(barcode)?.[1];
	const value = captured === undefined ? null : parseBaseNumberText(captured);
	if (value === null) {
		return {
			kind: 'error',
			code: 'parse_code_not_recognized',
			message: `Barcode ${barcode} does not match the campaign pattern.`
		};
	}
	return { kind: 'number', value };
}

/** Message of `parse_base_number_required` (same as `import_session_add_scan`). */
export function baseNumberRequiredMessage(
	rules: Pick<BarcodeRules, 'barcodeMode' | 'barcodePattern'>
): string {
	return rules.barcodeMode === 'manual_mapping'
		? 'This campaign needs the base number typed with the barcode.'
		: 'This campaign has no barcode pattern: type the base number.';
}
