import type { PageServerLoad } from './$types';
import { listMySales } from '$lib/server/repositories/portal';
import { loadFailed, pageParam, pagination, requireSalesViewer } from '$lib/server/portal/route';

export const load: PageServerLoad = async ({ locals, url }) => {
	const collector = await requireSalesViewer(locals, url);
	if (!collector) return { collector, sales: [], pagination: { page: 1, pageCount: 1 } };
	const result = await listMySales(locals.supabase, pageParam(url));
	if (result.error) loadFailed(locals, 'las ventas', result.error);
	return { collector, sales: result.data.items, pagination: pagination(result.data) };
};
