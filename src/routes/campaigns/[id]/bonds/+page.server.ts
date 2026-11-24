import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { canLoadBonds } from '$lib/domain/campaigns';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { buildBondListItems, parseBondListQuery } from '$lib/server/bonds/list';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import {
	BOND_LIST_PAGE_SIZE,
	listBondBaseNumbers,
	listBonds,
	type BondListEntry
} from '$lib/server/repositories/bonds';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { BOND_MESSAGES } from '$lib/server/services/bonds';

const isUuid = (value: string) => z.guid().safeParse(value).success;

/**
 * /campaigns/[id]/bonds: the campaign's bonds, filtered by the query string (base number,
 * associated number, barcode / internal code, type, commercial and financial status) and paged on
 * the server (`?page=`), so it works without JavaScript. Number filters match any participating
 * number (a manual pata through its members). Requires an active user with `campaign.view` and
 * `bond.view` (else 403). Reads go through `public.bond_list` (security_invoker: RLS applies).
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'bond.view');
	if (!isUuid(params.id)) error(404, { message: BOND_MESSAGES.campaignNotFound });

	const fail500 = (cause: unknown): never => {
		console.error('[bonds] bonds list load failed', {
			requestId: locals.requestId,
			campaignId: params.id,
			error: cause
		});
		error(500, { message: 'No se pudieron cargar los bonos. Volver a intentar.' });
	};

	const campaignResult = await getCampaignById(locals.supabase, params.id);
	if (campaignResult.error) fail500(campaignResult.error);
	const campaign = campaignResult.data;
	if (!campaign) error(404, { message: BOND_MESSAGES.campaignNotFound });

	const query = parseBondListQuery(url.searchParams, campaign);
	const valid = Object.keys(query.errors).length === 0;

	let entries: BondListEntry[] = [];
	let total = 0;
	if (valid) {
		const result = await listBonds(locals.supabase, campaign.id, query.filters, {
			page: query.page
		});
		if (result.error) fail500(result.error);
		entries = result.data?.entries ?? [];
		total = result.data?.total ?? 0;
	}
	const pataIds = [...new Set(entries.flatMap((e) => (e.groupPataId ? [e.groupPataId] : [])))];
	const basesResult = await listBondBaseNumbers(locals.supabase, pataIds);
	if (basesResult.error) fail500(basesResult.error);

	const permissions = locals.permissions ?? [];
	return {
		campaign,
		query: { values: query.values, errors: query.errors },
		bonds: buildBondListItems(entries, basesResult.data ?? new Map(), campaign),
		pagination: {
			page: query.page,
			pageSize: BOND_LIST_PAGE_SIZE,
			total,
			pageCount: Math.max(1, Math.ceil(total / BOND_LIST_PAGE_SIZE))
		},
		filtered: Object.values(query.values).some(Boolean),
		// UI hints only: the SQL functions enforce permission and campaign status.
		can: {
			create: hasPermissionIn(permissions, 'bond.create') && canLoadBonds(campaign.status),
			// Import pages also list past imports, so they are offered whatever the campaign status.
			importFile: hasPermissionIn(permissions, 'bond.import'),
			scan: hasPermissionIn(permissions, 'bond.scan')
		}
	};
};
