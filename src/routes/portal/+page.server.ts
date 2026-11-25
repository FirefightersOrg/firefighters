import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOwnCollector } from '$lib/server/auth/own-collector';
import { listCampaigns } from '$lib/server/repositories/campaigns';

/**
 * /portal: the landing lists the campaigns the collector can open. With exactly one, it goes straight to its
 * "Mis bonos" (the portal lives under `/portal/[campaignId]/...`). A user without a collector link sees the
 * empty state and no campaigns.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const collector = await requireOwnCollector(locals, url.pathname + url.search);
	if (!collector) return { collector, campaigns: [] };
	const result = await listCampaigns(locals.supabase);
	if (result.error) {
		console.error('[portal] campaigns load failed', {
			requestId: locals.requestId,
			error: result.error
		});
		error(500, { message: 'No se pudieron cargar las campañas. Volver a intentar.' });
	}
	const campaigns = (result.data ?? []).map((c) => ({ id: c.id, name: c.name, status: c.status }));
	if (campaigns.length === 1) redirect(303, `/portal/${campaigns[0].id}/bonos`);
	return { collector, campaigns };
};
