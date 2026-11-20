import { describe, expect, it, vi } from 'vitest';
import type { ExportRow } from '$lib/domain/backup-exports';
import { keysetFilter, paginateAll, type FetchPage } from './export';

const rowsOf = (n: number, start = 0): ExportRow[] =>
	Array.from({ length: n }, (_, i) => ({ id: start + i }));

describe('paginateAll', () => {
	it('reads past one page of 1000 rows, each page starting after the last row seen', async () => {
		const fetchPage = vi.fn<FetchPage>(async (after) => {
			const start = after ? (after.id as number) + 1 : 0;
			return { data: rowsOf(Math.min(2500 - start, 1000), start), error: null };
		});
		const seen: number[] = [];
		for await (const page of paginateAll(fetchPage, 1000)) seen.push(...page.map((r) => r.id));
		expect(seen).toHaveLength(2500);
		expect(new Set(seen).size).toBe(2500);
		expect(fetchPage.mock.calls.map(([a]) => a?.id ?? null)).toEqual([null, 999, 1999]);
	});

	it('does not repeat or skip rows when a row is inserted before the cursor mid-export', async () => {
		let data = rowsOf(6).map((r) => ({ id: r.id * 10 }));
		const fetchPage: FetchPage = async (after) => {
			const page = data.filter((r) => !after || r.id > after.id).slice(0, 3);
			if (after === null) data = [{ id: -5 }, ...data];
			return { data: page, error: null };
		};
		const seen: number[] = [];
		for await (const page of paginateAll(fetchPage, 3)) seen.push(...page.map((r) => r.id));
		expect(seen).toEqual([0, 10, 20, 30, 40, 50]);
	});

	it('asks for one more page when the last one is exactly full, then stops on empty', async () => {
		const fetchPage = vi.fn<FetchPage>(async (after) => ({
			data: after === null ? rowsOf(3) : [],
			error: null
		}));
		const pages: ExportRow[][] = [];
		for await (const page of paginateAll(fetchPage, 3)) pages.push(page);
		expect(pages).toHaveLength(1);
		expect(fetchPage).toHaveBeenCalledTimes(2);
	});

	it('yields nothing for an empty result', async () => {
		const pages: ExportRow[][] = [];
		for await (const p of paginateAll(async () => ({ data: [], error: null }), 5)) pages.push(p);
		expect(pages).toEqual([]);
	});

	it('throws on a page error instead of truncating silently', async () => {
		const fetchPage: FetchPage = async (after) =>
			after === null ? { data: rowsOf(2), error: null } : { data: null, error: new Error('boom') };
		await expect(async () => {
			for await (const page of paginateAll(fetchPage, 2)) void page;
		}).rejects.toThrow('boom');
	});
});

describe('keysetFilter', () => {
	it('builds a strictly-after filter over the whole order', () => {
		expect(
			keysetFilter(['payment_date', 'created_at', 'id'], {
				payment_date: '2026-11-01',
				created_at: '2026-11-01T10:00:00.5+00:00',
				id: 'abc'
			})
		).toBe(
			'and(payment_date.gt."2026-11-01"),' +
				'and(payment_date.eq."2026-11-01",created_at.gt."2026-11-01T10:00:00.5+00:00"),' +
				'and(payment_date.eq."2026-11-01",created_at.eq."2026-11-01T10:00:00.5+00:00",id.gt."abc")'
		);
	});
});
