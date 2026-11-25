import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import { GENERIC_ERROR_MESSAGE } from '$lib/copy';

/** SAN-142: N, the overdue installments from which reports warn about a sale. */
export const overdueWarningThresholdSchema = z.object({
	campaignId: z.guid(),
	threshold: z.coerce
		.number({ message: 'Ingresar un número entre 1 y 120.' })
		.int('Ingresar un número entero entre 1 y 120.')
		.min(1, 'Ingresar un número entre 1 y 120.')
		.max(120, 'Ingresar un número entre 1 y 120.')
});

export type OverdueWarningErrorKind =
	'permission' | 'validation' | 'not_found' | 'conflict' | 'internal';
const STATUS: Record<OverdueWarningErrorKind, number> = {
	permission: 403,
	validation: 400,
	not_found: 404,
	conflict: 409,
	internal: 500
};
export class OverdueWarningServiceError extends Error {
	readonly kind: OverdueWarningErrorKind;
	constructor(kind: OverdueWarningErrorKind, message: string, options?: { cause?: unknown }) {
		super(message, { cause: options?.cause });
		this.name = 'OverdueWarningServiceError';
		this.kind = kind;
	}
	get status() {
		return STATUS[this.kind];
	}
}

export function mapOverdueWarningRpcError(error: { code?: string; message?: string }) {
	if (error.code === '42501')
		return new OverdueWarningServiceError('permission', 'No hay permiso para esta acción.');
	if (error.code === '22023')
		return new OverdueWarningServiceError('validation', 'Ingresar un número entre 1 y 120.');
	if (error.code === 'P0002')
		return new OverdueWarningServiceError('not_found', 'Campaña no encontrada.');
	if (error.code === '55000')
		return new OverdueWarningServiceError(
			'conflict',
			'No se puede cambiar el aviso de una campaña cerrada o anulada.'
		);
	return new OverdueWarningServiceError('internal', GENERIC_ERROR_MESSAGE, { cause: error });
}

export async function setOverdueWarningThreshold(
	supabase: SupabaseClient,
	input: z.input<typeof overdueWarningThresholdSchema>,
	ctx: { requestId?: string | null; permissions?: readonly string[] | null }
): Promise<number> {
	if (ctx.permissions == null)
		throw new OverdueWarningServiceError('internal', 'No se pudieron cargar los permisos.');
	if (!hasPermissionIn(ctx.permissions, 'campaign.update_rules'))
		throw new OverdueWarningServiceError('permission', 'No hay permiso para esta acción.');
	const parsed = overdueWarningThresholdSchema.safeParse(input);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		if (issue?.path[0] !== 'threshold')
			throw new OverdueWarningServiceError('not_found', 'Campaña no encontrada.', {
				cause: parsed.error
			});
		throw new OverdueWarningServiceError('validation', issue.message, { cause: parsed.error });
	}
	let result: { error: { code?: string; message?: string } | null };
	try {
		result = await supabase.rpc('campaign_set_overdue_warning_threshold', {
			p_campaign_id: parsed.data.campaignId,
			p_threshold: parsed.data.threshold,
			p_request_id: ctx.requestId ?? null
		});
	} catch (cause) {
		throw new OverdueWarningServiceError('internal', GENERIC_ERROR_MESSAGE, { cause });
	}
	if (result.error) throw mapOverdueWarningRpcError(result.error);
	return parsed.data.threshold;
}
