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
import { POSTGREST_MAX_ROWS } from '$lib/postgrest';

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
	'annulled_from_status',
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

/** PostgREST `max_rows`, see `$lib/postgrest`. */
export const BOND_NUMBERS_PAGE_SIZE = POSTGREST_MAX_ROWS;

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
	annulled_from_status: string | null;
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
	/**
	 * Status the bond was annulled from (set by the database). Only bonds annulled from
	 * `available` (loaded by mistake) release their numbers; an annulled sale keeps them held.
	 */
	annulledFromStatus: BondCommercialStatus | null;
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
		annulledFromStatus:
			row.annulled_from_status === null
				? null
				: oneOf<BondCommercialStatus>(
						BOND_COMMERCIAL_STATUSES,
						row.annulled_from_status,
						'bonds.annulled_from_status'
					),
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
 * The campaign a bond belongs to, or `data: null` when the bond does not exist or is not visible
 * to the caller. One row, one column: used to scope bond record actions to the URL's campaign.
 * `id` must already be a valid uuid.
 */
export async function getBondCampaignId(
	supabase: SupabaseClient,
	id: string
): Promise<RepositoryResult<string | null>> {
	const { data, error } = await supabase
		.from('bonds')
		.select('campaign_id')
		.eq('id', id)
		.maybeSingle()
		.overrideTypes<{ campaign_id: string } | null, { merge: false }>();
	if (error) return { data: null, error };
	return { data: data?.campaign_id ?? null, error: null };
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

/**
 * Whether the campaign has at least one bond (annulled ones included, like the
 * `campaigns_rules_frozen_with_bonds` trigger): once it does, its rules are frozen even in draft.
 * Reads one id at most. Under RLS this needs `bond.view`; without it the answer is `false` and the
 * database still rejects a rules change.
 */
export async function campaignHasBonds(
	supabase: SupabaseClient,
	campaignId: string
): Promise<RepositoryResult<boolean>> {
	const { data, error } = await supabase
		.from('bonds')
		.select('id')
		.eq('campaign_id', campaignId)
		.limit(1)
		.overrideTypes<{ id: string }[], { merge: false }>();
	if (error) return { data: null, error };
	return { data: (data ?? []).length > 0, error: null };
}

// ---------------------------------------------------------------------------
// Manual grouping and group history (SAN-25)
// ---------------------------------------------------------------------------

/** A membership row with its ungrouping (history): never deleted, `ungroupedAt` once ungrouped. */
export interface BondGroupHistoryEntry extends BondGroupMembership {
	ungroupedAt: string | null;
	ungroupedBy: string | null;
	/** Ungrouping reason (null while the membership is active). */
	reason: string | null;
}

function mapHistoryEntry(row: BondGroupRow): BondGroupHistoryEntry {
	return {
		...mapMembership(row),
		ungroupedAt: row.ungrouped_at,
		ungroupedBy: row.ungrouped_by,
		reason: row.reason
	};
}

/**
 * Every membership of a manual pata, active and ungrouped (history), oldest first. Empty for a
 * bond that is not a manual pata.
 */
export async function listPataMemberships(
	supabase: SupabaseClient,
	pataBondId: string
): Promise<RepositoryResult<BondGroupHistoryEntry[]>> {
	const { data, error } = await supabase
		.from('bond_groups')
		.select(BOND_GROUP_COLUMNS)
		.eq('pata_bond_id', pataBondId)
		.order('grouped_at', { ascending: true })
		.order('id', { ascending: true })
		.overrideTypes<BondGroupRow[], { merge: false }>();
	if (error) return { data: null, error };
	return { data: (data ?? []).map(mapHistoryEntry), error: null };
}

/**
 * Numbers of several bonds (e.g. the members of a manual pata), released ones included, ordered
 * by bond then kind (base first) then value. `bondIds` must be valid uuids.
 */
export async function listBondNumbersByBondIds(
	supabase: SupabaseClient,
	bondIds: readonly string[]
): Promise<RepositoryResult<BondNumber[]>> {
	if (bondIds.length === 0) return { data: [], error: null };
	const { data, error } = await supabase
		.from('bond_numbers')
		.select(BOND_NUMBER_COLUMNS)
		.in('bond_id', [...bondIds])
		.order('number_value', { ascending: true })
		.overrideTypes<BondNumberRow[], { merge: false }>();
	if (error) return { data: null, error };
	try {
		const numbers = (data ?? [])
			.map(mapBondNumberRow)
			.sort((a, b) => KIND_ORDER[a.numberKind] - KIND_ORDER[b.numberKind]);
		return { data: numbers, error: null };
	} catch (err) {
		return { data: null, error: err as Error };
	}
}

/** Most bonds a grouping search returns. */
export const GROUPABLE_SEARCH_LIMIT = 20;

/** An available simple bond that is not an active member of a manual pata. */
export interface GroupableBond {
	id: string;
	baseNumber: number;
	internalCode: string | null;
	barcode: string | null;
}

interface GroupableRow {
	number_value: number;
	bond: { id: string; internal_code: string | null; barcode: string | null };
}

/**
 * Simple bonds of the campaign that can be grouped into a manual pata (available, not an active
 * member of another pata), ordered by base number, starting at `fromBase` when given. At most
 * `limit` rows (default {@link GROUPABLE_SEARCH_LIMIT}). One query: the live base numbers of the
 * campaign, inner-joined to their bond (kind and status filters) with an anti-join on the bond's
 * active memberships.
 */
export async function searchGroupableBonds(
	supabase: SupabaseClient,
	campaignId: string,
	options: { fromBase?: number | null; limit?: number } = {}
): Promise<RepositoryResult<GroupableBond[]>> {
	let query = supabase
		.from('bond_numbers')
		.select(
			'number_value, bond:bonds!bond_numbers_bond_fkey!inner(id, internal_code, barcode, ' +
				'active:bond_groups!bond_groups_member_bond_id_fkey(id))'
		)
		.eq('campaign_id', campaignId)
		.eq('number_kind', 'base')
		.is('released_at', null)
		.eq('bond.kind', 'simple')
		.eq('bond.commercial_status', 'available')
		.is('bond.active.ungrouped_at', null)
		.is('bond.active', null);
	if (options.fromBase != null) query = query.gte('number_value', options.fromBase);
	const { data, error } = await query
		.order('number_value', { ascending: true })
		.limit(options.limit ?? GROUPABLE_SEARCH_LIMIT)
		.overrideTypes<GroupableRow[], { merge: false }>();
	if (error) return { data: null, error };
	return {
		data: (data ?? []).map((row) => ({
			id: row.bond.id,
			baseNumber: row.number_value,
			internalCode: row.bond.internal_code,
			barcode: row.bond.barcode
		})),
		error: null
	};
}

/** A bond picked for a manual pata, with what the grouping rules need to know about it. */
export interface GroupingMember {
	id: string;
	campaignId: string;
	kind: BondKind;
	commercialStatus: BondCommercialStatus;
	internalCode: string | null;
	/** Live base number (simple bonds); null for a pata or an annulled bond. */
	baseNumber: number | null;
	/** The manual pata it is an active member of, if any. */
	activeGroupPataId: string | null;
}

interface GroupingMemberRow {
	id: string;
	campaign_id: string;
	kind: string;
	commercial_status: string;
	internal_code: string | null;
	numbers: { number_value: number; number_kind: string; released_at: string | null }[];
	groups: { pata_bond_id: string; ungrouped_at: string | null }[];
}

/**
 * The given bonds (visible to the caller) with their live base number and active membership, in
 * the order of `ids`; bonds that do not exist are left out. `ids` must be valid uuids.
 */
export async function listGroupingMembers(
	supabase: SupabaseClient,
	ids: readonly string[]
): Promise<RepositoryResult<GroupingMember[]>> {
	if (ids.length === 0) return { data: [], error: null };
	const { data, error } = await supabase
		.from('bonds')
		.select(
			'id, campaign_id, kind, commercial_status, internal_code, ' +
				'numbers:bond_numbers!bond_numbers_bond_fkey(number_value, number_kind, released_at), ' +
				'groups:bond_groups!bond_groups_member_bond_id_fkey(pata_bond_id, ungrouped_at)'
		)
		.in('id', [...ids])
		.overrideTypes<GroupingMemberRow[], { merge: false }>();
	if (error) return { data: null, error };
	try {
		const byId = new Map(
			(data ?? []).map((row): [string, GroupingMember] => [
				row.id,
				{
					id: row.id,
					campaignId: row.campaign_id,
					kind: oneOf<BondKind>(BOND_KINDS, row.kind, 'bonds.kind'),
					commercialStatus: oneOf<BondCommercialStatus>(
						BOND_COMMERCIAL_STATUSES,
						row.commercial_status,
						'bonds.commercial_status'
					),
					internalCode: row.internal_code,
					baseNumber:
						row.kind === 'simple'
							? (row.numbers.find((n) => n.number_kind === 'base' && n.released_at === null)
									?.number_value ?? null)
							: null,
					activeGroupPataId: row.groups.find((g) => g.ungrouped_at === null)?.pata_bond_id ?? null
				}
			])
		);
		return { data: ids.flatMap((id) => byId.get(id) ?? []), error: null };
	} catch (err) {
		return { data: null, error: err as Error };
	}
}

// ---------------------------------------------------------------------------
// Bonds list and record (SAN-26)
// ---------------------------------------------------------------------------

/** Rows per page of the bonds list. */
export const BOND_LIST_PAGE_SIZE = 25;

/** Filters of the bonds list (all optional, combined with AND). */
export interface BondListFilters {
	/** A participating base number (a manual pata matches through its members). */
	baseNumber?: number | null;
	/** A participating associated number (a manual pata matches through its members). */
	associatedNumber?: number | null;
	/** Exact barcode or internal code. */
	code?: string | null;
	kind?: BondKind | null;
	commercialStatus?: BondCommercialStatus | null;
	financialStatus?: BondFinancialStatus | null;
}

export interface BondListRow {
	id: string;
	campaign_id: string;
	kind: string;
	origin: string;
	internal_code: string | null;
	barcode: string | null;
	commercial_status: string;
	financial_status_snapshot: string;
	commercial_unit_count: number;
	total_value: string | number;
	created_at: string;
	base_numbers: number[] | null;
	associated_numbers: number[] | null;
	group_pata_id: string | null;
}

/** A row of the bonds list (`public.bond_list`). */
export interface BondListEntry {
	id: string;
	campaignId: string;
	kind: BondKind;
	origin: BondOrigin;
	internalCode: string | null;
	barcode: string | null;
	commercialStatus: BondCommercialStatus;
	financialStatus: BondFinancialStatus;
	commercialUnitCount: number;
	totalValue: string;
	createdAt: string;
	/** Participating base numbers, sorted (a manual pata: its members'). */
	baseNumbers: number[];
	associatedNumbers: number[];
	/** The manual pata this simple bond is an active member of. */
	groupPataId: string | null;
}

/**
 * Who has each bond and who bought it: `bond id -> { collectorId, buyerId }`, for one page of the
 * list (`bond_list` does not carry them). Read with the caller's client.
 */
export async function listBondHolderIds(
	supabase: SupabaseClient,
	bondIds: readonly string[]
): Promise<RepositoryResult<Map<string, { collectorId: string | null; buyerId: string | null }>>> {
	if (bondIds.length === 0) return { data: new Map(), error: null };
	const { data, error } = await supabase
		.from('bonds')
		.select('id, current_collector_id, current_buyer_id')
		.in('id', [...new Set(bondIds)])
		.overrideTypes<
			{ id: string; current_collector_id: string | null; current_buyer_id: string | null }[],
			{ merge: false }
		>();
	if (error) return { data: null, error };
	return {
		data: new Map(
			(data ?? []).map((row) => [
				row.id,
				{ collectorId: row.current_collector_id, buyerId: row.current_buyer_id }
			])
		),
		error: null
	};
}

export const BOND_LIST_COLUMNS = [
	'id',
	'campaign_id',
	'kind',
	'origin',
	'internal_code',
	'barcode',
	'commercial_status',
	'financial_status_snapshot',
	'commercial_unit_count',
	'total_value::text',
	'created_at',
	'base_numbers',
	'associated_numbers',
	'group_pata_id'
].join(', ');

export function mapBondListRow(row: BondListRow): BondListEntry {
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
		financialStatus: oneOf<BondFinancialStatus>(
			BOND_FINANCIAL_STATUSES,
			row.financial_status_snapshot,
			'bonds.financial_status_snapshot'
		),
		commercialUnitCount: row.commercial_unit_count,
		totalValue: toDecimalString(row.total_value),
		createdAt: row.created_at,
		baseNumbers: row.base_numbers ?? [],
		associatedNumbers: row.associated_numbers ?? [],
		groupPataId: row.group_pata_id
	};
}

