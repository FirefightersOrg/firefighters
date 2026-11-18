import type { SupabaseClient } from '@supabase/supabase-js';
import { CAMPAIGN_STATUS_LABELS, type CampaignStatus } from '$lib/domain/campaigns';
import { compileBarcodePattern } from '$lib/domain/barcodes';
import {
	IMPORT_BATCH_MAX_ROWS,
	IMPORT_SESSION_STATUSES,
	IMPORT_SOURCE_TYPES,
	ImportFileError,
	interpretImportRow,
	type ImportSessionStatus,
	type ImportSourceType,
	type ImportSummary
} from '$lib/domain/imports';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import type { PermissionCode } from '$lib/server/auth/permission-codes';
import { parseImportFile } from '$lib/server/imports/parse-file';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import type {
	ImportAddItemsInput,
	ImportAddScanInput,
	ImportCancelSessionInput,
	ImportRemoveItemInput,
	ImportSessionCreateInput,
	StagedImportRowInput
} from '$lib/schemas/import';

/**
 * Import staging use cases (SAN-45). Every write calls one audited `import_session_*` SQL function
 * (migration `20261126000000_import_staging.sql`) with the USER-SCOPED client, so the database
 * checks the caller's active profile and permission (`bond.scan` for scan sessions, `bond.import`
 * for file imports), locks the session and the campaign, stages / revalidates and writes the
 * `audit_log` row in one transaction. Every function returns the session summary
 * (`import_session_summary`). No bonds are created here: confirmation is SAN-47.
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
	itemRemoved: 'This row was already removed.',
	itemLinked: 'This row already created a bond and cannot be changed.',
	notScanSession: 'Scans can only be added to a barcode scan session.',
	duplicateRow: 'A row number of the file is already staged in this session.'
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
			if (/already used in this session/.test(message)) {
				return err('conflict', IMPORT_MESSAGES.duplicateRow);
			}
			return err('validation', sentence(message));
		case '55000': {
			const window = /while the campaign is draft or active \(status: (\w+)\)/.exec(message);
			if (window) {
				const label =
					CAMPAIGN_STATUS_LABELS[window[1] as CampaignStatus]?.toLowerCase() ?? window[1];
				return err('conflict', `${IMPORT_MESSAGES.campaignLocked} This campaign is ${label}.`);
			}
			if (
				/^import session \S+ is \w+ and cannot be changed/.test(message) ||
				/^items (cannot be added to|of) a \w+ import session/.test(message)
			) {
				return err('conflict', IMPORT_MESSAGES.sessionClosed);
			}
			if (/was already removed|was removed and cannot be changed/.test(message)) {
				return err('conflict', IMPORT_MESSAGES.itemRemoved);
			}
			if (/is linked to a bond/.test(message)) return err('conflict', IMPORT_MESSAGES.itemLinked);
			if (/^scans can only be added to a barcode_scan session/.test(message)) {
				return err('conflict', IMPORT_MESSAGES.notScanSession);
			}
			return err('conflict', sentence(message));
		}
		case '23505':
			return err('conflict', IMPORT_MESSAGES.duplicateRow);
		case '23514':
		case '23503':
		case '23502':
		case '23001':
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

function requirePermission(ctx: ImportRequestContext, permission: PermissionCode | null) {
	if (permission && ctx.permissions != null && !hasPermissionIn(ctx.permissions, permission)) {
		throw new ImportServiceError('permission', IMPORT_MESSAGES.permission);
	}
}

async function callImportRpc(
	supabase: SupabaseClient,
	fn: string,
	permission: PermissionCode | null,
	args: Record<string, unknown>,
	ctx: ImportRequestContext
): Promise<unknown> {
	requirePermission(ctx, permission);
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
			console.error(`[imports] ${fn} RPC failed`, {
				requestId: ctx.requestId,
				error: result.error
			});
		}
		throw mapped;
	}
	return result.data;
}

function unexpected(fn: string, data: unknown, ctx: ImportRequestContext): never {
	console.error(`[imports] ${fn} returned an unexpected value`, { requestId: ctx.requestId, data });
	throw new ImportServiceError('internal', IMPORT_MESSAGES.internal);
}

/** `import_session_summary` (+ `validated` from `import_session_validate`), camelCase. */
export interface ImportSessionSummary extends ImportSummary {
	sessionId: string;
	campaignId: string;
	sourceType: ImportSourceType;
	fileName: string | null;
	status: ImportSessionStatus;
	/** Every row ever staged (live + removed). */
	items: number;
	removedItems: number;
	/** Only from `import_session_validate`: whether this call moved the session to validated. */
	validated?: boolean;
}

