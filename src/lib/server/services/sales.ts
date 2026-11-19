import type { SupabaseClient } from '@supabase/supabase-js';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import { saleRegisterSchema, type SaleRegisterInput } from '$lib/schemas/sale';

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
		return new SaleServiceError('permission', 'You do not have permission to perform this action.');
	if (error.code === 'P0002')
		return new SaleServiceError(
			'not_found',
			/^buyer/.test(message)
				? 'Buyer not found.'
				: /^bond/.test(message)
					? 'Bond not found.'
					: 'Campaign not found.',
			{
				field: /^buyer/.test(message) ? 'buyerId' : /^bond/.test(message) ? 'bondId' : 'campaignId'
			}
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
	return new SaleServiceError('internal', 'Something went wrong. Please try again.', {
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
		throw new SaleServiceError('validation', 'Invalid sale data.', { cause: parsed.error });
	}
	if (ctx.permissions === null) {
		throw new SaleServiceError('internal', 'Something went wrong. Please try again.');
	}
	if (ctx.permissions != null && !hasPermissionIn(ctx.permissions, 'sale.create')) {
		throw new SaleServiceError('permission', 'You do not have permission to perform this action.');
	}
	let result: { data: unknown; error: RpcError | null };
	try {
		result = await supabase.rpc('sale_register', {
			p_campaign_id: parsed.data.campaignId,
			p_bond_id: parsed.data.bondId,
			p_buyer_id: parsed.data.buyerId,
			p_payment_mode: parsed.data.paymentMode,
			p_first_due_date: parsed.data.firstDueDate ?? null,
			p_request_id: ctx.requestId ?? null
		});
	} catch (cause) {
		throw new SaleServiceError('internal', 'Something went wrong. Please try again.', { cause });
	}
	if (result.error) throw mapSaleRpcError(result.error);
	if (typeof result.data !== 'string' || result.data === '') {
		throw new SaleServiceError('internal', 'Something went wrong. Please try again.');
	}
	return result.data;
}
