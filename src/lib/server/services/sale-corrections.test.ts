import { describe, expect, it, vi } from 'vitest';
import {
	correctSaleBuyer,
	correctSaleCollector,
	correctBondCollector,
	correctSettlement,
	correctSaleBuyerSchema,
	correctSettlementSchema,
	mapSaleCorrectionRpcError
} from './sale-corrections';

const id = '00000000-0000-4000-8000-000000000001';
const ctx = {
	requestId: 'san72',
	permissions: ['sale.correct', 'bond.assign', 'settlement.correct']
};
const cases = [
	{
		run: (c: never, x: typeof ctx) =>
			correctSaleBuyer(c, { saleId: id, newBuyerId: id, reason: ' fix ' }, x),
		name: 'sale_correct_buyer',
		args: { p_sale_id: id, p_new_buyer_id: id }
	},
	{
		run: (c: never, x: typeof ctx) =>
			correctSaleCollector(c, { saleId: id, newCollectorId: id, reason: ' fix ' }, x),
		name: 'sale_correct_collector',
		args: { p_sale_id: id, p_new_collector_id: id }
	},
	{
		run: (c: never, x: typeof ctx) =>
			correctBondCollector(c, { bondId: id, newCollectorId: id, sold: false, reason: ' fix ' }, x),
		name: 'bond_correct_collector',
		args: { p_bond_id: id, p_new_collector_id: id }
	},
	{
		run: (c: never, x: typeof ctx) =>
			correctBondCollector(c, { bondId: id, newCollectorId: id, sold: true, reason: ' fix ' }, x),
		name: 'bond_correct_collector',
		args: { p_bond_id: id, p_new_collector_id: id }
	},
	{
		run: (c: never, x: typeof ctx) =>
			correctSettlement(
				c,
				{
					settlementId: id,
					reason: ' fix ',
					adjustments: { commissionDelta: '10.25', cashRetainedDelta: -1 }
				},
				x
			),
		name: 'settlement_correct',
		args: {
			p_settlement_id: id,
			p_adjustments: { commission_delta: 10.25, cash_retained_delta: -1 }
		}
	}
];
describe('sale and settlement corrections', () => {
	it.each(cases)('serializes $name with request correlation', async ({ run, name, args }) => {
		const rpc = vi.fn().mockResolvedValue({ data: id, error: null });
		expect(await run({ rpc } as never, ctx)).toBe(id);
		expect(rpc).toHaveBeenCalledExactlyOnceWith(name, {
			...args,
			p_reason: 'fix',
			p_request_id: 'san72'
		});
	});
	it.each(cases)('fails closed for $name before any writes', async ({ run }) => {
		for (const permissions of [null, []]) {
			const rpc = vi.fn();
			await expect(
				run({ rpc } as never, { ...ctx, permissions } as typeof ctx)
			).rejects.toMatchObject({
				kind: permissions === null ? 'internal' : 'permission',
				status: permissions === null ? 500 : 403
			});
			expect(rpc).not.toHaveBeenCalled();
		}
	});
	it('validates code points and rejects blank reasons without RPC', async () => {
		const input = { saleId: id, newBuyerId: id, reason: '😀'.repeat(1000) };
		expect(correctSaleBuyerSchema.safeParse(input).success).toBe(true);
		for (const reason of ['', '  ', '😀'.repeat(1001)]) {
			const rpc = vi.fn();
			await expect(
				correctSaleBuyer({ rpc } as never, { ...input, reason }, ctx)
			).rejects.toMatchObject({ kind: 'validation' });
			expect(rpc).not.toHaveBeenCalled();
		}
	});
	it.each([NaN, Infinity, -Infinity, 1.001, 1e10, -1e10])(
		'rejects invalid delta %s',
		(commissionDelta) => {
			expect(
				correctSettlementSchema.safeParse({
					settlementId: id,
					reason: 'fix',
					adjustments: { commissionDelta, cashRetainedDelta: 0 }
				}).success
			).toBe(false);
		}
	);
	it('rejects zero-only deltas and malformed identifiers', () => {
		expect(
			correctSettlementSchema.safeParse({
				settlementId: id,
				reason: 'fix',
				adjustments: { commissionDelta: 0, cashRetainedDelta: 0 }
			}).success
		).toBe(false);
		expect(
			correctSaleBuyerSchema.safeParse({ saleId: 'bad', newBuyerId: id, reason: 'fix' }).success
		).toBe(false);
	});
	it.each([
		['42501', 'permission'],
		['P0002', 'not_found'],
		['22023', 'validation'],
		['23514', 'validation'],
		['55000', 'conflict'],
		['23001', 'conflict'],
		['XX000', 'internal']
	])('maps SQLSTATE %s', (code, kind) =>
		expect(mapSaleCorrectionRpcError({ code })).toMatchObject({ kind })
	);
	it.each(cases)('maps RPC and transport failures for $name', async ({ run }) => {
		await expect(
			run({ rpc: vi.fn().mockResolvedValue({ error: { code: '55000' } }) } as never, ctx)
		).rejects.toMatchObject({ kind: 'conflict' });
		await expect(
			run({ rpc: vi.fn().mockRejectedValue(new Error('offline')) } as never, ctx)
		).rejects.toMatchObject({ kind: 'internal' });
	});
});
