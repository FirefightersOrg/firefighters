import type { PageServerLoad } from './$types';
import { requireOwnCollector } from '$lib/server/auth/own-collector';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import { listCampaigns } from '$lib/server/repositories/campaigns';

export const load: PageServerLoad = async ({ locals, url }) => {
	const collector = await requireOwnCollector(locals, url.pathname + url.search);
	// SAN-144: campaigns the portal links to ("Mis bonos"); campaign.view is held by collectors.
	const campaigns = await listCampaigns(locals.supabase);
	return {
		collector,
		canViewSales: hasPermissionIn(locals.permissions, 'sale.view_own'),
		campaigns: (campaigns.data ?? []).map((c) => ({ id: c.id, name: c.name, status: c.status }))
	};
};
