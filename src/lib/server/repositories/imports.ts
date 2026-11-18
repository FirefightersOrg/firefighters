import type { SupabaseClient } from '@supabase/supabase-js';
import {
	IMPORT_ITEM_STATUSES,
	IMPORT_SESSION_STATUSES,
	IMPORT_SOURCE_TYPES,
	type ExistingCampaignData,
	type ImportBatchItem,
	type ImportItemStatus,
	type ImportRawItem,
	type ImportSessionStatus,
	type ImportSourceType
} from '$lib/domain/imports';
import type { BondKind } from '$lib/domain/bonds';
import type { RepositoryResult } from './campaigns';
import { listBondNumbersByCampaign } from './bonds';

/**
 * Read access to `public.import_sessions` / `public.import_session_items` under the caller's RLS
 * (`bond.import` or `bond.scan`). Writes go through the audited `import_session_*` SQL functions
 * (services/imports.ts).
 */
const PAGE_SIZE = 1000;

export const IMPORT_SESSION_COLUMNS = [
	'id',
	'campaign_id',
	'source_type',
	'status',
	'file_name',
	'notes',
	'created_by',
	'created_at',
	'updated_at',
	'validated_at',
	'confirmed_at',
	'cancelled_at',
	'cancel_reason',
	'failed_at',
	'failure_reason',
	'rolled_back_at',
	'rollback_reason'
].join(', ');

export interface ImportSessionRow {
	id: string;
	campaign_id: string;
	source_type: string;
	status: string;
	file_name: string | null;
	notes: string | null;
	created_by: string;
	created_at: string;
	updated_at: string;
	validated_at: string | null;
	confirmed_at: string | null;
	cancelled_at: string | null;
	cancel_reason: string | null;
	failed_at: string | null;
	failure_reason: string | null;
	rolled_back_at: string | null;
	rollback_reason: string | null;
}

export interface ImportSession {
	id: string;
	campaignId: string;
	sourceType: ImportSourceType;
	status: ImportSessionStatus;
	fileName: string | null;
	notes: string | null;
	createdBy: string;
	createdAt: string;
	updatedAt: string;
	validatedAt: string | null;
	confirmedAt: string | null;
	cancelledAt: string | null;
	cancelReason: string | null;
	failedAt: string | null;
	failureReason: string | null;
	rolledBackAt: string | null;
	rollbackReason: string | null;
}

export const IMPORT_ITEM_COLUMNS = [
	'id',
	'import_session_id',
	'row_number',
	'raw_value',
	'parsed_value',
	'barcode',
	'item_type',
	'group_key',
	'base_number',
	'status',
	'error_code',
	'error_message',
	'created_bond_id',
	'removed_at',
	'removed_by',
	'remove_reason'
].join(', ');

export interface ImportItemRow {
	id: string;
	import_session_id: string;
	row_number: number;
	raw_value: string;
	parsed_value: Record<string, unknown> | null;
	barcode: string | null;
	item_type: string | null;
	group_key: string | null;
	base_number: number | null;
	status: string;
	error_code: string | null;
	error_message: string | null;
	created_bond_id: string | null;
	removed_at: string | null;
	removed_by: string | null;
	remove_reason: string | null;
}

export interface ImportItem {
	id: string;
	sessionId: string;
	rowNumber: number;
	rawValue: string;
	/** The raw file fields (`parsed_value`; scans only carry `barcode`). */
	fields: ImportRawItem;
	barcode: string | null;
	itemType: BondKind | null;
	groupKey: string | null;
	baseNumber: number | null;
	status: ImportItemStatus;
	errorCode: string | null;
	errorMessage: string | null;
	createdBondId: string | null;
	removedAt: string | null;
	removedBy: string | null;
	removeReason: string | null;
}

function oneOf<T extends string>(allowed: readonly T[], value: string, column: string): T {
	if (!(allowed as readonly string[]).includes(value)) {
		throw new Error(`Unexpected ${column} value: ${value}`);
	}
	return value as T;
}

