import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import {
	BARCODE_MODES,
	CAMPAIGN_STATUSES,
	type BarcodeMode,
	type Campaign,
	type CampaignStatus
} from '$lib/domain/campaigns';
import {
	ASSOCIATED_NUMBER_MODES,
	OVERFLOW_POLICIES,
	type AssociatedNumberMode,
	type OverflowPolicy
} from '$lib/domain/numbering';
import { toDecimalString } from '$lib/domain/money';

/**
 * Read access to `public.campaigns` under the caller's RLS (`campaign.view`). Writes never go
 * through here: they use the audited `campaign_*` SQL functions (see services/campaigns.ts).
 *
 * Money columns are `numeric(14,2)`. PostgREST would serialize them as JSON numbers, so they are
 * selected with a `::text` cast and kept as exact two-decimal strings (`"60000.00"`).
 */
export const CAMPAIGN_COLUMNS = [
	'id',
	'name',
	'status',
	'starts_at',
	'ends_at',
	'simple_bond_value::text',
	'installment_count',
	'installment_value::text',
	'number_digits',
	'max_number',
	'associated_number_offset',
	'associated_number_mode',
	'overflow_policy',
	'barcode_mode',
	'barcode_pattern',
	'created_by',
	'created_at',
	'updated_at'
].join(', ');

export interface CampaignRow {
	id: string;
	name: string;
	status: string;
	starts_at: string | null;
	ends_at: string | null;
	simple_bond_value: string | number;
	installment_count: number;
	installment_value: string | number;
	number_digits: number;
	max_number: number;
	associated_number_offset: number;
	associated_number_mode: string;
	overflow_policy: string;
	barcode_mode: string;
	barcode_pattern: string | null;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

function oneOf<T extends string>(allowed: readonly T[], value: string, column: string): T {
	if (!(allowed as readonly string[]).includes(value)) {
		throw new Error(`Unexpected campaigns.${column} value: ${value}`);
	}
	return value as T;
}

/** Maps a database row to the app type. Throws on values the app does not know about. */
export function mapCampaignRow(row: CampaignRow): Campaign {
	return {
		id: row.id,
		name: row.name,
		status: oneOf<CampaignStatus>(CAMPAIGN_STATUSES, row.status, 'status'),
		startsAt: row.starts_at,
		endsAt: row.ends_at,
		simpleBondValue: toDecimalString(row.simple_bond_value),
		installmentCount: row.installment_count,
		installmentValue: toDecimalString(row.installment_value),
		numberDigits: row.number_digits,
		maxNumber: row.max_number,
		associatedNumberOffset: row.associated_number_offset,
		associatedNumberMode: oneOf<AssociatedNumberMode>(
			ASSOCIATED_NUMBER_MODES,
			row.associated_number_mode,
			'associated_number_mode'
		),
		overflowPolicy: oneOf<OverflowPolicy>(
			OVERFLOW_POLICIES,
			row.overflow_policy,
			'overflow_policy'
		),
		barcodeMode: oneOf<BarcodeMode>(BARCODE_MODES, row.barcode_mode, 'barcode_mode'),
		barcodePattern: row.barcode_pattern,
		createdBy: row.created_by,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export type RepositoryResult<T> =
	{ data: T; error: null } | { data: null; error: PostgrestError | Error };

/** All campaigns visible to the caller, newest first. */
export async function listCampaigns(
	supabase: SupabaseClient
): Promise<RepositoryResult<Campaign[]>> {
	const { data, error } = await supabase
		.from('campaigns')
		.select(CAMPAIGN_COLUMNS)
		.order('created_at', { ascending: false })
		.order('id', { ascending: true })
		.overrideTypes<CampaignRow[], { merge: false }>();

	if (error) return { data: null, error };
	try {
		return { data: (data ?? []).map(mapCampaignRow), error: null };
	} catch (err) {
		return { data: null, error: err as Error };
	}
}

/**
 * One campaign by id, or `data: null` when it does not exist or is not visible to the caller.
 * `id` must already be a valid uuid (an invalid one is a PostgREST error, not "not found").
 */
export async function getCampaignById(
	supabase: SupabaseClient,
	id: string
): Promise<RepositoryResult<Campaign | null>> {
	const { data, error } = await supabase
		.from('campaigns')
		.select(CAMPAIGN_COLUMNS)
		.eq('id', id)
		.maybeSingle()
		.overrideTypes<CampaignRow | null, { merge: false }>();

	if (error) return { data: null, error };
	try {
		return { data: data ? mapCampaignRow(data) : null, error: null };
	} catch (err) {
		return { data: null, error: err as Error };
	}
}