const SUMMARY_COUNTS: Record<
	Exclude<
		keyof ImportSessionSummary,
		'sessionId' | 'campaignId' | 'sourceType' | 'fileName' | 'status' | 'valid' | 'validated'
	>,
	string
> = {
	items: 'items',
	liveItems: 'live_items',
	removedItems: 'removed_items',
	simpleItems: 'simple_items',
	pataRows: 'pata_rows',
	pataGroups: 'pata_groups',
	errors: 'errors',
	warnings: 'warnings',
	pending: 'pending',
	duplicates: 'duplicates',
	baseNumbers: 'base_numbers',
	participatingNumbers: 'participating_numbers'
};

/** Maps the jsonb summary of the `import_session_*` functions; `null` when it is malformed. */
export function mapImportSummary(data: unknown): ImportSessionSummary | null {
	if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
	const raw = data as Record<string, unknown>;
	const { session_id, campaign_id, source_type, file_name, status, valid, validated } = raw;
	if (
		typeof session_id !== 'string' ||
		typeof campaign_id !== 'string' ||
		typeof source_type !== 'string' ||
		!(IMPORT_SOURCE_TYPES as readonly string[]).includes(source_type) ||
		(file_name !== null && typeof file_name !== 'string') ||
		typeof status !== 'string' ||
		!(IMPORT_SESSION_STATUSES as readonly string[]).includes(status) ||
		typeof valid !== 'boolean' ||
		(validated !== undefined && typeof validated !== 'boolean')
	) {
		return null;
	}
	const summary = {
		sessionId: session_id,
		campaignId: campaign_id,
		sourceType: source_type as ImportSourceType,
		fileName: file_name as string | null,
		status: status as ImportSessionStatus,
		valid
	} as ImportSessionSummary;
	for (const [key, column] of Object.entries(SUMMARY_COUNTS) as [
		keyof typeof SUMMARY_COUNTS,
		string
	][]) {
		const value = raw[column];
		if (typeof value !== 'number') return null;
		summary[key] = value;
	}
	if (validated !== undefined) summary.validated = validated;
	return summary;
}

