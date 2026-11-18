import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getCollectorsByIds, listBuyers, PARTY_PAGE_SIZE } from '$lib/server/repositories/parties';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	if (!hasPermissionIn(locals.permissions, 'buyer.view'))
		requirePermissionIn(locals.permissions, 'buyer.manage');
	if (!z.guid().safeParse(params.id).success) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	const campaignResult = await getCampaignById(locals.supabase, params.id);
	if (campaignResult.error)
		error(500, { message: 'Could not load the campaign. Please try again.' });
	if (!campaignResult.data) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
	const type = url.searchParams.get('type');
	const typeFilter = type === 'individual' || type === 'business' ? type : null;
	const result = await listBuyers(locals.supabase, {
		search: url.searchParams.get('q'),
		type: typeFilter,
		page
	});
	if (result.error) error(500, { message: 'Could not load buyers. Please try again.' });
	const buyers = result.data?.items ?? [];
	const collectors = await getCollectorsByIds(
		locals.supabase,
		buyers.flatMap((b) => (b.usualCollectorId ? [b.usualCollectorId] : []))
	);
	if (collectors.error) error(500, { message: 'Could not load buyers. Please try again.' });
	const total = result.data?.total ?? 0;
	return {
		campaign: campaignResult.data,
		buyers,
		collectors: [...(collectors.data ?? new Map()).values()],
		query: { q: url.searchParams.get('q') ?? '', type: typeFilter ?? '' },
		pagination: {
			page,
			pageSize: PARTY_PAGE_SIZE,
			total,
			pageCount: Math.max(1, Math.ceil(total / PARTY_PAGE_SIZE))
		},
		can: { manage: hasPermissionIn(locals.permissions, 'buyer.manage') }
	};
};
