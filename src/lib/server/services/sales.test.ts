import { describe, expect, it, vi } from 'vitest';
import { mapSaleRpcError, registerSale, SaleServiceError } from './sales';

const input = {
	campaignId: '00000000-0000-4000-8000-000000000001',
	bondId: '00000000-0000-4000-8000-000000000002',
	buyerId: '00000000-0000-4000-8000-000000000003',
	paymentMode: 'full_payment' as const
};
describe('sales service', () => {
	it('checks permission before the RPC', async () => {
		const rpc = vi.fn();
		await expect(registerSale({ rpc } as never, input, { permissions: [] })).rejects.toBeInstanceOf(
			SaleServiceError
		);
		expect(rpc).not.toHaveBeenCalled();
	});
	it('calls sale_register and returns the sale id', async () => {
		const rpc = vi.fn().mockResolvedValue({ data: 'sale-id', error: null });
		await expect(registerSale({ rpc } as never, input, { requestId: 'request' })).resolves.toBe(
			'sale-id'
		);
		expect(rpc).toHaveBeenCalledWith(
			'sale_register',
			expect.objectContaining({ p_request_id: 'request', p_first_due_date: null })
		);
	});
	it('rejects invalid input before the RPC', async () => {
		const rpc = vi.fn();
		await expect(
			registerSale({ rpc } as never, { ...input, buyerId: 'not-a-guid' } as never)
		).rejects.toMatchObject({ kind: 'validation' });
		expect(rpc).not.toHaveBeenCalled();
	});
	it.each([
		[{ code: '42501', message: 'no' }, 'permission', undefined],
		[{ code: '22023', message: 'first due date invalid' }, 'validation', 'firstDueDate'],
		[{ code: '22023', message: 'sale date cannot be in the future' }, 'validation', 'saleDate'],
		[{ code: '22023', message: 'bad payment mode' }, 'validation', 'paymentMode'],
		[{ code: '22023', message: 'bond belongs to another campaign' }, 'validation', 'bondId'],
		[{ code: 'P0002', message: 'buyer x not found' }, 'not_found', 'buyerId'],
		[{ code: 'P0002', message: 'bond x not found' }, 'not_found', 'bondId'],
		[{ code: 'P0002', message: 'campaign x not found' }, 'not_found', 'campaignId'],
		[{ code: '55000', message: 'bond sold' }, 'conflict', 'bondId'],
		[{ code: '55000', message: 'campaign must be active' }, 'conflict', 'campaignId'],
		[{ code: '23505', message: 'duplicate bond' }, 'conflict', 'bondId'],
		[{ code: 'XX000', message: 'no' }, 'internal', undefined]
	])('maps %o', (error, kind, field) =>
		expect(mapSaleRpcError(error)).toMatchObject({ kind, field })
	);
	it('treats unavailable permissions as an internal error', async () => {
		await expect(
			registerSale({ rpc: vi.fn() } as never, input, { permissions: null })
		).rejects.toMatchObject({
			kind: 'internal'
		});
	});
});
