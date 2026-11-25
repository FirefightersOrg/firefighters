import type { PageServerLoad } from './$types';
import { requireOwnCollector } from '$lib/server/auth/own-collector';
import { listCampaigns } from '$lib/server/repositories/campaigns';

export const load: PageServerLoad = async ({ locals, url }) => {
	const collector = await requireOwnCollector(locals, url.pathname + url.search);
	// SAN-144: campaigns the portal links to ("Mis bonos"); campaign.view is held by collectors.
	const campaigns = await listCampaigns(locals.supabase);
	return {
		collector,
		campaigns: (campaigns.data ?? []).map((c) => ({ id: c.id, name: c.name, status: c.status }))
	};
};
