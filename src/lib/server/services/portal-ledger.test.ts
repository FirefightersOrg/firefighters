import { describe, expect, it } from 'vitest';
import { listPortalLedger, parsePageParam, PortalLedgerError } from './portal-ledger';
import { mockSupabase } from '../../../routes/campaigns/test-helpers';

describe('parsePageParam', () => {
	it('accepts positive integers and falls back to 1', () => {
		expect(parsePageParam('3')).toBe(3);
		for (const bad of [null, '', '0', '-2', '1.5', 'abc', '999999999'])
			expect(parsePageParam(bad)).toBe(1);
	});
});

describe('listPortalLedger', () => {
	it('maps rows and the total', async () => {
		const { supabase, rpc } = mockSupabase({
			rpc: {
				data: [
					{
						id: 'a',
						occurred_at: 't',
						entry_type: 'cash_settled',
						direction: 'collector_credit',
						amount: '1.50',
						status: 'recorded',
						settlement_id: null,
						settlement_number: 4,
						running_balance: '1.50',
						total_count: 9
					}
				],
				error: null
			}
		});
		const page = await listPortalLedger(supabase, {
			campaignId: 'f0000000-0000-0000-0000-000000000001',
			page: 1
		});
		expect(page.total).toBe(9);
		expect(page.entries[0]).toMatchObject({
			amount: 1.5,
			settlementNumber: 4,
			runningBalance: 1.5
		});
		expect(rpc).toHaveBeenCalledOnce();
	});

	it('rejects an invalid campaign id before calling the database', async () => {
		const { supabase, rpc } = mockSupabase();
		await expect(
			listPortalLedger(supabase, { campaignId: 'nope', page: 1 })
		).rejects.toBeInstanceOf(PortalLedgerError);
		expect(rpc).not.toHaveBeenCalled();
	});
});
