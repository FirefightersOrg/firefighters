import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { BACKUP_EXPORTS, BACKUP_EXPORT_KINDS } from '$lib/domain/backup-exports';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';

/** /campaigns/[id]/backups: on-demand CSV exports. Requires `campaign.view` and `report.export`. */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'report.export');
	if (!z.guid().safeParse(params.id).success) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	const result = await getCampaignById(locals.supabase, params.id);
	if (result.error) {
		console.error('[backups] campaign load failed', {
			requestId: locals.requestId,
			error: result.error
		});
		error(500, { message: 'No se pudo cargar la campaña. Volver a intentar.' });
	}
	if (!result.data) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	return {
		campaign: result.data,
		exports: BACKUP_EXPORT_KINDS.map((kind) => ({
			kind,
			label: BACKUP_EXPORTS[kind].label,
			// UI hint: the export route re-checks every permission.
			allowed: BACKUP_EXPORTS[kind].permissions.every((p) =>
				hasPermissionIn(locals.permissions, p)
			),
			hasPeriod: Boolean(BACKUP_EXPORTS[kind].periodColumn)
		}))
	};
};
