import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import {
	buildStatusMatrix,
	parseReportFilters,
	pivotInstallments,
	todayInBuenosAires,
	totalBondsByCollector,
	totalCollectorMonthly
} from '$lib/domain/reports';
import { requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { listActiveCollectorOptions } from '$lib/server/repositories/parties';
import {
	getBondsByCollector,
	getBondsByStatus,
	getCollectorMonthly,
	getInstallmentsReport
} from '$lib/server/repositories/reports';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';

/**
 * /campaigns/[id]/reports: the four operational reports (SAN-86). Requires `campaign.view` and
 * `report.view_operational`; the SQL functions check both again and aggregate server-side.
 * Filters come from the query string (collector, kind, status, financial, month, from, to).
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'report.view_operational');
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

	const parsed = parseReportFilters(url.searchParams, todayInBuenosAires());
	if (!parsed.ok) error(400, { message: parsed.message });
	const filters = parsed.filters;

	const [byStatus, byCollector, installments, monthly, collectors] = await Promise.all([
		getBondsByStatus(locals.supabase, params.id, filters),
		getBondsByCollector(locals.supabase, params.id, filters),
		getInstallmentsReport(locals.supabase, params.id, filters),
		getCollectorMonthly(locals.supabase, params.id, filters),
		listActiveCollectorOptions(locals.supabase)
	]);
	const failed = [byStatus, byCollector, installments, monthly].find((r) => r.error);
	if (failed?.error) {
		console.error('[reports] report load failed', {
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

	return {
		campaign: campaign.data,
		filters,
		collectors: collectors.data ?? [],
		bondsByStatus: buildStatusMatrix(byStatus.data!),
		bondsByCollector: { rows: byCollector.data!, totals: totalBondsByCollector(byCollector.data!) },
		installments: pivotInstallments(installments.data!),
		monthly: { rows: monthly.data!, totals: totalCollectorMonthly(monthly.data!) }
	};
};
