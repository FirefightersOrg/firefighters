import { describe, expect, it, vi } from 'vitest';
import type { ExportRow } from '$lib/domain/backup-exports';
import { paginateAll, type FetchPage } from './export';

const rowsOf = (n: number, start = 0): ExportRow[] =>
	Array.from({ length: n }, (_, i) => ({ id: start + i }));

describe('paginateAll', () => {
	it('reads past one page of 1000 rows with contiguous ranges', async () => {
		const fetchPage = vi.fn<FetchPage>(async (from, to) => ({
			data: rowsOf(Math.min(to, 2499) - from + 1, from),
			error: null
		}));
		const seen: number[] = [];
		for await (const page of paginateAll(fetchPage, 1000)) seen.push(...page.map((r) => r.id));
		expect(seen).toHaveLength(2500);
		expect(new Set(seen).size).toBe(2500);
		expect(fetchPage.mock.calls).toEqual([
			[0, 999],
			[1000, 1999],
			[2000, 2999]
		]);
	});

	it('asks for one more page when the last one is exactly full, then stops on empty', async () => {
		const fetchPage = vi.fn<FetchPage>(async (from) => ({
			data: from === 0 ? rowsOf(3) : [],
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
		const fetchPage: FetchPage = async (from) =>
			from === 0 ? { data: rowsOf(2), error: null } : { data: null, error: new Error('boom') };
		await expect(async () => {
			for await (const page of paginateAll(fetchPage, 2)) void page;
		}).rejects.toThrow('boom');
	});
});