export function mapImportSessionRow(row: ImportSessionRow): ImportSession {
	return {
		id: row.id,
		campaignId: row.campaign_id,
		sourceType: oneOf(IMPORT_SOURCE_TYPES, row.source_type, 'import_sessions.source_type'),
		status: oneOf(IMPORT_SESSION_STATUSES, row.status, 'import_sessions.status'),
		fileName: row.file_name,
		notes: row.notes,
		createdBy: row.created_by,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		validatedAt: row.validated_at,
		confirmedAt: row.confirmed_at,
		cancelledAt: row.cancelled_at,
		cancelReason: row.cancel_reason,
		failedAt: row.failed_at,
		failureReason: row.failure_reason,
		rolledBackAt: row.rolled_back_at,
		rollbackReason: row.rollback_reason
	};
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export function mapImportItemRow(row: ImportItemRow): ImportItem {
	const parsed = row.parsed_value ?? {};
	return {
		id: row.id,
		sessionId: row.import_session_id,
		rowNumber: row.row_number,
		rawValue: row.raw_value,
		fields: {
			tipoBono: text(parsed.tipo_bono),
			grupoPata: text(parsed.grupo_pata),
			numeroBase: text(parsed.numero_base),
			barcode: text(parsed.barcode)
		},
		barcode: row.barcode,
		itemType:
			row.item_type === null
				? null
				: oneOf<BondKind>(['simple', 'pata'], row.item_type, 'import_session_items.item_type'),
		groupKey: row.group_key,
		baseNumber: row.base_number,
		status: oneOf(IMPORT_ITEM_STATUSES, row.status, 'import_session_items.status'),
		errorCode: row.error_code,
		errorMessage: row.error_message,
		createdBondId: row.created_bond_id,
		removedAt: row.removed_at,
		removedBy: row.removed_by,
		removeReason: row.remove_reason
	};
}

/** One session, or `data: null` when it does not exist or is not visible to the caller. */
export async function getImportSession(
	supabase: SupabaseClient,
	id: string
): Promise<RepositoryResult<ImportSession | null>> {
	const { data, error } = await supabase
		.from('import_sessions')
		.select(IMPORT_SESSION_COLUMNS)
		.eq('id', id)
		.maybeSingle()
		.overrideTypes<ImportSessionRow | null, { merge: false }>();
	if (error) return { data: null, error };
	try {
		return { data: data ? mapImportSessionRow(data) : null, error: null };
	} catch (err) {
		return { data: null, error: err as Error };
	}
}

/** Items of a session by row number; live only unless `includeRemoved`. Pages past the limit. */
export async function listImportItems(
	supabase: SupabaseClient,
	sessionId: string,
	options: { includeRemoved?: boolean } = {}
): Promise<RepositoryResult<ImportItem[]>> {
	const rows: ImportItemRow[] = [];
	for (let from = 0; ; from += PAGE_SIZE) {
		let query = supabase
			.from('import_session_items')
			.select(IMPORT_ITEM_COLUMNS)
			.eq('import_session_id', sessionId);
		if (!options.includeRemoved) query = query.is('removed_at', null);
		const { data, error } = await query
			.order('row_number', { ascending: true })
			.range(from, from + PAGE_SIZE - 1)
			.overrideTypes<ImportItemRow[], { merge: false }>();
		if (error) return { data: null, error };
		const page = data ?? [];
		rows.push(...page);
		if (page.length < PAGE_SIZE) break;
	}
	try {
		return { data: rows.map(mapImportItemRow), error: null };
	} catch (err) {
		return { data: null, error: err as Error };
	}
}

async function pagedCodes(
	supabase: SupabaseClient,
	table: 'bonds' | 'bond_numbers',
	campaignId: string
): Promise<RepositoryResult<[string, string][]>> {
	const out: [string, string][] = [];
	for (let from = 0; ; from += PAGE_SIZE) {
		let query = supabase
			.from(table)
			.select(
				table === 'bonds'
					? 'id, barcode, commercial_status, annulled_from_status'
					: 'bond_id, barcode'
			)
			.eq('campaign_id', campaignId)
			.not('barcode', 'is', null);
		if (table === 'bond_numbers') query = query.is('released_at', null);
		const { data, error } = await query
			.order('barcode', { ascending: true })
			.range(from, from + PAGE_SIZE - 1)
			.overrideTypes<Record<string, string | null>[], { merge: false }>();
		if (error) return { data: null, error };
		const page = data ?? [];
		for (const row of page) {
			if (table === 'bonds') {
				// Live: not annulled from available (same predicate as the unique index).
				if (row.commercial_status === 'annulled' && row.annulled_from_status === 'available')
					continue;
				out.push([row.barcode as string, row.id as string]);
			} else {
				out.push([row.barcode as string, row.bond_id as string]);
			}
		}
		if (page.length < PAGE_SIZE) break;
	}
	return { data: out, error: null };
}

/** Live items → the client validator's input (`validateImportBatch`). */
export function importItemsToBatch(items: readonly ImportItem[]): ImportBatchItem[] {
	return items
		.filter((i) => i.removedAt === null)
		.map((i) => ({
			key: i.id,
			rowNumber: i.rowNumber,
			itemType: i.itemType,
			groupKey: i.groupKey,
			baseNumber: i.baseNumber,
			barcode: i.barcode,
			errorCode: i.errorCode,
			errorMessage: i.errorMessage
		}));
}

/**
 * Live participating numbers and codes of a campaign, for the client-side validator
 * (`validateImportBatch`). Under RLS this needs `bond.view`. The database re-checks on validation.
 */
export async function getExistingCampaignData(
	supabase: SupabaseClient,
	campaignId: string
): Promise<RepositoryResult<ExistingCampaignData>> {
	const numbers = await listBondNumbersByCampaign(supabase, campaignId);
	if (numbers.error) return { data: null, error: numbers.error };
	const bondCodes = await pagedCodes(supabase, 'bonds', campaignId);
	if (bondCodes.error) return { data: null, error: bondCodes.error };
	const numberCodes = await pagedCodes(supabase, 'bond_numbers', campaignId);
	if (numberCodes.error) return { data: null, error: numberCodes.error };
	return {
		data: {
			numbers: new Map(numbers.data.map((n) => [n.numberValue, n.bondId])),
			barcodes: new Map([...bondCodes.data, ...numberCodes.data])
		},
		error: null
	};
}

// ---------------------------------------------------------------------------
// SAN-46: session history and scan feedback
// ---------------------------------------------------------------------------

/** Sessions listed on the import and scan pages (newest first). */
export const IMPORT_SESSION_LIST_LIMIT = 50;

/** The latest sessions of a campaign, of the given sources (newest first). */
export async function listImportSessions(
	supabase: SupabaseClient,
	campaignId: string,
	sources: readonly ImportSourceType[] = IMPORT_SOURCE_TYPES
): Promise<RepositoryResult<ImportSession[]>> {
	const { data, error } = await supabase
		.from('import_sessions')
		.select(IMPORT_SESSION_COLUMNS)
		.eq('campaign_id', campaignId)
		.in('source_type', [...sources])
		.order('created_at', { ascending: false })
		.order('id', { ascending: true })
		.limit(IMPORT_SESSION_LIST_LIMIT)
		.overrideTypes<ImportSessionRow[], { merge: false }>();
	if (error) return { data: null, error };
	try {
		return { data: (data ?? []).map(mapImportSessionRow), error: null };
	} catch (err) {
		return { data: null, error: err as Error };
	}
}

/** The last staged row of a session (the scan just added), or null. */
export async function getLastImportItem(
	supabase: SupabaseClient,
	sessionId: string
): Promise<RepositoryResult<ImportItem | null>> {
	const { data, error } = await supabase
		.from('import_session_items')
		.select(IMPORT_ITEM_COLUMNS)
		.eq('import_session_id', sessionId)
		.order('row_number', { ascending: false })
		.limit(1)
		.maybeSingle()
		.overrideTypes<ImportItemRow | null, { merge: false }>();
	if (error) return { data: null, error };
	try {
		return { data: data ? mapImportItemRow(data) : null, error: null };
	} catch (err) {
		return { data: null, error: err as Error };
	}
}
