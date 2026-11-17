/**
 * Money helpers (pure, no framework imports).
 *
 * Representation: amounts are stored in Postgres as `numeric(14,2)`. In the app they travel as
 * **canonical decimal strings with exactly two decimals** (`"60000.00"`), read with a `::text`
 * cast so no value ever goes through a binary float, and sent to SQL in the same canonical form.
 * Arithmetic is done in **integer cents** (`number`): the largest `numeric(14,2)` value,
 * 999,999,999,999.99, is 99,999,999,999,999 cents, well below `Number.MAX_SAFE_INTEGER`, so cent
 * arithmetic on these values is exact.
 *
 * People type and read amounts in **Argentine format** (es-AR): `.` groups thousands and `,` is
 * the decimal separator. User input goes through {@link parseMoneyInput}; every amount shown in
 * the UI goes through {@link formatMoney} (`"$ 60.000,50"`).
 */

/** Largest amount a `numeric(14,2)` column can hold, in cents. */
export const MAX_MONEY_CENTS = 99_999_999_999_999;

/** Integer digits a `numeric(14,2)` amount can have. */
const MAX_INTEGER_DIGITS = 12;

/** Canonical form (database / SQL): up to 12 integer digits, optionally `.` and 1-2 decimals. */
const CANONICAL_MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * Parses a **canonical** amount (`"60000"`, `"60000.5"`, `"60000.50"`) into cents, or `null` if
 * malformed. For database values and SQL-bound strings only; user input uses
 * {@link parseMoneyInput}.
 */
