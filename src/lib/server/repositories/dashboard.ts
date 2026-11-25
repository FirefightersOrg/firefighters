/**
 * Campaign dashboard (SAN-85): the next draw and its at-risk bonds, from the read-only
 * `dashboard_next_draw` / `dashboard_at_risk_bonds` SQL functions (permission `report.view_operational`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AtRiskBond, NextDraw } from '$lib/domain/dashboard';
import type { RepositoryResult } from './campaigns';

type Raw = Record<string, unknown>;
const optNum = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const optStr = (v: unknown) => (v === null || v === undefined ? null : String(v));

export async function getNextDraw(
	supabase: SupabaseClient,
	campaignId: string
): Promise<RepositoryResult<NextDraw | null>> {
	const { data, error } = await supabase.rpc('dashboard_next_draw', { p_campaign_id: campaignId });
	if (error) return { data: null, error };
	const r = ((data ?? []) as Raw[])[0];
	if (!r) return { data: null, error: null };
	return {
		data: {
			id: String(r.draw_id),
			name: String(r.draw_name),
			type: String(r.draw_type),
			drawDate: String(r.draw_date),
			paymentCutoffAt: String(r.payment_cutoff_at),
			requiredInstallmentNumber: optNum(r.required_installment_number),
			status: String(r.draw_status),
			atRiskCount: Number(r.at_risk_count ?? 0)
		},
		error: null
	};
}

export async function getAtRiskBonds(
	supabase: SupabaseClient,
	campaignId: string,
	drawId: string,
	limit: number
): Promise<RepositoryResult<AtRiskBond[]>> {
	const { data, error } = await supabase.rpc('dashboard_at_risk_bonds', {
		p_campaign_id: campaignId,
		p_draw_id: drawId,
		p_limit: limit,
		p_offset: 0
	});
	if (error) return { data: null, error };
	return {
		data: ((data ?? []) as Raw[]).map((r) => ({
			bondId: String(r.bond_id),
			kind: String(r.bond_kind),
			baseNumber: optNum(r.base_number),
			collectorId: optStr(r.collector_id),
			collectorName: optStr(r.collector_name),
			missingInstallments: Number(r.missing_installments ?? 0),
			requiredInstallments: optNum(r.required_installments),
			totalCount: Number(r.total_count ?? 0)
		})),
		error: null
	};
}
