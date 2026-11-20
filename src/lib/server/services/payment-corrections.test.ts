import { describe, expect, it, vi } from 'vitest';
import {
	annulPayment,
	annulPaymentSchema,
	correctPaymentMethod,
	reassociateTransfer,
	reassociateTransferSchema,
	mapPaymentCorrectionRpcError
} from './payment-corrections';

const id = '00000000-0000-4000-8000-000000000001';
const ctx = { requestId: 'san71', permissions: ['payment.annul'] };
const input = { paymentId: id, reason: ' mistake ' };
describe('payment corrections', () => {
	it.each([null, []])('fails closed before RPC for permissions %s', async (permissions) => {
		const rpc = vi.fn();
		await expect(
			annulPayment({ rpc } as never, input, { requestId: null, permissions })
		).rejects.toMatchObject({ kind: permissions === null ? 'internal' : 'permission' });
		expect(rpc).not.toHaveBeenCalled();
	});
	it('serializes each correction and request correlation', async () => {
		const rpc = vi.fn().mockResolvedValue({ data: id, error: null });
		await annulPayment({ rpc } as never, input, ctx);
		expect(rpc).toHaveBeenLastCalledWith('payment_annul', {
			p_payment_id: id,
			p_reason: 'mistake',
			p_request_id: 'san71'
		});
		await correctPaymentMethod({ rpc } as never, { ...input, newMethod: 'transfer' }, ctx);
		expect(rpc).toHaveBeenLastCalledWith(
			'payment_correct_method',
			expect.objectContaining({ p_new_method: 'transfer' })
		);
		await reassociateTransfer(
			{ rpc } as never,
			{ ...input, newSaleId: id, applications: [{ installmentId: id, amountApplied: '10.25' }] },
			ctx
		);
		expect(rpc).toHaveBeenLastCalledWith(
			'payment_reassociate_transfer',
			expect.objectContaining({
				p_new_sale_id: id,
				p_applications: [{ installment_id: id, amount_applied: 10.25 }]
			})
		);
	});
	it('validates reasons by Unicode code points, not UTF-16 units', () => {
		expect(annulPaymentSchema.safeParse({ ...input, reason: '😀'.repeat(1000) }).success).toBe(
			true
		);
		for (const reason of ['', '  ', '😀'.repeat(1001)])
			expect(annulPaymentSchema.safeParse({ ...input, reason }).success).toBe(false);
	});
	it.each([0, -1, 'NaN', 'Infinity', 10.255, 10_000_000_000])(
		'rejects invalid numeric(12,2) amount %s',
		(amountApplied) => {
			expect(
				reassociateTransferSchema.safeParse({
					...input,
					newSaleId: id,
					applications: [{ installmentId: id, amountApplied }]
				}).success
			).toBe(false);
		}
	);
	it('rejects duplicate applications and invalid input without writes', async () => {
		const rpc = vi.fn();
		await expect(
			annulPayment({ rpc } as never, { ...input, reason: '' }, ctx)
		).rejects.toMatchObject({
			kind: 'validation'
		});
		expect(rpc).not.toHaveBeenCalled();
		expect(
			reassociateTransferSchema.safeParse({
				...input,
				newSaleId: id,
				applications: Array(2).fill({ installmentId: id, amountApplied: 1 })
			}).success
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
		expect(mapPaymentCorrectionRpcError({ code })).toMatchObject({ kind })
	);
	it('maps returned errors and transport failures', async () => {
		await expect(
			annulPayment(
				{ rpc: vi.fn().mockResolvedValue({ error: { code: '42501' } }) } as never,
				input,
				ctx
			)
		).rejects.toMatchObject({ kind: 'permission' });
		await expect(
			annulPayment({ rpc: vi.fn().mockRejectedValue(new Error('offline')) } as never, input, ctx)
		).rejects.toMatchObject({ kind: 'internal' });
	});
});
