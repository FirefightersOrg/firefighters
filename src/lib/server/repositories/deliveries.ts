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
