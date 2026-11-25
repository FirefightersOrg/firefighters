import { describe, expect, it, vi } from 'vitest';
import { mapSaleUncollectibleRpcError, markSaleUncollectible } from './sale-uncollectible';

const SALE = 'a0000000-0000-4000-8000-000000000009';
const ctx = { requestId: 'req-1', permissions: ['sale.mark_uncollectible'] };

describe('markSaleUncollectible (SAN-106)', () => {
	it('calls sale_mark_uncollectible with the trimmed reason and request id', async () => {
		const rpc = vi.fn().mockResolvedValue({ error: null });
		await markSaleUncollectible({ rpc } as never, { saleId: SALE, reason: '  Se mudó ' }, ctx);
		expect(rpc).toHaveBeenCalledWith('sale_mark_uncollectible', {
			p_sale_id: SALE,
			p_reason: 'Se mudó',
			p_request_id: 'req-1'
		});
	});
	it('checks permissions and input before the RPC', async () => {
		const rpc = vi.fn();
		await expect(
			markSaleUncollectible({ rpc } as never, { saleId: SALE, reason: 'x' }, { permissions: null })
		).rejects.toMatchObject({ kind: 'internal' });
		await expect(
			markSaleUncollectible({ rpc } as never, { saleId: SALE, reason: 'x' }, { permissions: [] })
		).rejects.toMatchObject({ kind: 'permission' });
		await expect(
			markSaleUncollectible({ rpc } as never, { saleId: SALE, reason: '   ' }, ctx)
		).rejects.toMatchObject({
			kind: 'validation',
			field: 'reason',
			message: 'Ingresar el motivo.'
		});
		await expect(
			markSaleUncollectible({ rpc } as never, { saleId: SALE, reason: '😀'.repeat(1001) }, ctx)
		).rejects.toMatchObject({ kind: 'validation', field: 'reason' });
		await expect(
			markSaleUncollectible({ rpc } as never, { saleId: 'bad', reason: 'x' }, ctx)
		).rejects.toMatchObject({ kind: 'not_found' });
		expect(rpc).not.toHaveBeenCalled();
		// 1000 code points is the limit, the same as the SQL char_length check.
		rpc.mockResolvedValue({ error: null });
		await markSaleUncollectible({ rpc } as never, { saleId: SALE, reason: '😀'.repeat(1000) }, ctx);
		expect(rpc).toHaveBeenCalledOnce();
	});
	it.each([
		[{ code: '42501', message: 'no' }, 'permission', 'No hay permiso para esta acción.'],
		[{ code: 'P0002', message: 'sale not found' }, 'not_found', 'Venta no encontrada.'],
		[
			{ code: '22023', message: 'reason' },
			'validation',
			'Ingresar un motivo de hasta 1000 caracteres.'
		],
		[
			{ code: '55000', message: 'sale is already marked uncollectible' },
			'conflict',
			'La venta ya está marcada como incobrable.'
		],
		[
			{
				code: '55000',
				message: 'only an active sale can be marked uncollectible (status: annulled)'
			},
			'conflict',
			'Solo se puede marcar como incobrable una venta activa.'
		],
		[{ code: 'XX000', message: 'boom' }, 'internal', undefined]
	])('maps %o', (error, kind, message) =>
		expect(mapSaleUncollectibleRpcError(error)).toMatchObject(
			message ? { kind, message } : { kind }
		)
	);
	it('surfaces RPC errors and transport failures', async () => {
		const rpc = vi.fn().mockResolvedValueOnce({
			error: { code: '55000', message: 'sale is already marked uncollectible' }
		});
		await expect(
			markSaleUncollectible({ rpc } as never, { saleId: SALE, reason: 'x' }, ctx)
		).rejects.toMatchObject({ kind: 'conflict' });
		rpc.mockRejectedValueOnce(new Error('network'));
		await expect(
			markSaleUncollectible({ rpc } as never, { saleId: SALE, reason: 'x' }, ctx)
		).rejects.toMatchObject({ kind: 'internal' });
	});
});
