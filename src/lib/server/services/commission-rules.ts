import type { SupabaseClient } from '@supabase/supabase-js';
import type {
	CommissionRuleAnnulInput,
	CommissionRuleFormField,
	CommissionRuleInput,
	CommissionRuleUpdateInput
} from '$lib/schemas/commission-rule';
import { COMMISSION_REASON_MAX_LENGTH } from '$lib/schemas/commission-rule';

/**
 * Commission rule use cases. Every write calls one audited SQL function with the USER-SCOPED
 * client (`locals.supabase`), so the database checks the caller's active profile and
 * `commission.rule_manage` and writes the change plus its `audit_log` row in one transaction
 * (migration `20261118000000_commission_rules.sql`).
 *
 * Errors are thrown as `CommissionRuleServiceError` with a kind the routes map to HTTP statuses
 * and a message that is safe to show to the user.
 */

export type CommissionRuleErrorKind =
	'validation' | 'permission' | 'conflict' | 'not_found' | 'internal';

const STATUS_BY_KIND: Record<CommissionRuleErrorKind, number> = {
	validation: 400,
	permission: 403,
	not_found: 404,
	conflict: 409,
	internal: 500
};

export class CommissionRuleServiceError extends Error {
	readonly kind: CommissionRuleErrorKind;
	/** Form field the error belongs to, when it can be attributed to one. */
	readonly field?: CommissionRuleFormField;

	constructor(
		kind: CommissionRuleErrorKind,
		message: string,
		options?: { field?: CommissionRuleFormField; cause?: unknown }
	) {
		super(message, { cause: options?.cause });
		this.name = 'CommissionRuleServiceError';
		this.kind = kind;
		this.field = options?.field;
	}

	/** HTTP status for this error (400, 403, 404, 409 or 500). */
	get status(): number {
		return STATUS_BY_KIND[this.kind];
	}
}

interface PostgrestLikeError {
	code?: string;
	message: string;
	details?: string | null;
	hint?: string | null;
}

export const COMMISSION_RULE_MESSAGES = {
	permission: 'No hay permiso para gestionar reglas de comisión.',
	ruleNotFound: 'No se encontró la regla de comisión. Puede haberse quitado de esta campaña.',
	campaignNotFound: 'No se encontró la campaña.',
	internal: 'Algo salió mal. Volver a intentar.',
	invalid: 'Hay valores no válidos. Revisar el formulario.',
	overlap:
		'Esta regla se superpone con una regla activa del mismo tipo en esta campaña. ' +
		'Cambiar las fechas, o terminar o anular antes la otra regla.',
	campaignLocked:
		'Las reglas de comisión solo se pueden cambiar mientras la campaña es un borrador o está activa.',
	annulled: 'Esta regla fue anulada y ya no se puede cambiar.',
	alreadyAnnulled: 'Esta regla ya está anulada.',
	reasonRequired: 'Se requiere un motivo para anular una regla de comisión.',
	staleVersion:
		'Otra persona modificó esta regla de comisión mientras se editaba. Recargar la página para ver los últimos cambios y volver a hacer la edición.'
} as const;

/** Friendly messages for the table CHECK constraints (backstops of the function checks). */
const CONSTRAINT_MESSAGES: Record<string, { field?: CommissionRuleFormField; message: string }> = {
	commission_rules_rule_type_check: { field: 'ruleType', message: 'Tipo de regla desconocido.' },
	commission_rules_one_value: {
		field: 'valueKind',
		message: 'Ingresar un porcentaje o un monto fijo, no ambos.'
	},
	commission_rules_percentage_range: {
		field: 'percentage',
		message: 'El porcentaje debe ser mayor que 0 y hasta 100.'
	},
	commission_rules_fixed_amount_positive: {
		field: 'fixedAmount',
		message: 'El monto fijo debe ser mayor que 0.'
	},
	commission_rules_installment_number_custom: {
		field: 'installmentNumber',
		message: 'El número de cuota solo se usa (y es obligatorio) en una regla de cuota específica.'
	},
	commission_rules_annul_reason_max_length: {
		field: 'reason',
		message: `El motivo admite hasta ${COMMISSION_REASON_MAX_LENGTH} caracteres.`
	},
	commission_rules_validity_order: {
		field: 'validTo',
		message: 'La fecha de fin de vigencia debe ser igual o posterior a la de inicio.'
	}
};

