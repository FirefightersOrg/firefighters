import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSettlement } from './settlements';

function settlementClient(data: unknown) {
	const query = {
		select: () => query,
		eq: () => query,
		maybeSingle: () => query,
		overrideTypes: () => Promise.resolve({ data, error: null })
	};
	return { from: () => query } as unknown as SupabaseClient;
}

describe('getSettlement', () => {
	it('maps the stored financial snapshot used after closing', async () => {
		const result = await getSettlement(
			settlementClient({
				id: 'settlement',
				settlement_number: 7,
				collector_id: 'collector',
				collectors: { display_name: 'Ana' },
				status: 'closed',
				opened_at: '2026-01-01T00:00:00Z',
				closed_at: '2026-01-02T00:00:00Z',
				notes: null,
				total_cash: '12.34',
				total_transfer: '56.78',
				total_amount: '69.12',
				commission_amount: '6.91',
				commission_paid_amount: '2.00',
				net_to_firefighters: '62.21'
			}),
			'campaign',
			'settlement'
		);

		expect(result.data?.totals).toEqual({
			totalCash: '12.34',
			totalTransfer: '56.78',
			totalAmount: '69.12',
			commissionAmount: '6.91',
			commissionPaidAmount: '2.00',
			netToFirefighters: '62.21',
			collectorCreditBalance: '0.00'
		});
	});
});
