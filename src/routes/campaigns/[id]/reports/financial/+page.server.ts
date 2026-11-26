import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { FINANCIAL_VIEWS, reportPage, reportView } from '$lib/report-views';
import {
	countPrizesByStatus,
	parseFinancialFilters,
	pivotPaymentsByDate,
	ROSTER_PAGE_LIMIT,
	totalCollectorAccounts,
	totalSettlements
} from '$lib/domain/financial-reports';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	getCollectorAccounts,
	getCollectorLedger,
	getDrawRosterEntries,
	getDrawRosters,
	getPaymentsByDate,
	getPrizesReport,
	getSettlementsByCollector
} from '$lib/server/repositories/financial-reports';
import { listActiveCollectorOptions } from '$lib/server/repositories/parties';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';

/**
 * /campaigns/[id]/reports/financial: financial and draw reports (SAN-87). Requires `campaign.view`
 * and `report.view_financial`; the SQL functions check both again and aggregate server-side.
 * Filters come from the query string (collector, method, settlement, from, to, draw, eligibility,
 * prize). The collector account detail needs a collector and the roster entries need a draw; the
 * roster shows its first rows only (the export has all of them).
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'report.view_financial');
	if (!z.guid().safeParse(params.id).success) error(404, { message: CAMPAIGN_MESSAGES.notFound });

	const campaign = await getCampaignById(locals.supabase, params.id);
	if (campaign.error) {
		console.error('[reports] campaign load failed', {
			requestId: locals.requestId,
			error: campaign.error
		});
		error(500, { message: 'Could not load the reports. Please try again.' });
	}
	if (!campaign.data) error(404, { message: CAMPAIGN_MESSAGES.notFound });

	const parsed = parseFinancialFilters(url.searchParams);
	if (!parsed.ok) error(400, { message: parsed.message });
	const filters = parsed.filters;

	const [payments, settlements, accounts, draws, prizes, collectors] = await Promise.all([
		getPaymentsByDate(locals.supabase, params.id, filters),
		getSettlementsByCollector(locals.supabase, params.id, filters),
		getCollectorAccounts(locals.supabase, params.id, filters),
		getDrawRosters(locals.supabase, params.id, null),
		getPrizesReport(locals.supabase, params.id, filters),
		listActiveCollectorOptions(locals.supabase)
	]);
	const ledger = filters.collectorId
		? await getCollectorLedger(locals.supabase, params.id, filters.collectorId, filters, 'all')
		: null;
	const roster = filters.drawId
		? await getDrawRosterEntries(
				locals.supabase,
				params.id,
				filters.drawId,
				filters,
				ROSTER_PAGE_LIMIT
			)
		: null;

	const failed = [payments, settlements, accounts, draws, prizes, ledger, roster].find(
		(r) => r?.error
	);
	if (failed?.error) {
		const code = (failed.error as { code?: string }).code;
		if (code === 'P0002') error(404, { message: 'Draw not found.' });
		console.error('[reports] financial report load failed', {
			requestId: locals.requestId,
			campaignId: params.id,
			error: failed.error
		});
		error(500, { message: 'Could not load the reports. Please try again.' });
	}
	if (collectors.error) {
		// The filter list is a convenience (it needs collector.view): the reports still render.
		console.error('[reports] collector options failed', {
			requestId: locals.requestId,
			error: collectors.error
		});
	}

	const drawRows = draws.data!;
	const selectedDraw = filters.drawId
		? (drawRows.find((d) => d.drawId === filters.drawId) ?? null)
		: null;
	return {
		view: reportView(
			url.searchParams,
			FINANCIAL_VIEWS,
			filters.collectorId ? 'ledger' : filters.drawId ? 'roster' : 'payments'
		),
		page: reportPage(url.searchParams.get('page')),
		campaign: campaign.data,
		filters,
		collectors: collectors.data ?? [],
		canExport: hasPermissionIn(locals.permissions, 'report.export'),
		payments: pivotPaymentsByDate(payments.data!),
		settlements: { rows: settlements.data!, totals: totalSettlements(settlements.data!) },
		accounts: { rows: accounts.data!, totals: totalCollectorAccounts(accounts.data!) },
		ledger: ledger?.data ?? null,
		draws: drawRows,
		roster: roster?.data ?? null,
		rosterTruncated: (roster?.data?.length ?? 0) >= ROSTER_PAGE_LIMIT,
		selectedDraw,
		prizes: { rows: prizes.data!, counts: countPrizesByStatus(prizes.data!) }
	};
};