/** Maps a PostgREST/Postgres error from a `commission_rule_*` function. */
export function mapCommissionRuleRpcError(
	rpcError: PostgrestLikeError
): CommissionRuleServiceError {
	const message = rpcError.message ?? '';
	const err = (kind: CommissionRuleErrorKind, text: string, field?: CommissionRuleFormField) =>
		new CommissionRuleServiceError(kind, text, { field, cause: rpcError });

	switch (rpcError.code) {
		case '42501':
			return err('permission', COMMISSION_RULE_MESSAGES.permission);

		case 'P0002':
			return message.startsWith('campaign')
				? err('not_found', COMMISSION_RULE_MESSAGES.campaignNotFound)
				: err('not_found', COMMISSION_RULE_MESSAGES.ruleNotFound);

		case '23P01':
			return err('conflict', COMMISSION_RULE_MESSAGES.overlap);

		// Optimistic concurrency: the rule changed after the form was loaded (nothing written).
		// PT409 (not 40001, which PostgREST would retry forever); PostgREST answers HTTP 409.
		case 'PT409':
			return err('conflict', COMMISSION_RULE_MESSAGES.staleVersion);

		case '22023': {
			const range = /^installment number must be between 1 and (\d+)/.exec(message);
			if (range) {
				return err(
					'validation',
					`El número de cuota debe estar entre 1 y ${range[1]}.`,
					'installmentNumber'
				);
			}
			if (message.startsWith('installment number')) {
				return err('validation', 'El número de cuota no es válido.', 'installmentNumber');
			}
			if (message.startsWith('percentage')) {
				return err('validation', 'El porcentaje no es válido.', 'percentage');
			}
			if (message.startsWith('fixed amount')) {
				return err('validation', 'El monto fijo no es válido.', 'fixedAmount');
			}
			if (message.startsWith('exactly one of percentage or fixed amount')) {
				return err('validation', 'Ingresar un porcentaje o un monto fijo, no ambos.', 'valueKind');
			}
			if (message.startsWith('invalid commission rule type')) {
				return err('validation', 'Tipo de regla desconocido.', 'ruleType');
			}
			if (message === 'valid from date is required') {
				return err('validation', 'La fecha de inicio de vigencia es obligatoria.', 'validFrom');
			}
			if (message.startsWith('valid to date')) {
				return err(
					'validation',
					'La fecha de fin de vigencia debe ser igual o posterior a la de inicio.',
					'validTo'
				);
			}
			if (message.startsWith('a reason is required')) {
				return err('validation', COMMISSION_RULE_MESSAGES.reasonRequired, 'reason');
			}
			return err('validation', COMMISSION_RULE_MESSAGES.invalid);
		}

		case '23514': {
			const constraint = /violates check constraint "([^"]+)"/.exec(message)?.[1];
			if (constraint) {
				const known = CONSTRAINT_MESSAGES[constraint];
				return known
					? err('validation', known.message, known.field)
					: err('validation', COMMISSION_RULE_MESSAGES.invalid);
			}
			const exceeds =
				/installment number \d+ exceeds the campaign installment count \((\d+)\)/.exec(message);
			if (exceeds) {
				return err(
					'validation',
					`El número de cuota debe estar entre 1 y ${exceeds[1]}.`,
					'installmentNumber'
				);
			}
			return err('internal', COMMISSION_RULE_MESSAGES.internal);
		}

		case '55000':
			if (message.includes('already annulled')) {
				return err('conflict', COMMISSION_RULE_MESSAGES.alreadyAnnulled);
			}
			if (message.includes('is annulled and cannot be changed')) {
				return err('conflict', COMMISSION_RULE_MESSAGES.annulled);
			}
			if (message.includes('while the campaign is draft or active')) {
				return err('conflict', COMMISSION_RULE_MESSAGES.campaignLocked);
			}
			return err('conflict', 'Este cambio no está permitido en el estado actual.');

		case '23502':
			return err('validation', 'Falta un valor obligatorio.');

		case '22003':
			return err('validation', 'Un valor es demasiado grande.');

		case '22P02':
		case '22007':
		case '22008':
			return err('validation', COMMISSION_RULE_MESSAGES.invalid);

		default:
			return err('internal', COMMISSION_RULE_MESSAGES.internal);
	}
}

