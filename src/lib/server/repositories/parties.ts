import type { SupabaseClient } from '@supabase/supabase-js';
import {
	BUYER_TYPES,
	COLLECTOR_STATUSES,
	partySearchTerm,
	type Buyer,
	type BuyerType,
	type Collector,
	type CollectorStatus
} from '$lib/domain/parties';
import type { RepositoryResult } from './campaigns';

/**
 * Read access to `public.collectors` and `public.buyers` under the caller's RLS
 * (collector.view/manage, or the collector's own row; buyer.view/manage). Writes go through the
 * audited SQL functions (services/parties.ts).
 */
export const COLLECTOR_COLUMNS =
	'id, display_name, phone, email, address, user_profile_id, status, created_by, created_at, updated_at';
export const BUYER_COLUMNS =
	'id, type, first_name, last_name, business_name, document_number, tax_id, phone, address, usual_collector_id, notes, created_by, created_at, updated_at';

export const PARTY_PAGE_SIZE = 25;

export interface CollectorRow {
	id: string;
	display_name: string;
	phone: string | null;
	email: string | null;
	address: string | null;
	user_profile_id: string | null;
	status: string;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

export interface BuyerRow {
	id: string;
	type: string;
	first_name: string | null;
	last_name: string | null;
	business_name: string | null;
	document_number: string | null;
	tax_id: string | null;
	phone: string | null;
	address: string | null;
	usual_collector_id: string | null;
	notes: string | null;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

interface BuyerBondRow {
	id: string;
	campaign_id: string;
	bond_numbers: { number_value: number; number_kind: string }[];
	campaigns: { name: string; number_digits: number } | null;
}

export interface BuyerBondNumber {
	id: string;
	campaignId: string;
	campaignName: string;
	campaignNumberDigits: number;
	baseNumbers: number[];
}

function oneOf<T extends string>(values: readonly T[], value: string, what: string): T {
	if (!(values as readonly string[]).includes(value))
		throw new Error(`unexpected ${what}: ${value}`);
	return value as T;
}

export function mapCollectorRow(row: CollectorRow): Collector {
	return {
		id: row.id,
		displayName: row.display_name,
		phone: row.phone,
		email: row.email,
		address: row.address,
		userProfileId: row.user_profile_id,
		status: oneOf<CollectorStatus>(COLLECTOR_STATUSES, row.status, 'collector status'),
		createdBy: row.created_by,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export function mapBuyerRow(row: BuyerRow): Buyer {
	return {
		id: row.id,
		type: oneOf<BuyerType>(BUYER_TYPES, row.type, 'buyer type'),
		firstName: row.first_name,
		lastName: row.last_name,
		businessName: row.business_name,
		documentNumber: row.document_number,
		taxId: row.tax_id,
		phone: row.phone,
		address: row.address,
		usualCollectorId: row.usual_collector_id,
		notes: row.notes,
		createdBy: row.created_by,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function wrap<T>(map: () => T): RepositoryResult<T> {
	try {
		return { data: map(), error: null };
	} catch (err) {
		return { data: null, error: err as Error };
	}
}

export interface PartyPage<T> {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
}

/** Each word of the search must match one of the columns (case and accent sensitive ILIKE). */
function wordFilters(search: string | null | undefined, columns: readonly string[]): string[] {
	const term = partySearchTerm(search);
	if (!term) return [];
	return term.split(' ').map((word) => columns.map((c) => `${c}.ilike.*${word}*`).join(','));
}

/** Collectors by name (active first), optionally filtered by status and a search term. */
export async function listCollectors(
	supabase: SupabaseClient,
	options: {
		status?: CollectorStatus | null;
		search?: string | null;
		page?: number;
		pageSize?: number;
	} = {}
): Promise<RepositoryResult<PartyPage<Collector>>> {
	const pageSize = options.pageSize ?? PARTY_PAGE_SIZE;
	const page = Math.max(1, options.page ?? 1);
	let query = supabase.from('collectors').select(COLLECTOR_COLUMNS, { count: 'exact' });
	if (options.status) query = query.eq('status', options.status);
	for (const filter of wordFilters(options.search, ['display_name', 'phone', 'email'])) {
		query = query.or(filter);
	}
	const { data, error, count } = await query
		.order('status', { ascending: true })
		.order('display_name', { ascending: true })
		.order('id', { ascending: true })
		.range((page - 1) * pageSize, page * pageSize - 1)
		.overrideTypes<CollectorRow[], { merge: false }>();
	if (error) return { data: null, error };
	return wrap(() => ({
		items: (data ?? []).map(mapCollectorRow),
		total: count ?? 0,
		page,
		pageSize
	}));
}

/** One collector, or null when it does not exist or is not visible to the caller. */
export async function getCollector(
	supabase: SupabaseClient,
	id: string
): Promise<RepositoryResult<Collector | null>> {
	const { data, error } = await supabase
		.from('collectors')
		.select(COLLECTOR_COLUMNS)
		.eq('id', id)
		.maybeSingle()
		.overrideTypes<CollectorRow | null, { merge: false }>();
	if (error) return { data: null, error };
	return wrap(() => (data ? mapCollectorRow(data) : null));
}

/** Active collectors by name, for pickers (usual collector, later bond delivery). */
export async function listActiveCollectorOptions(
	supabase: SupabaseClient
): Promise<RepositoryResult<Pick<Collector, 'id' | 'displayName'>[]>> {
	const { data, error } = await supabase
		.from('collectors')
		.select('id, display_name')
		.eq('status', 'active')
		.order('display_name', { ascending: true })
		.limit(1000)
		.overrideTypes<{ id: string; display_name: string }[], { merge: false }>();
	if (error) return { data: null, error };
	return {
		data: (data ?? []).map((c) => ({ id: c.id, displayName: c.display_name })),
		error: null
	};
}

/** Visible collectors for a rendered buyer page, keyed by id. One query avoids list N+1 calls. */
export async function getCollectorsByIds(
	supabase: SupabaseClient,
	ids: readonly string[]
): Promise<RepositoryResult<Map<string, Pick<Collector, 'id' | 'displayName'>>>> {
	if (ids.length === 0) return { data: new Map(), error: null };
	const { data, error } = await supabase
		.from('collectors')
		.select('id, display_name')
		.in('id', [...new Set(ids)])
		.overrideTypes<{ id: string; display_name: string }[], { merge: false }>();
	if (error) return { data: null, error };
	return {
		data: new Map((data ?? []).map((c) => [c.id, { id: c.id, displayName: c.display_name }])),
		error: null
	};
}

/**
 * Buyers matching a search over names, phone, document number and tax id (every word must
 * match a column), by last/business name.
 */
export async function listBuyers(
	supabase: SupabaseClient,
	options: {
		search?: string | null;
		type?: BuyerType | null;
		usualCollectorId?: string | null;
		page?: number;
		pageSize?: number;
	} = {}
): Promise<RepositoryResult<PartyPage<Buyer>>> {
	const pageSize = options.pageSize ?? PARTY_PAGE_SIZE;
	const page = Math.max(1, options.page ?? 1);
	let query = supabase.from('buyers').select(BUYER_COLUMNS, { count: 'exact' });
	if (options.type) query = query.eq('type', options.type);
	if (options.usualCollectorId) query = query.eq('usual_collector_id', options.usualCollectorId);
	for (const filter of wordFilters(options.search, [
		'first_name',
		'last_name',
		'business_name',
		'phone',
		'document_number',
		'tax_id'
	])) {
		query = query.or(filter);
	}
	const { data, error, count } = await query
		.order('business_name', { ascending: true, nullsFirst: false })
		.order('last_name', { ascending: true, nullsFirst: false })
		.order('first_name', { ascending: true, nullsFirst: false })
		.order('id', { ascending: true })
		.range((page - 1) * pageSize, page * pageSize - 1)
		.overrideTypes<BuyerRow[], { merge: false }>();
	if (error) return { data: null, error };
	return wrap(() => ({ items: (data ?? []).map(mapBuyerRow), total: count ?? 0, page, pageSize }));
}

/** One buyer, or null when it does not exist or is not visible to the caller. */
export async function getBuyer(
	supabase: SupabaseClient,
	id: string
): Promise<RepositoryResult<Buyer | null>> {
	const { data, error } = await supabase
		.from('buyers')
		.select(BUYER_COLUMNS)
		.eq('id', id)
		.maybeSingle()
		.overrideTypes<BuyerRow | null, { merge: false }>();
	if (error) return { data: null, error };
	return wrap(() => (data ? mapBuyerRow(data) : null));
}

/**
 * Bonds currently assigned to a buyer. The campaign and base numbers are embedded in the same
 * query, so the buyer record never turns into an N+1 lookup.
 */
export async function listBuyerBonds(
	supabase: SupabaseClient,
	buyerId: string,
	options: { campaignId?: string; excludeCampaignId?: string } = {}
): Promise<RepositoryResult<BuyerBondNumber[]>> {
	let query = supabase
		.from('bonds')
		.select(
			'id, campaign_id, bond_numbers(number_value, number_kind), campaigns!inner(name, number_digits)'
		)
		.eq('current_buyer_id', buyerId);
	if (options.campaignId) query = query.eq('campaign_id', options.campaignId);
	if (options.excludeCampaignId) query = query.neq('campaign_id', options.excludeCampaignId);
	const { data, error } = await query
		.order('campaign_id', { ascending: true })
		.order('id', { ascending: true })
		.overrideTypes<BuyerBondRow[], { merge: false }>();
	if (error) return { data: null, error };
	return {
		data: (data ?? []).map((bond) => ({
			id: bond.id,
			campaignId: bond.campaign_id,
			campaignName: bond.campaigns?.name ?? 'Unknown campaign',
			campaignNumberDigits: bond.campaigns?.number_digits ?? 4,
			baseNumbers: (bond.bond_numbers ?? [])
				.filter((number) => number.number_kind === 'base')
				.map((number) => number.number_value)
				.sort((a, b) => a - b)
		})),
		error: null
	};
}

/** Other buyers with the same document number or tax id (possible duplicates to warn about). */
export async function findBuyersByIdentification(
	supabase: SupabaseClient,
	identification: {
		documentNumber?: string | null;
		taxId?: string | null;
		excludeId?: string | null;
	}
): Promise<RepositoryResult<Buyer[]>> {
	const filters: string[] = [];
	const clean = (v: string | null | undefined) => (v ?? '').replace(/[,()*"\\]/g, '').trim();
	if (clean(identification.documentNumber)) {
		filters.push(`document_number.eq.${clean(identification.documentNumber)}`);
	}
	if (clean(identification.taxId)) filters.push(`tax_id.eq.${clean(identification.taxId)}`);
	if (filters.length === 0) return { data: [], error: null };
	let query = supabase.from('buyers').select(BUYER_COLUMNS).or(filters.join(','));
	if (identification.excludeId) query = query.neq('id', identification.excludeId);
	const { data, error } = await query.limit(10).overrideTypes<BuyerRow[], { merge: false }>();
	if (error) return { data: null, error };
	return wrap(() => (data ?? []).map(mapBuyerRow));
}