/**
 * A value for a PostgREST logic filter (`or=(...)`): double-quoted, with `"` and `\` escaped, so
 * commas, dots and parentheses in a code are taken literally.
 */
export function quotePostgrestValue(value: string): string {
	return `"${value.replace(/["\\]/g, (c) => `\\${c}`)}"`;
}

/** PostgREST's error when the requested range starts past the last matching row. */
const RANGE_NOT_SATISFIABLE = 'PGRST103';

/** `public.bond_list` rows of a campaign matching the filters, with the exact count. */
function filteredBondList(supabase: SupabaseClient, campaignId: string, filters: BondListFilters) {
	let query = supabase
		.from('bond_list')
		.select(BOND_LIST_COLUMNS, { count: 'exact' })
		.eq('campaign_id', campaignId);
	if (filters.baseNumber != null) query = query.contains('base_numbers', [filters.baseNumber]);
	if (filters.associatedNumber != null) {
		query = query.contains('associated_numbers', [filters.associatedNumber]);
	}
	if (filters.code) {
		const code = quotePostgrestValue(filters.code);
		query = query.or(`barcode.eq.${code},internal_code.eq.${code}`);
	}
	if (filters.kind) query = query.eq('kind', filters.kind);
	if (filters.commercialStatus) query = query.eq('commercial_status', filters.commercialStatus);
	if (filters.financialStatus) {
		query = query.eq('financial_status_snapshot', filters.financialStatus);
	}
	return query;
}