export interface CommissionRuleRequestContext {
	requestId?: string | null;
}

async function callCommissionRuleRpc(
	supabase: SupabaseClient,
	fn: string,
	args: Record<string, unknown>,
	ctx: CommissionRuleRequestContext
): Promise<unknown> {
	let result: { data: unknown; error: PostgrestLikeError | null };
	try {
		result = await supabase.rpc(fn, args);
	} catch (cause) {
		console.error(`[commission-rules] ${fn} RPC threw`, { requestId: ctx.requestId, error: cause });
		throw new CommissionRuleServiceError('internal', COMMISSION_RULE_MESSAGES.internal, { cause });
	}

	if (result.error) {
		const mapped = mapCommissionRuleRpcError(result.error);
		if (mapped.kind === 'internal') {
			console.error(`[commission-rules] ${fn} RPC failed`, {
				requestId: ctx.requestId,
				error: result.error
			});
		}
		throw mapped;
	}
	return result.data;
}

function ruleArgs(input: CommissionRuleInput) {
	return {
		p_rule_type: input.ruleType,
		p_installment_number: input.installmentNumber,
		// Exact decimal strings; Postgres parses them into numeric without float rounding.
		p_percentage: input.percentage,
		p_fixed_amount: input.fixedAmount,
		p_valid_from: input.validFrom,
		p_valid_to: input.validTo,
		p_reason: input.reason
	};
}

/**
 * Creates a rule (`commission.rule_manage`). Returns the new rule id. With `appliesToCollectorId`
 * it is a special per-collector rule (SAN-69), which takes precedence over general rules.
 */
export async function createCommissionRule(
	supabase: SupabaseClient,
	campaignId: string,
	input: CommissionRuleInput,
	ctx: CommissionRuleRequestContext = {},
	appliesToCollectorId: string | null = null
): Promise<string> {
	const data = await callCommissionRuleRpc(
		supabase,
		'commission_rule_create',
		{
			p_campaign_id: campaignId,
			...ruleArgs(input),
			p_request_id: ctx.requestId ?? null,
			...(appliesToCollectorId ? { p_applies_to_collector_id: appliesToCollectorId } : {})
		},
		ctx
	);
	if (typeof data !== 'string' || data.length === 0) {
		console.error('[commission-rules] commission_rule_create returned no id', {
			requestId: ctx.requestId,
			data
		});
		throw new CommissionRuleServiceError('internal', COMMISSION_RULE_MESSAGES.internal);
	}
	return data;
}

/**
 * Updates an active rule. Returns false when nothing changed (no audit row). Throws a `conflict`
 * (409) when the rule changed since `input.expectedUpdatedAt` (nothing written).
 */
export async function updateCommissionRule(
	supabase: SupabaseClient,
	input: CommissionRuleUpdateInput,
	ctx: CommissionRuleRequestContext = {}
): Promise<boolean> {
	const data = await callCommissionRuleRpc(
		supabase,
		'commission_rule_update',
		{
			p_id: input.ruleId,
			...ruleArgs(input),
			// The exact string as loaded (microseconds); the database compares it with updated_at.
			p_expected_updated_at: input.expectedUpdatedAt,
			p_request_id: ctx.requestId ?? null
		},
		ctx
	);
	return data === true;
}

/** Annuls an active rule (reason required). */
export async function annulCommissionRule(
	supabase: SupabaseClient,
	input: CommissionRuleAnnulInput,
	ctx: CommissionRuleRequestContext = {}
): Promise<void> {
	await callCommissionRuleRpc(
		supabase,
		'commission_rule_annul',
		{ p_id: input.ruleId, p_reason: input.reason, p_request_id: ctx.requestId ?? null },
		ctx
	);
}
