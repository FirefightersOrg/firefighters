import type { SupabaseClient } from '@supabase/supabase-js';
import {
	ASSIGNMENT_STATUSES,
	ASSIGNMENT_TYPES,
	DELIVERY_NOTE_REASONS,
	type AssignmentStatus,
	type AssignmentType,
	type BondAssignment,
	type DeliveryNote,
	type DeliveryNoteReason
} from '$lib/domain/deliveries';
import type { RepositoryResult } from './campaigns';
import { mapBondListRow, BOND_LIST_COLUMNS, type BondListEntry, type BondListRow } from './bonds';

/**
 * Read access to delivery notes and bond custody history under the caller's RLS (bond.view or a
 * delivery permission; a collector's own login sees its own). Writes go through the audited SQL
 * functions (services/deliveries.ts).
 */
export const DELIVERY_NOTES_PAGE_SIZE = 25;

interface NoteRow {
	id: string;
	campaign_id: string;
	note_number: number;
	collector_id: string;
	status: string;
	reason: string;
	issued_at: string;
	created_by: string;
	notes: string | null;
	collectors: { display_name: string } | null;
	profiles: { full_name: string } | null;
	delivery_note_items: { count: number }[];
}

interface AssignmentRow {
	id: string;
	bond_id: string;
	collector_id: string | null;
	assignment_type: string;
	status: string;
	assigned_at: string;
	returned_at: string | null;
	created_by: string;
	notes: string | null;
	delivery_note_id: string | null;
	responsible_party: string | null;
	lost_on: string | null;
	collectors: { display_name: string } | null;
	delivery_notes: { note_number: number } | null;
}

const NOTE_SELECT =
	'id, campaign_id, note_number, collector_id, status, reason, issued_at, created_by, notes, collectors(display_name), profiles!delivery_notes_created_by_fkey(full_name), delivery_note_items(count)';
const ASSIGNMENT_SELECT =
	'id, bond_id, collector_id, assignment_type, status, assigned_at, returned_at, created_by, notes, delivery_note_id, responsible_party, lost_on, collectors(display_name), delivery_notes(note_number)';

function oneOf<T extends string>(values: readonly T[], value: string, what: string): T {
	if (!(values as readonly string[]).includes(value))
		throw new Error(`unexpected ${what}: ${value}`);
	return value as T;
}

export function mapNoteRow(row: NoteRow): DeliveryNote {
	return {
		id: row.id,
		campaignId: row.campaign_id,
		noteNumber: row.note_number,
		collectorId: row.collector_id,
		collectorName: row.collectors?.display_name ?? null,
		status: oneOf(['issued', 'annulled'] as const, row.status, 'note status'),
		reason: oneOf<DeliveryNoteReason>(DELIVERY_NOTE_REASONS, row.reason, 'note reason'),
		issuedAt: row.issued_at,
		createdBy: row.created_by,
		createdByName: row.profiles?.full_name ?? null,
		notes: row.notes,
		bondCount: row.delivery_note_items?.[0]?.count ?? 0
	};
}

export function mapAssignmentRow(row: AssignmentRow): BondAssignment {
	return {
		id: row.id,
		bondId: row.bond_id,
		collectorId: row.collector_id,
		collectorName: row.collectors?.display_name ?? null,
		assignmentType: oneOf<AssignmentType>(ASSIGNMENT_TYPES, row.assignment_type, 'assignment type'),
		status: oneOf<AssignmentStatus>(ASSIGNMENT_STATUSES, row.status, 'assignment status'),
		assignedAt: row.assigned_at,
		returnedAt: row.returned_at,
		createdBy: row.created_by,
		notes: row.notes,
		deliveryNoteId: row.delivery_note_id,
		noteNumber: row.delivery_notes?.note_number ?? null,
		responsibleParty: row.responsible_party,
		lostOn: row.lost_on
	};
}

function wrap<T>(map: () => T): RepositoryResult<T> {
	try {
		return { data: map(), error: null };
	} catch (err) {
		return { data: null, error: err as Error };
	}
}

/** Delivery notes of a campaign, newest first, optionally by collector or note number. */
export async function listDeliveryNotes(
	supabase: SupabaseClient,
	campaignId: string,
	options: {
		collectorId?: string | null;
		noteNumber?: number | null;
		from?: string | null;
		to?: string | null;
		page?: number;
		pageSize?: number;
	} = {}
): Promise<
	RepositoryResult<{ items: DeliveryNote[]; total: number; page: number; pageSize: number }>
