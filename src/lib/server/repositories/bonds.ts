import type { SupabaseClient } from '@supabase/supabase-js';
import {
	BOND_COMMERCIAL_STATUSES,
	BOND_FINANCIAL_STATUSES,
	BOND_KINDS,
	BOND_NUMBER_KINDS,
	BOND_ORIGINS,
	type BondCommercialStatus,
	type BondFinancialStatus,
	type BondKind,
	type BondNumberKind,
	type BondOrigin
} from '$lib/domain/bonds';
import { toDecimalString } from '$lib/domain/money';
import type { RepositoryResult } from './campaigns';

/**
 * Read access to `public.bonds`, `public.bond_numbers` and `public.bond_groups` under the
 * caller's RLS (`bond.view`). Writes never go through here: they use the audited `bond_*` SQL
 * functions (see services/bonds.ts).
 *
 * `total_value` is `numeric(14,2)`: selected with a `::text` cast and kept as an exact
 * two-decimal string.
 */
export const BOND_COLUMNS = [
	'id',
	'campaign_id',
	'kind',
	'origin',
	'internal_code',
	'barcode',
	'commercial_status',
	'financial_status_snapshot',
	'current_collector_id',
	'current_buyer_id',
	'commercial_unit_count',
	'total_value::text',
	'annulled_at',
	'annulled_by',
	'annul_reason',
	'created_by',
	'created_at',
	'updated_at'
].join(', ');

export const BOND_NUMBER_COLUMNS = [
	'id',
	'campaign_id',
	'bond_id',
	'number_value',
	'number_kind',
	'source_base_number_id',
	'created_at',
	'released_at',
	'released_by'
].join(', ');

export const BOND_GROUP_COLUMNS = [
	'id',
	'pata_bond_id',
	'member_bond_id',
	'grouped_at',
	'grouped_by',
	'ungrouped_at',
	'ungrouped_by',
	'reason'
].join(', ');

/** PostgREST's default page size (supabase/config.toml `max_rows`). */
export const BOND_NUMBERS_PAGE_SIZE = 1000;

