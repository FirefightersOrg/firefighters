/**
 * Barcode interpretation per campaign `barcode_mode` (pure, client-safe). SAN-45.
 *
 * - `base_number`: the barcode IS the base number (ASCII digits, up to the campaign's digit count,
 *   zero padding allowed: "0068" and "68" are both 68).
 * - `manual_mapping`: the barcode says nothing about the number; the operator (or the file's
 *   `numero_base` column) supplies the base number.
 * - `internal_code` / `external_legacy_code`: the campaign's `barcodePattern` is a regular
 *   expression whose FIRST capture group is the base number (same digit rule as above). Without a
 *   pattern they behave like `manual_mapping`.
 *
 * The database (`import_read_barcode`, migration `20261126000000_import_staging_rpcs.sql`) applies
 * the same rules with Postgres `regexp_match` and is the authority. Postgres patterns are ARE
 * (Advanced Regular Expressions); JavaScript `RegExp` agrees with them on the common subset
 * (literals, `^`, `$`, `.`, `\d`, `\s`, bracket expressions such as `[0-9A-Z]`, groups `(...)` and
 * `(?:...)`, alternation, greedy quantifiers and `{m,n}`). Constructs whose meaning differs
 * (`\b` is a backspace in ARE, `\y` `\m` `\M` `\A` `\Z` are ARE-only escapes, POSIX classes such as
 * `[[:digit:]]`, `***` directors, embedded options `(?i)`, lazy quantifiers, which ARE resolves per
 * whole expression) make {@link compileBarcodePattern} return `null`: the app then cannot decide
 * and leaves the item for the database (status `pending` in the client preview).
 */
import type { BarcodeMode } from './campaigns';
import { barcodeModeUsesPattern } from './campaigns';
import type { CampaignNumberingConfig } from './numbering';

/** Longest barcode / pata group code (same limit as `import_session_items` CHECKs). */
export const BARCODE_MAX_LENGTH = 200;

export interface BarcodeRules extends Pick<CampaignNumberingConfig, 'numberDigits'> {
	barcodeMode: BarcodeMode;
	barcodePattern: string | null;
}

/** Number padded like the campaign shows it (same as SQL `bond_format_number`). */
export function padNumber(value: number, digits: number): string {
	return value < 0 ? String(value) : String(value).padStart(digits, '0');
}

/** ASCII digits only, 1 to `digits` characters (zero padding allowed). */
export function isNumberText(text: string, digits: number): boolean {
	return /^[0-9]+$/.test(text) && text.length <= digits;
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
export function barcodeNeedsManualNumber(rules: Pick<BarcodeRules, 'barcodeMode' | 'barcodePattern'>) {
	return (
		rules.barcodeMode === 'manual_mapping' ||
		(barcodeModeUsesPattern(rules.barcodeMode) && rules.barcodePattern === null)
	);
}

export type BarcodeReadErrorCode = 'invalid_barcode' | 'barcode_pattern_mismatch';

/** What a barcode says about the base number. */
export type BarcodeReading =
	/** The barcode carries the base number: `text` is its digits as written (e.g. "0068"). */
	| { kind: 'number'; text: string; value: number }
	/** The mode does not read numbers from barcodes (manual mapping / no pattern). */
	| { kind: 'none' }
	| { kind: 'error'; code: BarcodeReadErrorCode; message: string }
	/** The pattern is not portable to JavaScript: only the database can read it. */
	| { kind: 'undetermined' };

/**
 * Reads the base number carried by `barcode` (already trimmed, non-empty). Does not check the
 * campaign range: see `interpretImportItem` in `imports.ts`. `compiled` lets callers compile the
 * pattern once per batch.
 */
export function readBarcode(
	barcode: string,
	rules: BarcodeRules,
	compiled: RegExp | null = compileBarcodePattern(rules.barcodePattern)
): BarcodeReading {
	const digits = rules.numberDigits;
	if (rules.barcodeMode === 'base_number') {
		return isNumberText(barcode, digits)
			? { kind: 'number', text: barcode, value: Number(barcode) }
			: {
					kind: 'error',
					code: 'invalid_barcode',
					message: `Barcode "${barcode}" is not a base number of up to ${digits} digits`
				};
	}
	if (barcodeNeedsManualNumber(rules)) return { kind: 'none' };
	if (compiled === null) return { kind: 'undetermined' };

	const match = compiled.exec(barcode);
	const captured = match?.[1];
	if (captured === undefined) {
		return {
			kind: 'error',
			code: 'barcode_pattern_mismatch',
			message: `Barcode "${barcode}" does not match the campaign barcode pattern`
		};
	}
	if (!isNumberText(captured, digits)) {
		return {
			kind: 'error',
			code: 'invalid_barcode',
			message: `The base number read from barcode "${barcode}" ("${captured}") is not a number of up to ${digits} digits`
		};
	}
	return { kind: 'number', text: captured, value: Number(captured) };
}
