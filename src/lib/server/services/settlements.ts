import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
	PAYMENT_ANNULMENT_REASON_MAX,
	PAYMENT_METHODS,
	SETTLEMENT_NOTES_MAX
} from '$lib/domain/payments';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import type { PermissionCode } from '$lib/server/auth/permission-codes';

const uuid = z.string().uuid();
const notes = z.string().trim().min(1).max(SETTLEMENT_NOTES_MAX).nullable().optional();
const application = z.object({ installmentId: uuid, amountApplied: z.coerce.number().positive() });
export const openSettlementSchema = z.object({ campaignId: uuid, collectorId: uuid, notes });
export const addPaymentToSettlementSchema = z.object({
	settlementId: uuid,
	saleId: uuid,
	amount: z.coerce.number().positive(),
	paymentMethod: z.enum(PAYMENT_METHODS),
	applications: z.array(application).min(1),
	paymentDate: z.string().date().optional()
});
export const removePaymentFromSettlementSchema = z.object({
	paymentId: uuid,
	reason: z.string().trim().min(1).max(PAYMENT_ANNULMENT_REASON_MAX)
});
export const closeSettlementSchema = z.object({ settlementId: uuid });
export type OpenSettlementInput = z.input<typeof openSettlementSchema>;
export type AddPaymentToSettlementInput = z.input<typeof addPaymentToSettlementSchema>;
export type RemovePaymentFromSettlementInput = z.input<typeof removePaymentFromSettlementSchema>;

export class SettlementServiceError extends Error {
	constructor(
		readonly kind: 'permission' | 'validation' | 'not_found' | 'conflict' | 'internal',
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = 'SettlementServiceError';
	}
	get status() {
		return { permission: 403, validation: 400, not_found: 404, conflict: 409, internal: 500 }[
			this.kind
		];
	}
}
type RpcError = { code?: string; message?: string };
export function mapSettlementRpcError(error: RpcError) {
	if (error.code === '42501')
		return new SettlementServiceError(
			'permission',
			'You do not have permission to perform this action.'
		);
	if (error.code === 'P0002')
		return new SettlementServiceError(
			'not_found',
			'The requested settlement resource was not found.'
		);
	if (['22023', '23514'].includes(error.code ?? ''))
		return new SettlementServiceError('validation', error.message || 'Invalid settlement data.');
	if (['55000', '23505'].includes(error.code ?? ''))
		return new SettlementServiceError(
			'conflict',
			error.message || 'The settlement can no longer be changed.'
		);
	return new SettlementServiceError('internal', 'Something went wrong. Please try again.', {
		cause: error
	});
}
function requirePermission(
	permissions: readonly string[] | null | undefined,
	permission: PermissionCode
) {
	if (permissions === null)
		throw new SettlementServiceError('internal', 'Something went wrong. Please try again.');
	if (permissions != null && !hasPermissionIn(permissions, permission))
		throw new SettlementServiceError(
			'permission',
			'You do not have permission to perform this action.'
		);
}
async function rpc<T>(
	client: SupabaseClient,
	name: string,
	args: Record<string, unknown>
): Promise<T> {
	let result: { data: T | null; error: RpcError | null };
	try {
		result = await client.rpc(name, args);
	} catch (cause) {
		throw new SettlementServiceError('internal', 'Something went wrong. Please try again.', {
			cause
		});
	}
	if (result.error) throw mapSettlementRpcError(result.error);
	return result.data as T;
}
export async function openSettlement(
	client: SupabaseClient,
	input: OpenSettlementInput,
	ctx: { requestId?: string | null; permissions?: readonly string[] | null } = {}
) {
	const p = openSettlementSchema.safeParse(input);
	if (!p.success)
		throw new SettlementServiceError('validation', 'Invalid settlement data.', { cause: p.error });
	requirePermission(ctx.permissions, 'settlement.create');
	return rpc<string>(client, 'settlement_open', {
		p_campaign_id: p.data.campaignId,
		p_collector_id: p.data.collectorId,
		p_notes: p.data.notes ?? null,
		p_request_id: ctx.requestId ?? null
	});
}
export async function addPaymentToSettlement(
	client: SupabaseClient,
	input: AddPaymentToSettlementInput,
	ctx: { requestId?: string | null; permissions?: readonly string[] | null } = {}
) {
	const p = addPaymentToSettlementSchema.safeParse(input);
	if (!p.success)
		throw new SettlementServiceError('validation', 'Invalid payment data.', { cause: p.error });
	requirePermission(ctx.permissions, 'payment.create');
	return rpc<string>(client, 'settlement_add_payment', {
		p_settlement_id: p.data.settlementId,
		p_sale_id: p.data.saleId,
		p_amount: p.data.amount,
		p_payment_method: p.data.paymentMethod,
		p_applications: p.data.applications.map((x) => ({
			installment_id: x.installmentId,
			amount_applied: x.amountApplied
		})),
		p_payment_date: p.data.paymentDate ?? null,
		p_request_id: ctx.requestId ?? null
	});
}
export async function removePaymentFromSettlement(
	client: SupabaseClient,
	input: RemovePaymentFromSettlementInput,
	ctx: { requestId?: string | null; permissions?: readonly string[] | null } = {}
) {
	const p = removePaymentFromSettlementSchema.safeParse(input);
	if (!p.success)
		throw new SettlementServiceError('validation', 'Invalid annulment data.', { cause: p.error });
	requirePermission(ctx.permissions, 'settlement.update_open');
	return rpc<void>(client, 'settlement_remove_payment', {
		p_payment_id: p.data.paymentId,
		p_reason: p.data.reason,
		p_request_id: ctx.requestId ?? null
	});
}
export async function closeSettlement(
	client: SupabaseClient,
	input: { settlementId: string },
	ctx: { requestId?: string | null; permissions?: readonly string[] | null } = {}
) {
	const p = closeSettlementSchema.safeParse(input);
	if (!p.success)
		throw new SettlementServiceError('validation', 'Invalid settlement data.', { cause: p.error });
	requirePermission(ctx.permissions, 'settlement.close');
	return rpc<void>(client, 'settlement_close', {
		p_settlement_id: p.data.settlementId,
		p_request_id: ctx.requestId ?? null
	});
}
