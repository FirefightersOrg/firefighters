/**
 * Percentage helpers (pure, no framework imports). Same approach as `money.ts`.
 *
 * Representation: percentages are stored in Postgres as `numeric(5,2)` (`12.50` = 12,5 %). In the
 * app they travel as **canonical decimal strings with exactly two decimals** (`"12.50"`), read
 * with a `::text` cast, and arithmetic is done in integer **hundredths of a percent**
 * (`1250` = 12,5 %), so no value ever goes through a binary float.
 *
 * People type and read percentages in **Argentine format** (es-AR): `,` is the decimal
 * separator. User input goes through {@link parsePercentInput}; every percentage shown in the UI
 * goes through {@link formatPercent} (`"12,5 %"`).
 */

/** 100 % in hundredths: the largest commission percentage. */
export const MAX_PERCENT_HUNDREDTHS = 10_000;

/** Message for input {@link parsePercentInput} rejects (shared by the schemas and the UI). */
export const PERCENT_INPUT_FORMAT_MESSAGE =
	'Ingresar un porcentaje como 25 o 12,5 (coma para hasta 2 decimales)';

/** Canonical form (database / SQL): up to 3 integer digits, optionally `.` and 1-2 decimals. */
const CANONICAL_PERCENT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

/**
 * Typed input (after removing an optional trailing `%`): digits, then optionally a `,` (or a
 * single `.`) and 1-2 decimals. Percentages never need thousands separators (at most 100), so a
 * `.` followed by 1-2 digits is unambiguously a decimal point.
 */
const PERCENT_INPUT_PATTERN = /^(\d{1,6})(?:[,.](\d{1,2}))?$/;

/**
 * Parses a **canonical** percentage (`"12"`, `"12.5"`, `"12.50"`) into hundredths, or `null` if
 * malformed. For database values and SQL-bound strings only; user input uses
 * {@link parsePercentInput}.
 */
export function parsePercentToHundredths(input: string): number | null {
	const trimmed = input.trim();
	if (!CANONICAL_PERCENT_PATTERN.test(trimmed)) return null;
	const [whole, fraction = ''] = trimmed.split('.');
	return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/**
 * Parses a percentage typed by a person into hundredths of a percent, or `null` if it is
 * malformed. It does **not** check the range: the form schema reports "must be greater than 0"
 * / "at most 100" with their own messages. The same function runs in the browser and on the
 * server, so both accept exactly the same strings.
 *
 * Rules:
 * - Surrounding whitespace and an optional trailing `%` (with or without a space, including a
 *   non-breaking one) are ignored, so the display format (`"12,5 %"`) parses back.
 * - `,` is the decimal separator: `25`, `12,5`, `12,50`. A single `.` followed by 1-2 digits is
 *   also accepted as a decimal point (`12.5`): it cannot be a thousands separator here.
 * - Rejected: more than 2 decimals (`12,345`), both separators (`1.2,5`), grouping (`1.000`),
 *   signs, exponents, a missing integer part (`,5`) or decimals (`5,`), spaces inside the number.
 */
export function parsePercentInput(input: string): number | null {
	const text = input.trim().replace(/\s*%$/u, '');
	const match = PERCENT_INPUT_PATTERN.exec(text);
	if (!match) return null;
	const [, whole, fraction = ''] = match;
	return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** Hundredths → canonical two-decimal string (`1250` → `"12.50"`). */
export function hundredthsToDecimalString(hundredths: number): string {
	if (!Number.isSafeInteger(hundredths) || hundredths < 0) {
		throw new RangeError(`Invalid percentage: ${String(hundredths)}`);
	}
	const whole = Math.trunc(hundredths / 100);
	const fraction = hundredths % 100;
	return `${whole}.${String(fraction).padStart(2, '0')}`;
}

/**
 * Normalizes a database percentage to a canonical two-decimal string. Accepts the `::text` form
 * (`"12.50"`) and, defensively, a JSON number (PostgREST's default for `numeric`).
 */
export function toPercentString(value: string | number): string {
	if (typeof value === 'number') {
		if (!Number.isFinite(value) || value < 0) throw new RangeError(`Invalid percentage: ${value}`);
		return hundredthsToDecimalString(Math.round(value * 100));
	}
	const hundredths = parsePercentToHundredths(value);
	if (hundredths === null) throw new RangeError(`Invalid percentage: ${value}`);
	return hundredthsToDecimalString(hundredths);
}

/** Hundredths → es-AR number without `%`, trailing zeros trimmed (`1250` → `"12,5"`). */
export function formatHundredthsAsInput(hundredths: number): string {
	const [whole, fraction] = hundredthsToDecimalString(hundredths).split('.');
	const trimmed = fraction.replace(/0+$/, '');
	return trimmed ? `${whole},${trimmed}` : whole;
}

/**
 * Non-breaking space between the number and `%` (product decision: `25 %`, never split across
 * lines). Note that `Intl.NumberFormat('es-AR', { style: 'percent' })` omits the space.
 */
const PERCENT_SEPARATOR = '\u00a0';

/** Hundredths → display percentage (`2500` → `"25 %"`, `1250` → `"12,5 %"`). */
export function formatHundredths(hundredths: number): string {
	return `${formatHundredthsAsInput(hundredths)}${PERCENT_SEPARATOR}%`;
}

/**
 * Display format for a canonical percentage: `"12.50"` → `"12,5 %"`, `"25.00"` → `"25 %"`
 * (es-AR, trailing zeros trimmed, non-breaking space before `%`). A malformed value is returned
 * unchanged.
 */
export function formatPercent(value: string): string {
	const hundredths = parsePercentToHundredths(value);
	return hundredths === null ? value : formatHundredths(hundredths);
}

/**
 * A canonical percentage as an es-AR input value (`"12.50"` → `"12,5"`), to prefill a form field.
 * A malformed value is returned unchanged.
 */
export function formatPercentInput(value: string): string {
	const hundredths = parsePercentToHundredths(value);
	return hundredths === null ? value : formatHundredthsAsInput(hundredths);
}
