import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { hasPermissionIn } from '$lib/server/auth/permissions';

export interface DrawRosterRequestContext {
	requestId: string | null;
	permissions: readonly string[] | null;
}
export class DrawRosterServiceError extends Error {
	constructor(
		readonly kind: 'permission' | 'validation' | 'not_found' | 'conflict' | 'internal',
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = 'DrawRosterServiceError';
	}
	get status() {
		return { permission: 403, validation: 400, not_found: 404, conflict: 409, internal: 500 }[
			this.kind
		];
	}
}
export function mapDrawRosterRpcError(error: { code?: string; message?: string }) {
	switch (error.code) {
		case '42501':
			return new DrawRosterServiceError('permission', 'Draw roster permission is required.');
		case '55000':
			return new DrawRosterServiceError(
				'conflict',
				error.message || 'Draw state does not allow this action.'
			);
		case '22023':
		case '23514':
			return new DrawRosterServiceError('validation', error.message || 'Invalid draw roster data.');
		case 'P0002':
			return new DrawRosterServiceError('not_found', 'Draw not found.');
		default:
			return new DrawRosterServiceError('internal', 'Could not change draw roster.', {
				cause: error
			});
	}
}
export const drawRosterSchema = z.object({ drawId: z.guid() });
async function changeRoster(
	client: SupabaseClient,
	input: z.input<typeof drawRosterSchema>,
	ctx: DrawRosterRequestContext,
	action: 'generate' | 'freeze'
) {
	if (ctx?.permissions == null)
		throw new DrawRosterServiceError('internal', 'Could not load draw permissions.');
	if (!hasPermissionIn(ctx.permissions, `draw.${action}_roster`))
		throw new DrawRosterServiceError('permission', 'Draw roster permission is required.');
	const parsed = drawRosterSchema.safeParse(input);
	if (!parsed.success)
		throw new DrawRosterServiceError('validation', 'Invalid draw roster data.', {
			cause: parsed.error
		});
	try {
		const { data, error } = await client.rpc(`draw_${action}_roster`, {
			p_draw_id: parsed.data.drawId,
			p_request_id: ctx.requestId
		});
		if (error) throw mapDrawRosterRpcError(error);
		return data as string;
	} catch (cause) {
		if (cause instanceof DrawRosterServiceError) throw cause;
		throw new DrawRosterServiceError('internal', 'Could not change draw roster.', { cause });
	}
}
export function generateDrawRoster(
	client: SupabaseClient,
	input: z.input<typeof drawRosterSchema>,
	ctx: DrawRosterRequestContext
) {
	return changeRoster(client, input, ctx, 'generate');
}
export function freezeDrawRoster(
	client: SupabaseClient,
	input: z.input<typeof drawRosterSchema>,
	ctx: DrawRosterRequestContext
) {
	return changeRoster(client, input, ctx, 'freeze').then(() => undefined);
}
