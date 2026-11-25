import { describe, expect, it, vi } from 'vitest';
import {
	addPaymentToSettlement,
	addPaymentToSettlementSchema,
	closeSettlement,
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
	// SAN-91 minimum testing contract: closeSettlement.
	describe('closeSettlement', () => {
		it('requires settlement.close and validates the id before any RPC', async () => {
			const rpc = vi.fn();
			await expect(
				closeSettlement(
					{ rpc } as never,
					{ settlementId: id },
					{ permissions: ['settlement.view'] }
				)
			).rejects.toMatchObject({ status: 403 });
			await expect(
				closeSettlement(
					{ rpc } as never,
					{ settlementId: 'bad' },
					{ permissions: ['settlement.close'] }
				)
			).rejects.toMatchObject({ status: 400 });
			expect(rpc).not.toHaveBeenCalled();
		});
		it('calls settlement_close with the request id', async () => {
			const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
			await closeSettlement(
				{ rpc } as never,
				{ settlementId: id },
				{ permissions: ['settlement.close'], requestId: 'req-close' }
			);
			expect(rpc).toHaveBeenCalledWith('settlement_close', {
				p_settlement_id: id,
				p_request_id: 'req-close'
			});
		});
		it.each([
			[
				1,
				'Hay 1 cobro enviado por el cobrador sin procesar. Inclúyalo o recházalo antes de cerrar la rendición.'
			],
			[
				3,
				'Hay 3 cobros enviados por el cobrador sin procesar. Inclúyalos o recházalos antes de cerrar la rendición.'
			]
		])(
			'maps unprocessed collector payments (FF156, %i) to a Spanish 409 that says what to do',
			async (count, message) => {
				const rpc = vi.fn().mockResolvedValue({
					data: null,
					error: {
						code: 'FF156',
						message: `settlement has ${count} unprocessed collector payments`
					}
				});
				await expect(
					closeSettlement(
						{ rpc } as never,
						{ settlementId: id },
						{ permissions: ['settlement.close'] }
					)
				).rejects.toMatchObject({ status: 409, kind: 'conflict', message });
			}
		);
		it('still gives a clear message when the FF156 count cannot be read', () => {
			expect(mapSettlementRpcError({ code: 'FF156', message: 'x' })).toMatchObject({
				kind: 'conflict',
				message: expect.stringContaining('sin procesar')
			});
		});
		it('maps a settlement that can no longer be closed to a 409', async () => {
			const rpc = vi.fn().mockResolvedValue({
				data: null,
				error: { code: '55000', message: 'settlement has no pending payments' }
			});
			await expect(
				closeSettlement(
					{ rpc } as never,
					{ settlementId: id },
					{ permissions: ['settlement.close'] }
				)
			).rejects.toMatchObject({ status: 409 });
		});
	});
});
