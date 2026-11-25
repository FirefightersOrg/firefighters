import type { SupabaseClient } from '@supabase/supabase-js';
import type { RepositoryResult } from './campaigns';
import type { PrizeStatus, WinningNumberStatus } from '$lib/domain/prizes';

type Row = Record<string, unknown>;
const PAGE_SIZE = 500;

const object = (value: unknown): Row | null =>
	Array.isArray(value) ? ((value[0] as Row | undefined) ?? null) : ((value as Row | null) ?? null);
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const buyerLabel = (snapshot: unknown) => {
	const row = (snapshot ?? {}) as Row;
	return (
		text(row.business_name) ||
		[text(row.first_name), text(row.last_name)].filter(Boolean).join(' ') ||
		'Sin comprador'
	);
};

export interface PrizeWinningNumber {
	id: string;
	numberValue: number;
	resultStatus: WinningNumberStatus;
	notes: string | null;
	loadedAt: string;
	matchedRosterEntryId: string | null;
	eligible: boolean | null;
	ineligibilityReason: string | null;
	bondId: string | null;
	bondLabel: string | null;
	buyerLabel: string | null;
	collectorLabel: string | null;
}

export interface PrizeListItem {
	id: string;
	drawId: string;
	name: string;
	description: string | null;
	position: number;
	status: PrizeStatus;
	excludesFromConsolation: boolean;
	annulledAt: string | null;
	annulReason: string | null;
	winningNumber: PrizeWinningNumber | null;
}

export interface PrizeRecordItem {
	id: string;
	drawId: string;
	drawName: string;
	name: string;
	position: number;
	status: PrizeStatus;
	deliveredAt: string | null;
}

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

const mapPrize = (row: Row): PrizeListItem => {
	const winner = object(row.winning_numbers);
	const entry = winner ? object(winner.draw_roster_entries) : null;
	const bond = entry ? object(entry.bonds) : null;
	return {
		id: row.id as string,
		drawId: row.draw_id as string,
		name: row.name as string,
		description: row.description as string | null,
		position: row.position as number,
		status: row.status as PrizeStatus,
		excludesFromConsolation: Boolean(row.excludes_from_consolation),
		annulledAt: row.annulled_at as string | null,
		annulReason: row.annul_reason as string | null,
		winningNumber: winner
			? {
					id: winner.id as string,
					numberValue: winner.number_value as number,
					resultStatus: winner.result_status as WinningNumberStatus,
					notes: winner.notes as string | null,
					loadedAt: winner.loaded_at as string,
					matchedRosterEntryId: winner.matched_roster_entry_id as string | null,
					eligible: entry ? Boolean(entry.eligible) : null,
					ineligibilityReason: entry ? (entry.ineligibility_reason as string | null) : null,
					bondId: entry ? (entry.bond_id as string) : null,
					bondLabel: entry ? text(bond?.internal_code) || null : null,
					buyerLabel: entry ? buyerLabel(entry.buyer_snapshot) : null,
					collectorLabel: entry
						? text(((entry.collector_snapshot ?? {}) as Row).display_name) || 'Sin cobrador'
						: null
				}
			: null
	};
};

const PRIZE_SELECT = '*, winning_numbers(*, draw_roster_entries(*, bonds(internal_code)))';

export async function listDrawPrizes(
	client: SupabaseClient,
	drawId: string
): Promise<RepositoryResult<PrizeListItem[]>> {
	const query = client
		.from('prizes')
		.select(PRIZE_SELECT)
		.eq('draw_id', drawId)
		.order('position')
		.order('created_at')
		.order('id');
	const result = await pages((from, to) =>
		query.range(from, to).overrideTypes<Row[], { merge: false }>()
	);
	return result.error
		? { data: null, error: result.error as Error }
		: { data: (result.data ?? []).map(mapPrize), error: null };
}

export async function getPrizeInDraw(
	client: SupabaseClient,
	drawId: string,
	prizeId: string
): Promise<RepositoryResult<PrizeListItem | null>> {
	const { data, error } = await client
		.from('prizes')
		.select(PRIZE_SELECT)
		.eq('draw_id', drawId)
		.eq('id', prizeId)
		.maybeSingle()
		.overrideTypes<Row | null, { merge: false }>();
	return error || !data ? { data: null, error } : { data: mapPrize(data), error: null };
}

const mapRecordPrize = (row: Row): PrizeRecordItem => {
	const prize = object(row.prizes) ?? {};
	const draw = object(prize.draws) ?? {};
	return {
		id: prize.id as string,
		drawId: draw.id as string,
		drawName: draw.name as string,
		name: prize.name as string,
		position: prize.position as number,
		status: prize.status as PrizeStatus,
		deliveredAt: row.delivered_at as string | null
	};
};

async function listAwardPrizes(
	client: SupabaseClient,
	filter: 'bond_id' | 'buyer_id',
	id: string,
	campaignId: string
): Promise<RepositoryResult<PrizeRecordItem[]>> {
	const query = client
		.from('prize_awards')
		.select('*, prizes!inner(*, draws!inner(id, name, campaign_id, draw_date, created_at))')
		.eq(filter, id)
		.eq('prizes.draws.campaign_id', campaignId)
		.order('awarded_at', { ascending: false })
		.order('id');
	const result = await pages((from, to) =>
		query.range(from, to).overrideTypes<Row[], { merge: false }>()
	);
	return result.error
		? { data: null, error: result.error as Error }
		: { data: (result.data ?? []).map(mapRecordPrize), error: null };
}

export const listBondPrizes = (client: SupabaseClient, campaignId: string, bondId: string) =>
	listAwardPrizes(client, 'bond_id', bondId, campaignId);

export const listBuyerPrizes = (client: SupabaseClient, campaignId: string, buyerId: string) =>
	listAwardPrizes(client, 'buyer_id', buyerId, campaignId);
