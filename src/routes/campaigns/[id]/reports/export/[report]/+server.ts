import { error, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { parseFinancialFilters } from '$lib/domain/financial-reports';
import {
	isExportFormat,
	isReportExportKey,
	REPORT_EXPORTS,
	reportExportFileName
} from '$lib/domain/report-exports';
import { parseReportFilters, todayInBuenosAires } from '$lib/domain/reports';
import { requireActiveUser } from '$lib/server/auth/guards';
import { requirePermissionIn } from '$lib/server/auth/permissions';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { datasetToCsv, datasetToXlsx, loadReportDataset } from '$lib/server/reports/export';

const CSV_TYPE = 'text/csv; charset=utf-8';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * GET /campaigns/[id]/reports/export/[report]?format=csv|xlsx&<report filters> (SAN-87).
 *
 * Exports one report with the same filters as the screen. Requires an active user with
 * `report.export`, `campaign.view` and the view permission of the report (`report.view_operational`
 * or `report.view_financial`); the SQL function checks them again. 403 when denied, 500 when the
 * permissions could not be loaded (`locals.permissions === null`), 404 for an unknown report,
 * campaign or draw, 400 for a bad filter or format. `format` defaults to csv.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	requireActiveUser(locals, url.pathname + url.search);
	requirePermissionIn(locals.permissions, 'report.export');
	requirePermissionIn(locals.permissions, 'campaign.view');
	const { report, id } = params;
	if (!report || !id || !isReportExportKey(report) || !z.guid().safeParse(id).success) {
		error(404, { message: 'Export not found.' });
	}
	const definition = REPORT_EXPORTS[report];
	requirePermissionIn(locals.permissions, definition.permission);

	const format = url.searchParams.get('format')?.trim() || 'csv';
	if (!isExportFormat(format)) error(400, { message: 'Invalid format: use csv or xlsx.' });
	const operational = parseReportFilters(url.searchParams, todayInBuenosAires());
	if (!operational.ok) error(400, { message: operational.message });
	const financial = parseFinancialFilters(url.searchParams);
	if (!financial.ok) error(400, { message: financial.message });

	// A syntactically valid id must also be an existing campaign visible to the caller (RLS).
	const campaign = await getCampaignById(locals.supabase, id);
	if (campaign.error) {
		console.error('[reports] campaign lookup failed', {
			requestId: locals.requestId,
			campaignId: id,
			error: campaign.error
		});
		error(500, { message: 'Could not generate the export. Please try again.' });
	}
	if (!campaign.data) error(404, { message: 'Campaign not found.' });

	const loaded = await loadReportDataset(
		locals.supabase,
		report,
		id,
		operational.filters,
		financial.filters
	);
	if (!loaded.ok) {
		if (loaded.kind === 'invalid') error(400, { message: loaded.message });
		const code = loaded.error.code;
		if (code === '42501')
			error(403, { message: 'You do not have permission to export this report.' });
		if (code === 'P0002') error(404, { message: 'Campaign or draw not found.' });
		console.error('[reports] export failed', {
			requestId: locals.requestId,
			report,
			campaignId: id,
			error: loaded.error
		});
		error(500, { message: 'Could not generate the export. Please try again.' });
	}

	let body: string | Uint8Array;
	try {
		body = format === 'csv' ? datasetToCsv(loaded.dataset) : await datasetToXlsx(loaded.dataset);
	} catch (cause) {
		console.error('[reports] export render failed', {
			requestId: locals.requestId,
			report,
			campaignId: id,
			error: cause
		});
		error(500, { message: 'Could not generate the export. Please try again.' });
	}
	console.info('[reports] export generated', {
		requestId: locals.requestId,
		report,
		format,
		campaignId: id,
		userId: locals.profile?.id
	});
	const fileName = reportExportFileName(report, id, todayInBuenosAires(), format);
	return new Response(body as BodyInit, {
		headers: {
			'content-type': format === 'csv' ? CSV_TYPE : XLSX_TYPE,
			'content-disposition': `attachment; filename="${fileName}"`,
			'cache-control': 'no-store'
		}
	});
};
