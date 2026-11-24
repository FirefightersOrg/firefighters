import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import type { PermissionCode } from '$lib/server/auth/permission-codes';
import {
	PRIZE_NAME_MAX,
	PRIZE_DESCRIPTION_MAX,
	PRIZE_NOTES_MAX,
	PRIZE_REASON_MAX
} from '$lib/domain/prizes';

export interface PrizeRequestContext {
	requestId: string | null;
	permissions: readonly string[] | null;
}
export class PrizeServiceError extends Error {
	constructor(
		readonly kind: 'permission' | 'validation' | 'not_found' | 'conflict' | 'internal',
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = 'PrizeServiceError';
	}
	get status() {
		return { permission: 403, validation: 400, not_found: 404, conflict: 409, internal: 500 }[
			this.kind
		];
	}
}
export function mapPrizeRpcError(error: { code?: string; message?: string }) {
	switch (error.code) {
		case '42501':
			return new PrizeServiceError('permission', 'Hace falta el permiso de premios.');
		case '55000':
			return new PrizeServiceError(
				'conflict',
				(
					{
						'this prize already has a loaded winning number':
							'Este premio ya tiene un número ganador cargado.',
						'a delivered prize cannot be annulled; pending product decision':
							'Un premio entregado no se puede anular. Primero hay que revertir la entrega.',
						'completed draws cannot configure prizes':
							'En un sorteo completado no se pueden configurar premios.',
						'previous draws of the campaign have unresolved prizes that exclude from consolation':
							'Hay sorteos anteriores de la campaña con premios sin resolver que excluyen del consuelo.'
					} as Record<string, string>
				)[error.message ?? ''] ||
					error.message ||
					'El estado del premio no permite esta acción.'
			);
		case '23505':
			return new PrizeServiceError(
				'conflict',
				error.message || 'El estado o la posición del premio entran en conflicto.'
			);
		case '22023':
		case '23514':
			return new PrizeServiceError('validation', error.message || 'Datos del premio inválidos.');
		case 'P0002':
			return new PrizeServiceError('not_found', 'Premio o sorteo no encontrado.');
		default:
			return new PrizeServiceError('internal', 'No se pudo modificar el premio.', { cause: error });
	}
}
const text = (max: number) =>
	z
		.string()
		.trim()
		.min(1)
		.refine((s) => [...s].length <= max);
const fields = {
	name: text(PRIZE_NAME_MAX),
	description: text(PRIZE_DESCRIPTION_MAX).nullable(),
	position: z.number().int().min(1).max(2147483647),
	excludesFromConsolation: z.boolean().default(true)
};
export const createPrizeSchema = z.object({ drawId: z.guid(), ...fields });
export const updatePrizeSchema = z.object({
	prizeId: z.guid(),
	...fields,
	excludesFromConsolation: z.boolean()
});
export const loadWinningNumberSchema = z.object({
	prizeId: z.guid(),
	numberValue: z.number().int().min(0).max(2147483647),
	notes: text(PRIZE_NOTES_MAX).nullable()
});
export const resolvePrizeSchema = z.object({
	prizeId: z.guid(),
	decision: z.enum(['award', 'unaward']),
	notes: text(PRIZE_NOTES_MAX).nullable()
});
export const deliverPrizeSchema = z.object({
	prizeId: z.guid(),
	notes: text(PRIZE_NOTES_MAX)
});
export const annulPrizeSchema = z.object({
	prizeId: z.guid(),
	reason: text(PRIZE_REASON_MAX)
});
export const reversePrizeDeliverySchema = annulPrizeSchema;
export type ReversePrizeDeliveryInput = z.input<typeof reversePrizeDeliverySchema>;
export type CreatePrizeInput = z.input<typeof createPrizeSchema>;
export type UpdatePrizeInput = z.input<typeof updatePrizeSchema>;
export type LoadWinningNumberInput = z.input<typeof loadWinningNumberSchema>;
export type ResolvePrizeInput = z.input<typeof resolvePrizeSchema>;
export type DeliverPrizeInput = z.input<typeof deliverPrizeSchema>;
export type AnnulPrizeInput = z.input<typeof annulPrizeSchema>;

