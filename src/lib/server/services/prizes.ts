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
			return new PrizeServiceError('permission', 'Prize permission is required.');
		case '55000':
			return new PrizeServiceError(
				'conflict',
				(
					{
						'this prize already has a loaded winning number':
							'This prize already has a loaded winning number.',
						'a delivered prize cannot be annulled; pending product decision':
							'A delivered prize cannot be annulled; pending product decision.',
						'completed draws cannot configure prizes': 'Completed draws cannot configure prizes.',
						'previous draws of the campaign have unresolved prizes that exclude from consolation':
							'Previous draws of the campaign have unresolved prizes that exclude from consolation.'
					} as Record<string, string>
				)[error.message ?? ''] ||
					error.message ||
					'Prize state conflicts.'
			);
		case '23505':
			return new PrizeServiceError(
				'conflict',
				error.message || 'Prize state or position conflicts.'
			);
		case '22023':
		case '23514':
			return new PrizeServiceError('validation', error.message || 'Invalid prize data.');
		case 'P0002':
			return new PrizeServiceError('not_found', 'Prize or draw not found.');
		default:
			return new PrizeServiceError('internal', 'Could not change prize.', { cause: error });
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
		throw new PrizeServiceError('internal', 'Could not load prize permissions.');
	if (!hasPermissionIn(ctx.permissions, permission))
		throw new PrizeServiceError('permission', 'Prize permission is required.');
	const parsed = schema.safeParse(input);
	if (!parsed.success)
		throw new PrizeServiceError('validation', 'Invalid prize data.', { cause: parsed.error });
	try {
		const { data, error } = await client.rpc(name, {
			...args(parsed.data),
			p_request_id: ctx.requestId
		});
		if (error) throw mapPrizeRpcError(error);
		return data as string;
	} catch (cause) {
		if (cause instanceof PrizeServiceError) throw cause;
		throw new PrizeServiceError('internal', 'Could not change prize.', { cause });
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
