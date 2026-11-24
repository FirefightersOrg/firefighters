import type { SupabaseClient } from '@supabase/supabase-js';
import { statusWord } from '$lib/domain/status-word';
import { BOND_COMMERCIAL_STATUSES } from '$lib/domain/bonds';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import type { PermissionCode } from '$lib/server/auth/permission-codes';

/**
 * Bond delivery use cases (SAN-54). Each one calls an audited SQL function with the USER-SCOPED
 * client: the database checks the profile and permission (bond.assign / bond.return /
 * bond.mark_lost), locks the campaign and the bonds, applies the transition and writes the
 * history and audit rows in one transaction.
 */

export type DeliveryErrorKind = 'validation' | 'permission' | 'conflict' | 'not_found' | 'internal';

const STATUS_BY_KIND: Record<DeliveryErrorKind, number> = {
	validation: 400,
	permission: 403,
	not_found: 404,
	conflict: 409,
	internal: 500
};

export class DeliveryServiceError extends Error {
	readonly kind: DeliveryErrorKind;
	readonly field?: string;

	constructor(
		kind: DeliveryErrorKind,
		message: string,
		options?: { field?: string; cause?: unknown }
	) {
		super(message, { cause: options?.cause });
		this.name = 'DeliveryServiceError';
		this.kind = kind;
		this.field = options?.field;
	}

	get status(): number {
		return STATUS_BY_KIND[this.kind];
	}
}

export const DELIVERY_MESSAGES = {
	permission: 'No hay permiso para esta acción.',
	bondNotFound: 'A selected bond no longer exists.',
	collectorNotFound: 'Cobrador no encontrado.',
	campaignLocked:
		'Los bonos solo se pueden entregar o cambiar mientras la campaña está en borrador o activa.',
	internal: 'Algo salió mal. Volver a intentar.',
	invalid: 'Hay valores inválidos. Revisarlos.'
} as const;

interface PostgrestLikeError {
	code?: string;
	message: string;
}

const STATUS_WORD = new RegExp(`\\b(${BOND_COMMERCIAL_STATUSES.join('|')})\\b`, 'g');

