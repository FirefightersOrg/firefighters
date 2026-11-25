import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	CommissionLedgerServiceError,
	adjustCollectorLedger,
	adjustCommission,
	annulCollectorLedgerEntry,
	commissionSettleSchema,
	LEDGER_PAGE_SIZE,
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

/** An rpc whose result is read through `.range(from, to)`, one page per call. */
function pagedClient(
	pages: { data?: unknown; error?: { code?: string; message?: string } | null }[]
) {
	const range = vi.fn();
	for (const page of pages)
		range.mockResolvedValueOnce({ data: page.data ?? null, error: page.error ?? null });
	const rpc = vi.fn().mockReturnValue({ range });
	return { rpc, range, client: { rpc } as unknown as SupabaseClient };
}

describe('listCollectorLedger', () => {
	it('reads every page so a long ledger is not cut at the 1000-row cap', async () => {
		const row = (n: number) => ({
			id: `e${n}`,
			occurred_at: '2026-11-19T10:00:00Z',
			entry_type: 'commission_generated',
			direction: 'collector_credit',
			amount: '1.00',
			status: 'recorded',
			running_balance: String(n)
		});
		const full = Array.from({ length: LEDGER_PAGE_SIZE }, (_, i) => row(i + 1));
		const {
			rpc,
			range,
			client: c
		} = pagedClient([
			{ data: full },
			{ data: [row(LEDGER_PAGE_SIZE + 1), row(LEDGER_PAGE_SIZE + 2)] }
		]);
		const rows = await listCollectorLedger(c, { campaignId, collectorId });
		expect(rows).toHaveLength(LEDGER_PAGE_SIZE + 2);
		expect(rows.at(-1)).toMatchObject({ id: `e${LEDGER_PAGE_SIZE + 2}`, runningBalance: 1002 });
		expect(range.mock.calls).toEqual([
			[0, LEDGER_PAGE_SIZE - 1],
			[LEDGER_PAGE_SIZE, 2 * LEDGER_PAGE_SIZE - 1]
		]);
		expect(rpc).toHaveBeenCalledWith('collector_ledger_entries_with_balance', {
			p_campaign_id: campaignId,
			p_collector_id: collectorId
		});
	});

	it('stops after one page when the ledger is short, and maps page errors', async () => {
		const short = pagedClient([{ data: [] }]);
		expect(await listCollectorLedger(short.client, { campaignId, collectorId })).toEqual([]);
		expect(short.range).toHaveBeenCalledOnce();
		const failing = pagedClient([{ error: { code: '42501', message: 'denied' } }]);
		await expect(
			listCollectorLedger(failing.client, { campaignId, collectorId })
		).rejects.toMatchObject({ kind: 'permission' });
	});

	it('maps rows with numeric amounts and running balance', async () => {
		const { client: c } = pagedClient([
			{
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
			}
		]);
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

	it('passes the compensated entry and translates the compensation refusals (SAN-108)', async () => {
		const original = '00000000-0000-4000-8000-0000000000aa';
		const { rpc, client: c } = client({ data: 'entry' });
		await adjustCollectorLedger(c, {
			campaignId,
			collectorId,
			amount: 4,
			direction: 'collector_debit',
			reason: 'Bonus was lower',
			originalEntryId: original
		});
		expect(rpc).toHaveBeenLastCalledWith(
			'collector_ledger_adjust',
			expect.objectContaining({ p_original_entry_id: original })
		);
		for (const [code, message, kind, text] of [
			[
				'22023',
				'the compensation exceeds what is left of the original entry',
				'validation',
				'supera lo que queda'
			],
			[
				'23514',
				'a compensation must have the opposite direction of the entry it compensates',
				'validation',
				'sentido contrario'
			],
			[
				'55000',
				'a compensating or compensated entry cannot be annulled; record a compensation instead',
				'conflict',
				'otro ajuste'
			]
		] as const) {
			const failing = client({ error: { code, message } }).client;
			await expect(
				annulCollectorLedgerEntry(failing, { entryId, reason: 'x' })
			).rejects.toMatchObject({
				kind,
				message: expect.stringContaining(text)
			});
		}
	});
});
