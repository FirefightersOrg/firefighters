import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { requireOwnCollector } from '$lib/server/auth/own-collector';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';
import {
	PORTAL_LEDGER_PAGE_SIZE,
	PortalLedgerError,
	getPortalLedgerSummary,
	listPortalLedger,
	listPortalSettlements,
	parsePageParam
} from '$lib/server/services/portal-ledger';

/**
 * /portal/[campaignId]/cuenta: "Mi cuenta corriente" (SAN-146), read-only.
 * The collector comes from the session (`requireOwnCollector`), never from the URL: the only id in the
 * path is the campaign. A campaign the person cannot see answers 404. Permission `collector.ledger.view_own`
 * is checked here and again by the SQL functions and RLS.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	const collector = await requireOwnCollector(
		locals,
		url.pathname + url.search,
		'collector.ledger.view_own'
	);
	if (!z.guid().safeParse(params.campaignId).success)
		error(404, { message: CAMPAIGN_MESSAGES.notFound });
	const campaign = await getCampaignById(locals.supabase, params.campaignId);
	if (campaign.error)
		error(500, { message: 'No se pudo cargar tu cuenta corriente. Volver a intentar.' });
	if (!campaign.data) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	if (!collector) return { collector, campaign: campaign.data, ledger: null };

	const page = parsePageParam(url.searchParams.get('page'));
	try {
		const [summary, entries, settlements] = await Promise.all([
			getPortalLedgerSummary(locals.supabase, params.campaignId),
			listPortalLedger(locals.supabase, { campaignId: params.campaignId, page }),
			listPortalSettlements(locals.supabase, { campaignId: params.campaignId })
		]);
		const pageCount = Math.max(1, Math.ceil(entries.total / PORTAL_LEDGER_PAGE_SIZE));
		if (page > pageCount) error(404, { message: 'No se encontró esa página.' });
		return {
			collector,
			campaign: campaign.data,
			ledger: {
				summary,
				entries: entries.entries,
				total: entries.total,
				page,
				pageCount,
				settlements: settlements.settlements,
				settlementsTotal: settlements.total
			}
		};
	} catch (err) {
		if (err instanceof PortalLedgerError)
			error(err.status, {
				message:
					err.kind === 'internal'
						? 'No se pudo cargar tu cuenta corriente. Volver a intentar.'
						: err.message
			});
		throw err;
	}
};