/**
 * One page of a campaign's bonds (`public.bond_list`, RLS: `bond.view`) and the total matching
 * the filters, in one query. Stable order: lowest participating base number, then load time, then
 * id. `page` starts at 1. A page past the last one (a stale link, or `?page=` typed by hand) has
 * no entries: PostgREST refuses that range (PGRST103), so the total is read with a second query.
 */
export async function listBonds(
	supabase: SupabaseClient,
	campaignId: string,
	filters: BondListFilters,
	options: { page: number; pageSize?: number }
): Promise<RepositoryResult<{ entries: BondListEntry[]; total: number }>> {
	const pageSize = options.pageSize ?? BOND_LIST_PAGE_SIZE;
	const from = (Math.max(1, options.page) - 1) * pageSize;
	const { data, error, count } = await filteredBondList(supabase, campaignId, filters)
		.order('sort_number', { ascending: true, nullsFirst: false })
		.order('created_at', { ascending: true })
		.order('id', { ascending: true })
		.range(from, from + pageSize - 1)
		.overrideTypes<BondListRow[], { merge: false }>();
	if (error?.code === RANGE_NOT_SATISFIABLE && from > 0) {
		const first = await filteredBondList(supabase, campaignId, filters)
			.range(0, 0)
			.overrideTypes<BondListRow[], { merge: false }>();
		if (first.error) return { data: null, error: first.error };
		return { data: { entries: [], total: first.count ?? 0 }, error: null };
	}
	if (error) return { data: null, error };
	try {
		return {
			data: { entries: (data ?? []).map(mapBondListRow), total: count ?? 0 },
			error: null
		};
	} catch (err) {
		return { data: null, error: err as Error };
	}
}

