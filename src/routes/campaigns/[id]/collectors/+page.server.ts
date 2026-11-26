import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { COLLECTOR_STATUSES, type CollectorStatus } from '$lib/domain/parties';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getCollectorAccounts } from '$lib/server/repositories/financial-reports';
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
	// UX plan PR 14b: each row says the collector's balance to the roles that already read it in the
	// financial reports. One call for the campaign; the SQL function checks `report.view_financial`.
	const canSeeBalances = hasPermissionIn(locals.permissions, 'report.view_financial');
	const [counts, accounts] = await Promise.all([
		countAssignedBondsByCollector(
			locals.supabase,
			params.id,
			result.data.items.map((item) => item.id)
		),
		canSeeBalances
			? getCollectorAccounts(locals.supabase, params.id, {
					collectorId: null,
					method: null,
					settlementStatus: null,
					from: null,
					to: null,
					drawId: null,
					eligibility: null,
					prizeStatus: null
				})
			: null
	]);
	if (counts.error || accounts?.error)
		error(500, { message: 'No se pudieron cargar los cobradores. Volver a intentar.' });
	const balances = accounts
		? new Map((accounts.data ?? []).map((account) => [account.collectorId, account.balance]))
		: null;
	return {
		campaign: campaignResult.data,
		collectors: result.data.items.map((collector) => ({
			...collector,
			assignedBonds: counts.data?.get(collector.id) ?? 0,
			/** Null when the role cannot read balances; a collector without movements has none. */
			balance: balances ? (balances.get(collector.id) ?? '0.00') : null
		})),
		pagination: {
			...result.data,
			pageCount: Math.max(1, Math.ceil(result.data.total / result.data.pageSize))
		},
		query: {
			q: url.searchParams.get('q') ?? '',
			status: status(url.searchParams.get('status')) ?? ''
		},
		can: {
			manage: hasPermissionIn(locals.permissions, 'collector.manage'),
			balances: canSeeBalances
		}
	};
};
