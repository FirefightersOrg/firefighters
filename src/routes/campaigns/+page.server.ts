import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { listCampaigns } from '$lib/server/repositories/campaigns';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCampaignViewer(locals, url);

	const result = await listCampaigns(locals.supabase);
	if (result.error) {
		console.error('[campaigns] list failed', { requestId: locals.requestId, error: result.error });
		error(500, { message: 'No se pudieron cargar las campañas. Volver a intentar.' });
	}

	return {
		campaigns: result.data,
		canCreate: hasPermissionIn(locals.permissions, 'campaign.create')
	};
};
