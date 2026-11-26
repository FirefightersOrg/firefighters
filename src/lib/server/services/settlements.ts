import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
	PAYMENT_ANNULMENT_REASON_MAX,
	PAYMENT_METHODS,
	SETTLEMENT_NOTES_MAX
} from '$lib/domain/payments';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import type { PermissionCode } from '$lib/server/auth/permission-codes';
import { GENERIC_ERROR_MESSAGE, unprocessedSubmittedMessage } from '$lib/copy';

const uuid = z.guid();
/** numeric(12,2): positive, at most 2 decimals and below 10^10. */
const money = z.coerce.number().positive().max(9_999_999_999.99).multipleOf(0.01);
const notes = z.string().trim().min(1).max(SETTLEMENT_NOTES_MAX).nullable().optional();
const application = z.object({ installmentId: uuid, amountApplied: money });
export const openSettlementSchema = z.object({ campaignId: uuid, collectorId: uuid, notes });
export const addPaymentToSettlementSchema = z.object({
	settlementId: uuid,
	saleId: uuid,
	amount: money,
	paymentMethod: z.enum(PAYMENT_METHODS),
	applications: z.array(application).min(1),
	paymentDate: z.string().date().optional()
});
export const removePaymentFromSettlementSchema = z.object({
	paymentId: uuid,
	reason: z
		.string()
		.trim()
		.min(1)
		.refine((reason) => [...reason].length <= PAYMENT_ANNULMENT_REASON_MAX)
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
		return new SettlementServiceError('permission', 'No hay permiso para esta acción.');
	if (error.code === 'P0002')
		return new SettlementServiceError('not_found', 'No se encontró el recurso de la rendición.');
	// FF156 (SAN-156): the collector still has submitted collections nobody included or rejected.
	if (error.code === 'FF156') {
		const count = Number(/(\d+) unprocessed/.exec(error.message ?? '')?.[1]);
		return new SettlementServiceError(
			'conflict',
			Number.isInteger(count) && count > 0
				? unprocessedSubmittedMessage(count)
				: 'Hay cobros enviados por el cobrador sin procesar. Inclúyalos o rechácelos antes de cerrar la rendición.'
		);
	}
	if (
		error.code === '22023' &&
		/payment date cannot be before the sale date/.test(error.message ?? '')
	)
		return new SettlementServiceError(
			'validation',
			'La fecha del cobro no puede ser anterior a la fecha de la venta.'
		);
	if (['22023', '23514'].includes(error.code ?? ''))
		return new SettlementServiceError(
			'validation',
			error.message || 'Datos de la rendición inválidos.'
		);
	// 23001 restrict_violation (immutable after draft), P0001 generic guard raise.
	if (['55000', '23505', '23001', 'P0001'].includes(error.code ?? ''))
		return new SettlementServiceError(
			'conflict',
			error.message || 'La rendición ya no se puede modificar.'
		);
	return new SettlementServiceError('internal', GENERIC_ERROR_MESSAGE, {
		cause: error
	});
}
/** Every call must say who is calling; unknown permissions fail closed. */
export interface SettlementRequestContext {
	requestId?: string | null;
	/** The caller's permissions; `null` (could not load) fails closed with a 500. */
	permissions: readonly string[] | null;
}
function requirePermission(
	permissions: readonly string[] | null | undefined,
	permission: PermissionCode
) {
	if (permissions == null) throw new SettlementServiceError('internal', GENERIC_ERROR_MESSAGE);
	if (!hasPermissionIn(permissions, permission))
		throw new SettlementServiceError('permission', 'No hay permiso para esta acción.');
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
		throw new SettlementServiceError('internal', GENERIC_ERROR_MESSAGE, {
			cause
		});
	}
	if (result.error) throw mapSettlementRpcError(result.error);
	return result.data as T;
}
export async function openSettlement(
	client: SupabaseClient,
	input: OpenSettlementInput,
	ctx: SettlementRequestContext
) {
	const p = openSettlementSchema.safeParse(input);
	if (!p.success)
		throw new SettlementServiceError('validation', 'Datos de la rendición inválidos.', {
			cause: p.error
		});
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
	ctx: SettlementRequestContext
) {
	const p = addPaymentToSettlementSchema.safeParse(input);
	if (!p.success)
		throw new SettlementServiceError('validation', 'Datos del pago inválidos.', { cause: p.error });
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
	ctx: SettlementRequestContext
) {
	const p = removePaymentFromSettlementSchema.safeParse(input);
	if (!p.success)
		throw new SettlementServiceError('validation', 'Datos de la anulación inválidos.', {
			cause: p.error
		});
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
	ctx: SettlementRequestContext
) {
	const p = closeSettlementSchema.safeParse(input);
	if (!p.success)
		throw new SettlementServiceError('validation', 'Datos de la rendición inválidos.', {
			cause: p.error
		});
	requirePermission(ctx.permissions, 'settlement.close');
	return rpc<void>(client, 'settlement_close', {
		p_settlement_id: p.data.settlementId,
		p_request_id: ctx.requestId ?? null
	});
}
