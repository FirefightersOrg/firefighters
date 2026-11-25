import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import { GENERIC_ERROR_MESSAGE } from '$lib/copy';
import { SaleServiceError } from './sales';

/**
 * SAN-106: marking a sale uncollectible is manual only (admin or treasurer), with a mandatory
 * reason that the database audits. The mark is final; SQL rechecks everything under locks.
 */
export const markSaleUncollectibleSchema = z.object({
	saleId: z.guid(),
	reason: z
		.string()
		.trim()
		.min(1, 'Ingresar el motivo.')
		.refine((value) => [...value].length <= 1000, 'El motivo supera los 1000 caracteres.')
});

interface RpcError {
	code?: string;
	message?: string;
}
export function mapSaleUncollectibleRpcError(error: RpcError): SaleServiceError {
	const message = error.message ?? '';
	if (error.code === '42501')
		return new SaleServiceError('permission', 'No hay permiso para esta acción.');
	if (error.code === 'P0002') return new SaleServiceError('not_found', 'Venta no encontrada.');
	if (error.code === '22023')
		return new SaleServiceError('validation', 'Ingresar un motivo de hasta 1000 caracteres.', {
			field: 'reason'
		});
	if (error.code === '55000')
		return new SaleServiceError(
			'conflict',
			/already/.test(message)
				? 'La venta ya está marcada como incobrable.'
				: 'Solo se puede marcar como incobrable una venta activa.'
		);
	return new SaleServiceError('internal', GENERIC_ERROR_MESSAGE, { cause: error });
}

export async function markSaleUncollectible(
	supabase: SupabaseClient,
	input: z.input<typeof markSaleUncollectibleSchema>,
	ctx: { requestId?: string | null; permissions?: readonly string[] | null }
): Promise<void> {
	if (ctx.permissions == null)
		throw new SaleServiceError('internal', 'No se pudieron cargar los permisos.');
	if (!hasPermissionIn(ctx.permissions, 'sale.mark_uncollectible'))
		throw new SaleServiceError('permission', 'No hay permiso para esta acción.');
	const parsed = markSaleUncollectibleSchema.safeParse(input);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		if (issue?.path[0] !== 'reason')
			throw new SaleServiceError('not_found', 'Venta no encontrada.', { cause: parsed.error });
		throw new SaleServiceError('validation', issue.message, {
			field: 'reason',
			cause: parsed.error
		});
	}
	let result: { error: RpcError | null };
	try {
		result = await supabase.rpc('sale_mark_uncollectible', {
			p_sale_id: parsed.data.saleId,
			p_reason: parsed.data.reason,
			p_request_id: ctx.requestId ?? null
		});
	} catch (cause) {
		throw new SaleServiceError('internal', GENERIC_ERROR_MESSAGE, { cause });
	}
	if (result.error) throw mapSaleUncollectibleRpcError(result.error);
}
