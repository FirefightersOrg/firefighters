import { describe, expect, it } from 'vitest';
import { commissionSettleSchema } from './commission-ledger';

describe('commission ledger service schemas', () => {
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
