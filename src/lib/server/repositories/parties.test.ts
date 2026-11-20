import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findBuyersByIdentification, normalizeIdentification } from './parties';

function mockClient(rows: unknown[] = []) {
	const builder = {
		select: vi.fn(),
		or: vi.fn(),
		neq: vi.fn(),
		limit: vi.fn(),
		overrideTypes: vi.fn()
	};
	builder.select.mockReturnValue(builder);
	builder.or.mockReturnValue(builder);
	builder.neq.mockReturnValue(builder);
	builder.limit.mockReturnValue(builder);
	builder.overrideTypes.mockResolvedValue({ data: rows, error: null });
	const from = vi.fn().mockReturnValue(builder);
	return { client: { from } as unknown as SupabaseClient, from, builder };
}

describe('normalizeIdentification', () => {
	it.each([
		['30.111.222', '30111222'],
		['30111222', '30111222'],
		[' 30 111 222 ', '30111222'],
		['30-11122233-4', '30111222334'],
		['DNI 30.111.222', '30111222']
	])('reduces %j to its digits', (input, expected) => {
		expect(normalizeIdentification(input)).toBe(expected);
	});

	it.each([[null], [undefined], [''], ['  '], ['s/n']])('returns null for %j', (input) => {
		expect(normalizeIdentification(input)).toBeNull();
	});
});

describe('findBuyersByIdentification', () => {
	it('compares the normalised columns with digits only', async () => {
		const { client, from, builder } = mockClient();
		await findBuyersByIdentification(client, {
			documentNumber: '30.111.222',
			taxId: '30-11122233-4'
		});
		expect(from).toHaveBeenCalledWith('buyers');
		expect(builder.or).toHaveBeenCalledWith(
			'document_number_normalized.eq.30111222,tax_id_normalized.eq.30111222334'
		);
	});

	it('excludes the buyer being edited', async () => {
		const { client, builder } = mockClient();
		await findBuyersByIdentification(client, { documentNumber: '1.234', excludeId: 'buyer-1' });
		expect(builder.neq).toHaveBeenCalledWith('id', 'buyer-1');
	});

	it('does not query when there are no digits to compare', async () => {
		const { client, from } = mockClient();
		const result = await findBuyersByIdentification(client, {
			documentNumber: 's/n',
			taxId: null
		});
		expect(result).toEqual({ data: [], error: null });
		expect(from).not.toHaveBeenCalled();
	});
});
