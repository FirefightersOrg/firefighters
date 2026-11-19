import type { SupabaseClient } from '@supabase/supabase-js';
import type { BuyerType, CollectorStatus } from '$lib/domain/parties';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import type { PermissionCode } from '$lib/server/auth/permission-codes';

/**
 * Collector and buyer writes (SAN-49). Each one calls an audited SQL function with the
 * USER-SCOPED client (`locals.supabase`): the database checks the profile and permission
 * (collector.manage / buyer.manage), validates, writes and audits in one transaction.
 *
 * Errors are thrown as `PartyServiceError` with a kind the routes map to HTTP statuses, a message
 * safe to show, and the form field it belongs to when there is one.
 */

export type PartyErrorKind = 'validation' | 'permission' | 'conflict' | 'not_found' | 'internal';

const STATUS_BY_KIND: Record<PartyErrorKind, number> = {
	validation: 400,
	permission: 403,
	not_found: 404,
	conflict: 409,
	internal: 500
};

export class PartyServiceError extends Error {
	readonly kind: PartyErrorKind;
	readonly field?: string;

	constructor(
		kind: PartyErrorKind,
		message: string,
		options?: { field?: string; cause?: unknown }
	) {
		super(message, { cause: options?.cause });
		this.name = 'PartyServiceError';
		this.kind = kind;
		this.field = options?.field;
	}

	get status(): number {
		return STATUS_BY_KIND[this.kind];
	}
}

export const PARTY_MESSAGES = {
	permission: 'You do not have permission to perform this action.',
	collectorNotFound: 'Collector not found.',
	buyerNotFound: 'Buyer not found.',
	usualCollectorNotFound: 'The usual collector no longer exists.',
	profileLinked: 'That user is already linked to another collector.',
	stale: 'Someone else changed this record. Reload it and apply your change again.',
	invalid: 'Some values are invalid. Please review the form.',
	internal: 'Something went wrong. Please try again.'
} as const;

interface PostgrestLikeError {
	code?: string;
	message: string;
}

/** Form field a database validation message belongs to. */
const FIELD_BY_MESSAGE: [RegExp, string][] = [
	[/^a display name|^display name/, 'displayName'],
	[/^email/, 'email'],
	[/^phone/, 'phone'],
	[/^address/, 'address'],
	[/collector status/, 'status'],
	[/^profile /, 'userProfileId'],
	[/buyer type/, 'type'],
	[/first or last name|^first name/, 'firstName'],
	[/^last name/, 'lastName'],
	[/business name/, 'businessName'],
	[/^document number/, 'documentNumber'],
	[/^tax id/, 'taxId'],
	[/^notes/, 'notes']
];

function sentence(message: string): string {
	const text = message.replace(/\s[0-9a-f]{8}-[0-9a-f-]{27}/gi, '');
	const s = text.charAt(0).toUpperCase() + text.slice(1);
	return /[.!?]$/.test(s) ? s : `${s}.`;
}

export function mapPartyRpcError(rpcError: PostgrestLikeError): PartyServiceError {
	const message = rpcError.message ?? '';
	const err = (kind: PartyErrorKind, text: string, field?: string) =>
		new PartyServiceError(kind, text, { field, cause: rpcError });
	switch (rpcError.code) {
		case '42501':
			return err('permission', PARTY_MESSAGES.permission);
		case '22023': {
			const field = FIELD_BY_MESSAGE.find(([re]) => re.test(message))?.[1];
			if (field === 'userProfileId') return err('validation', 'That user does not exist.', field);
			return err('validation', sentence(message), field);
		}
		case 'P0002':
			if (message.startsWith('usual collector')) {
				return err('not_found', PARTY_MESSAGES.usualCollectorNotFound, 'usualCollectorId');
			}
			if (message.startsWith('buyer')) return err('not_found', PARTY_MESSAGES.buyerNotFound);
			return err('not_found', PARTY_MESSAGES.collectorNotFound);
		case '23505':
			return err('conflict', PARTY_MESSAGES.profileLinked, 'userProfileId');
		case 'PT409':
			return err('conflict', PARTY_MESSAGES.stale);
		case '23514':
		case '23503':
		case '22P02':
			return err('validation', PARTY_MESSAGES.invalid);
		default:
			return err('internal', PARTY_MESSAGES.internal);
	}
}

export interface PartyRequestContext {
	requestId?: string | null;
	/** The request's permission list (`locals.permissions`): enables the up-front check. */
	permissions?: readonly string[] | null;
}

