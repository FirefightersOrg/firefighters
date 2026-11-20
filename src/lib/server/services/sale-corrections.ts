import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import type { PermissionCode } from '$lib/server/auth/permission-codes';
import { mapSettlementRpcError, SettlementServiceError } from './settlements';

export { SettlementServiceError as SaleCorrectionServiceError };
export const mapSaleCorrectionRpcError = mapSettlementRpcError;
const uuid = z.guid();
const reason = z
	.string()
	.trim()
	.min(1)
	.refine((value) => [...value].length <= 1000, 'Reason exceeds 1000 code points.');
const delta = z.coerce.number().min(-9_999_999_999.99).max(9_999_999_999.99).multipleOf(0.01);
export const correctSaleBuyerSchema = z.object({ saleId: uuid, newBuyerId: uuid, reason });
export const correctSaleCollectorSchema = z.object({ saleId: uuid, newCollectorId: uuid, reason });
export const correctBondCollectorSchema = z.object({
	bondId: uuid,
	newCollectorId: uuid,
	reason,
	// Sold bonds use sale.correct; unsold bonds use bond.assign. SQL rechecks under locks.
	sold: z.boolean()
});
export const correctSettlementSchema = z.object({
	settlementId: uuid,
	reason,
	adjustments: z
		.object({ commissionDelta: delta, cashRetainedDelta: delta })
		.strict()
		.refine((value) => value.commissionDelta !== 0 || value.cashRetainedDelta !== 0)
});
export interface SaleCorrectionRequestContext {
	requestId: string | null;
	permissions: readonly string[] | null;
}

async function correct<T extends z.ZodType>(
	client: SupabaseClient,
	schema: T,
	input: z.input<T>,
	ctx: SaleCorrectionRequestContext,
	permission: PermissionCode,
	name: string,
	args: (value: z.output<T>) => Record<string, unknown>
) {
	if (ctx?.permissions == null)
		throw new SettlementServiceError('internal', 'Could not load correction permissions.');
	if (!hasPermissionIn(ctx.permissions, permission))
		throw new SettlementServiceError('permission', 'Correction permission is required.');
	const parsed = schema.safeParse(input);
	if (!parsed.success)
		throw new SettlementServiceError('validation', 'Invalid correction.', { cause: parsed.error });
	try {
		const { data, error } = await client.rpc(name, {
			...args(parsed.data),
			p_request_id: ctx.requestId
		});
		if (error) throw mapSaleCorrectionRpcError(error);
		return data as string | null;
	} catch (cause) {
		if (cause instanceof SettlementServiceError) throw cause;
		throw new SettlementServiceError('internal', 'Correction failed.', { cause });
	}
}
export function correctSaleBuyer(
	client: SupabaseClient,
	input: z.input<typeof correctSaleBuyerSchema>,
	ctx: SaleCorrectionRequestContext
) {
	return correct(
		client,
		correctSaleBuyerSchema,
		input,
		ctx,
		'sale.correct',
		'sale_correct_buyer',
		(p) => ({
			p_sale_id: p.saleId,
			p_new_buyer_id: p.newBuyerId,
			p_reason: p.reason
		})
	);
}
export function correctSaleCollector(
	client: SupabaseClient,
	input: z.input<typeof correctSaleCollectorSchema>,
	ctx: SaleCorrectionRequestContext
) {
	return correct(
		client,
		correctSaleCollectorSchema,
		input,
		ctx,
		'sale.correct',
		'sale_correct_collector',
		(p) => ({ p_sale_id: p.saleId, p_new_collector_id: p.newCollectorId, p_reason: p.reason })
	);
}
export function correctBondCollector(
	client: SupabaseClient,
	input: z.input<typeof correctBondCollectorSchema>,
	ctx: SaleCorrectionRequestContext
) {
	return correct(
		client,
		correctBondCollectorSchema,
		input,
		ctx,
		input.sold ? 'sale.correct' : 'bond.assign',
		'bond_correct_collector',
		(p) => ({ p_bond_id: p.bondId, p_new_collector_id: p.newCollectorId, p_reason: p.reason })
	);
}
export function correctSettlement(
	client: SupabaseClient,
	input: z.input<typeof correctSettlementSchema>,
	ctx: SaleCorrectionRequestContext
) {
	return correct(
		client,
		correctSettlementSchema,
		input,
		ctx,
		'settlement.correct',
		'settlement_correct',
		(p) => ({
			p_settlement_id: p.settlementId,
			p_reason: p.reason,
			p_adjustments: {
				commission_delta: p.adjustments.commissionDelta,
				cash_retained_delta: p.adjustments.cashRetainedDelta
			}
		})
	);
}