export interface BondRow {
	id: string;
	campaign_id: string;
	kind: string;
	origin: string;
	internal_code: string | null;
	barcode: string | null;
	commercial_status: string;
	financial_status_snapshot: string;
	current_collector_id: string | null;
	current_buyer_id: string | null;
	commercial_unit_count: number;
	total_value: string | number;
	annulled_at: string | null;
	annulled_by: string | null;
	annul_reason: string | null;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

export interface BondNumberRow {
	id: string;
	campaign_id: string;
	bond_id: string;
	number_value: number;
	number_kind: string;
	source_base_number_id: string | null;
	created_at: string;
	released_at: string | null;
	released_by: string | null;
}

export interface BondGroupRow {
	id: string;
	pata_bond_id: string;
	member_bond_id: string;
	grouped_at: string;
	grouped_by: string;
	ungrouped_at: string | null;
	ungrouped_by: string | null;
	reason: string | null;
}

/** App representation of a `bonds` row. */
export interface Bond {
	id: string;
	campaignId: string;
	kind: BondKind;
	origin: BondOrigin;
	internalCode: string | null;
	barcode: string | null;
	commercialStatus: BondCommercialStatus;
	financialStatusSnapshot: BondFinancialStatus;
	currentCollectorId: string | null;
	currentBuyerId: string | null;
	commercialUnitCount: number;
	/** Two-decimal string: simple_bond_value * commercialUnitCount. */
	totalValue: string;
	annulledAt: string | null;
	annulledBy: string | null;
	annulReason: string | null;
	createdBy: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface BondNumber {
	id: string;
	campaignId: string;
	bondId: string;
	/** Integer value; format it with the campaign's digit count (`formatCampaignNumber`). */
	numberValue: number;
	numberKind: BondNumberKind;
	sourceBaseNumberId: string | null;
	createdAt: string;
	/** Set once the bond was annulled: the number no longer counts and can be entered again. */
	releasedAt: string | null;
	releasedBy: string | null;
}

export interface BondGroupMembership {
	id: string;
	pataBondId: string;
	memberBondId: string;
	groupedAt: string;
	groupedBy: string;
}

/** A bond with its numbers and its active group membership (as member and as manual pata). */
export interface BondDetail extends Bond {
	/** Every number of the bond, released ones included (history), base first, by value. */
	numbers: BondNumber[];
	/** For a simple bond: the active membership in a manual pata, if grouped. */
	activeGroup: BondGroupMembership | null;
	/** For a manual pata: its active members. */
	activeMembers: BondGroupMembership[];
}

function oneOf<T extends string>(allowed: readonly T[], value: string, column: string): T {
	if (!(allowed as readonly string[]).includes(value)) {
		throw new Error(`Unexpected ${column} value: ${value}`);
	}
	return value as T;
}

export function mapBondRow(row: BondRow): Bond {
	return {
		id: row.id,
		campaignId: row.campaign_id,
		kind: oneOf<BondKind>(BOND_KINDS, row.kind, 'bonds.kind'),
		origin: oneOf<BondOrigin>(BOND_ORIGINS, row.origin, 'bonds.origin'),
		internalCode: row.internal_code,
		barcode: row.barcode,
		commercialStatus: oneOf<BondCommercialStatus>(
			BOND_COMMERCIAL_STATUSES,
			row.commercial_status,
			'bonds.commercial_status'
		),
		financialStatusSnapshot: oneOf<BondFinancialStatus>(
			BOND_FINANCIAL_STATUSES,
			row.financial_status_snapshot,
			'bonds.financial_status_snapshot'
		),
		currentCollectorId: row.current_collector_id,
		currentBuyerId: row.current_buyer_id,
		commercialUnitCount: row.commercial_unit_count,
		totalValue: toDecimalString(row.total_value),
		annulledAt: row.annulled_at,
		annulledBy: row.annulled_by,
		annulReason: row.annul_reason,
		createdBy: row.created_by,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export function mapBondNumberRow(row: BondNumberRow): BondNumber {
	return {
		id: row.id,
		campaignId: row.campaign_id,
		bondId: row.bond_id,
		numberValue: row.number_value,
		numberKind: oneOf<BondNumberKind>(
			BOND_NUMBER_KINDS,
			row.number_kind,
			'bond_numbers.number_kind'
		),
		sourceBaseNumberId: row.source_base_number_id,
		createdAt: row.created_at,
		releasedAt: row.released_at,
		releasedBy: row.released_by
	};
}

function mapMembership(row: BondGroupRow): BondGroupMembership {
	return {
		id: row.id,
		pataBondId: row.pata_bond_id,
		memberBondId: row.member_bond_id,
		groupedAt: row.grouped_at,
		groupedBy: row.grouped_by
	};
}

const KIND_ORDER: Record<BondNumberKind, number> = { base: 0, associated: 1, extraordinary: 2 };

/**
 * One bond with its numbers and active group membership, or `data: null` when it does not exist
 * or is not visible to the caller. `id` must already be a valid uuid.
 */
export async function getBondById(
	supabase: SupabaseClient,
	id: string
): Promise<RepositoryResult<BondDetail | null>> {
	const bondResult = await supabase
		.from('bonds')
		.select(BOND_COLUMNS)
		.eq('id', id)
		.maybeSingle()
		.overrideTypes<BondRow | null, { merge: false }>();
	if (bondResult.error) return { data: null, error: bondResult.error };
	if (!bondResult.data) return { data: null, error: null };

	const [numbersResult, groupsResult] = await Promise.all([
		supabase
			.from('bond_numbers')
			.select(BOND_NUMBER_COLUMNS)
			.eq('bond_id', id)
			.overrideTypes<BondNumberRow[], { merge: false }>(),
		supabase
			.from('bond_groups')
			.select(BOND_GROUP_COLUMNS)
			.or(`member_bond_id.eq.${id},pata_bond_id.eq.${id}`)
			.is('ungrouped_at', null)
			.overrideTypes<BondGroupRow[], { merge: false }>()
	]);
	if (numbersResult.error) return { data: null, error: numbersResult.error };
	if (groupsResult.error) return { data: null, error: groupsResult.error };

	try {
		const numbers = (numbersResult.data ?? [])
			.map(mapBondNumberRow)
			.sort(
				(a, b) =>
					KIND_ORDER[a.numberKind] - KIND_ORDER[b.numberKind] ||
					a.numberValue - b.numberValue ||
					a.createdAt.localeCompare(b.createdAt)
			);
		const groups = groupsResult.data ?? [];
		const asMember = groups.find((g) => g.member_bond_id === id);
		return {
			data: {
				...mapBondRow(bondResult.data),
				numbers,
				activeGroup: asMember ? mapMembership(asMember) : null,
				activeMembers: groups.filter((g) => g.pata_bond_id === id).map(mapMembership)
			},
			error: null
		};
	} catch (err) {
		return { data: null, error: err as Error };
	}
}

/**
 * Participating numbers of a campaign, ordered by value. Only live numbers by default (the ones
 * that count for uniqueness); `includeReleased` adds the numbers of annulled bonds (history).
 * Pages through PostgREST's row limit, so every number is returned.
 */
export async function listBondNumbersByCampaign(
	supabase: SupabaseClient,
	campaignId: string,
	options: { includeReleased?: boolean } = {}
): Promise<RepositoryResult<BondNumber[]>> {
	const rows: BondNumberRow[] = [];
	for (let from = 0; ; from += BOND_NUMBERS_PAGE_SIZE) {
		let query = supabase
			.from('bond_numbers')
			.select(BOND_NUMBER_COLUMNS)
			.eq('campaign_id', campaignId);
		if (!options.includeReleased) query = query.is('released_at', null);
		const { data, error } = await query
			.order('number_value', { ascending: true })
			.order('id', { ascending: true })
			.range(from, from + BOND_NUMBERS_PAGE_SIZE - 1)
			.overrideTypes<BondNumberRow[], { merge: false }>();
		if (error) return { data: null, error };
		const page = data ?? [];
		rows.push(...page);
		if (page.length < BOND_NUMBERS_PAGE_SIZE) break;
	}
	try {
		return { data: rows.map(mapBondNumberRow), error: null };
	} catch (err) {
		return { data: null, error: err as Error };
	}
}
