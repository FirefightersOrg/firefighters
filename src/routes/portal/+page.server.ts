import type { PageServerLoad } from './$types';
import { requireOwnCollector } from '$lib/server/auth/own-collector';
import { hasPermissionIn } from '$lib/server/auth/permissions';

export const load: PageServerLoad = async ({ locals, url }) => {
	const collector = await requireOwnCollector(locals, url.pathname + url.search);
	return { collector, canViewSales: hasPermissionIn(locals.permissions, 'sale.view_own') };
};
