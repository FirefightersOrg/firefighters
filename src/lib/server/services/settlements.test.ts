import { describe, expect, it, vi } from 'vitest';
import {
	addPaymentToSettlement,
	mapSettlementRpcError,
	SettlementServiceError
} from './settlements';
const id = '00000000-0000-4000-8000-000000000001';
describe('settlement services', () => {
	it('checks payment permission before RPC', async () => {
		const rpc = vi.fn();
		await expect(
			addPaymentToSettlement(
				{ rpc } as never,
				{
					settlementId: id,
					saleId: id,
					amount: 1,
					paymentMethod: 'cash',
					applications: [{ installmentId: id, amountApplied: 1 }]
				},
				{ permissions: [] }
			)
		).rejects.toBeInstanceOf(SettlementServiceError);
		expect(rpc).not.toHaveBeenCalled();
	});
	it('serializes applications for the settlement RPC', async () => {
		const rpc = vi.fn().mockResolvedValue({ data: id, error: null });
		await addPaymentToSettlement(
			{ rpc } as never,
			{
				settlementId: id,
				saleId: id,
				amount: 1,
				paymentMethod: 'cash',
				applications: [{ installmentId: id, amountApplied: 1 }]
			},
			{ requestId: 'r' }
		);
		expect(rpc).toHaveBeenCalledWith(
			'settlement_add_payment',
			expect.objectContaining({
				p_request_id: 'r',
				p_applications: [{ installment_id: id, amount_applied: 1 }]
			})
		);
	});
	it.each([
		[{ code: '42501' }, 'permission'],
		[{ code: 'P0002' }, 'not_found'],
		[{ code: '22023' }, 'validation'],
		[{ code: '55000' }, 'conflict'],
		[{ code: 'XX000' }, 'internal']
	] as const)('maps RPC errors', (error, kind) =>
		expect(mapSettlementRpcError(error)).toMatchObject({ kind })
	);
});
