import { error, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import {
	BACKUP_EXPORTS,
	exportDateInBuenosAires,
	exportFileName,
	isBackupExportKind,
	parseExportPeriod
} from '$lib/domain/backup-exports';
import { requireActiveUser } from '$lib/server/auth/guards';
import { requirePermissionIn } from '$lib/server/auth/permissions';
import { streamExportCsv } from '$lib/server/backups/export';
import { getCampaignById } from '$lib/server/repositories/campaigns';

/**
 * GET /campaigns/[id]/backups/export/[kind]?from=YYYY-MM-DD&to=YYYY-MM-DD (SAN-90).
 *
 * On-demand CSV backup export, read-only. Requires an active user with `report.export` plus the
 * view permission of the exported data (RLS still applies). 403 when denied, 500 when the
 * permissions could not be loaded (`locals.permissions === null`), 404 unknown kind/campaign id,
 * 400 malformed period. `from`/`to` filter payments by `payment_date` and the ledger by
 * `occurred_at` (Argentina time); other exports ignore them.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	requireActiveUser(locals, url.pathname + url.search);
	requirePermissionIn(locals.permissions, 'report.export');
	const { kind, id } = params;
	if (!kind || !id || !isBackupExportKind(kind) || !z.guid().safeParse(id).success) {
		error(404, { message: 'Exportación no encontrada.' });
	}
	const def = BACKUP_EXPORTS[kind];
	for (const permission of def.permissions) requirePermissionIn(locals.permissions, permission);

	const period = parseExportPeriod(url.searchParams.get('from'), url.searchParams.get('to'));
	if (!period)
		error(400, {
			message:
				'Período inválido: usar desde/hasta como AAAA-MM-DD, con desde anterior o igual a hasta.'
		});

	// A syntactically valid id must also be an existing campaign visible to the caller (RLS).
	const campaign = await getCampaignById(locals.supabase, id);
	if (campaign.error) {
		console.error('[backups] campaign lookup failed', {
			requestId: locals.requestId,
			campaignId: id,
			error: campaign.error
		});
		error(500, { message: 'No se pudo generar la exportación. Intentar nuevamente.' });
	}
	if (!campaign.data) error(404, { message: 'Campaña no encontrada.' });

	let body: ReadableStream<Uint8Array>;
	try {
		body = await streamExportCsv(locals.supabase, kind, id, period);
	} catch (cause) {
		console.error('[backups] export failed', {
			requestId: locals.requestId,
			kind,
			campaignId: id,
			error: cause
		});
		error(500, { message: 'No se pudo generar la exportación. Intentar nuevamente.' });
	}
	console.info('[backups] export generated', {
		requestId: locals.requestId,
		kind,
		campaignId: id,
		userId: locals.profile?.id
	});
	const today = exportDateInBuenosAires();
	return new Response(body, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${exportFileName(kind, id, today)}"`,
			'cache-control': 'no-store'
		}
	});
};
