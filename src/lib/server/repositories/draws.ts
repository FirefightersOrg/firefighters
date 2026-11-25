import type { SupabaseClient } from '@supabase/supabase-js';
import type { RepositoryResult } from './campaigns';
import type { Draw, DrawRoster, DrawRosterEntry, DrawStatus, DrawType } from '$lib/domain/draws';

type Row = Record<string, unknown>;
const PAGE_SIZE = 500;
const snapshotText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const buyerSnapshotName = (value: unknown) => {
	const row = (value ?? {}) as Record<string, unknown>;
	return (
		snapshotText(row.business_name) ||
		[snapshotText(row.first_name), snapshotText(row.last_name)].filter(Boolean).join(' ') ||
		'Sin comprador'
	);
};
const collectorSnapshotName = (value: unknown) => {
	const row = (value ?? {}) as Record<string, unknown>;
	return snapshotText(row.display_name) || 'Sin cobrador';
};
export interface DrawRosterListEntry extends DrawRosterEntry {
	numberKind: 'base' | 'associated' | 'extraordinary';
	bondKind: 'simple' | 'pata';
	bondLabel: string;
	buyerName: string;
	collectorName: string;
}
const mapDraw = (row: Row): Draw => ({
	id: row.id as string,
	campaignId: row.campaign_id as string,
	drawType: row.draw_type as DrawType,
	name: row.name as string,
	drawDate: row.draw_date as string,
	paymentCutoffAt: row.payment_cutoff_at as string,
	requiredInstallmentNumber: row.required_installment_number as number | null,
	eligibilityRule: (row.eligibility_rule ?? {}) as Record<string, unknown>,
	status: row.status as DrawStatus,
	createdAt: row.created_at as string,
	createdBy: row.created_by as string,
	updatedAt: row.updated_at as string,
	annulledAt: row.annulled_at as string | null,
	annulledBy: row.annulled_by as string | null,
	annulReason: row.annul_reason as string | null
});
const mapRoster = (row: Row): DrawRoster => ({
	id: row.id as string,
	drawId: row.draw_id as string,
	status: row.status as DrawRoster['status'],
	generatedAt: row.generated_at as string,
	generatedBy: row.generated_by as string,
	frozenAt: row.frozen_at as string | null,
	frozenBy: row.frozen_by as string | null,
	createdAt: row.created_at as string,
	createdBy: row.created_by as string,
	updatedAt: row.updated_at as string
});
async function pages(
	fetch: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>
): Promise<{ data: Row[] | null; error: unknown }> {
	const all: Row[] = [];
	for (let from = 0; ; from += PAGE_SIZE) {
		const result = await fetch(from, from + PAGE_SIZE - 1);
		if (result.error) return { data: null, error: result.error };
		all.push(...(result.data ?? []));
		if (!result.data || result.data.length < PAGE_SIZE) return { data: all, error: null };
	}
}
export async function listDraws(
	client: SupabaseClient,
	campaignId: string,
	filters: { type?: DrawType | null; status?: DrawStatus | null } = {}
): Promise<RepositoryResult<Draw[]>> {
	let query = client.from('draws').select('*').eq('campaign_id', campaignId);
	if (filters.type) query = query.eq('draw_type', filters.type);
	if (filters.status) query = query.eq('status', filters.status);
	query = query
		.order('draw_date', { ascending: false })
		.order('created_at', { ascending: false })
		.order('id');
	const result = await pages((from, to) =>
		query.range(from, to).overrideTypes<Row[], { merge: false }>()
	);
	if (result.error) return { data: null, error: result.error as Error };
	return { data: (result.data ?? []).map(mapDraw), error: null };
}
export async function getDraw(
	client: SupabaseClient,
	campaignId: string,
	drawId: string
): Promise<RepositoryResult<Draw | null>> {
	const { data, error } = await client
		.from('draws')
		.select('*')
		.eq('campaign_id', campaignId)
		.eq('id', drawId)
		.maybeSingle()
		.overrideTypes<Row | null, { merge: false }>();
	return error || !data ? { data: null, error } : { data: mapDraw(data), error: null };
}
export async function getCurrentDrawRoster(
	client: SupabaseClient,
	drawId: string
): Promise<RepositoryResult<DrawRoster | null>> {
	const { data, error } = await client
		.from('draw_rosters')
		.select('*')
		.eq('draw_id', drawId)
		.in('status', ['generated', 'frozen'])
		.order('status', { ascending: true })
		.order('generated_at', { ascending: false })
		.order('id')
		.limit(1)
		.maybeSingle()
		.overrideTypes<Row | null, { merge: false }>();
	return error || !data ? { data: null, error } : { data: mapRoster(data), error: null };
}
/** SAN-152: legacy rosters frozen before the change may hold extra ('extraordinary') numbers. */
export async function rosterHasLegacyExtras(
	client: SupabaseClient,
	rosterId: string
): Promise<RepositoryResult<boolean>> {
	const { count, error } = await client
		.from('draw_roster_entries')
		.select('id, bond_numbers!inner(number_kind)', { count: 'exact', head: true })
		.eq('draw_roster_id', rosterId)
		.eq('bond_numbers.number_kind', 'extraordinary');
	return error ? { data: null, error } : { data: (count ?? 0) > 0, error: null };
}
const mapEntry = (row: Row): DrawRosterListEntry => {
	const number = (row.bond_numbers ?? {}) as Row;
	const bond = (row.bonds ?? {}) as Row;
	return {
		id: row.id as string,
		drawRosterId: row.draw_roster_id as string,
		bondId: row.bond_id as string,
		bondNumberId: row.bond_number_id as string,
		numberValue: row.number_value as number,
		buyerSnapshot: (row.buyer_snapshot ?? {}) as Record<string, unknown>,
		collectorSnapshot: (row.collector_snapshot ?? {}) as Record<string, unknown>,
		eligible: Boolean(row.eligible),
		ineligibilityReason: row.ineligibility_reason as string | null,
		createdAt: row.created_at as string,
		createdBy: row.created_by as string,
		updatedAt: row.updated_at as string,
		numberKind: (number.number_kind ?? 'base') as DrawRosterListEntry['numberKind'],
		bondKind: (bond.kind ?? 'simple') as DrawRosterListEntry['bondKind'],
		bondLabel: String(bond.internal_code ?? '—'),
		buyerName: buyerSnapshotName(row.buyer_snapshot),
		collectorName: collectorSnapshotName(row.collector_snapshot)
	};
};
export async function listDrawRosterEntries(
	client: SupabaseClient,
	rosterId: string
): Promise<RepositoryResult<DrawRosterListEntry[]>> {
	const query = client
		.from('draw_roster_entries')
		.select('*, bond_numbers(number_kind), bonds(kind, internal_code)')
		.eq('draw_roster_id', rosterId)
		.order('number_value')
		.order('id');
	const result = await pages((from, to) =>
		query.range(from, to).overrideTypes<Row[], { merge: false }>()
	);
	if (result.error) return { data: null, error: result.error as Error };
	return { data: (result.data ?? []).map(mapEntry), error: null };
}
export async function listBondDrawRosterEntries(
	client: SupabaseClient,
	campaignId: string,
	bondId: string
): Promise<RepositoryResult<(DrawRosterListEntry & { draw: Draw; roster: DrawRoster })[]>> {
	const query = client
		.from('draw_roster_entries')
		.select(
			'*, bond_numbers(number_kind), bonds(kind, internal_code), draw_rosters!inner(*, draws!inner(*))'
		)
		.eq('bond_id', bondId)
		.eq('draw_rosters.draws.campaign_id', campaignId)
		.in('draw_rosters.status', ['generated', 'frozen'])
		.order('number_value')
		.order('id');
	const result = await pages((from, to) =>
		query.range(from, to).overrideTypes<Row[], { merge: false }>()
	);
	if (result.error) return { data: null, error: result.error as Error };
	return {
		data: (result.data ?? []).map((row) => {
			const rosterRow = row.draw_rosters as Row;
			return {
				...mapEntry(row),
				roster: mapRoster(rosterRow),
				draw: mapDraw(rosterRow.draws as Row)
			};
		}),
		error: null
	};
}
