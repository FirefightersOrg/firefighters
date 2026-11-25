import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { requireOwnCollector } from '$lib/server/auth/own-collector';
import { getMyBond } from '$lib/server/portal/my-bonds';
import { getCampaignById } from '$lib/server/repositories/campaigns';

const isUuid = (value: string) => z.guid().safeParse(value).success;
const NOT_FOUND = 'Bono no encontrado.';

/**
 * /portal/[campaignId]/bonos/[bondId]: reduced read-only view of one own bond (no buyer or payment data).
 * A bond that is not currently the signed-in collector's answers 404.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	const collector = await requireOwnCollector(locals, url.pathname + url.search);
	if (!isUuid(params.campaignId) || !isUuid(params.bondId)) error(404, { message: NOT_FOUND });
	if (!collector) error(404, { message: NOT_FOUND });

	const fail500 = (cause: unknown): never => {
		console.error('[portal] my bond load failed', {
			requestId: locals.requestId,
			bondId: params.bondId,
			error: cause
		});
		error(500, { message: 'No se pudo cargar el bono. Volver a intentar.' });
	};

	const campaignResult = await getCampaignById(locals.supabase, params.campaignId);
	if (campaignResult.error) fail500(campaignResult.error);
	if (!campaignResult.data) error(404, { message: NOT_FOUND });

	const detail = await getMyBond(locals.supabase, collector.id, campaignResult.data, params.bondId);
	if (detail.error) fail500(detail.error);
	if (!detail.data) error(404, { message: NOT_FOUND });

	return {
		campaign: { id: campaignResult.data.id, name: campaignResult.data.name },
		...detail.data
	};
};
