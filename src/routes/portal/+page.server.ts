import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOwnCollector } from '$lib/server/auth/own-collector';
import { listCampaigns } from '$lib/server/repositories/campaigns';

/** A collector works a campaign while it sells or collects: active, or closing (it still takes payments). */
const WORKABLE = new Set(['active', 'closing']);

/** Where the collector lands inside a campaign: what there is to collect (decision P5). */
export const _portalHome = (campaignId: string) => `/portal/${campaignId}/por-cobrar`;

/**
 * /portal: the campaigns the collector works on. Only active and closing ones are offered (decision
 * Q4: never a draft, a closed or an annulled campaign); with exactly one, the landing goes straight
 * to its «Por cobrar» (the portal lives under `/portal/[campaignId]/...`). A user without a
 * collector link sees the empty state and no campaigns.
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
	const campaigns = (result.data ?? [])
		.filter((c) => WORKABLE.has(c.status))
		.map((c) => ({ id: c.id, name: c.name, status: c.status }));
	if (campaigns.length === 1) redirect(303, _portalHome(campaigns[0].id));
	return { collector, campaigns };
};
