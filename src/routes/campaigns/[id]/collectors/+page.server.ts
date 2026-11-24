import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { COLLECTOR_STATUSES, type CollectorStatus } from '$lib/domain/parties';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { countAssignedBondsByCollector, listCollectors } from '$lib/server/repositories/parties';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';

const uuid = (value: string) => z.guid().safeParse(value).success;
const status = (value: string | null): CollectorStatus | null =>
	value && (COLLECTOR_STATUSES as readonly string[]).includes(value)
		? (value as CollectorStatus)
		: null;

export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	if (!hasPermissionIn(locals.permissions, 'collector.view'))
		requirePermissionIn(locals.permissions, 'collector.manage');
	if (!uuid(params.id)) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	const campaignResult = await getCampaignById(locals.supabase, params.id);
	if (campaignResult.error)
		error(500, { message: 'No se pudo cargar la campaña. Volver a intentar.' });
	if (!campaignResult.data) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	const pageValue = Number(url.searchParams.get('page'));
	const result = await listCollectors(locals.supabase, {
		search: url.searchParams.get('q'),
		status: status(url.searchParams.get('status')),
		page: Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1
	});
	if (result.error || !result.data)
		error(500, { message: 'No se pudieron cargar los cobradores. Volver a intentar.' });
	const counts = await countAssignedBondsByCollector(
		locals.supabase,
		params.id,
		result.data.items.map((item) => item.id)
	);
	if (counts.error)
		error(500, { message: 'No se pudieron cargar los cobradores. Volver a intentar.' });
	return {
		campaign: campaignResult.data,
		collectors: result.data.items.map((collector) => ({
			...collector,
			assignedBonds: counts.data?.get(collector.id) ?? 0
		})),
		pagination: {
			...result.data,
			pageCount: Math.max(1, Math.ceil(result.data.total / result.data.pageSize))
		},
		query: {
			q: url.searchParams.get('q') ?? '',
			status: status(url.searchParams.get('status')) ?? ''
		},
		can: { manage: hasPermissionIn(locals.permissions, 'collector.manage') }
	};
};
