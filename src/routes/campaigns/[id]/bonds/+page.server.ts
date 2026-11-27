import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { canLoadBonds } from '$lib/domain/campaigns';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { buildBondListItems, parseBondListQuery } from '$lib/server/bonds/list';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import {
	BOND_LIST_PAGE_SIZE,
	listBondBaseNumbers,
	listBondHolderIds,
	listBonds,
	type BondListEntry
} from '$lib/server/repositories/bonds';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getBuyerNamesByIds, getCollectorsByIds } from '$lib/server/repositories/parties';
import { BOND_MESSAGES } from '$lib/server/services/bonds';

const isUuid = (value: string) => z.guid().safeParse(value).success;

/**
 * /campaigns/[id]/bonds: the campaign's bonds, filtered by the query string (base number,
 * associated number, barcode / internal code, type, commercial and financial status) and paged on
 * the server (`?page=`), so it works without JavaScript. Number filters match any participating
 * number (a manual pata through its members). Requires an active user with `campaign.view` and
 * `bond.view` (else 403). Reads go through `public.bond_list` (security_invoker: RLS applies).
 *
 * A search by number alone that finds exactly one bond goes straight to its record (UX plan PR 9):
 * that is what the search in the top bar and on the campaign page send. With any other filter, a
 * page, no match or several, the list is shown.
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
	const searched = [...url.searchParams].filter(([, value]) => value.trim() !== '');
	if (
		valid &&
		total === 1 &&
		entries.length === 1 &&
		searched.length === 1 &&
		searched[0][0] === 'base'
	)
		redirect(303, `/campaigns/${campaign.id}/bonds/${entries[0].id}`);

	const pataIds = [...new Set(entries.flatMap((e) => (e.groupPataId ? [e.groupPataId] : [])))];
	const basesResult = await listBondBaseNumbers(locals.supabase, pataIds);
	if (basesResult.error) fail500(basesResult.error);

	// Who has each bond and who bought it (audit A7), by name, read with the caller's client: a role
	// that cannot read them, or a failed read, leaves the row without the name. Never fatal.
	const holders = await listBondHolderIds(
		locals.supabase,
		entries.map((entry) => entry.id)
	);
	const holderIds = [...(holders.data ?? new Map()).values()];
	const [collectorNames, buyerNames] = await Promise.all([
		getCollectorsByIds(
			locals.supabase,
			holderIds.flatMap((h) => (h.collectorId ? [h.collectorId] : []))
		),
		getBuyerNamesByIds(
			locals.supabase,
			holderIds.flatMap((h) => (h.buyerId ? [h.buyerId] : []))
		)
	]);
	for (const failed of [holders.error, collectorNames.error, buyerNames.error])
		if (failed)
			console.error('[bonds] bonds list names read failed', {
				requestId: locals.requestId,
				campaignId: params.id,
				error: failed
			});

	// The collector the list is filtered by (a link from the collector record), by name. Read with the
	// caller's client: a role that cannot read collectors, or an unknown id, leaves `null` and the
	// chip says «Cobrador». An unknown id matches no bond, so the list is empty; never an error.
	let filterCollectorName: string | null = null;
	if (query.filters.collectorId) {
		const found = await getCollectorsByIds(locals.supabase, [query.filters.collectorId]);
		if (found.error)
			console.error('[bonds] bonds list collector read failed', {
				requestId: locals.requestId,
				campaignId: params.id,
				error: found.error
			});
		filterCollectorName = found.data?.get(query.filters.collectorId)?.displayName ?? null;
	}

	const permissions = locals.permissions ?? [];
	return {
		campaign,
		filterCollectorName,
		query: { values: query.values, errors: query.errors },
		bonds: buildBondListItems(entries, basesResult.data ?? new Map(), campaign).map((bond) => {
			const holder = holders.data?.get(bond.id);
			return {
				...bond,
				collectorName:
					(holder?.collectorId && collectorNames.data?.get(holder.collectorId)?.displayName) ||
					null,
				buyerName: (holder?.buyerId && buyerNames.data?.get(holder.buyerId)) || null
			};
		}),
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
