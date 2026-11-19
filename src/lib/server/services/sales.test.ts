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
			expect.objectContaining({ p_request_id: 'request' })
		);
	});
	it.each([
		[{ code: '42501', message: 'no' }, 'permission'],
		[{ code: '22023', message: 'first due date invalid' }, 'validation'],
		[{ code: 'P0002', message: 'buyer x not found' }, 'not_found'],
		[{ code: '55000', message: 'bond sold' }, 'conflict'],
		[{ code: 'XX000', message: 'no' }, 'internal']
	])('maps %o', (error, kind) => expect(mapSaleRpcError(error)).toMatchObject({ kind }));
});
