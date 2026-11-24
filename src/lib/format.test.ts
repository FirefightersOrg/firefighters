import { describe, expect, it } from 'vitest';
import {
	EMPTY_VALUE,
	formatDate,
	formatDateTime,
	formatMoney,
	formatNumber,
	formatPaddedNumber,
	formatRelative,
	formatTime
} from './format';

const NBSP = ' ';
const ars = (fractionDigits: number, value: number | string) =>
	new Intl.NumberFormat('es-AR', {
		style: 'currency',
		currency: 'ARS',
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: 2
	}).format(value as number);

describe('formatNumber', () => {
	it('uses dot for thousands and comma for decimals', () => {
		expect(formatNumber(1284500.75)).toBe('1.284.500,75');
		expect(formatNumber('1284500.75')).toBe('1.284.500,75');
		expect(formatNumber(1234567)).toBe('1.234.567');
	});

	it('drops trailing zeros and keeps at most two decimals by default', () => {
		expect(formatNumber(12.5)).toBe('12,5');
		expect(formatNumber('12.50')).toBe('12,5');
		expect(formatNumber(1.005)).toBe(
			new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(1.005)
		);
		expect(formatNumber(0.126)).toBe('0,13');
	});

	it('honours minimum and maximum fraction digits', () => {
		expect(formatNumber(5, { minimumFractionDigits: 2 })).toBe('5,00');
		expect(formatNumber(1.23456, { maximumFractionDigits: 4 })).toBe('1,2346');
		expect(formatNumber(1.2, { minimumFractionDigits: 3, maximumFractionDigits: 1 })).toBe('1,200');
	});

	it('handles zero, negatives and small values', () => {
		expect(formatNumber(0)).toBe('0');
		expect(formatNumber(-1234.5)).toBe(new Intl.NumberFormat('es-AR').format(-1234.5));
		expect(formatNumber(-1234.5)).toContain('1.234,5');
		expect(formatNumber('-0.5')).toContain('0,5');
	});

	it('groups four digit numbers like the rest', () => {
		expect(formatNumber(1234)).toBe('1.234');
	});

	it('returns the fallback for null, undefined, empty and malformed input', () => {
		for (const value of [null, undefined, '', '  ', 'abc', '1,5', NaN, Infinity]) {
			expect(formatNumber(value)).toBe(EMPTY_VALUE);
		}
		expect(formatNumber(null, { fallback: '' })).toBe('');
	});
});

describe('formatMoney', () => {
	it('omits decimals for whole amounts and shows two otherwise', () => {
		expect(formatMoney(1284500)).toBe(ars(0, 1284500));
		expect(formatMoney('1284500.00')).toBe(ars(0, 1284500));
		expect(formatMoney('1284500.75')).toBe(ars(2, '1284500.75'));
		expect(formatMoney('60000.5')).toBe(ars(2, '60000.5'));
	});

	it('renders the es-AR shape: sign, one space, dot thousands, comma decimals', () => {
		expect(formatMoney(1284500)).toMatch(/^\$\s1\.284\.500$/);
		expect(formatMoney('1284500.75')).toMatch(/^\$\s1\.284\.500,75$/);
		expect(formatMoney(0)).toMatch(/^\$\s0$/);
	});

	it('uses the same space character as Intl (non-breaking on Node 24 ICU)', () => {
		const sample = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(1);
		const intlSpace = /\$(\s)/.exec(sample)?.[1];
		expect(intlSpace).toBeDefined();
		expect(/\$(\s)/.exec(formatMoney(5))?.[1]).toBe(intlSpace);
		// Whatever ICU emits, it must not be a breaking regular space inside the amount on this runtime.
		if (intlSpace === NBSP) expect(formatMoney(5)).toContain(NBSP);
	});

	it('always shows two decimals when asked (printable documents)', () => {
		expect(formatMoney('100.00', { decimals: 'always' })).toBe(ars(2, '100.00'));
		expect(formatMoney(100, { decimals: 'always' })).toMatch(/^\$\s100,00$/);
		expect(formatMoney('0', { decimals: 'always' })).toMatch(/^\$\s0,00$/);
	});

	it('matches the legacy domain formatter for canonical amounts', async () => {
		const { formatMoney: legacy } = await import('$lib/domain/money');
		for (const amount of ['0.00', '0.05', '100.00', '60000.50', '1284500.75', '99999999999.99']) {
			expect(formatMoney(amount, { decimals: 'always' })).toBe(legacy(amount));
		}
	});

	it('keeps large decimal strings exact', () => {
		expect(formatMoney('99999999999999.99')).toMatch(/^\$\s99\.999\.999\.999\.999,99$/);
	});

	it('formats negative amounts with Intl sign placement', () => {
		expect(formatMoney(-1234.5)).toBe(ars(2, -1234.5));
		expect(formatMoney('-1500')).toBe(ars(0, -1500));
		expect(formatMoney('-1500')).toContain('1.500');
		expect(formatMoney('-1500').startsWith('-')).toBe(true);
	});

	it('rounds to cents', () => {
		expect(formatMoney('10.126')).toMatch(/^\$\s10,13$/);
		expect(formatMoney(0.1 + 0.2)).toMatch(/^\$\s0,3$|^\$\s0,30$/);
		expect(formatMoney('10.004')).toMatch(/^\$\s10,00$/);
	});

	it('treats an amount that is whole only after trailing zeros as whole', () => {
		expect(formatMoney('15.000')).toBe(ars(0, 15));
	});

	it('returns the fallback for null, undefined and malformed input', () => {
		for (const value of [null, undefined, '', 'x', '$ 10', NaN]) {
			expect(formatMoney(value)).toBe(EMPTY_VALUE);
		}
		expect(formatMoney(undefined, { fallback: 'Sin importe' })).toBe('Sin importe');
	});
});

