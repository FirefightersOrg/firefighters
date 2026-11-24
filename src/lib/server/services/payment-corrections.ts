import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import { mapSettlementRpcError, SettlementServiceError } from './settlements';

export { SettlementServiceError as PaymentCorrectionServiceError };
export function mapPaymentCorrectionRpcError(error: { code?: string; message?: string }) {
	if (
		error.code === '55000' &&
		error.message ===
			"This payment's sale was moved to another collector. Correct the sale collector back before annulling or correcting this payment."
	)
		return new SettlementServiceError(
			'conflict',
			'La venta de este pago fue reasignada a otro cobrador. Primero hay que devolver la venta al cobrador original para anular o corregir el pago.'
		);
	return mapSettlementRpcError(error);
}
const uuid = z.guid();
const reason = z
	.string()
	.trim()
	.min(1)
	.refine((value) => Array.from(value).length <= 1000, 'El motivo supera los 1000 caracteres.');
const money = z.coerce.number().positive().max(9_999_999_999.99).multipleOf(0.01);
export const annulPaymentSchema = z.object({ paymentId: uuid, reason });
export const correctPaymentMethodSchema = annulPaymentSchema.extend({
	newMethod: z.enum(['cash', 'transfer'])
});
export const reassociateTransferSchema = annulPaymentSchema.extend({
	newSaleId: uuid,
	applications: z
		.array(z.object({ installmentId: uuid, amountApplied: money }))
		.min(1)
		.refine(
			(values) => new Set(values.map((value) => value.installmentId)).size === values.length,
			'Cuota repetida.'
		)
});
export interface PaymentCorrectionRequestContext {
	requestId: string | null;
	permissions: readonly string[] | null;
}

async function correct<T extends z.ZodType>(
	client: SupabaseClient,
	schema: T,
	input: z.input<T>,
	ctx: PaymentCorrectionRequestContext,
	name: string,
	extra: (value: z.output<T>) => Record<string, unknown>
) {
	if (ctx?.permissions == null)
		throw new SettlementServiceError(
			'internal',
			'No se pudieron cargar los permisos de corrección.'
		);
	if (!hasPermissionIn(ctx.permissions, 'payment.annul'))
		throw new SettlementServiceError('permission', 'Hace falta el permiso de corrección de pagos.');
	const parsed = schema.safeParse(input);
	if (!parsed.success)
		throw new SettlementServiceError('validation', 'Corrección de pago inválida.', {
			cause: parsed.error
		});
	const value = parsed.data as z.output<T> & { paymentId: string; reason: string };
	try {
		const { data, error } = await client.rpc(name, {
			p_payment_id: value.paymentId,
			p_reason: value.reason,
			p_request_id: ctx.requestId,
			...extra(parsed.data)
		});
		if (error) throw mapPaymentCorrectionRpcError(error);
		return data as string | null;
	} catch (cause) {
		if (cause instanceof SettlementServiceError) throw cause;
		throw new SettlementServiceError('internal', 'No se pudo corregir el pago.', { cause });
	}
}
export function annulPayment(
	client: SupabaseClient,
	input: z.input<typeof annulPaymentSchema>,
	ctx: PaymentCorrectionRequestContext
) {
	return correct(client, annulPaymentSchema, input, ctx, 'payment_annul', () => ({}));
}
export function correctPaymentMethod(
	client: SupabaseClient,
	input: z.input<typeof correctPaymentMethodSchema>,
	ctx: PaymentCorrectionRequestContext
) {
	return correct(client, correctPaymentMethodSchema, input, ctx, 'payment_correct_method', (p) => ({
		p_new_method: p.newMethod
	}));
}
export function reassociateTransfer(
	client: SupabaseClient,
	input: z.input<typeof reassociateTransferSchema>,
	ctx: PaymentCorrectionRequestContext
) {
	return correct(
		client,
		reassociateTransferSchema,
		input,
		ctx,
		'payment_reassociate_transfer',
		(p) => ({
			p_new_sale_id: p.newSaleId,
			p_applications: p.applications.map((application) => ({
				installment_id: application.installmentId,
				amount_applied: application.amountApplied
			}))
		})
	);
}
