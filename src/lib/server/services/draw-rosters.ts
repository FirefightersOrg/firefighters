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
			return new DrawRosterServiceError('permission', 'Hace falta el permiso de padrones.');
		case '55000':
			return new DrawRosterServiceError(
				'conflict',
				error.message || 'El estado del sorteo no permite esta acción.'
			);
		case '22023':
		case '23514':
			return new DrawRosterServiceError(
				'validation',
				error.message || 'Datos del padrón inválidos.'
			);
		case 'P0002':
			return new DrawRosterServiceError('not_found', 'Sorteo no encontrado.');
		default:
			return new DrawRosterServiceError('internal', 'No se pudo modificar el padrón.', {
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
		throw new DrawRosterServiceError('internal', 'No se pudieron cargar los permisos de sorteos.');
	if (!hasPermissionIn(ctx.permissions, `draw.${action}_roster`))
		throw new DrawRosterServiceError('permission', 'Hace falta el permiso de padrones.');
	const parsed = drawRosterSchema.safeParse(input);
	if (!parsed.success)
		throw new DrawRosterServiceError('validation', 'Datos del padrón inválidos.', {
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
		throw new DrawRosterServiceError('internal', 'No se pudo modificar el padrón.', { cause });
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
