/**
 * Spanish display formatting for the whole app (SAN-131). Locale `es-AR` (decided in SAN-126):
 * numbers `1.284.500,75`, money `$ 1.284.500`, dates `24/11/2026`, 24 h times `18:05`.
 *
 * Everything goes through `Intl`, so output may contain non-breaking spaces (ICU puts one between
 * `$` and the amount). Compare against `Intl` output, never against hardcoded space characters.
 * Pure and client-safe: no `$env`, no server imports. Domain parsing/arithmetic of money stays in
 * `$lib/domain/money`; this module is for display.
 */

export const LOCALE = 'es-AR';
export const TIME_ZONE = 'America/Argentina/Buenos_Aires';
/** Shown for null, undefined and unparseable values. */
export const EMPTY_VALUE = '—';

type Numeric = number | string | null | undefined;
type DateInput = Date | string | number | null | undefined;

interface FormatOptions {
	/** Text returned for null, undefined or invalid input. Defaults to {@link EMPTY_VALUE}. */
	fallback?: string;
}

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `Intl` accepts decimal strings (exact, no float rounding); reject anything non-numeric first. */
function toIntlNumber(value: Numeric): number | string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	const trimmed = value.trim();
	return /^-?\d+(\.\d+)?$/.test(trimmed) ? trimmed : null;
}

function isWhole(value: number | string): boolean {
	if (typeof value === 'number') return Number.isInteger(value);
	const fraction = value.split('.')[1];
	return !fraction || /^0*$/.test(fraction);
}

const numberFormatters = new Map<string, Intl.NumberFormat>();
function numberFormatter(options: Intl.NumberFormatOptions): Intl.NumberFormat {
	const key = JSON.stringify(options);
	let formatter = numberFormatters.get(key);
	if (!formatter) {
		formatter = new Intl.NumberFormat(LOCALE, options);
		numberFormatters.set(key, formatter);
	}
	return formatter;
}

export interface FormatNumberOptions extends FormatOptions {
	minimumFractionDigits?: number;
	/** Defaults to 2. */
	maximumFractionDigits?: number;
}

/** `1284500.75` → `"1.284.500,75"`. Trailing zeros are dropped unless `minimumFractionDigits` says otherwise. */
export function formatNumber(value: Numeric, options: FormatNumberOptions = {}): string {
	const parsed = toIntlNumber(value);
	if (parsed === null) return options.fallback ?? EMPTY_VALUE;
	const minimumFractionDigits = options.minimumFractionDigits ?? 0;
	return numberFormatter({
		minimumFractionDigits,
		maximumFractionDigits: Math.max(options.maximumFractionDigits ?? 2, minimumFractionDigits)
	}).format(parsed as number);
}

export interface FormatMoneyOptions extends FormatOptions {
	/**
	 * `auto` (default): no decimals when the amount is whole (`$ 1.284.500`), two otherwise
	 * (`$ 1.284.500,75`). `always`: always two decimals, for printable documents and ledgers.
	 */
	decimals?: 'auto' | 'always';
}

/**
 * Argentine pesos from a canonical decimal string (`"60000.50"`) or a number. Negative amounts
 * keep Intl's sign placement (`-$ 1.234,50`). Rounds to cents.
 */
export function formatMoney(value: Numeric, options: FormatMoneyOptions = {}): string {
	const parsed = toIntlNumber(value);
	if (parsed === null) return options.fallback ?? EMPTY_VALUE;
	const fractionDigits = options.decimals === 'always' || !isWhole(parsed) ? 2 : 0;
	return numberFormatter({
		style: 'currency',
		currency: 'ARS',
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: 2
	}).format(parsed as number);
}

/** Zero-padded integer (`7, 4` → `"0007"`), for bond, note and settlement numbers. Longer values are not truncated. */
export function formatPaddedNumber(value: number, digits: number): string {
	if (!Number.isSafeInteger(value)) return String(value);
	return value < 0
		? `-${String(-value).padStart(digits, '0')}`
		: String(value).padStart(digits, '0');
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	let formatter = dateFormatters.get(key);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat(LOCALE, options);
		dateFormatters.set(key, formatter);
	}
	return formatter;
}

