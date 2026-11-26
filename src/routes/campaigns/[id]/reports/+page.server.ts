import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { OPERATIONAL_VIEWS, reportPage, reportView } from '$lib/report-views';
import {
	buildStatusMatrix,
	parseReportFilters,
	pivotInstallments,
	todayInBuenosAires,
	totalBondsByCollector,
	totalCollectorMonthly
} from '$lib/domain/reports';
import {
	hasPermissionIn,
	permissionsUnavailable,
	requirePermissionIn
} from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { listActiveCollectorOptions } from '$lib/server/repositories/parties';
import {
	getBondsByCollector,
	getBondsByStatus,
	getCollectorMonthly,
	getInstallmentsReport,
	getOverdueSales,
	getOverdueWarningThreshold
} from '$lib/server/repositories/reports';
import {
	OverdueWarningServiceError,
	setOverdueWarningThreshold
} from '$lib/server/services/overdue-warning';
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

	const [byStatus, byCollector, installments, monthly, overdue, threshold, collectors] =
		await Promise.all([
			getBondsByStatus(locals.supabase, params.id, filters),
			getBondsByCollector(locals.supabase, params.id, filters),
			getInstallmentsReport(locals.supabase, params.id, filters),
			getCollectorMonthly(locals.supabase, params.id, filters),
			getOverdueSales(locals.supabase, params.id, filters),
			getOverdueWarningThreshold(locals.supabase, params.id),
			listActiveCollectorOptions(locals.supabase)
		]);
	const failed = [byStatus, byCollector, installments, monthly, overdue, threshold].find(
		(r) => r.error
	);
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
		view: reportView(url.searchParams, OPERATIONAL_VIEWS),
		page: reportPage(url.searchParams.get('page')),
		canViewCollectors: hasPermissionIn(locals.permissions, 'collector.view'),
		campaign: campaign.data,
		filters,
		collectors: collectors.data ?? [],
		canExport: hasPermissionIn(locals.permissions, 'report.export'),
		canViewFinancial: hasPermissionIn(locals.permissions, 'report.view_financial'),
		bondsByStatus: buildStatusMatrix(byStatus.data!),
		bondsByCollector: { rows: byCollector.data!, totals: totalBondsByCollector(byCollector.data!) },
		installments: pivotInstallments(installments.data!),
		monthly: { rows: monthly.data!, totals: totalCollectorMonthly(monthly.data!) },
		/** SAN-142: informative warning; it marks nothing. */
		overdueWarning: {
			threshold: threshold.data!,
			sales: overdue.data!,
			canEdit:
				hasPermissionIn(locals.permissions, 'campaign.update_rules') &&
				!['closed', 'annulled'].includes(campaign.data.status),
			canViewSales: hasPermissionIn(locals.permissions, 'sale.view')
		}
	};
};

export const actions: Actions = {
	setOverdueThreshold: async ({ request, locals, params, url }) => {
		const form = 'setOverdueThreshold';
		if (permissionsUnavailable(locals.permissions))
			return fail(500, { form, message: 'No se pudieron cargar los permisos.' });
		requireCampaignViewer(locals, url);
		// Same gate as the page (report.view_operational) plus the rules permission; SQL rechecks.
		if (
			!hasPermissionIn(locals.permissions, 'report.view_operational') ||
			!hasPermissionIn(locals.permissions, 'campaign.update_rules')
		)
			return fail(403, { form, message: 'No hay permiso para esta acción.' });
		const threshold = String((await request.formData()).get('threshold') ?? '').trim();
		try {
			const saved = await setOverdueWarningThreshold(
				locals.supabase,
				{ campaignId: params.id, threshold },
				{ requestId: locals.requestId ?? null, permissions: locals.permissions ?? null }
			);
			return {
				form,
				success: true,
				message: `Aviso actualizado: desde ${saved} ${saved === 1 ? 'cuota vencida' : 'cuotas vencidas'}.`
			};
		} catch (cause) {
			const service = cause instanceof OverdueWarningServiceError ? cause : null;
			const message = service?.message ?? 'No se pudo actualizar el aviso.';
			// A validation error belongs to the field (aria-describedby); the rest goes to the alert.
			return fail(service?.status ?? 500, {
				form,
				threshold,
				fieldError: service?.kind === 'validation' ? message : null,
				message: service?.kind === 'validation' ? null : message
			});
		}
	}
};
