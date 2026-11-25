import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getMyBuyer } from '$lib/server/repositories/portal';
import { loadFailed, requireSalesViewer, requireUuid } from '$lib/server/portal/route';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const collector = await requireSalesViewer(locals, url);
	if (!collector) error(404, { message: 'Comprador no encontrado.' });
	const buyerId = requireUuid(params.buyerId, 'Comprador no encontrado.');
	const result = await getMyBuyer(locals.supabase, buyerId);
	if (result.error) loadFailed(locals, 'el comprador', result.error);
	if (!result.data) error(404, { message: 'Comprador no encontrado.' });
	return { collector, buyer: result.data.buyer, sales: result.data.sales };
};
