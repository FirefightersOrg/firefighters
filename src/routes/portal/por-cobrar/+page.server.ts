import type { PageServerLoad } from './$types';
import { listMyDueInstallments } from '$lib/server/repositories/portal';
import { loadFailed, pageParam, pagination, requireSalesViewer } from '$lib/server/portal/route';

export const load: PageServerLoad = async ({ locals, url }) => {
	const collector = await requireSalesViewer(locals, url);
	if (!collector) return { collector, due: [], pagination: { page: 1, pageCount: 1 } };
	const result = await listMyDueInstallments(locals.supabase, pageParam(url));
	if (result.error) loadFailed(locals, 'las cuotas por cobrar', result.error);
	return { collector, due: result.data.items, pagination: pagination(result.data) };
};