const DATE_PARTS = { day: '2-digit', month: '2-digit', year: 'numeric' } as const;
const TIME_PARTS = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;

/** SQL `date` strings (`2026-11-24`) are calendar days: no time zone, no invented time. */
function calendarDay(value: DateInput): Date | null {
	if (typeof value !== 'string') return null;
	const match = CALENDAR_DAY.exec(value.trim());
	if (!match) return null;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const date = new Date(Date.UTC(year, month - 1, day));
	// Reject overflow such as 2026-02-31.
	return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function toInstant(value: DateInput): Date | null {
	if (value === null || value === undefined || value === '') return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `24/11/2026`. A `YYYY-MM-DD` string is a calendar day and is printed as is. Any other string,
 * `Date` or epoch is an instant and is shown on the Buenos Aires calendar.
 */
export function formatDate(value: DateInput, options: FormatOptions = {}): string {
	const fallback = options.fallback ?? EMPTY_VALUE;
	const day = calendarDay(value);
	if (day) return dateFormatter('day', { ...DATE_PARTS, timeZone: 'UTC' }).format(day);
	// A well-shaped but impossible day (2026-02-31) must not fall through to Date parsing.
	if (typeof value === 'string' && CALENDAR_DAY.test(value.trim())) return fallback;
	const instant = toInstant(value);
	if (!instant) return fallback;
	return dateFormatter('date', { ...DATE_PARTS, timeZone: TIME_ZONE }).format(instant);
}

/**
 * `24/11/2026, 18:05` (24 h, Buenos Aires time). A calendar-day string has no time, so it is
 * formatted like {@link formatDate} instead of showing an invented `00:00`.
 */
export function formatDateTime(value: DateInput, options: FormatOptions = {}): string {
	if (typeof value === 'string' && CALENDAR_DAY.test(value.trim()))
		return formatDate(value, options);
	const instant = toInstant(value);
	if (!instant) return options.fallback ?? EMPTY_VALUE;
	return dateFormatter('datetime', { ...DATE_PARTS, ...TIME_PARTS, timeZone: TIME_ZONE }).format(
		instant
	);
}

/** `18:05` in Buenos Aires time. */
export function formatTime(value: DateInput, options: FormatOptions = {}): string {
	const instant = toInstant(value);
	if (!instant) return options.fallback ?? EMPTY_VALUE;
	return dateFormatter('time', { ...TIME_PARTS, timeZone: TIME_ZONE }).format(instant);
}

/** Buenos Aires calendar day of an instant, as a day count, to count whole days between instants. */
function buenosAiresDayNumber(instant: Date): number {
	const parts = Object.fromEntries(
		dateFormatter('day-parts', { ...DATE_PARTS, timeZone: TIME_ZONE })
			.formatToParts(instant)
			.map((part) => [part.type, part.value])
	);
	return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 86_400_000;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const RELATIVE_LIMIT_DAYS = 7;

let relativeFormatter: Intl.RelativeTimeFormat | undefined;

/**
 * Relative time only for less than 7 calendar days (Buenos Aires): `ahora`, `hace 5 minutos`,
 * `dentro de 2 horas`, `ayer`, `hace 3 días`. From 7 days on it falls back to {@link formatDate},
 * because «hace 40 días» is harder to read than a date. `now` is injectable for tests.
 */
export function formatRelative(
	value: DateInput,
	now: Date | number = new Date(),
	options: FormatOptions = {}
): string {
	const instant = toInstant(value);
	if (!instant) return options.fallback ?? EMPTY_VALUE;
	const reference = toInstant(now) ?? new Date();
	relativeFormatter ??= new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
	const diff = instant.getTime() - reference.getTime();
	const abs = Math.abs(diff);
	if (abs < MINUTE) return relativeFormatter.format(0, 'second');
	if (abs < HOUR) return relativeFormatter.format(Math.trunc(diff / MINUTE), 'minute');
	if (abs < 24 * HOUR) return relativeFormatter.format(Math.trunc(diff / HOUR), 'hour');
	const days = buenosAiresDayNumber(instant) - buenosAiresDayNumber(reference);
	if (Math.abs(days) >= RELATIVE_LIMIT_DAYS) return formatDate(instant, options);
	return relativeFormatter.format(days, 'day');
}