async function write<T extends z.ZodType>(
	client: SupabaseClient,
	input: z.input<T>,
	ctx: PrizeRequestContext,
	permission: PermissionCode,
	schema: T,
	name: string,
	args: (p: z.output<T>) => Record<string, unknown>
) {
	if (ctx?.permissions == null)
		throw new PrizeServiceError('internal', 'No se pudieron cargar los permisos de premios.');
	if (!hasPermissionIn(ctx.permissions, permission))
		throw new PrizeServiceError('permission', 'Hace falta el permiso de premios.');
	const parsed = schema.safeParse(input);
	if (!parsed.success)
		throw new PrizeServiceError('validation', 'Datos del premio inválidos.', {
			cause: parsed.error
		});
	try {
		const { data, error } = await client.rpc(name, {
			...args(parsed.data),
			p_request_id: ctx.requestId
		});
		if (error) throw mapPrizeRpcError(error);
		return data as string;
	} catch (cause) {
		if (cause instanceof PrizeServiceError) throw cause;
		throw new PrizeServiceError('internal', 'No se pudo modificar el premio.', { cause });
	}
}
const configArgs = (p: z.output<typeof createPrizeSchema> | UpdatePrizeInput) => ({
	p_name: p.name,
	p_description: p.description,
	p_position: p.position,
	p_excludes_from_consolation: p.excludesFromConsolation
});
export function createPrize(
	client: SupabaseClient,
	input: CreatePrizeInput,
	ctx: PrizeRequestContext
) {
	return write(client, input, ctx, 'draw.update', createPrizeSchema, 'prize_create', (p) => ({
		p_draw_id: p.drawId,
		...configArgs(p)
	}));
}
export function updatePrize(
	client: SupabaseClient,
	input: UpdatePrizeInput,
	ctx: PrizeRequestContext
) {
	return write(client, input, ctx, 'draw.update', updatePrizeSchema, 'prize_update', (p) => ({
		p_prize_id: p.prizeId,
		...configArgs(p)
	})).then(() => undefined);
}
export function loadWinningNumber(
	client: SupabaseClient,
	input: LoadWinningNumberInput,
	ctx: PrizeRequestContext
) {
	return write(
		client,
		input,
		ctx,
		'draw.load_winner',
		loadWinningNumberSchema,
		'draw_load_winning_number',
		(p) => ({
			p_prize_id: p.prizeId,
			p_number_value: p.numberValue,
			p_notes: p.notes
		})
	);
}
export function resolvePrize(
	client: SupabaseClient,
	input: ResolvePrizeInput,
	ctx: PrizeRequestContext
) {
	return write(client, input, ctx, 'prize.resolve', resolvePrizeSchema, 'prize_resolve', (p) => ({
		p_prize_id: p.prizeId,
		p_decision: p.decision,
		p_notes: p.notes
	})).then(() => undefined);
}
export function deliverPrize(
	client: SupabaseClient,
	input: DeliverPrizeInput,
	ctx: PrizeRequestContext
) {
	return write(client, input, ctx, 'prize.deliver', deliverPrizeSchema, 'prize_deliver', (p) => ({
		p_prize_id: p.prizeId,
		p_notes: p.notes
	})).then(() => undefined);
}
export function annulPrize(
	client: SupabaseClient,
	input: AnnulPrizeInput,
	ctx: PrizeRequestContext
) {
	return write(client, input, ctx, 'prize.annul', annulPrizeSchema, 'prize_annul', (p) => ({
		p_prize_id: p.prizeId,
		p_reason: p.reason
	})).then(() => undefined);
}
export function reversePrizeDelivery(
	client: SupabaseClient,
	input: ReversePrizeDeliveryInput,
	ctx: PrizeRequestContext
) {
	return write(
		client,
		input,
		ctx,
		'prize.reverse_delivery',
		reversePrizeDeliverySchema,
		'prize_reverse_delivery',
		(p) => ({ p_prize_id: p.prizeId, p_reason: p.reason })
	).then(() => undefined);
}
