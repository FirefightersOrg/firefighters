import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { requireUuid } from '$lib/server/portal/route';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';

/**
 * Campaign scope of the portal (`/portal/[campaignId]/...`). The id only selects which campaign to show: the
 * collector always comes from the session. A malformed id, or a campaign the person cannot see, answers 404.
 */
export const load: LayoutServerLoad = async ({ locals, params }) => {
	const campaignId = requireUuid(params.campaignId, CAMPAIGN_MESSAGES.notFound);
	const result = await getCampaignById(locals.supabase, campaignId);
	if (result.error) {
		console.error('[portal] campaign load failed', {
			requestId: locals.requestId,
			error: result.error
		});
		error(500, { message: 'No se pudo cargar la campaña. Volver a intentar.' });
	}
	if (!result.data) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	return { campaign: { id: result.data.id, name: result.data.name } };
};
