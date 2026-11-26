import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	countBondsByBuyer,
	getCollectorsByIds,
	listBuyers,
	PARTY_PAGE_SIZE
} from '$lib/server/repositories/parties';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	if (!hasPermissionIn(locals.permissions, 'buyer.view'))
		requirePermissionIn(locals.permissions, 'buyer.manage');
	if (!z.guid().safeParse(params.id).success) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	const campaignResult = await getCampaignById(locals.supabase, params.id);
	if (campaignResult.error)
		error(500, { message: 'No se pudo cargar la campaña. Volver a intentar.' });
	if (!campaignResult.data) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
	const type = url.searchParams.get('type');
	const typeFilter = type === 'individual' || type === 'business' ? type : null;
	const result = await listBuyers(locals.supabase, {
		search: url.searchParams.get('q'),
		type: typeFilter,
		page
	});
	if (result.error)
		error(500, { message: 'No se pudieron cargar los compradores. Volver a intentar.' });
	const buyers = result.data?.items ?? [];
	// UX plan PR 14b: each row says how many bonds of this campaign the buyer has, with one grouped
	// query for the whole page. Only for roles that read bonds: without
	// `bond.view` the RLS would return nothing and the row would say «Sin bonos».
	const canCountBonds = hasPermissionIn(locals.permissions, 'bond.view');
	const [collectors, bonds] = await Promise.all([
		getCollectorsByIds(
			locals.supabase,
			buyers.flatMap((b) => (b.usualCollectorId ? [b.usualCollectorId] : []))
		),
		canCountBonds
			? countBondsByBuyer(
					locals.supabase,
					campaignResult.data.id,
					buyers.map((b) => b.id)
				)
			: null
	]);
	if (collectors.error || bonds?.error)
		error(500, { message: 'No se pudieron cargar los compradores. Volver a intentar.' });
	const total = result.data?.total ?? 0;
	return {
		campaign: campaignResult.data,
		buyers: buyers.map((buyer) => ({
			...buyer,
			/** Bonds of this campaign in the buyer's name; null when the role cannot read bonds. */
			bondCount: bonds ? (bonds.data?.get(buyer.id) ?? 0) : null
		})),
		collectors: [...(collectors.data ?? new Map()).values()],
		query: { q: url.searchParams.get('q') ?? '', type: typeFilter ?? '' },
		pagination: {
			page,
			pageSize: PARTY_PAGE_SIZE,
			total,
			pageCount: Math.max(1, Math.ceil(total / PARTY_PAGE_SIZE))
		},
		can: { manage: hasPermissionIn(locals.permissions, 'buyer.manage'), bondCounts: canCountBonds }
	};
};
