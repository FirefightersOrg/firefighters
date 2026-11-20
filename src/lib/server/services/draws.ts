import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { DRAW_NAME_MAX, DRAW_REASON_MAX, DRAW_TYPES, type DrawType } from '$lib/domain/draws';
import { hasPermissionIn } from '$lib/server/auth/permissions';

const codePoints = (max: number) =>
	z
		.string()
		.trim()
		.min(1)
		.refine((value) => [...value].length <= max);
const drawInput = z.object({
	campaignId: z.guid(),
	drawType: z.enum(DRAW_TYPES),
	name: codePoints(DRAW_NAME_MAX),
	drawDate: z.string().date(),
	paymentCutoffAt: z.iso.datetime({ offset: true }),
	requiredInstallmentNumber: z.number().int().positive().nullable(),
	eligibilityRule: z.record(z.string(), z.unknown())
});
const updateInput = drawInput.omit({ campaignId: true, drawType: true });
const annulInput = z.object({ drawId: z.guid(), reason: codePoints(DRAW_REASON_MAX) });

export type DrawWriteInput = z.input<typeof drawInput>;
export type DrawUpdateInput = z.input<typeof updateInput>;
export interface DrawRequestContext {
	requestId: string | null | undefined;
	permissions: readonly string[] | null;
}

export class DrawServiceError extends Error {
	constructor(
		readonly kind: 'permission' | 'validation' | 'not_found' | 'conflict' | 'internal',
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = 'DrawServiceError';
	}
	get status() {
		return { permission: 403, validation: 400, not_found: 404, conflict: 409, internal: 500 }[
			this.kind
		];
	}
}

type RpcError = { code?: string; message?: string };
export function mapDrawRpcError(error: RpcError): DrawServiceError {
	if (error.code === '42501')
		return new DrawServiceError('permission', 'You do not have permission to perform this action.');
	if (error.code === 'P0002') return new DrawServiceError('not_found', 'Draw not found.');
	if (['22023', '23514'].includes(error.code ?? ''))
		return new DrawServiceError('validation', error.message || 'Invalid draw data.');
	if (['55000', '23505', '23001', 'P0001'].includes(error.code ?? ''))
		return new DrawServiceError('conflict', error.message || 'The draw can no longer be changed.');
	return new DrawServiceError('internal', 'Something went wrong. Please try again.', {
		cause: error
	});
}

function requirePermission(ctx: DrawRequestContext, permission: string) {
	if (ctx.permissions == null)
		throw new DrawServiceError('internal', 'Something went wrong. Please try again.');
	if (!hasPermissionIn(ctx.permissions, permission as never))
		throw new DrawServiceError('permission', 'You do not have permission to perform this action.');
}
async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>) {
	try {
		const { data, error } = await client.rpc(name, args);
		if (error) throw mapDrawRpcError(error);
		return data as T;
	} catch (error) {
		if (error instanceof DrawServiceError) throw error;
		throw new DrawServiceError('internal', 'Something went wrong. Please try again.', {
			cause: error
		});
	}
}
function validateRules(input: { drawType?: DrawType; requiredInstallmentNumber: number | null }) {
	if (input.drawType === 'monthly' && input.requiredInstallmentNumber == null)
		throw new DrawServiceError('validation', 'Monthly draws require an installment number.');
}

export async function createDraw(
	client: SupabaseClient,
	input: DrawWriteInput,
	ctx: DrawRequestContext
) {
	const parsed = drawInput.safeParse(input);
	if (!parsed.success)
		throw new DrawServiceError('validation', 'Invalid draw data.', { cause: parsed.error });
	validateRules(parsed.data);
	requirePermission(ctx, 'draw.create');
	return rpc<string>(client, 'draw_create', {
		p_campaign_id: parsed.data.campaignId,
		p_draw_type: parsed.data.drawType,
		p_name: parsed.data.name,
		p_draw_date: parsed.data.drawDate,
		p_payment_cutoff_at: parsed.data.paymentCutoffAt,
		p_required_installment_number: parsed.data.requiredInstallmentNumber,
		p_eligibility_rule: parsed.data.eligibilityRule,
		p_request_id: ctx.requestId ?? null
	});
}

export async function updateDraw(
	client: SupabaseClient,
	drawId: string,
	input: DrawUpdateInput,
	ctx: DrawRequestContext
) {
	const id = z.guid().safeParse(drawId);
	const parsed = updateInput.safeParse(input);
	if (!id.success || !parsed.success)
		throw new DrawServiceError('validation', 'Invalid draw data.', {
			cause: parsed.success ? id.error : parsed.error
		});
	requirePermission(ctx, 'draw.update');
	return rpc<void>(client, 'draw_update', {
		p_draw_id: id.data,
		p_name: parsed.data.name,
		p_draw_date: parsed.data.drawDate,
		p_payment_cutoff_at: parsed.data.paymentCutoffAt,
		p_required_installment_number: parsed.data.requiredInstallmentNumber,
		p_eligibility_rule: parsed.data.eligibilityRule,
		p_request_id: ctx.requestId ?? null
	});
}

export async function annulDraw(
	client: SupabaseClient,
	input: { drawId: string; reason: string },
	ctx: DrawRequestContext
) {
	const parsed = annulInput.safeParse(input);
	if (!parsed.success)
		throw new DrawServiceError('validation', 'Invalid annulment data.', { cause: parsed.error });
	requirePermission(ctx, 'draw.update');
	return rpc<void>(client, 'draw_annul', {
		p_draw_id: parsed.data.drawId,
		p_reason: parsed.data.reason,
		p_request_id: ctx.requestId ?? null
	});
}
