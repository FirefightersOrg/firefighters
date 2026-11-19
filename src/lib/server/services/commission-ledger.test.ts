import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	CommissionLedgerServiceError,
	adjustCollectorLedger,
	adjustCommission,
	annulCollectorLedgerEntry,
	commissionSettleSchema,
	listCollectorLedger,
	settleCommission
} from './commission-ledger';

const campaignId = '00000000-0000-4000-8000-000000000001';
const collectorId = '00000000-0000-4000-8000-000000000002';
const entryId = '00000000-0000-4000-8000-000000000003';

function client(result: { data?: unknown; error?: { code?: string; message?: string } | null }) {
	const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
	return { rpc, client: { rpc } as unknown as SupabaseClient };
}

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
		const base = { campaignId, collectorId, amount: 1, reason: 'x' };
		expect(commissionSettleSchema.safeParse({ ...base, reason: 'x'.repeat(1000) }).success).toBe(
			true
		);
		expect(commissionSettleSchema.safeParse({ ...base, reason: 'x'.repeat(1001) }).success).toBe(
			false
		);
	});
});

describe('adjustCommission', () => {
	it('calls commission_adjust with the difference row arguments', async () => {
		const { rpc, client: c } = client({ data: 'adj-id' });
		await expect(
			adjustCommission(
				c,
				{
					campaignId,
					collectorId,
					amount: '12.50',
					direction: 'in_favor_of_collector',
					reason: ' Missed '
				},
				{ requestId: 'req-1' }
			)
		).resolves.toBe('adj-id');
		expect(rpc).toHaveBeenCalledWith('commission_adjust', {
			p_campaign_id: campaignId,
			p_collector_id: collectorId,
			p_amount: 12.5,
			p_direction: 'in_favor_of_collector',
			p_reason: 'Missed',
			p_settlement_id: null,
			p_payment_id: null,
			p_request_id: 'req-1'
		});
	});

	it('rejects invalid input before calling the database', async () => {
		const { rpc, client: c } = client({});
		const base = { campaignId, collectorId, direction: 'in_favor_of_collector' as const };
		await expect(adjustCommission(c, { ...base, amount: 0, reason: 'x' })).rejects.toMatchObject({
			kind: 'validation'
		});
		await expect(adjustCommission(c, { ...base, amount: 1, reason: '  ' })).rejects.toMatchObject({
			kind: 'validation'
		});
		expect(rpc).not.toHaveBeenCalled();
	});

	it('maps a permission error to 403', async () => {
		const { client: c } = client({ error: { code: '42501' } });
		const error = await adjustCommission(c, {
			campaignId,
			collectorId,
			amount: 1,
			direction: 'in_favor_of_firefighters',
			reason: 'x'
		}).catch((e) => e);
		expect(error).toBeInstanceOf(CommissionLedgerServiceError);
		expect(error.status).toBe(403);
	});
});

describe('adjustCollectorLedger and annulCollectorLedgerEntry', () => {
	it('calls the ledger RPCs', async () => {
		const { rpc, client: c } = client({ data: 'entry' });
		await adjustCollectorLedger(c, {
			campaignId,
			collectorId,
			amount: 4,
			direction: 'collector_debit',
			reason: 'Short'
		});
		expect(rpc).toHaveBeenLastCalledWith(
			'collector_ledger_adjust',
			expect.objectContaining({ p_direction: 'collector_debit', p_amount: 4 })
		);
		await annulCollectorLedgerEntry(c, { entryId, reason: 'Twice' });
		expect(rpc).toHaveBeenLastCalledWith('collector_ledger_annul_entry', {
			p_entry_id: entryId,
			p_reason: 'Twice',
			p_request_id: null
		});
	});

	it('maps a closed-settlement annulment refusal to a 409 conflict', async () => {
		const { client: c } = client({
			error: { code: '55000', message: 'closed-settlement entries must be corrected' }
		});
		await expect(annulCollectorLedgerEntry(c, { entryId, reason: 'x' })).rejects.toMatchObject({
			kind: 'conflict'
		});
	});
});

describe('listCollectorLedger', () => {
	it('maps rows with numeric amounts and running balance', async () => {
		const { client: c } = client({
			data: [
				{
					id: 'e1',
					occurred_at: '2026-11-19T10:00:00Z',
					entry_type: 'commission_generated',
					direction: 'collector_credit',
					amount: '15.00',
					status: 'recorded',
					settlement_id: 's1',
					payment_id: null,
					reason: null,
					running_balance: '15.00'
				},
				{
					id: 'e2',
					occurred_at: '2026-11-19T11:00:00Z',
					entry_type: 'adjustment_in_favor_of_firefighters',
					direction: 'collector_debit',
					amount: '4.00',
					status: 'annulled',
					settlement_id: null,
					payment_id: null,
					reason: 'Cash shortfall',
					annul_reason: 'Twice',
					running_balance: '15.00'
				}
			]
		});
		const rows = await listCollectorLedger(c, { campaignId, collectorId });
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ amount: 15, runningBalance: 15, settlementId: 's1' });
		expect(rows[1]).toMatchObject({
			status: 'annulled',
			reason: 'Cash shortfall',
			annulReason: 'Twice',
			runningBalance: 15
		});
		expect(rows[0].annulReason).toBeNull();
	});
});
