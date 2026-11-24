import type { SupabaseClient } from '@supabase/supabase-js';
import type { RepositoryResult } from './campaigns';

type Snapshot = Record<string, unknown>;

export interface PrizeCertificateSource {
	campaignId: string;
	drawId: string;
	drawName: string;
	drawType: string;
	drawDate: string;
	prizeId: string;
	prizeName: string;
	prizePosition: number;
	prizeStatus: string;
	winningNumber: number | null;
	winnerStatus: string | null;
	winnerNotes: string | null;
	rosterEligible: boolean | null;
	ineligibilityReason: string | null;
	buyerSnapshot: Snapshot | null;
	collectorSnapshot: Snapshot | null;
	bondId: string | null;
	bondLabel: string | null;
	awardStatus: string | null;
	deliveredAt: string | null;
	deliveryNotes: string | null;
	deliveredByName: string | null;
	unawardedByName: string | null;
	unawardedAt: string | null;
	resolutionNotes: string | null;
}

const value = (data: unknown): Record<string, unknown> =>
	(Array.isArray(data) ? data[0] : data) as Record<string, unknown>;

export async function getPrizeCertificateData(
	client: SupabaseClient,
	prizeId: string
): Promise<RepositoryResult<PrizeCertificateSource | null>> {
	const { data, error } = await client.rpc('prize_certificate_data', { p_prize_id: prizeId });
	if (error) return { data: null, error };
	if (!data) return { data: null, error: null };
	const row = value(data);
	return {
		data: {
			campaignId: row.campaign_id as string,
			drawId: row.draw_id as string,
			drawName: row.draw_name as string,
			drawType: row.draw_type as string,
			drawDate: row.draw_date as string,
			prizeId: row.prize_id as string,
			prizeName: row.prize_name as string,
			prizePosition: row.prize_position as number,
			prizeStatus: row.prize_status as string,
			winningNumber: row.winning_number as number | null,
			winnerStatus: row.winner_status as string | null,
			winnerNotes: row.winner_notes as string | null,
			rosterEligible: row.roster_eligible as boolean | null,
			ineligibilityReason: row.ineligibility_reason as string | null,
			buyerSnapshot: row.buyer_snapshot as Snapshot | null,
			collectorSnapshot: row.collector_snapshot as Snapshot | null,
			bondId: row.bond_id as string | null,
			bondLabel: row.bond_label as string | null,
			awardStatus: row.award_status as string | null,
			deliveredAt: row.delivered_at as string | null,
			deliveryNotes: row.delivery_notes as string | null,
			deliveredByName: row.delivered_by_name as string | null,
			unawardedByName: row.unawarded_by_name as string | null,
			unawardedAt: row.unawarded_at as string | null,
			resolutionNotes: row.resolution_notes as string | null
		},
		error: null
	};
}
