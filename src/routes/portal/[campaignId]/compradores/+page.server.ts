import type { PageServerLoad } from './$types';
import { listMyBuyers } from '$lib/server/repositories/portal';
import {
	loadFailed,
	pageParam,
	pagination,
	requireSalesViewer,
	requireUuid
} from '$lib/server/portal/route';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const collector = await requireSalesViewer(locals, url);
	const campaignId = requireUuid(params.campaignId, 'Campaña no encontrada.');
	if (!collector) return { collector, buyers: [], pagination: { page: 1, pageCount: 1 } };
	const result = await listMyBuyers(locals.supabase, pageParam(url), campaignId);
	if (result.error) loadFailed(locals, 'los compradores', result.error);
	return { collector, buyers: result.data.items, pagination: pagination(result.data) };
};