export function parseMoneyToCents(input: string): number | null {
	const trimmed = input.trim();
	if (!CANONICAL_MONEY_PATTERN.test(trimmed)) return null;
	const [whole, fraction = ''] = trimmed.split('.');
	return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

// Integer part written with `.` thousands separators: a first group of 1-3 digits without a
// leading zero, then one or more groups of exactly 3 digits (`60.000`, `1.234.567`).
const GROUPED_INTEGER = String.raw`[1-9]\d{0,2}(?:\.\d{3})+`;
// Integer part without separators (`60000`, `0`).
const PLAIN_INTEGER = String.raw`\d+`;

/** Has a comma: `,` is the decimal separator (1-2 decimals), `.` may only group thousands. */
const AR_WITH_DECIMALS = new RegExp(`^(${GROUPED_INTEGER}|${PLAIN_INTEGER}),(\\d{1,2})$`);
/** No comma: digits, optionally grouped with `.` in thousands. */
const AR_INTEGER = new RegExp(`^(${GROUPED_INTEGER}|${PLAIN_INTEGER})$`);
/** No comma, a single `.` followed by 1-2 digits: unambiguously a decimal point (`60000.50`). */
const DOT_DECIMAL = /^(\d+)\.(\d{1,2})$/;

/** Message for input {@link parseMoneyInput} rejects (shared by the schemas and live previews). */
export const MONEY_INPUT_FORMAT_MESSAGE =
	'Enter an amount like 60.000 or 60.000,50 (dots for thousands, comma for up to 2 decimals)';

/**
 * Parses an amount typed by a person into cents, or `null` if it is malformed or does not fit in
 * `numeric(14,2)`. The same function runs in the browser (live previews) and on the server
 * (form schemas), so both accept exactly the same strings.
 *
 * Rules (Argentine format):
 * - Surrounding whitespace and an optional leading `$` are ignored, so the display format
 *   (`"$ 60.000,50"`, see {@link formatMoney}) parses back to the same amount.
 * - **With a comma**, the comma is the decimal separator (exactly one, followed by 1-2 digits)
 *   and dots can only be thousands separators: `60.000,50`, `60000,50`, `60.000,5`.
 * - **Without a comma**, dots are thousands separators when they group exactly 3 digits
 *   (`60.000` = 60000, `1.234.567` = 1234567); the first group has 1-3 digits and no leading
 *   zero. Plain digits are whole amounts (`60000`).
 * - **The only dot-as-decimal form accepted** is a single dot followed by 1-2 digits with no
 *   comma (`60000.50`, `60000.5`): a thousands group always has 3 digits, so it is unambiguous.
 * - Everything else is rejected rather than guessed: `60,000` (3 decimals), `1,234.56` (US
 *   format), `60.00.00`, `0.500`, `60000.500`, `1.5,00`, `.5`, `5,`, signs, exponents, spaces
 *   inside the number, more than 12 integer digits.
 */
export function parseMoneyInput(input: string): number | null {
	const text = input.trim().replace(/^\$\s*/, '');

	let whole: string;
	let fraction = '';
	const withDecimals = AR_WITH_DECIMALS.exec(text);
	const dotDecimal = withDecimals ? null : DOT_DECIMAL.exec(text);
	if (withDecimals) {
		[, whole, fraction] = withDecimals;
	} else if (dotDecimal) {
		[, whole, fraction] = dotDecimal;
	} else if (AR_INTEGER.test(text)) {
		whole = text;
	} else {
		return null;
	}

	const digits = whole.replaceAll('.', '');
	if (digits.length > MAX_INTEGER_DIGITS) return null;
	return Number(digits) * 100 + Number(fraction.padEnd(2, '0'));
}

/** Formats cents as a canonical two-decimal string (`6000000` → `"60000.00"`). */
export function centsToDecimalString(cents: number): string {
	if (!Number.isSafeInteger(cents) || cents < 0) {
		throw new RangeError(`Invalid cents value: ${String(cents)}`);
	}
	const whole = Math.trunc(cents / 100);
	const fraction = cents % 100;
	return `${whole}.${String(fraction).padStart(2, '0')}`;
}

/**
 * Normalizes a database money value to a canonical two-decimal string. Accepts the `::text` form
 * (`"60000.00"`) and, defensively, a JSON number (PostgREST's default for `numeric`).
 */
export function toDecimalString(value: string | number): string {
	if (typeof value === 'number') {
		if (!Number.isFinite(value) || value < 0) throw new RangeError(`Invalid amount: ${value}`);
		return centsToDecimalString(Math.round(value * 100));
	}
	const cents = parseMoneyToCents(value);
	if (cents === null) throw new RangeError(`Invalid amount: ${value}`);
	return centsToDecimalString(cents);
}

/** Groups the digits of a non-negative integer with `.` (`"1234567"` → `"1.234.567"`). */
export function groupThousands(digits: string): string {
	return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** `1234567` → `"1.234.567"` (es-AR thousands separators, deterministic). */
export function formatInteger(value: number): string {
	if (!Number.isSafeInteger(value)) return String(value);
	return value < 0 ? `-${groupThousands(String(-value))}` : groupThousands(String(value));
}

/** Non-breaking space between the currency sign and the amount, as `Intl` es-AR does. */
const CURRENCY_SEPARATOR = ' ';

/** Cents → es-AR amount without currency sign (`6000050` → `"60.000,50"`). */
export function formatCentsAsInput(cents: number): string {
	const [whole, fraction] = centsToDecimalString(cents).split('.');
	return `${groupThousands(whole)},${fraction}`;
}

/** Cents → display amount (`6000050` → `"$ 60.000,50"`, with a non-breaking space). */
export function formatCents(cents: number): string {
	return `$${CURRENCY_SEPARATOR}${formatCentsAsInput(cents)}`;
}

/**
 * Display format for a canonical amount: `"60000.5"` → `"$ 60.000,50"` (es-AR, always two
 * decimals, non-breaking space after `$`). Built from the digits rather than with
 * `Intl.NumberFormat`, so it is exact for every `numeric(14,2)` value and renders the same on the
 * server and in every browser (the output matches `Intl.NumberFormat('es-AR', { style:
 * 'currency', currency: 'ARS' })`). A malformed value is returned unchanged.
 */
export function formatMoney(value: string): string {
	const cents = parseMoneyToCents(value);
	return cents === null ? value : formatCents(cents);
}

/**
 * A canonical amount as an es-AR input value (`"60000.00"` → `"60.000,00"`), to prefill a form
 * field. A malformed value is returned unchanged.
 */
export function formatMoneyInput(value: string): string {
	const cents = parseMoneyToCents(value);
	return cents === null ? value : formatCentsAsInput(cents);
}