describe('formatPaddedNumber', () => {
	it('pads to the digit count without truncating', () => {
		expect(formatPaddedNumber(7, 4)).toBe('0007');
		expect(formatPaddedNumber(0, 5)).toBe('00000');
		expect(formatPaddedNumber(123456, 4)).toBe('123456');
	});

	it('keeps the sign in front and passes through unsafe values', () => {
		expect(formatPaddedNumber(-7, 4)).toBe('-0007');
		expect(formatPaddedNumber(1.5, 4)).toBe('1.5');
	});
});

describe('formatDate', () => {
	it('formats instants on the Buenos Aires calendar as dd/mm/yyyy', () => {
		expect(formatDate('2026-11-24T15:00:00Z')).toBe('24/11/2026');
		expect(formatDate(new Date('2026-03-05T12:00:00Z'))).toBe('05/03/2026');
		expect(formatDate(Date.UTC(2026, 0, 31, 12))).toBe('31/01/2026');
	});

	it('respects the Buenos Aires day boundary (UTC-3)', () => {
		// 02:59 UTC is still the previous day in Buenos Aires; 03:00 UTC is the new day.
		expect(formatDate('2026-11-24T02:59:59Z')).toBe('23/11/2026');
		expect(formatDate('2026-11-24T03:00:00Z')).toBe('24/11/2026');
		expect(formatDate('2026-01-01T02:59:00Z')).toBe('31/12/2025');
		expect(formatDate('2026-11-24T23:59:59-03:00')).toBe('24/11/2026');
	});

	it('prints calendar days as is, with no zone shift', () => {
		expect(formatDate('2026-11-24')).toBe('24/11/2026');
		expect(formatDate('2026-01-01')).toBe('01/01/2026');
		expect(formatDate('2028-02-29')).toBe('29/02/2028');
	});

	it('rejects impossible calendar days instead of rolling over', () => {
		expect(formatDate('2026-02-31')).toBe(EMPTY_VALUE);
		expect(formatDate('2026-13-01')).toBe(EMPTY_VALUE);
		expect(formatDate('2027-02-29')).toBe(EMPTY_VALUE);
	});

	it('returns the fallback for null, undefined and invalid input', () => {
		for (const value of [null, undefined, '', 'nope', new Date('x'), NaN]) {
			expect(formatDate(value)).toBe(EMPTY_VALUE);
		}
		expect(formatDate(null, { fallback: 'Sin fecha' })).toBe('Sin fecha');
	});
});

describe('formatDateTime', () => {
	const intl = (value: string) =>
		new Intl.DateTimeFormat('es-AR', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
			timeZone: 'America/Argentina/Buenos_Aires'
		}).format(new Date(value));

	it('formats date and 24 h time in Buenos Aires', () => {
		expect(formatDateTime('2026-11-24T21:05:00Z')).toBe(intl('2026-11-24T21:05:00Z'));
		expect(formatDateTime('2026-11-24T21:05:00Z')).toMatch(/^24\/11\/2026,? 18:05$/);
		expect(formatDateTime('2026-11-18T15:30:00Z')).toContain('12:30');
	});

	it('uses 00:xx, never 24:xx, at midnight and keeps 24 h hours in the afternoon', () => {
		expect(formatDateTime('2026-11-24T03:05:00Z')).toMatch(/^24\/11\/2026,? 00:05$/);
		expect(formatDateTime('2026-11-24T20:00:00Z')).toContain('17:00');
		expect(formatDateTime('2026-11-24T20:00:00Z')).not.toMatch(/p\.\s?m\./i);
	});

	it('crosses the day boundary like formatDate', () => {
		expect(formatDateTime('2026-11-24T02:59:00Z')).toMatch(/^23\/11\/2026,? 23:59$/);
		expect(formatDateTime('2026-11-24T03:00:00Z')).toMatch(/^24\/11\/2026,? 00:00$/);
	});

	it('does not invent a time for calendar days', () => {
		expect(formatDateTime('2026-11-24')).toBe('24/11/2026');
		expect(formatDateTime('2026-11-24')).not.toMatch(/\d{2}:\d{2}/);
	});

	it('accepts Date and epoch values', () => {
		const instant = new Date('2026-11-24T21:05:00Z');
		expect(formatDateTime(instant)).toBe(formatDateTime(instant.getTime()));
		expect(formatDateTime(instant)).toBe(formatDateTime('2026-11-24T21:05:00Z'));
	});

	it('returns the fallback for missing or invalid values', () => {
		expect(formatDateTime(null)).toBe(EMPTY_VALUE);
		expect(formatDateTime(undefined)).toBe(EMPTY_VALUE);
		expect(formatDateTime('garbage')).toBe(EMPTY_VALUE);
		expect(formatDateTime('2026-02-31')).toBe(EMPTY_VALUE);
	});
});