async function call(
	supabase: SupabaseClient,
	fn: string,
	permission: PermissionCode,
	args: Record<string, unknown>,
	ctx: PartyRequestContext
): Promise<unknown> {
	if (ctx.permissions != null && !hasPermissionIn(ctx.permissions, permission)) {
		throw new PartyServiceError('permission', PARTY_MESSAGES.permission);
	}
	let result: { data: unknown; error: PostgrestLikeError | null };
	try {
		result = await supabase.rpc(fn, { ...args, p_request_id: ctx.requestId ?? null });
	} catch (cause) {
		console.error(`[parties] ${fn} RPC threw`, { requestId: ctx.requestId, error: cause });
		throw new PartyServiceError('internal', PARTY_MESSAGES.internal, { cause });
	}
	if (result.error) {
		const mapped = mapPartyRpcError(result.error);
		if (mapped.kind === 'internal') {
			console.error(`[parties] ${fn} RPC failed`, {
				requestId: ctx.requestId,
				error: result.error
			});
		}
		throw mapped;
	}
	return result.data;
}

function requireId(fn: string, data: unknown, ctx: PartyRequestContext): string {
	if (typeof data !== 'string' || data === '') {
		console.error(`[parties] ${fn} returned no id`, { requestId: ctx.requestId, data });
		throw new PartyServiceError('internal', PARTY_MESSAGES.internal);
	}
	return data;
}

export interface CollectorInput {
	displayName: string;
	phone: string | null;
	email: string | null;
	address: string | null;
	userProfileId: string | null;
	status: CollectorStatus;
}

export interface BuyerInput {
	type: BuyerType;
	firstName: string | null;
	lastName: string | null;
	businessName: string | null;
	documentNumber: string | null;
	taxId: string | null;
	phone: string | null;
	address: string | null;
	usualCollectorId: string | null;
	notes: string | null;
}

const collectorArgs = (input: CollectorInput) => ({
	p_display_name: input.displayName,
	p_phone: input.phone,
	p_email: input.email,
	p_address: input.address,
	p_user_profile_id: input.userProfileId,
	p_status: input.status
});

const buyerArgs = (input: BuyerInput) => ({
	p_type: input.type,
	p_first_name: input.firstName,
	p_last_name: input.lastName,
	p_business_name: input.businessName,
	p_document_number: input.documentNumber,
	p_tax_id: input.taxId,
	p_phone: input.phone,
	p_address: input.address,
	p_usual_collector_id: input.usualCollectorId,
	p_notes: input.notes
});

/** Creates a collector (`collector.manage`). Returns its id. */
export async function createCollector(
	supabase: SupabaseClient,
	input: CollectorInput,
	ctx: PartyRequestContext = {}
): Promise<string> {
	const data = await call(
		supabase,
		'collector_create',
		'collector.manage',
		collectorArgs(input),
		ctx
	);
	return requireId('collector_create', data, ctx);
}

/**
 * Replaces a collector's fields (`collector.manage`). `expectedUpdatedAt` is the `updatedAt` the
 * form was loaded with (stale → conflict). Returns false when nothing changed.
 */
export async function updateCollector(
	supabase: SupabaseClient,
	id: string,
	input: CollectorInput,
	expectedUpdatedAt: string,
	ctx: PartyRequestContext = {}
): Promise<boolean> {
	const data = await call(
		supabase,
		'collector_update',
		'collector.manage',
		{ p_id: id, ...collectorArgs(input), p_expected_updated_at: expectedUpdatedAt },
		ctx
	);
	return data === true;
}

/** Creates a buyer (`buyer.manage`). Returns its id. */
export async function createBuyer(
	supabase: SupabaseClient,
	input: BuyerInput,
	ctx: PartyRequestContext = {}
): Promise<string> {
	const data = await call(supabase, 'buyer_create', 'buyer.manage', buyerArgs(input), ctx);
	return requireId('buyer_create', data, ctx);
}

/** Replaces a buyer's fields (`buyer.manage`, optimistic concurrency). False when unchanged. */
export async function updateBuyer(
	supabase: SupabaseClient,
	id: string,
	input: BuyerInput,
	expectedUpdatedAt: string,
	ctx: PartyRequestContext = {}
): Promise<boolean> {
	const data = await call(
		supabase,
		'buyer_update',
		'buyer.manage',
		{ p_id: id, ...buyerArgs(input), p_expected_updated_at: expectedUpdatedAt },
		ctx
	);
	return data === true;
}
