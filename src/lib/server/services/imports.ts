import type { SupabaseClient } from '@supabase/supabase-js';
import { CAMPAIGN_STATUS_LABELS, type CampaignStatus } from '$lib/domain/campaigns';
import {
	IMPORT_SESSION_STATUSES,
	ImportFileError,
	type ImportSessionStatus,
	type ImportSummary
} from '$lib/domain/imports';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import type { PermissionCode } from '$lib/server/auth/permission-codes';
import { parseImportFile } from '$lib/server/imports/parse-file';
import type {
	ImportAddItemsInput,
	ImportAddScanInput,
	ImportCancelSessionInput,
	ImportRawItemInput,
	ImportRemoveItemInput,
	ImportSessionCreateInput,
	ImportUpdateItemInput
} from '$lib/schemas/import';

/**
 * Import staging use cases (SAN-45). Every write calls one audited `import_session_*` SQL function
 * with the USER-SCOPED client, so the database checks the caller's active profile and permission
 * (`bond.scan` for scan sessions, `bond.import` for file imports), locks the session and the
 * campaign, validates and writes the change plus its `audit_log` row in one transaction
 * (migration `20261126000000_import_staging_rpcs.sql`). No bonds are created here: confirmation
 * is SAN-47.
 *
 * Errors are thrown as `ImportServiceError` with a kind the routes map to HTTP statuses and a
 * message that is safe to show (file problems carry `fileErrorCode`).
 */

export type ImportErrorKind = 'validation' | 'permission' | 'conflict' | 'not_found' | 'internal';

const STATUS_BY_KIND: Record<ImportErrorKind, number> = {
	validation: 400,
	permission: 403,
	not_found: 404,
	conflict: 409,
	internal: 500
};

export class ImportServiceError extends Error {
	readonly kind: ImportErrorKind;
	/** Set when the uploaded file itself could not be read. */
	readonly fileErrorCode?: ImportFileError['code'];