function summaryOf(fn: string, data: unknown, ctx: ImportRequestContext): ImportSessionSummary {
	return mapImportSummary(data) ?? unexpected(fn, data, ctx);
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

/** A staged row as the `import_session_add_items` JSON object. */
export function toRpcRow(row: StagedImportRowInput): Record<string, unknown> {
	return {
		row_number: row.rowNumber,
		raw_value: row.rawValue,
		parsed_value: row.parsedValue ?? {},
		barcode: row.barcode,
		item_type: row.itemType,
		group_key: row.groupKey,
		base_number: row.baseNumber,
		error_code: row.errorCode,
		error_message: row.errorMessage
	};
}

/**
 * Stages interpreted file rows, IMPORT_BATCH_MAX_ROWS per call (each call is its own transaction
 * and `import.stage` audit row; the database revalidates the whole session every time). Returns
 * the summary after the last batch.
 */
export async function addImportItems(
	supabase: SupabaseClient,
	input: ImportAddItemsInput,
	ctx: ImportRequestContext = {}
): Promise<ImportSessionSummary> {
	let data: unknown = null;
	for (let from = 0; from < input.rows.length; from += IMPORT_BATCH_MAX_ROWS) {
		data = await callImportRpc(
			supabase,
			'import_session_add_items',
			'bond.import',
			{
				p_session_id: input.sessionId,
				p_rows: input.rows.slice(from, from + IMPORT_BATCH_MAX_ROWS).map(toRpcRow),
				p_request_id: ctx.requestId ?? null
			},
			ctx
		);
	}
	return summaryOf('import_session_add_items', data, ctx);
}

/**
 * Stages one scan (row number = next in the session). The database reads the base number from the
 * code per the campaign `barcode_mode`; `baseNumber` is the typed number for manual mapping.
 */
export async function addScanItem(
	supabase: SupabaseClient,
	input: ImportAddScanInput,
	ctx: ImportRequestContext = {}
): Promise<ImportSessionSummary> {
	const data = await callImportRpc(
		supabase,
		'import_session_add_scan',
		'bond.scan',
		{
			p_session_id: input.sessionId,
			p_barcode: input.barcode,
			p_group_key: input.groupKey,
			p_base_number: input.baseNumber,
			p_raw_value: input.rawValue,
			p_request_id: ctx.requestId ?? null
		},
		ctx
	);
	return summaryOf('import_session_add_scan', data, ctx);
}

/** Soft-removes an item (kept as history) and revalidates the session. */
export async function removeImportItem(
	supabase: SupabaseClient,
	input: ImportRemoveItemInput,
	ctx: ImportRequestContext = {}
): Promise<ImportSessionSummary> {
	const data = await callImportRpc(
		supabase,
		'import_session_remove_item',
		null,
		{ p_item_id: input.itemId, p_reason: input.reason, p_request_id: ctx.requestId ?? null },
		ctx
	);
	return summaryOf('import_session_remove_item', data, ctx);
}

/** Cancels a draft or validated session. */
export async function cancelImportSession(
	supabase: SupabaseClient,
	input: ImportCancelSessionInput,
	ctx: ImportRequestContext = {}
): Promise<ImportSessionSummary> {
	const data = await callImportRpc(
		supabase,
		'import_session_cancel',
		null,
		{ p_session_id: input.sessionId, p_reason: input.reason, p_request_id: ctx.requestId ?? null },
		ctx
	);
	return summaryOf('import_session_cancel', data, ctx);
}

/**
 * Re-runs every check in the database against the live campaign data (plus the pata group sizes)
 * and moves the session to `validated` when no row is pending or in error (`validated: true`).
 */
export async function validateImportSession(
	supabase: SupabaseClient,
	sessionId: string,
	ctx: ImportRequestContext = {}
): Promise<ImportSessionSummary> {
	const data = await callImportRpc(
		supabase,
		'import_session_validate',
		null,
		{ p_session_id: sessionId, p_request_id: ctx.requestId ?? null },
		ctx
	);
	return summaryOf('import_session_validate', data, ctx);
}

/** Reads the summary of a session (`bond.import` or `bond.scan`). */
export async function getImportSessionSummary(
	supabase: SupabaseClient,
	sessionId: string,
	ctx: ImportRequestContext = {}
): Promise<ImportSessionSummary> {
	const data = await callImportRpc(
		supabase,
		'import_session_summary',
		null,
		{ p_session_id: sessionId },
		ctx
	);
	return summaryOf('import_session_summary', data, ctx);
}

export interface StagedImportFile extends ImportSessionSummary {
	rowCount: number;
}

/**
 * Upload flow: parses the CSV / .xlsx file, interprets each row with the campaign's barcode rules
 * (`interpretImportRow`), creates the session, stages every row and validates. A file that
 * cannot be read throws a `validation` error with `fileErrorCode` before anything is written. If
 * staging fails after the session was created, the session is left as a draft (the caller can
 * cancel it).
 */
export async function stageImportFile(
	supabase: SupabaseClient,
	input: { campaignId: string; fileName: string; bytes: Uint8Array; notes?: string | null },
	ctx: ImportRequestContext = {}
): Promise<StagedImportFile> {
	requirePermission(ctx, 'bond.import');
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

	const campaign = await getCampaignById(supabase, input.campaignId);
	if (campaign.error) {
		console.error('[imports] campaign read failed', {
			requestId: ctx.requestId,
			error: campaign.error
		});
		throw new ImportServiceError('internal', IMPORT_MESSAGES.internal, { cause: campaign.error });
	}
	const rules = campaign.data;
	if (!rules) throw new ImportServiceError('not_found', IMPORT_MESSAGES.campaignNotFound);
	const compiled = compileBarcodePattern(rules.barcodePattern);
	const rows = parsed.rows.map((row) => interpretImportRow(row, rules, compiled));

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
	await addImportItems(supabase, { sessionId, rows }, ctx);
	const summary = await validateImportSession(supabase, sessionId, ctx);
	return { ...summary, rowCount: parsed.rows.length };
}
