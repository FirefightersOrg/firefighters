import { describe, expect, it } from 'vitest';
import type { DrawStatus } from './draws';
import {
	bondCountWords,
	collectorBalanceWords,
	listSearch,
	showingWords,
	splitDraws,
	dialNumber
} from './people-draw-lists';

describe('bondCountWords', () => {
	it('says the count with its noun, and «Sin bonos» for none', () => {
		expect(bondCountWords(0)).toBe('Sin bonos');
		expect(bondCountWords(1)).toBe('1 bono');
		expect(bondCountWords(35)).toBe('35 bonos');
		expect(bondCountWords(1240)).toBe('1.240 bonos');
		expect(bondCountWords(Number.NaN)).toBe('Sin bonos');
	});
});

describe('collectorBalanceWords', () => {
	it('names whose favour the balance is in, with the figure without a sign', () => {
		expect(collectorBalanceWords('41000.00')).toEqual({
			label: 'A favor del cobrador',
			amount: 41000
		});
		expect(collectorBalanceWords('-3500.50')).toEqual({
			label: 'A cargo del cobrador',
			amount: 3500.5
		});
		expect(collectorBalanceWords(-0.01)).toEqual({ label: 'A cargo del cobrador', amount: 0.01 });
	});

	it('says «Sin saldo» for zero, with no figure', () => {
		expect(collectorBalanceWords('0.00')).toEqual({ label: 'Sin saldo', amount: null });
		expect(collectorBalanceWords(0)).toEqual({ label: 'Sin saldo', amount: null });
		expect(collectorBalanceWords('-0.00')).toEqual({ label: 'Sin saldo', amount: null });
	});

	it('says nothing when the balance was not read', () => {
		expect(collectorBalanceWords(null)).toBeNull();
		expect(collectorBalanceWords(undefined)).toBeNull();
		expect(collectorBalanceWords('')).toBeNull();
		expect(collectorBalanceWords('abc')).toBeNull();
	});
});

describe('dialNumber', () => {
	it('keeps the digits and the plus sign of a phone as people type it', () => {
		expect(dialNumber('2364 55-9034')).toBe('2364559034');
		expect(dialNumber('+54 (236) 455-9034')).toBe('+542364559034');
	});

	it('is null when there is nothing to dial', () => {
		expect(dialNumber(null)).toBeNull();
		expect(dialNumber('')).toBeNull();
		expect(dialNumber('no tiene')).toBeNull();
		expect(dialNumber('+')).toBeNull();
	});
});

describe('splitDraws', () => {
	const draw = (id: string, status: DrawStatus, drawDate: string) => ({ id, status, drawDate });
	// As the load returns them: by date, latest first.
	const draws = [
		draw('final', 'scheduled', '2027-06-24'),
		draw('december', 'roster_generated', '2026-12-08'),
		draw('november', 'roster_frozen', '2026-11-26'),
		draw('october', 'completed', '2026-10-28'),
		draw('void', 'annulled', '2026-10-01'),
		draw('september', 'closed', '2026-09-30')
	];

	it('puts the draws still to be held first, the next one on top', () => {
		expect(splitDraws(draws).pending.map((d) => d.id)).toEqual(['november', 'december', 'final']);
	});

	it('lists the ones held or annulled after them, the latest on top', () => {
		expect(splitDraws(draws).done.map((d) => d.id)).toEqual(['october', 'void', 'september']);
	});

	it('does not depend on the order it is given, and leaves the input alone', () => {
		const reversed = [...draws].reverse();
		const result = splitDraws(reversed);
		expect(result.pending.map((d) => d.id)).toEqual(['november', 'december', 'final']);
		expect(result.done.map((d) => d.id)).toEqual(['october', 'void', 'september']);
		expect(reversed.map((d) => d.id)).toEqual([...draws].reverse().map((d) => d.id));
		expect(splitDraws([])).toEqual({ pending: [], done: [] });
	});
});

describe('showingWords', () => {
	const noun = { one: 'comprador', many: 'compradores' };

	it('says which rows of the list are on screen', () => {
		expect(showingWords({ page: 1, pageSize: 25, total: 90 }, noun)).toBe(
			'Mostrando 1–25 de 90 compradores'
		);
		expect(showingWords({ page: 4, pageSize: 25, total: 90 }, noun)).toBe(
			'Mostrando 76–90 de 90 compradores'
		);
		expect(showingWords({ page: 1, pageSize: 25, total: 1 }, noun)).toBe(
			'Mostrando 1–1 de 1 comprador'
		);
	});
});

describe('listSearch', () => {
	it('keeps the filters that have a value, and the page past the first', () => {
		expect(listSearch({ q: '', type: '' })).toBe('');
		expect(listSearch({ q: 'Ada Lovelace', type: 'individual' })).toBe(
			'?q=Ada%20Lovelace&type=individual'
		);
		expect(listSearch({ q: 'Ada Lovelace', type: '' }, 3)).toBe('?q=Ada%20Lovelace&page=3');
		expect(listSearch({ q: '', type: '' }, 2)).toBe('?page=2');
		expect(listSearch({ q: 'a&b=c' })).toBe('?q=a%26b%3Dc');
	});
});
