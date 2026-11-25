import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getMyBuyer } from '$lib/server/repositories/portal';
import { loadFailed, requireSalesViewer, requireUuid } from '$lib/server/portal/route';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const collector = await requireSalesViewer(locals, url);
	if (!collector) error(404, { message: 'Comprador no encontrado.' });
	const campaignId = requireUuid(params.campaignId, 'Campaña no encontrada.');
	const buyerId = requireUuid(params.buyerId, 'Comprador no encontrado.');
	const result = await getMyBuyer(locals.supabase, buyerId);
	if (result.error) loadFailed(locals, 'el comprador', result.error);
	// Only the sales of this campaign; a buyer with none here answers like a missing one.
	const sales = (result.data?.sales ?? []).filter((sale) => sale.campaignId === campaignId);
	if (!result.data || sales.length === 0) error(404, { message: 'Comprador no encontrado.' });
	return { collector, buyer: result.data.buyer, sales };
};