	constructor(
		kind: ImportErrorKind,
		message: string,
		options?: { cause?: unknown; fileErrorCode?: ImportFileError['code'] }
	) {
		super(message, { cause: options?.cause });
		this.name = 'ImportServiceError';
		this.kind = kind;
		this.fileErrorCode = options?.fileErrorCode;
	}

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

export const IMPORT_MESSAGES = {
	permission: 'You do not have permission to perform this action.',
	campaignNotFound: 'Campaign not found.',
	sessionNotFound: 'Import session not found.',
	itemNotFound: 'Import row not found.',
	internal: 'Something went wrong. Please try again.',
	invalid: 'Some values are invalid. Please review them.',
	campaignLocked: 'Bonds can only be imported while the campaign is a draft or active.',
	sessionClosed: 'This import session is closed and can no longer be changed.',
	itemRemoved: 'This row was removed and can no longer be changed.',
	nothingToValidate: 'Add at least one row before validating.'
} as const;

function sentence(message: string): string {
	const text = message.charAt(0).toUpperCase() + message.slice(1);
	return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Maps a PostgREST/Postgres error from an `import_session_*` function. */
export function mapImportRpcError(rpcError: PostgrestLikeError): ImportServiceError {
	const message = rpcError.message ?? '';
	const err = (kind: ImportErrorKind, text: string) =>
		new ImportServiceError(kind, text, { cause: rpcError });

	switch (rpcError.code) {
		case '42501':
			return err('permission', IMPORT_MESSAGES.permission);
		case 'P0002':
			if (message.startsWith('campaign')) return err('not_found', IMPORT_MESSAGES.campaignNotFound);
			if (message.startsWith('import session item'))
				return err('not_found', IMPORT_MESSAGES.itemNotFound);
			return err('not_found', IMPORT_MESSAGES.sessionNotFound);
		case '22023':
			return err('validation', sentence(message));
		case '55000': {
			const window = /while the campaign is draft or active \(status: (\w+)\)/.exec(message);
			if (window) {
				const label =
					CAMPAIGN_STATUS_LABELS[window[1] as CampaignStatus]?.toLowerCase() ?? window[1];
				return err('conflict', `${IMPORT_MESSAGES.campaignLocked} This campaign is ${label}.`);
			}
			if (/^import session \S+ is \w+ and cannot be changed/.test(message)) {
				return err('conflict', IMPORT_MESSAGES.sessionClosed);
			}
			if (/was removed and cannot be changed/.test(message)) {
				return err('conflict', IMPORT_MESSAGES.itemRemoved);
			}
			if (/has no items to validate/.test(message)) {
				return err('conflict', IMPORT_MESSAGES.nothingToValidate);
			}
			return err('conflict', sentence(message));
		}
		case '23514':
		case '23503':
		case '23502':
		case '23505':
		case '22P02':
		case '22003':
			return err('validation', IMPORT_MESSAGES.invalid);
		default:
			return err('internal', IMPORT_MESSAGES.internal);
	}
}

export interface ImportRequestContext {
	requestId?: string | null;
	/** The request's permission list (`locals.permissions`): enables the up-front check. */
	permissions?: readonly string[] | null;
}

async function callImportRpc(
	supabase: SupabaseClient,
	fn: string,
	permission: PermissionCode | null,
	args: Record<string, unknown>,
	ctx: ImportRequestContext
): Promise<unknown> {
	if (
		permission &&
		ctx.permissions !== undefined &&
		ctx.permissions !== null &&
		!hasPermissionIn(ctx.permissions, permission)
	) {
		throw new ImportServiceError('permission', IMPORT_MESSAGES.permission);
	}
	let result: { data: unknown; error: PostgrestLikeError | null };
	try {
		result = await supabase.rpc(fn, args);
	} catch (cause) {
		console.error(`[imports] ${fn} RPC threw`, { requestId: ctx.requestId, error: cause });
		throw new ImportServiceError('internal', IMPORT_MESSAGES.internal, { cause });
	}
	if (result.error) {
		const mapped = mapImportRpcError(result.error);
		if (mapped.kind === 'internal') {
			console.error(`[imports] ${fn} RPC failed`, { requestId: ctx.requestId, error: result.error });
		}
		throw mapped;
	}
	return result.data;
}

function unexpected(fn: string, data: unknown, ctx: ImportRequestContext): never {
	console.error(`[imports] ${fn} returned an unexpected value`, { requestId: ctx.requestId, data });
	throw new ImportServiceError('internal', IMPORT_MESSAGES.internal);
}

/** The raw fields as the SQL functions take them. */
export function toRpcFields(item: ImportRawItemInput): Record<string, string | null> {
	return {
		tipo_bono: item.tipoBono,
		grupo_pata: item.grupoPata,
		numero_base: item.numeroBase,
		barcode: item.barcode
	};
}

/** Creates a draft session (`bond.scan` for scans, `bond.import` for files). Returns its id. */
export async function createImportSession(
	supabase: SupabaseClient,
	input: ImportSessionCreateInput,
	ctx: ImportRequestContext = {}
): Promise<string> {
	const data = await callImportRpc(
		supabase,
		'import_session_create',
		input.sourceType === 'barcode_scan' ? 'bond.scan' : 'bond.import',
		{
			p_campaign_id: input.campaignId,
			p_source_type: input.sourceType,
			p_file_name: input.fileName,
			p_notes: input.notes,
			p_request_id: ctx.requestId ?? null
		},
		ctx
	);
	if (typeof data !== 'string' || data === '') unexpected('import_session_create', data, ctx);
	return data;
}

/** Stages file rows in bulk (pending until validated). Returns how many were added. */
export async function addImportItems(
	supabase: SupabaseClient,
	input: ImportAddItemsInput,
	ctx: ImportRequestContext = {}
): Promise<number> {
	const data = await callImportRpc(
		supabase,
		'import_session_add_items',
		'bond.import',
		{
			p_session_id: input.sessionId,
			p_items: input.items.map((item) => ({
				row_number: item.rowNumber,
				raw: item.raw,
				...toRpcFields(item)
			})),
			p_request_id: ctx.requestId ?? null
		},
		ctx
	);
	if (typeof data !== 'number') unexpected('import_session_add_items', data, ctx);
	return data;
}

/** Stages one scan (row number = next in the session). Returns the item id. */
export async function addScanItem(
	supabase: SupabaseClient,
	input: ImportAddScanInput,
	ctx: ImportRequestContext = {}
): Promise<string> {
	const data = await callImportRpc(
		supabase,
		'import_session_add_scan',
		'bond.scan',
		{ p_session_id: input.sessionId, p_item: toRpcFields(input), p_request_id: ctx.requestId ?? null },
		ctx
	);
	if (typeof data !== 'string' || data === '') unexpected('import_session_add_scan', data, ctx);
	return data;
}

/** Corrects an item's raw fields (back to pending). `false` when nothing changed. */
export async function updateImportItem(
	supabase: SupabaseClient,
	input: ImportUpdateItemInput,
	ctx: ImportRequestContext = {}
): Promise<boolean> {
	const data = await callImportRpc(
		supabase,
		'import_session_update_item',
		null,
		{ p_item_id: input.itemId, p_item: toRpcFields(input), p_request_id: ctx.requestId ?? null },
		ctx
	);
	if (typeof data !== 'boolean') unexpected('import_session_update_item', data, ctx);
	return data;
}

/** Soft-removes an item (kept as history). */
export async function removeImportItem(
	supabase: SupabaseClient,
	input: ImportRemoveItemInput,
	ctx: ImportRequestContext = {}
): Promise<void> {
	await callImportRpc(
		supabase,
		'import_session_remove_item',
		null,
		{ p_item_id: input.itemId, p_reason: input.reason, p_request_id: ctx.requestId ?? null },
		ctx
	);
}

/** Cancels a draft or validated session. */
export async function cancelImportSession(
	supabase: SupabaseClient,
	input: ImportCancelSessionInput,
	ctx: ImportRequestContext = {}
): Promise<void> {
	await callImportRpc(
		supabase,
		'import_session_cancel',
		null,
		{ p_session_id: input.sessionId, p_reason: input.reason, p_request_id: ctx.requestId ?? null },
		ctx
	);
}

export interface ImportValidationResult {
	/** `validated` when nothing is blocking, otherwise `draft`. */
	status: ImportSessionStatus;
	summary: ImportSummary;
}

const SUMMARY_KEYS: Record<keyof ImportSummary, string> = {
	totalItems: 'total_items',
	valid: 'valid',
	warnings: 'warnings',
	errors: 'errors',
	pending: 'pending',
	simpleBonds: 'simple_bonds',
	patas: 'patas',
	baseNumbers: 'base_numbers',
	participatingNumbers: 'participating_numbers',
	duplicates: 'duplicates'
};

export function mapValidationResult(data: unknown): ImportValidationResult | null {
	if (!data || typeof data !== 'object') return null;
	const raw = data as Record<string, unknown>;
	const status = raw.status;
	if (typeof status !== 'string' || !(IMPORT_SESSION_STATUSES as readonly string[]).includes(status)) {
		return null;
	}
	const summary = {} as ImportSummary;
	for (const [key, column] of Object.entries(SUMMARY_KEYS) as [keyof ImportSummary, string][]) {
		const value = raw[column];
		if (typeof value !== 'number') return null;
		summary[key] = value;
	}
	return { status: status as ImportSessionStatus, summary };
}

/**
 * Re-runs every check in the database against the live campaign data, writes each item's
 * status / error and moves the session to `validated` when nothing is blocking.
 */
export async function validateImportSession(
	supabase: SupabaseClient,
	sessionId: string,
	ctx: ImportRequestContext = {}
): Promise<ImportValidationResult> {
	const data = await callImportRpc(
		supabase,
		'import_session_validate',
		null,
		{ p_session_id: sessionId, p_request_id: ctx.requestId ?? null },
		ctx
	);
	return mapValidationResult(data) ?? unexpected('import_session_validate', data, ctx);
}

export interface StagedImportFile extends ImportValidationResult {
	sessionId: string;
	rowCount: number;
}

/**
 * Upload flow: parses the CSV / .xlsx file, creates the session, stages every row and validates
 * it. A file that cannot be read throws a `validation` error with `fileErrorCode` before anything
 * is written. If staging fails after the session was created, the session is left as a draft
 * (the caller can cancel it).
 */
export async function stageImportFile(
	supabase: SupabaseClient,
	input: { campaignId: string; fileName: string; bytes: Uint8Array; notes?: string | null },
	ctx: ImportRequestContext = {}
): Promise<StagedImportFile> {
	if (ctx.permissions != null && !hasPermissionIn(ctx.permissions, 'bond.import')) {
		throw new ImportServiceError('permission', IMPORT_MESSAGES.permission);
	}
	let parsed;
	try {
		parsed = await parseImportFile({ name: input.fileName, bytes: input.bytes });
	} catch (err) {
		if (err instanceof ImportFileError) {
			throw new ImportServiceError('validation', sentence(err.message), {
				cause: err,
				fileErrorCode: err.code
			});
		}
		throw err;
	}
	const sessionId = await createImportSession(
		supabase,
		{
			campaignId: input.campaignId,
			sourceType: parsed.sourceType,
			fileName: input.fileName.trim().slice(0, 255),
			notes: input.notes?.trim() || null
		},
		ctx
	);
	await addImportItems(
		supabase,
		{
			sessionId,
			items: parsed.rows.map((row) => ({
				rowNumber: row.rowNumber,
				raw: row.raw,
				tipoBono: row.tipoBono,
				grupoPata: row.grupoPata,
				numeroBase: row.numeroBase,
				barcode: row.barcode
			}))
		},
		ctx
	);
	const result = await validateImportSession(supabase, sessionId, ctx);
	return { sessionId, rowCount: parsed.rows.length, ...result };
}