function humanize(message: string): string {
	const text = message
		.replace(/\s[0-9a-f]{8}-[0-9a-f-]{27}/gi, '')
		.replace(STATUS_WORD, (s) => statusWord(s));
	const sentence = text.charAt(0).toUpperCase() + text.slice(1);
	return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

const FIELD_BY_MESSAGE: [RegExp, string][] = [
	[/responsible party/, 'responsibleParty'],
	[/date of the loss/, 'lostOn'],
	[/^a reason|^reason/, 'reason'],
	[/^notes/, 'notes'],
	[
		/bond list|at least one bond|at most \d+ bonds|another campaign|already delivered to that collector/,
		'bondIds'
	]
];

export function mapDeliveryRpcError(rpcError: PostgrestLikeError): DeliveryServiceError {
	const message = rpcError.message ?? '';
	const err = (kind: DeliveryErrorKind, text: string, field?: string) =>
		new DeliveryServiceError(kind, text, { field, cause: rpcError });
	switch (rpcError.code) {
		case '42501':
			return err('permission', DELIVERY_MESSAGES.permission);
		case '22007':
		case '22008':
			// A well-formed but impossible date (2026-02-31) fails the cast of p_lost_on.
			return err('validation', 'Ingresar una fecha válida.', 'lostOn');
		case '22023':
			if (/one collector at a time/.test(message)) {
				return err('validation', 'Devolver los bonos de a un cobrador por vez.', 'bondIds');
			}
			return err(
				'validation',
				humanize(message),
				FIELD_BY_MESSAGE.find(([re]) => re.test(message))?.[1]
			);
		case 'P0002':
			if (message.startsWith('collector')) {
				return err('not_found', DELIVERY_MESSAGES.collectorNotFound, 'collectorId');
			}
			return err('not_found', DELIVERY_MESSAGES.bondNotFound, 'bondIds');
		case '55000': {
			if (/only while the campaign is active/.test(message)) {
				return err(
					'conflict',
					'Los bonos se entregan a los cobradores solo mientras la campaña está activa.'
				);
			}
			const window = /while the campaign is draft or active \(status: (\w+)\)/.exec(message);
			if (window) {
				const label = statusWord(window[1]);
				return err('conflict', `${DELIVERY_MESSAGES.campaignLocked} This campaign is ${label}.`);
			}
			if (/no longer with that collector/.test(message)) {
				return err(
					'conflict',
					'A selected bond is no longer with this collector. Reload the page and try again.',
					'bondIds'
				);
			}
			if (/collector .* is inactive/.test(message))
				return err('conflict', humanize(message), 'collectorId');
			if (/manually grouped pata/.test(message)) {
				return err(
					'conflict',
					'A selected bond belongs to a manual pata: deliver the pata instead.',
					'bondIds'
				);
			}
			return err('conflict', humanize(message), 'bondIds');
		}
		case '23514':
		case '23503':
		case '22P02':
			return err('validation', DELIVERY_MESSAGES.invalid);
		default:
			return err('internal', DELIVERY_MESSAGES.internal);
	}
}

export interface DeliveryRequestContext {
	requestId?: string | null;
	/** The request's permission list (`locals.permissions`): enables the up-front check. */
	permissions?: readonly string[] | null;
}

async function call(
	supabase: SupabaseClient,
	fn: string,
	permission: PermissionCode,
	args: Record<string, unknown>,
	ctx: DeliveryRequestContext
): Promise<unknown> {
	if (ctx.permissions != null && !hasPermissionIn(ctx.permissions, permission)) {
		throw new DeliveryServiceError('permission', DELIVERY_MESSAGES.permission);
	}
	let result: { data: unknown; error: PostgrestLikeError | null };
	try {
		result = await supabase.rpc(fn, { ...args, p_request_id: ctx.requestId ?? null });
	} catch (cause) {
		console.error(`[deliveries] ${fn} RPC threw`, { requestId: ctx.requestId, error: cause });
		throw new DeliveryServiceError('internal', DELIVERY_MESSAGES.internal, { cause });
	}
	if (result.error) {
		const mapped = mapDeliveryRpcError(result.error);
		if (mapped.kind === 'internal') {
			console.error(`[deliveries] ${fn} RPC failed`, {
				requestId: ctx.requestId,
				error: result.error
			});
		}
		throw mapped;
	}
	return result.data;
}

function requireId(fn: string, data: unknown, ctx: DeliveryRequestContext): string {
	if (typeof data !== 'string' || data === '') {
		console.error(`[deliveries] ${fn} returned no id`, { requestId: ctx.requestId, data });
		throw new DeliveryServiceError('internal', DELIVERY_MESSAGES.internal);
	}
	return data;
}

/** Delivers available bonds to an active collector (`bond.assign`). Returns the note id. */
export async function assignBondsToCollector(
	supabase: SupabaseClient,
	input: { campaignId: string; collectorId: string; bondIds: string[]; notes?: string | null },
	ctx: DeliveryRequestContext = {}
): Promise<string> {
	const data = await call(
		supabase,
		'bond_deliver',
		'bond.assign',
		{
			p_campaign_id: input.campaignId,
			p_collector_id: input.collectorId,
			p_bond_ids: input.bondIds,
			p_notes: input.notes ?? null
		},
		ctx
	);
	return requireId('bond_deliver', data, ctx);
}

/** Moves delivered bonds to another active collector (`bond.assign`). Returns the new note id. */
export async function reassignBondsToCollector(
	supabase: SupabaseClient,
	input: {
		campaignId: string;
		collectorId: string;
		bondIds: string[];
		notes?: string | null;
		/** The collector the bonds were seen with: the database refuses if one moved meanwhile. */
		fromCollectorId?: string | null;
	},
	ctx: DeliveryRequestContext = {}
): Promise<string> {
	const data = await call(
		supabase,
		'bond_reassign',
		'bond.assign',
		{
			p_campaign_id: input.campaignId,
			p_collector_id: input.collectorId,
			p_bond_ids: input.bondIds,
			p_notes: input.notes ?? null,
			p_from_collector_id: input.fromCollectorId ?? null
		},
		ctx
	);
	return requireId('bond_reassign', data, ctx);
}

/**
 * Returns delivered bonds of one collector to stock (`bond.return`), with a return note as the
 * collector's receipt. Returns the note id.
 */
export async function returnBondsFromCollector(
	supabase: SupabaseClient,
	input: {
		campaignId: string;
		bondIds: string[];
		notes?: string | null;
		/** The collector the bonds were seen with: the database refuses if one moved meanwhile. */
		fromCollectorId?: string | null;
	},
	ctx: DeliveryRequestContext = {}
): Promise<string> {
	const data = await call(
		supabase,
		'bond_return',
		'bond.return',
		{
			p_campaign_id: input.campaignId,
			p_bond_ids: input.bondIds,
			p_notes: input.notes ?? null,
			p_from_collector_id: input.fromCollectorId ?? null
		},
		ctx
	);
	return requireId('bond_return', data, ctx);
}

/** Marks an available or delivered bond lost (`bond.mark_lost`); all three details are required. */
export async function markBondLost(
	supabase: SupabaseClient,
	input: {
		campaignId: string;
		bondId: string;
		responsibleParty: string;
		lostOn: string;
		reason: string;
	},
	ctx: DeliveryRequestContext = {}
): Promise<void> {
	await call(
		supabase,
		'bond_mark_lost',
		'bond.mark_lost',
		{
			p_campaign_id: input.campaignId,
			p_bond_id: input.bondId,
			p_responsible_party: input.responsibleParty,
			p_lost_on: input.lostOn,
			p_reason: input.reason
		},
		ctx
	);
}
