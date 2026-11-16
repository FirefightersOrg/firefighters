/**
 * Money helpers (pure, no framework imports).
 *
 * Representation: amounts are stored in Postgres as `numeric(14,2)`. In the app they travel as
 * **decimal strings with exactly two decimals** (`"60000.00"`), read with a `::text` cast so no
 * value ever goes through a binary float. Arithmetic is done in **integer cents** (`number`):
 * the largest `numeric(14,2)` value, 999,999,999,999.99, is 99,999,999,999,999 cents, well below
 * `Number.MAX_SAFE_INTEGER`, so cent arithmetic on these values is exact.
 */

/** Largest amount a `numeric(14,2)` column can hold, in cents. */
export const MAX_MONEY_CENTS = 99_999_999_999_999;

/**
 * Accepted user input: up to 12 integer digits, optionally a dot and 1-2 decimals.
 * No signs, no thousands separators, no exponent (e.g. `60000`, `60000.5`, `60000.50`).
 */
export const MONEY_INPUT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/** Parses user input (see {@link MONEY_INPUT_PATTERN}) into cents, or `null` if malformed. */
export function parseMoneyToCents(input: string): number | null {
	const trimmed = input.trim();
	if (!MONEY_INPUT_PATTERN.test(trimmed)) return null;
	const [whole, fraction = ''] = trimmed.split('.');
	return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** Formats cents as a two-decimal string (`6000000` → `"60000.00"`). */
export function centsToDecimalString(cents: number): string {
	if (!Number.isSafeInteger(cents) || cents < 0) {
		throw new RangeError(`Invalid cents value: ${String(cents)}`);
	}
	const whole = Math.trunc(cents / 100);
	const fraction = cents % 100;
	return `${whole}.${String(fraction).padStart(2, '0')}`;
}

/**
 * Normalizes a database money value to a two-decimal string. Accepts the `::text` form
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

/** Display format with thousands separators (`"60000.00"` → `"60,000.00"`). Exact (string-based). */
export function formatMoney(value: string): string {
	const cents = parseMoneyToCents(value);
	if (cents === null) return value;
	const [whole, fraction] = centsToDecimalString(cents).split('.');
	return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}