/**
 * Participating base numbers of the given bonds (`public.bond_list`), e.g. to name the manual
 * patas of the listed members ("in pata 0068 + 0069"). `ids` must be valid uuids.
 */
export async function listBondBaseNumbers(
	supabase: SupabaseClient,
	ids: readonly string[]
): Promise<RepositoryResult<Map<string, number[]>>> {
	if (ids.length === 0) return { data: new Map(), error: null };
	const { data, error } = await supabase
		.from('bond_list')
		.select('id, base_numbers')
		.in('id', [...ids])
		.overrideTypes<{ id: string; base_numbers: number[] | null }[], { merge: false }>();
	if (error) return { data: null, error };
	return {
		data: new Map((data ?? []).map((row) => [row.id, row.base_numbers ?? []])),
		error: null
	};
}

/**
 * Every manual pata a bond has been a member of (active and ungrouped memberships), oldest
 * first. `memberBondId` must be a valid uuid.
 */
export async function listMembershipsOfMember(
	supabase: SupabaseClient,
	memberBondId: string
): Promise<RepositoryResult<BondGroupHistoryEntry[]>> {
	const { data, error } = await supabase
		.from('bond_groups')
		.select(BOND_GROUP_COLUMNS)
		.eq('member_bond_id', memberBondId)
		.order('grouped_at', { ascending: true })
		.order('id', { ascending: true })
		.overrideTypes<BondGroupRow[], { merge: false }>();
	if (error) return { data: null, error };
	return { data: (data ?? []).map(mapHistoryEntry), error: null };
}
