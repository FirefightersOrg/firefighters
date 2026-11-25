import type { SupabaseClient } from '@supabase/supabase-js';
import {
	BOND_COMMERCIAL_STATUSES,
	BOND_FINANCIAL_STATUSES,
	type BondCommercialStatus,
	type BondFinancialStatus,
	type BondKind
} from '$lib/domain/bonds';
import { campaignNumberingConfig, type Campaign } from '$lib/domain/campaigns';
import type { AssignmentStatus, AssignmentType, DeliveryNoteReason } from '$lib/domain/deliveries';
import { formatCampaignNumber } from '$lib/domain/numbering';

/** Own bonds per page. The query is ordered by (created_at, id), so pages are stable. */
export const MY_BONDS_PAGE_SIZE = 25;

export interface MyBondRow {
	id: string;
	kind: BondKind;
	typeLabel: string;
	baseNumbers: string[];
	associatedNumbers: string[];
	commercialStatus: BondCommercialStatus;
	financialStatus: BondFinancialStatus;
	unitCount: number;
	totalValue: string;
}

export interface MyBondsFilters {
	status: BondCommercialStatus | '';
	financial: BondFinancialStatus | '';
	page: number;
}

export function parseMyBondsQuery(params: URLSearchParams): MyBondsFilters {
	const status = params.get('status') ?? '';
	const financial = params.get('financial') ?? '';
	const page = Number(params.get('page') ?? '1');
	return {
		status: (BOND_COMMERCIAL_STATUSES as readonly string[]).includes(status)
			? (status as BondCommercialStatus)
			: '',
		financial: (BOND_FINANCIAL_STATUSES as readonly string[]).includes(financial)
			? (financial as BondFinancialStatus)
			: '',
		page: Number.isInteger(page) && page >= 1 && page <= 100000 ? page : 1
	};
}

interface NumberRef {
	number_value: number;
	number_kind: 'base' | 'associated' | 'extraordinary';
	released_at: string | null;
}

interface BondRowRaw {
	id: string;
	kind: BondKind;
	commercial_status: BondCommercialStatus;
	financial_status_snapshot: BondFinancialStatus;
	commercial_unit_count: number;
	total_value: string;
	bond_numbers: NumberRef[] | null;
}

const BOND_SELECT =
	'id, kind, commercial_status, financial_status_snapshot, commercial_unit_count, total_value, bond_numbers(number_value, number_kind, released_at)';

export function typeLabel(kind: BondKind): string {
	return kind === 'pata' ? 'Pata' : 'Bono simple';
}

function mapBond(row: BondRowRaw, campaign: Campaign): MyBondRow {
	const config = campaignNumberingConfig(campaign);
	const live = (row.bond_numbers ?? [])
		.filter((n) => n.released_at === null)
		.sort((a, b) => a.number_value - b.number_value);
	const fmt = (kind: string) =>
		live
			.filter((n) => n.number_kind === kind)
			.map((n) => formatCampaignNumber(n.number_value, config));
	return {
		id: row.id,
		kind: row.kind,
		typeLabel: typeLabel(row.kind),
		baseNumbers: fmt('base'),
		associatedNumbers: fmt('associated'),
		commercialStatus: row.commercial_status,
		financialStatus: row.financial_status_snapshot,
		unitCount: row.commercial_unit_count,
		totalValue: row.total_value
	};
}

type Result<T> = { data: T; error: null } | { data: null; error: unknown };