> {
	const pageSize = options.pageSize ?? DELIVERY_NOTES_PAGE_SIZE;
	const page = Math.max(1, options.page ?? 1);
	let query = supabase
		.from('delivery_notes')
		.select(NOTE_SELECT, { count: 'exact' })
		.eq('campaign_id', campaignId);
	if (options.collectorId) query = query.eq('collector_id', options.collectorId);
	if (options.noteNumber) query = query.eq('note_number', options.noteNumber);
	if (options.from) query = query.gte('issued_at', options.from);
	if (options.to) query = query.lte('issued_at', `${options.to}T23:59:59.999Z`);
	const { data, error, count } = await query
		.order('note_number', { ascending: false })
		.range((page - 1) * pageSize, page * pageSize - 1)
		.overrideTypes<NoteRow[], { merge: false }>();
	if (error) return { data: null, error };
	return wrap(() => ({ items: (data ?? []).map(mapNoteRow), total: count ?? 0, page, pageSize }));
}

/** One note of a campaign with the ids of its bonds, or null. */
export async function getDeliveryNote(
	supabase: SupabaseClient,
	campaignId: string,
	noteId: string
): Promise<RepositoryResult<{ note: DeliveryNote; bondIds: string[] } | null>> {
	const { data, error } = await supabase
		.from('delivery_notes')
		.select(NOTE_SELECT)
		.eq('id', noteId)
		.eq('campaign_id', campaignId)
		.maybeSingle()
		.overrideTypes<NoteRow | null, { merge: false }>();
	if (error) return { data: null, error };
	if (!data) return { data: null, error: null };
	const items = await supabase
		.from('delivery_note_items')
		.select('bond_id')
		.eq('delivery_note_id', noteId)
		.overrideTypes<{ bond_id: string }[], { merge: false }>();
	if (items.error) return { data: null, error: items.error };
	return wrap(() => ({
		note: mapNoteRow(data),
		bondIds: (items.data ?? []).map((i) => i.bond_id)
	}));
}

/** A delivered bond and the numbers printed on a delivery note. */
export interface DeliveryNoteBond {
	id: string;
	kind: 'simple' | 'pata';
	commercialUnitCount: number;
	barcode: string | null;
	numbers: {
		id: string;
		value: number;
		kind: 'base' | 'associated' | 'extraordinary';
		sourceBaseNumberId: string | null;
		barcode: string | null;
	}[];
	/** Simple members of a manually grouped pata (empty for printed bonds). */
	members: DeliveryNoteBond[];
}

interface DeliveryBondRow {
	id: string;
	kind: 'simple' | 'pata';
	commercial_unit_count: number;
	barcode: string | null;
	numbers: {
		id: string;
		number_value: number;
		number_kind: 'base' | 'associated' | 'extraordinary';
		source_base_number_id: string | null;
		barcode: string | null;
	}[];
	groups: {
		ungrouped_at: string | null;
		member: Omit<DeliveryBondRow, 'groups'> | null;
	}[];
}

function mapDeliveryBond(row: DeliveryBondRow): DeliveryNoteBond {
	return {
		id: row.id,
		kind: row.kind,
		commercialUnitCount: row.commercial_unit_count,
		barcode: row.barcode,
		numbers: (row.numbers ?? []).map((number) => ({
			id: number.id,
			value: number.number_value,
			kind: number.number_kind,
			sourceBaseNumberId: number.source_base_number_id,
			barcode: number.barcode
		})),
		// Only the current members of a manual pata (an ungrouped membership is history).
		members: (row.groups ?? []).flatMap((group) =>
			group.member && group.ungrouped_at === null
				? [mapDeliveryBond({ ...group.member, groups: [] })]
				: []
		)
	};
}

/**
 * Bonds on a note, including their participating numbers and barcodes. A manual pata exposes the
 * numbers (and per-base barcode) of each leg, because it owns no numbers itself.
 */