describe('formatTime', () => {
	it('formats the Buenos Aires wall clock in 24 h', () => {
		expect(formatTime('2026-11-24T21:05:00Z')).toBe('18:05');
		expect(formatTime('2026-11-24T03:00:00Z')).toBe('00:00');
		expect(formatTime(null)).toBe(EMPTY_VALUE);
	});
});

describe('formatRelative', () => {
	const now = new Date('2026-11-24T15:00:00Z'); // 12:00 in Buenos Aires
	const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
	const rtf = new Intl.RelativeTimeFormat('es-AR', { numeric: 'auto' });
	const MIN = 60_000;
	const HOUR = 60 * MIN;
	const DAY = 24 * HOUR;

	it('says now for under a minute, in both directions', () => {
		expect(formatRelative(at(-30_000), now)).toBe(rtf.format(0, 'second'));
		expect(formatRelative(at(30_000), now)).toBe(rtf.format(0, 'second'));
		expect(formatRelative(now, now)).toBe(rtf.format(0, 'second'));
	});

	it('uses minutes and hours inside the day', () => {
		expect(formatRelative(at(-5 * MIN), now)).toBe(rtf.format(-5, 'minute'));
		expect(formatRelative(at(45 * MIN), now)).toBe(rtf.format(45, 'minute'));
		expect(formatRelative(at(-3 * HOUR), now)).toBe(rtf.format(-3, 'hour'));
		expect(formatRelative(at(2 * HOUR), now)).toBe(rtf.format(2, 'hour'));
	});

	it('uses Buenos Aires calendar days from 24 h on', () => {
		expect(formatRelative(at(-DAY), now)).toBe(rtf.format(-1, 'day'));
		expect(formatRelative(at(DAY), now)).toBe(rtf.format(1, 'day'));
		expect(formatRelative(at(-3 * DAY), now)).toBe(rtf.format(-3, 'day'));
		expect(formatRelative(at(-6 * DAY), now)).toBe(rtf.format(-6, 'day'));
	});

	it('falls back to an absolute date from 7 days on', () => {
		expect(formatRelative(at(-7 * DAY), now)).toBe(formatDate(at(-7 * DAY)));
		expect(formatRelative(at(-40 * DAY), now)).toBe(formatDate(at(-40 * DAY)));
		expect(formatRelative(at(10 * DAY), now)).toBe(formatDate(at(10 * DAY)));
	});

	it('counts days on the Buenos Aires calendar, not on 24 h blocks', () => {
		// 01:00 Buenos Aires on the 24th vs 23:00 on the 22nd: 26 h apart, two calendar days.
		const earlyMorning = new Date('2026-11-24T04:00:00Z');
		const twoDaysEarlier = new Date('2026-11-23T02:00:00Z'); // 23:00 on the 22nd
		expect(formatRelative(twoDaysEarlier, earlyMorning)).toBe(rtf.format(-2, 'day'));
	});

	it('accepts strings and epochs and a numeric now', () => {
		expect(formatRelative('2026-11-24T14:55:00Z', now.getTime())).toBe(rtf.format(-5, 'minute'));
		expect(formatRelative(now.getTime() - 5 * MIN, now)).toBe(rtf.format(-5, 'minute'));
	});

	it('returns the fallback for missing or invalid values', () => {
		expect(formatRelative(null, now)).toBe(EMPTY_VALUE);
		expect(formatRelative(undefined, now)).toBe(EMPTY_VALUE);
		expect(formatRelative('x', now)).toBe(EMPTY_VALUE);
		expect(formatRelative('x', now, { fallback: '' })).toBe('');
	});
});
