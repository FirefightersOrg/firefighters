import type { SupabaseClient } from '@supabase/supabase-js';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import { saleRegisterSchema, type SaleRegisterInput } from '$lib/schemas/sale';
import { GENERIC_ERROR_MESSAGE } from '$lib/copy';

export type SaleErrorKind = 'permission' | 'validation' | 'not_found' | 'conflict' | 'internal';
const STATUS: Record<SaleErrorKind, number> = {
	permission: 403,
	validation: 400,
	not_found: 404,
	conflict: 409,
	internal: 500
};
export class SaleServiceError extends Error {
	readonly kind: SaleErrorKind;
	readonly field?: string;
	constructor(kind: SaleErrorKind, message: string, options?: { field?: string; cause?: unknown }) {
		super(message, { cause: options?.cause });
		this.name = 'SaleServiceError';
		this.kind = kind;
		this.field = options?.field;
	}
	get status() {
		return STATUS[this.kind];
	}
}
interface RpcError {
	code?: string;
	message?: string;
}
export function mapSaleRpcError(error: RpcError): SaleServiceError {
	const message = error.message ?? '';
	if (error.code === '42501')
		return new SaleServiceError('permission', 'No hay permiso para esta acción.');
	if (error.code === 'P0002')
		return new SaleServiceError(
			'not_found',
			/^buyer/.test(message)
				? 'Comprador no encontrado.'
				: /^bond/.test(message)
					? 'Bono no encontrado.'
					: 'Campaña no encontrada.',
			{
				field: /^buyer/.test(message) ? 'buyerId' : /^bond/.test(message) ? 'bondId' : 'campaignId'
			}
		);
	if (error.code === '22023' && /sale date/.test(message))
		return new SaleServiceError(
			'validation',
			'La fecha de venta no puede ser futura ni anterior al inicio de la campaña.',
			{ field: 'saleDate' }
		);
	if (error.code === '22023' && /due date/.test(message))
		return new SaleServiceError(
			'validation',
			'El primer vencimiento tiene que estar entre la fecha de venta y un año después.',
			{ field: 'firstDueDate' }
		);
	if (error.code === '22023')
		return new SaleServiceError(
			'validation',
			`${message.charAt(0).toUpperCase()}${message.slice(1)}.`,
			{
				field: /due date/.test(message)
					? 'firstDueDate'
					: /payment mode/.test(message)
						? 'paymentMode'
						: 'bondId'
			}
		);
	if (error.code === '55000' || error.code === '23505')
		return new SaleServiceError(
			'conflict',
			`${message.charAt(0).toUpperCase()}${message.slice(1)}.`,
			{
				field: /campaign/.test(message) ? 'campaignId' : 'bondId'
			}
		);
	return new SaleServiceError('internal', GENERIC_ERROR_MESSAGE, {
		cause: error
	});
}
export async function registerSale(
	supabase: SupabaseClient,
	input: SaleRegisterInput,
	ctx: { requestId?: string | null; permissions?: readonly string[] | null } = {}
): Promise<string> {
	const parsed = saleRegisterSchema.safeParse(input);
	if (!parsed.success) {
		throw new SaleServiceError('validation', 'Datos de la venta inválidos.', {
			cause: parsed.error
		});
	}
	if (ctx.permissions === null) {
		throw new SaleServiceError('internal', GENERIC_ERROR_MESSAGE);
	}
	if (ctx.permissions != null && !hasPermissionIn(ctx.permissions, 'sale.create')) {
		throw new SaleServiceError('permission', 'No hay permiso para esta acción.');
	}
	let result: { data: unknown; error: RpcError | null };
	try {
		result = await supabase.rpc('sale_register', {
			p_campaign_id: parsed.data.campaignId,
			p_bond_id: parsed.data.bondId,
			p_buyer_id: parsed.data.buyerId,
			p_payment_mode: parsed.data.paymentMode,
			p_first_due_date: parsed.data.firstDueDate ?? null,
			p_request_id: ctx.requestId ?? null,
			p_sale_date: parsed.data.saleDate ?? null
		});
	} catch (cause) {
		throw new SaleServiceError('internal', GENERIC_ERROR_MESSAGE, { cause });
	}
	if (result.error) throw mapSaleRpcError(result.error);
	if (typeof result.data !== 'string' || result.data === '') {
		throw new SaleServiceError('internal', GENERIC_ERROR_MESSAGE);
	}
	return result.data;
}
