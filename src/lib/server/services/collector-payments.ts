import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { PAYMENT_ANNULMENT_REASON_MAX, PAYMENT_METHODS } from '$lib/domain/payments';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import type { PermissionCode } from '$lib/server/auth/permission-codes';
import { GENERIC_ERROR_MESSAGE } from '$lib/copy';
import { SettlementServiceError } from './settlements';

/**
 * Collector-submitted payments (SAN-147). The collector registers a collection as a draft; it only counts once an
 * operator includes it in a settlement that is then closed. The collector is NEVER an input: the RPC resolves it
 * from the session. Errors are translated to neutral Spanish here (the database messages are English).
 */

export const COLLECTOR_NOTE_MAX = 500;

const uuid = z.guid();
/** numeric(12,2): positive, at most 2 decimals, below 10^10. */
const money = z.coerce.number().positive().max(9_999_999_999.99).multipleOf(0.01);

export const submitCollectorPaymentSchema = z.object({
	saleId: uuid,
	installmentId: uuid,
	amount: money,
	paymentMethod: z.enum(PAYMENT_METHODS),
	paymentDate: z.string().date().optional(),
	note: z.string().trim().max(COLLECTOR_NOTE_MAX).optional()
});
export const attachCollectorPaymentSchema = z.object({ settlementId: uuid, paymentId: uuid });
export const rejectCollectorPaymentSchema = z.object({
	paymentId: uuid,
	reason: z
		.string()
		.trim()
		.min(1)
		.refine((reason) => [...reason].length <= PAYMENT_ANNULMENT_REASON_MAX)
});
export type SubmitCollectorPaymentInput = z.input<typeof submitCollectorPaymentSchema>;

export interface CollectorPaymentContext {
	requestId?: string | null;
	permissions: readonly string[] | null;
}
type RpcError = { code?: string; message?: string };

const MESSAGES: [RegExp, string][] = [
	[/date cannot be in the future/, 'La fecha del cobro no puede ser futura.'],
	[
		/exceed installment amount/,
		'El importe supera el saldo de la cuota, contando los cobros pendientes.'
	],
	[/must equal the payment amount/, 'El importe no coincide con el monto aplicado a la cuota.'],
	[/installment is not collectable/, 'Esta cuota ya no admite cobros.'],
	[/sale must be active|campaign must be active/, 'La venta o la campaña ya no están activas.'],
	[/only a draft submitted/, 'Este cobro ya fue procesado.'],
	[/open settlement|settlement must be open/, 'La rendición ya no está abierta.'],
	[/collector and campaign/, 'El cobro pertenece a otro cobrador o campaña.']
];

export function mapCollectorPaymentError(error: RpcError): SettlementServiceError {
	const text = error.message ?? '';
	const known = MESSAGES.find(([pattern]) => pattern.test(text))?.[1];
	if (error.code === '42501')
		return new SettlementServiceError('permission', 'No hay permiso para esta acción.');
	if (error.code === 'P0002')
		return new SettlementServiceError('not_found', 'No se encontró la venta o el cobro.');
	if (['22023', '23514'].includes(error.code ?? ''))
		return new SettlementServiceError('validation', known ?? 'Datos del cobro inválidos.');
	if (['55000', '23505', '23001', 'P0001'].includes(error.code ?? ''))
		return new SettlementServiceError('conflict', known ?? 'El cobro ya no se puede modificar.');
	return new SettlementServiceError('internal', GENERIC_ERROR_MESSAGE, { cause: error });
}

function requireAll(permissions: readonly string[] | null, ...needed: PermissionCode[]) {
	if (permissions == null) throw new SettlementServiceError('internal', GENERIC_ERROR_MESSAGE);
	if (!needed.every((p) => hasPermissionIn(permissions, p)))
		throw new SettlementServiceError('permission', 'No hay permiso para esta acción.');
}

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>) {
	let result: { data: T | null; error: RpcError | null };
	try {
		result = await client.rpc(name, args);
	} catch (cause) {
		throw new SettlementServiceError('internal', GENERIC_ERROR_MESSAGE, { cause });
	}
	if (result.error) throw mapCollectorPaymentError(result.error);
	return result.data as T;
}

/** Collector: register a collection of one installment. Returns the draft payment id. */
export async function submitCollectorPayment(
	client: SupabaseClient,
	input: SubmitCollectorPaymentInput,
	ctx: CollectorPaymentContext
) {
	const p = submitCollectorPaymentSchema.safeParse(input);
	if (!p.success)
		throw new SettlementServiceError('validation', 'Datos del cobro inválidos.', {
			cause: p.error
		});
	requireAll(ctx.permissions, 'payment.create_own');
	return rpc<string>(client, 'portal_payment_submit', {
		p_sale_id: p.data.saleId,
		p_amount: p.data.amount,
		p_payment_method: p.data.paymentMethod,
		p_applications: [{ installment_id: p.data.installmentId, amount_applied: p.data.amount }],
		p_payment_date: p.data.paymentDate ?? null,
		p_request_id: ctx.requestId ?? null,
		p_note: p.data.note || null
	});
}

/** Operator/treasury: include a submitted draft in an open settlement of that collector. */
export async function attachCollectorPayment(
	client: SupabaseClient,
	input: { settlementId: string; paymentId: string },
	ctx: CollectorPaymentContext
) {
	const p = attachCollectorPaymentSchema.safeParse(input);
	if (!p.success)
		throw new SettlementServiceError('validation', 'Datos del cobro inválidos.', {
			cause: p.error
		});
	requireAll(ctx.permissions, 'payment.create', 'settlement.update_open');
	return rpc<void>(client, 'settlement_attach_collector_payment', {
		p_settlement_id: p.data.settlementId,
		p_payment_id: p.data.paymentId,
		p_request_id: ctx.requestId ?? null
	});
}

/** Operator/treasury: reject a submitted draft; the reason is shown to the collector. */
export async function rejectCollectorPayment(
	client: SupabaseClient,
	input: { paymentId: string; reason: string },
	ctx: CollectorPaymentContext
) {
	const p = rejectCollectorPaymentSchema.safeParse(input);
	if (!p.success)
		throw new SettlementServiceError('validation', 'Ingresar un motivo del rechazo.', {
			cause: p.error
		});
	requireAll(ctx.permissions, 'payment.create', 'settlement.update_open');
	return rpc<void>(client, 'settlement_reject_collector_payment', {
		p_payment_id: p.data.paymentId,
		p_reason: p.data.reason,
		p_request_id: ctx.requestId ?? null
	});
}