export async function listDeliveryNoteBonds(
	supabase: SupabaseClient,
	noteId: string
): Promise<RepositoryResult<DeliveryNoteBond[]>> {
	const { data, error } = await supabase
		.from('delivery_note_items')
		.select(
			'bond:bonds!delivery_note_items_bond_fkey(' +
				'id, kind, commercial_unit_count, barcode, ' +
				'numbers:bond_numbers(id, number_value, number_kind, source_base_number_id, barcode), ' +
				'groups:bond_groups!bond_groups_pata_bond_id_fkey(ungrouped_at, ' +
				'member:bonds!bond_groups_member_bond_id_fkey(id, kind, commercial_unit_count, barcode, ' +
				'numbers:bond_numbers(id, number_value, number_kind, source_base_number_id, barcode)))' +
				')'
		)
		.eq('delivery_note_id', noteId)
		.overrideTypes<{ bond: DeliveryBondRow | null }[], { merge: false }>();
	if (error) return { data: null, error };
	try {
		return {
			data: (data ?? []).flatMap((item) => (item.bond ? [mapDeliveryBond(item.bond)] : [])),
			error: null
		};
	} catch (cause) {
		return { data: null, error: cause as Error };
	}
}

/** Custody history of one bond, oldest first. */
export async function listBondAssignments(
	supabase: SupabaseClient,
	bondId: string
): Promise<RepositoryResult<BondAssignment[]>> {
	const { data, error } = await supabase
		.from('bond_assignments')
		.select(ASSIGNMENT_SELECT)
		.eq('bond_id', bondId)
		.order('assigned_at', { ascending: true })
		.order('id', { ascending: true })
		.overrideTypes<AssignmentRow[], { merge: false }>();
	if (error) return { data: null, error };
	return wrap(() => (data ?? []).map(mapAssignmentRow));
}

/** Available campaign bonds matching a participating number, barcode or internal code. */
export async function findAvailableBonds(
	supabase: SupabaseClient,
	campaignId: string,
	options: {
		number?: number | null;
		code?: string | null;
		from?: number | null;
		to?: number | null;
	}
): Promise<RepositoryResult<BondListEntry[]>> {
	let query = supabase
		.from('bond_list')
		.select(BOND_LIST_COLUMNS)
		.eq('campaign_id', campaignId)
		.eq('commercial_status', 'available')
		// Members of a manual pata are delivered with their pata, never alone.
		.is('group_pata_id', null);
	if (options.number != null) {
		query = query.or(
			`base_numbers.cs.{${options.number}},associated_numbers.cs.{${options.number}}`
		);
	}
	if (options.code)
		query = query.or(
			`barcode.eq."${options.code.replace(/["\\]/g, '\\$&')}",internal_code.eq."${options.code.replace(/["\\]/g, '\\$&')}"`
		);
	if (options.from != null) query = query.gte('sort_number', options.from);
	if (options.to != null) query = query.lte('sort_number', options.to);
	const { data, error } = await query
		.order('sort_number', { ascending: true })
		.limit(500)
		.overrideTypes<BondListRow[], { merge: false }>();
	if (error) return { data: null, error };
	return wrap(() => (data ?? []).map(mapBondListRow));
}

/** Bonds of the campaign by id, as list entries (for a note's detail). */
export async function listBondEntriesByIds(
	supabase: SupabaseClient,
	campaignId: string,
	ids: readonly string[]
): Promise<RepositoryResult<BondListEntry[]>> {
	if (ids.length === 0) return { data: [], error: null };
	const { data, error } = await supabase
		.from('bond_list')
		.select(BOND_LIST_COLUMNS)
		.eq('campaign_id', campaignId)
		.in('id', [...ids])
		.order('sort_number', { ascending: true })
		.overrideTypes<BondListRow[], { merge: false }>();
	if (error) return { data: null, error };
	return wrap(() => (data ?? []).map(mapBondListRow));
}

/** The note behind each bond's active custody (delivery or reassignment), keyed by bond id. */
export async function listActiveAssignmentNotes(
	supabase: SupabaseClient,
	bondIds: readonly string[]
): Promise<RepositoryResult<Map<string, { noteId: string; noteNumber: number }>>> {
	if (bondIds.length === 0) return { data: new Map(), error: null };
	const { data, error } = await supabase
		.from('bond_assignments')
		.select('bond_id, delivery_note_id, delivery_notes(note_number)')
		.in('bond_id', [...bondIds])
		.eq('status', 'active')
		.overrideTypes<
			{
				bond_id: string;
				delivery_note_id: string | null;
				delivery_notes: { note_number: number } | null;
			}[],
			{ merge: false }
		>();
	if (error) return { data: null, error };
	const notes = new Map<string, { noteId: string; noteNumber: number }>();
	for (const row of data ?? []) {
		if (row.delivery_note_id && row.delivery_notes) {
			notes.set(row.bond_id, {
				noteId: row.delivery_note_id,
				noteNumber: row.delivery_notes.note_number
			});
		}
	}
	return { data: notes, error: null };
}
