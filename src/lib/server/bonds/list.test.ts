import { describe, expect, it } from 'vitest';
import type { Campaign } from '$lib/domain/campaigns';
import { parseBondListQuery } from './list';

const campaign = { numberDigits: 4 } as unknown as Campaign;
const COLLECTOR = 'c0000000-0000-0000-0000-0000000000c1';
const parse = (search: string) => parseBondListQuery(new URLSearchParams(search), campaign);

describe('parseBondListQuery: collector filter', () => {
	it('takes a collector id', () => {
		const query = parse(`collector=${COLLECTOR}`);
		expect(query.filters.collectorId).toBe(COLLECTOR);
		expect(query.values.collector).toBe(COLLECTOR);
		expect(query.errors).toEqual({});
	});

	it('has no collector filter by default', () => {
		const query = parse('');
		expect(query.filters.collectorId).toBeNull();
		expect(query.values.collector).toBe('');
	});

	it('refuses anything that is not an id', () => {
		for (const bad of ['abc', '1', "x'; drop table bonds;--", 'c0000000-0000-0000-0000']) {
			const query = parse(`collector=${encodeURIComponent(bad)}`);
			expect(query.filters.collectorId).toBeNull();
			expect(query.errors.collector).toBeTruthy();
		}
	});
});