/** The collector's own bonds in a campaign (`current_collector_id` = the session's collector). */
export async function listMyBonds(
	supabase: SupabaseClient,
	collectorId: string,
	campaign: Campaign,
	filters: MyBondsFilters
): Promise<Result<{ rows: MyBondRow[]; total: number }>> {
	const from = (filters.page - 1) * MY_BONDS_PAGE_SIZE;
	let query = supabase
		.from('bonds')
		.select(BOND_SELECT, { count: 'exact' })
		.eq('campaign_id', campaign.id)
		.eq('current_collector_id', collectorId);
	if (filters.status) query = query.eq('commercial_status', filters.status);
	if (filters.financial) query = query.eq('financial_status_snapshot', filters.financial);
	const { data, error, count } = await query
		.order('created_at', { ascending: true })
		.order('id', { ascending: true })
		.range(from, from + MY_BONDS_PAGE_SIZE - 1)
		.overrideTypes<BondRowRaw[], { merge: false }>();
	if (error) return { data: null, error };
	return {
		data: { rows: (data ?? []).map((r) => mapBond(r, campaign)), total: count ?? 0 },
		error: null
	};
}

export interface MyAssignment {
	id: string;
	assignmentType: AssignmentType;
	status: AssignmentStatus;
	assignedAt: string;
	returnedAt: string | null;
	noteNumber: number | null;
}

export interface MyDeliveryNote {
	id: string;
	noteNumber: number;
	reason: DeliveryNoteReason;
	status: 'issued' | 'annulled';
	issuedAt: string;
}

export interface MyBondDetail {
	bond: MyBondRow;
	assignments: MyAssignment[];
	notes: MyDeliveryNote[];
}

/** One own bond with its assignment history and delivery notes, or `null` when it is not the collector's. */
export async function getMyBond(
	supabase: SupabaseClient,
	collectorId: string,
	campaign: Campaign,
	bondId: string
): Promise<Result<MyBondDetail | null>> {
	const bondResult = await supabase
		.from('bonds')
		.select(BOND_SELECT)
		.eq('id', bondId)
		.eq('campaign_id', campaign.id)
		.eq('current_collector_id', collectorId)
		.maybeSingle()
		.overrideTypes<BondRowRaw | null, { merge: false }>();
	if (bondResult.error) return { data: null, error: bondResult.error };
	if (!bondResult.data) return { data: null, error: null };

	const [assignments, notes] = await Promise.all([
		supabase
			.from('bond_assignments')
			.select(
				'id, assignment_type, status, assigned_at, returned_at, delivery_note:delivery_notes(note_number)'
			)
			.eq('bond_id', bondId)
			.eq('collector_id', collectorId)
			.order('assigned_at', { ascending: false })
			.order('id', { ascending: true })
			.limit(500)
			.overrideTypes<
				{
					id: string;
					assignment_type: AssignmentType;
					status: AssignmentStatus;
					assigned_at: string;
					returned_at: string | null;
					delivery_note: { note_number: number } | null;
				}[],
				{ merge: false }
			>(),
		supabase
			.from('delivery_notes')
			.select('id, note_number, reason, status, issued_at, delivery_note_items!inner(bond_id)')
			.eq('delivery_note_items.bond_id', bondId)
			.eq('collector_id', collectorId)
			.order('issued_at', { ascending: false })
			.order('id', { ascending: true })
			.limit(500)
			.overrideTypes<
				{
					id: string;
					note_number: number;
					reason: DeliveryNoteReason;
					status: 'issued' | 'annulled';
					issued_at: string;
				}[],
				{ merge: false }
			>()
	]);
	if (assignments.error) return { data: null, error: assignments.error };
	if (notes.error) return { data: null, error: notes.error };

	return {
		data: {
			bond: mapBond(bondResult.data, campaign),
			assignments: (assignments.data ?? []).map((a) => ({
				id: a.id,
				assignmentType: a.assignment_type,
				status: a.status,
				assignedAt: a.assigned_at,
				returnedAt: a.returned_at,
				noteNumber: a.delivery_note?.note_number ?? null
			})),
			notes: (notes.data ?? []).map((n) => ({
				id: n.id,
				noteNumber: n.note_number,
				reason: n.reason,
				status: n.status,
				issuedAt: n.issued_at
			}))
		},
		error: null
	};
}
