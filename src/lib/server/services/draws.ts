import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { DRAW_NAME_MAX, DRAW_REASON_MAX, DRAW_TYPES } from '$lib/domain/draws';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import {
	DrawRosterServiceError,
	mapDrawRosterRpcError,
	type DrawRosterRequestContext
} from './draw-rosters';

export { DrawRosterServiceError as DrawServiceError };
export const mapDrawRpcError = mapDrawRosterRpcError;
export type DrawRequestContext = DrawRosterRequestContext;
const text = (max: number) =>
	z
		.string()
		.trim()
		.min(1)
		.refine((s) => [...s].length <= max);
const fields = {
	name: text(DRAW_NAME_MAX),
	drawDate: z.iso.date(),
	paymentCutoffAt: z.iso.datetime({ offset: true }),
	requiredInstallmentNumber: z.number().int().min(1).max(120).nullable(),
	eligibilityRule: z.record(z.string(), z.unknown())
};
export const createDrawSchema = z
	.object({
		campaignId: z.guid(),
		drawType: z.enum(DRAW_TYPES),
		...fields
	})
	.refine((p) => p.drawType !== 'monthly' || p.requiredInstallmentNumber !== null, {
		path: ['requiredInstallmentNumber'],
		message: 'Monthly draws require an installment.'
	});
export const updateDrawSchema = z.object({ drawId: z.guid(), ...fields });
export const annulDrawSchema = z.object({ drawId: z.guid(), reason: text(DRAW_REASON_MAX) });
export type CreateDrawInput = z.input<typeof createDrawSchema>;
export type UpdateDrawInput = z.input<typeof updateDrawSchema>;
export const completeDrawSchema = z.object({ drawId: z.guid() });
export type AnnulDrawInput = z.input<typeof annulDrawSchema>;
export type CompleteDrawInput = z.input<typeof completeDrawSchema>;
async function write<T extends z.ZodType>(
	client: SupabaseClient,
	input: z.input<T>,
	ctx: DrawRequestContext,
	permission: 'draw.create' | 'draw.update' | 'draw.annul' | 'draw.complete',
	schema: T,
	name: string,
	args: (p: z.output<T>) => Record<string, unknown>
) {
	if (ctx?.permissions == null)
		throw new DrawRosterServiceError('internal', 'Could not load draw permissions.');
	if (!hasPermissionIn(ctx.permissions, permission))
		throw new DrawRosterServiceError('permission', 'Draw permission is required.');
	const parsed = schema.safeParse(input);
	if (!parsed.success)
		throw new DrawRosterServiceError('validation', 'Invalid draw data.', { cause: parsed.error });
	try {
		const { data, error } = await client.rpc(name, {
			...args(parsed.data),
			p_request_id: ctx.requestId
		});
		if (error) throw mapDrawRpcError(error);
		return data as string;
	} catch (cause) {
		if (cause instanceof DrawRosterServiceError) throw cause;
		throw new DrawRosterServiceError('internal', 'Could not change draw.', { cause });
	}
}
const ruleArgs = (p: z.output<typeof updateDrawSchema> | z.output<typeof createDrawSchema>) => ({
	p_name: p.name,
	p_draw_date: p.drawDate,
	p_payment_cutoff_at: p.paymentCutoffAt,
	p_required_installment_number: p.requiredInstallmentNumber,
	p_eligibility_rule: p.eligibilityRule
});
export function createDraw(
	client: SupabaseClient,
	input: CreateDrawInput,
	ctx: DrawRequestContext
) {
	return write(client, input, ctx, 'draw.create', createDrawSchema, 'draw_create', (p) => ({
		p_campaign_id: p.campaignId,
		p_draw_type: p.drawType,
		...ruleArgs(p)
	}));
}
export function updateDraw(
	client: SupabaseClient,
	input: UpdateDrawInput,
	ctx: DrawRequestContext
) {
	return write(client, input, ctx, 'draw.update', updateDrawSchema, 'draw_update', (p) => ({
		p_draw_id: p.drawId,
		...ruleArgs(p)
	})).then(() => undefined);
}
export function annulDraw(client: SupabaseClient, input: AnnulDrawInput, ctx: DrawRequestContext) {
	return write(client, input, ctx, 'draw.annul', annulDrawSchema, 'draw_annul', (p) => ({
		p_draw_id: p.drawId,
		p_reason: p.reason
	})).then(() => undefined);
}

/** SAN-123: roster_frozen -> completed; every prize must be resolved first (409 otherwise). */
export function completeDraw(
	client: SupabaseClient,
	input: CompleteDrawInput,
	ctx: DrawRequestContext
) {
	return write(client, input, ctx, 'draw.complete', completeDrawSchema, 'draw_complete', (p) => ({
		p_draw_id: p.drawId
	})).then(() => undefined);
}
