import type { LayoutServerLoad } from './$types';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';

// Scoped guard for /campaigns/** (app-wide guards are SAN-95): signed-in active user, else
// redirect to /login?redirectTo=...; `campaign.view`, else 403. Page loads repeat the check
// (they run in parallel with this one) and every form action checks on its own.
export const load: LayoutServerLoad = async ({ locals, url }) => {
	requireCampaignViewer(locals, url);
	return {};
};
