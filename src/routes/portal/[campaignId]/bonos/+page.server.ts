import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { requireOwnCollector } from '$lib/server/auth/own-collector';
import {
	listMyBonds,
	MY_BONDS_PAGE_SIZE,
	parseMyBondsQuery,
	type MyBondRow
} from '$lib/server/portal/my-bonds';
import { getCampaignById } from '$lib/server/repositories/campaigns';

const isUuid = (value: string) => z.guid().safeParse(value).success;

/**
 * /portal/[campaignId]/bonos: the signed-in collector's own bonds (read only). The collector comes from
 * the session (`requireOwnCollector`), never from the URL; rows are filtered by `current_collector_id`.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	const collector = await requireOwnCollector(locals, url.pathname + url.search);
	if (!isUuid(params.campaignId)) error(404, { message: 'Campaña no encontrada.' });

	const fail500 = (cause: unknown): never => {
		console.error('[portal] my bonds load failed', {
			requestId: locals.requestId,
			campaignId: params.campaignId,
			error: cause
		});
		error(500, { message: 'No se pudieron cargar tus bonos. Volver a intentar.' });
	};

	const campaignResult = await getCampaignById(locals.supabase, params.campaignId);
	if (campaignResult.error) fail500(campaignResult.error);
	const campaign = campaignResult.data;
	if (!campaign) error(404, { message: 'Campaña no encontrada.' });

	const filters = parseMyBondsQuery(url.searchParams);
	let rows: MyBondRow[] = [];
	let total = 0;
	if (collector) {
		const result = await listMyBonds(locals.supabase, collector.id, campaign, filters);
		if (result.error) fail500(result.error);
		rows = result.data!.rows;
		total = result.data!.total;
	}
	return {
		collector,
		campaign: { id: campaign.id, name: campaign.name },
		filters,
		bonds: rows,
		pagination: {
			page: filters.page,
			pageSize: MY_BONDS_PAGE_SIZE,
			total,
			pageCount: Math.max(1, Math.ceil(total / MY_BONDS_PAGE_SIZE))
		}
	};
};
