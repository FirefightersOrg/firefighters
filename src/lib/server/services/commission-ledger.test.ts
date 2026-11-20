import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { commissionSettleSchema, settleCommission } from './commission-ledger';

describe('commission ledger service schemas', () => {
	it('maps a missing campaign or collector to 404 rather than an internal error', async () => {
		const client = {
			rpc: vi.fn().mockResolvedValue({
				data: null,
				error: { code: 'P0002', message: 'campaign not found' }
			})
		} as unknown as SupabaseClient;
		await expect(
			settleCommission(client, {
				campaignId: '00000000-0000-4000-8000-000000000001',
				collectorId: '00000000-0000-4000-8000-000000000002',
				amount: 1,
				reason: 'payout'
			})
		).rejects.toMatchObject({ kind: 'not_found', status: 404 });
	});
	it('uses the shared ledger reason maximum', () => {
		const base = {
			campaignId: '00000000-0000-4000-8000-000000000001',
			collectorId: '00000000-0000-4000-8000-000000000002',
			amount: 1,
			reason: 'x'
		};
		expect(commissionSettleSchema.safeParse({ ...base, reason: 'x'.repeat(1000) }).success).toBe(
			true
		);
		expect(commissionSettleSchema.safeParse({ ...base, reason: 'x'.repeat(1001) }).success).toBe(
			false
		);
	});
});
