import { describe, expect, it, vi } from 'vitest';
import {
	addPaymentToSettlement,
	addPaymentToSettlementSchema,
	mapSettlementRpcError,
	removePaymentFromSettlementSchema,
	SettlementServiceError
} from './settlements';
const id = '00000000-0000-4000-8000-000000000001';
describe('settlement services', () => {
	it('counts annulment reasons like PostgreSQL char_length, not UTF-16 units', () => {
		expect(
			removePaymentFromSettlementSchema.safeParse({
				paymentId: id,
				reason: '😀'.repeat(1000)
			}).success
		).toBe(true);
		expect(
			removePaymentFromSettlementSchema.safeParse({
				paymentId: id,
				reason: '😀'.repeat(1001)
			}).success
		).toBe(false);
	});
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
			{ requestId: 'r', permissions: ['payment.create'] }
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

describe('settlement service review hardening (SAN-63)', () => {
	const ids = {
		settlementId: '00000000-0000-4000-8000-000000000001',
		saleId: '00000000-0000-4000-8000-000000000002',
		installmentId: '00000000-0000-4000-8000-000000000003'
	};
	const input = (amount: string | number) => ({
		settlementId: ids.settlementId,
		saleId: ids.saleId,
		amount,
		paymentMethod: 'cash' as const,
		applications: [{ installmentId: ids.installmentId, amountApplied: amount }]
	});

	it('fails closed when permissions could not be loaded', async () => {
		const rpc = vi.fn();
		await expect(
			addPaymentToSettlement({ rpc } as never, input(10), { permissions: null })
		).rejects.toMatchObject({ kind: 'internal' });
		expect(rpc).not.toHaveBeenCalled();
	});

	it('limits amounts to numeric(12,2)', () => {
		expect(addPaymentToSettlementSchema.safeParse(input('10.25')).success).toBe(true);
		expect(addPaymentToSettlementSchema.safeParse(input('10.255')).success).toBe(false);
		expect(addPaymentToSettlementSchema.safeParse(input('10000000000')).success).toBe(false);
	});

	it('maps restrict and guard raises to conflicts', () => {
		expect(mapSettlementRpcError({ code: '23001' }).kind).toBe('conflict');
		expect(mapSettlementRpcError({ code: 'P0001' }).kind).toBe('conflict');
	});
});
