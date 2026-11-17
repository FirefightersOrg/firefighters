import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { campaignNumberingConfig, canLoadBonds, type Campaign } from '$lib/domain/campaigns';
import { NumberingError, parseCampaignNumber } from '$lib/domain/numbering';
import { requirePermissionIn } from '$lib/server/auth/permissions';
import {
	describeGroupableBond,
	describeGroupingMembers,
	GROUPING_SEARCH_PARAM,
	GROUPING_SELECTED_PARAM,
	groupingProblemMessage,
	groupingTotals,
	selectedBondIds,
	type GroupableBondView,
	type GroupingMemberView,
	type PataEntryMode
} from '$lib/server/bonds/grouping';
import {
	bondFormFailure,
	bondServiceFailure,
	bondValidationFailure,
	campaignLockedMessage,
	checkBondActionPermission,
	conflictLinks,
	FIX_FIELDS_MESSAGE,
	type BondFormName
} from '$lib/server/bonds/route-helpers';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import {
	GROUPABLE_SEARCH_LIMIT,
	listGroupingMembers,
	searchGroupableBonds,
	type GroupableBond
} from '$lib/server/repositories/bonds';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { BOND_MESSAGES, createBond, groupBondsIntoPata } from '$lib/server/services/bonds';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';
import {
	bondCreatePataSchema,
	bondGroupSchema,
	PATA_ENTRY_FIELDS,
	PATA_GROUP_FIELDS
} from '$lib/schemas/bond';
import { readFormFields } from '$lib/schemas/campaign';

const isUuid = (value: string) => z.guid().safeParse(value).success;

/**
 * /campaigns/[id]/bonds/pata/new: entry of patas, in two modes (`?mode=printed|grouping`).
 * - Printed pata: N >= 2 base numbers typed at once; `bond_create` stores the 2N numbers.
 * - Manual grouping: pick N >= 2 available simple bonds that are not in another pata (search by
 *   base number; the picked bonds live in the URL, `?selected=<id>&selected=<id>`), then
 *   `bond_group_into_pata` creates the pata. Members keep their numbers.
 * Requires an active user with `campaign.view` and `bond.create` (else 403); the forms are only
 * offered while the campaign is a draft or active. Both actions open the new pata's record.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'bond.create');
	if (!isUuid(params.id)) {
		error(404, { message: CAMPAIGN_MESSAGES.notFound });
	}

	const result = await getCampaignById(locals.supabase, params.id);
	if (result.error) {
		console.error('[bonds] new pata load failed', {
			requestId: locals.requestId,
			campaignId: params.id,
			error: result.error
		});
		error(500, { message: 'Could not load the campaign. Please try again.' });
	}
	if (!result.data) {
		error(404, { message: CAMPAIGN_MESSAGES.notFound });
	}

	const campaign = result.data;
	const canLoad = canLoadBonds(campaign.status);
	const mode: PataEntryMode = url.searchParams.get('mode') === 'grouping' ? 'grouping' : 'printed';
	return {
		campaign,
		canLoad,
		lockedMessage: canLoad ? null : campaignLockedMessage(campaign.status),
		mode,
		grouping: mode === 'grouping' && canLoad ? await loadGrouping(locals, campaign, url) : null
	};
};

/** The grouping search and the picked bonds. */
async function loadGrouping(locals: App.Locals, campaign: Campaign, url: URL) {
	const config = campaignNumberingConfig(campaign);
	const query = (url.searchParams.get(GROUPING_SEARCH_PARAM) ?? '').trim();
	const selectedIds = selectedBondIds(url.searchParams.getAll(GROUPING_SELECTED_PARAM));

	let fromBase: number | null = null;
	let searchError: string | null = null;
	if (query !== '') {
		try {
			fromBase = parseCampaignNumber(query, config);
		} catch (err) {
			if (!(err instanceof NumberingError)) throw err;
			searchError = `"${query}" is not a valid base number (use up to ${config.numberDigits} digits).`;
		}
	}

	const [searchResult, membersResult] = await Promise.all([
		searchError
			? Promise.resolve({ data: [] as GroupableBond[], error: null })
			: searchGroupableBonds(locals.supabase, campaign.id, {
					fromBase,
					// The picked bonds are left out of the results: ask for enough rows to fill the list.
					limit: GROUPABLE_SEARCH_LIMIT + selectedIds.length
				}),
		listGroupingMembers(locals.supabase, selectedIds)
	]);
	if (searchResult.error || membersResult.error) {
		console.error('[bonds] grouping lookup failed', {
			requestId: locals.requestId,
			campaignId: campaign.id,
			error: searchResult.error ?? membersResult.error
		});
		error(500, { message: 'Could not load the bonds. Please try again.' });
	}

	const selected = describeGroupingMembers(selectedIds, membersResult.data, campaign.id, config);
	const picked = new Set(selectedIds);
	const results: GroupableBondView[] = searchResult.data
		.filter((bond) => !picked.has(bond.id))
		.slice(0, GROUPABLE_SEARCH_LIMIT)
		.map((bond) => describeGroupableBond(bond, config));

	return {
		query,
		searchError,
		searchLimit: GROUPABLE_SEARCH_LIMIT,
		results,
		selected,
		...groupingTotals(selected.length, campaign.simpleBondValue)
	};
}

/** Shared start of both actions: permission, campaign and its status. */
async function campaignForAction(
	locals: App.Locals,
	params: { id: string },
	url: URL,
	form: BondFormName,
	values: Record<string, string>
) {
	const denied = checkBondActionPermission(locals, url, form, 'bond.create');
	if (denied) return { failure: denied };
	if (!isUuid(params.id)) {
		return { failure: bondFormFailure(form, 404, CAMPAIGN_MESSAGES.notFound) };
	}
	const result = await getCampaignById(locals.supabase, params.id);
	if (result.error) {
		console.error('[bonds] campaign lookup failed', {
			requestId: locals.requestId,
			campaignId: params.id,
			error: result.error
		});
		return { failure: bondFormFailure(form, 500, BOND_MESSAGES.internal, { values }) };
	}
	const campaign = result.data;
	if (!campaign) return { failure: bondFormFailure(form, 404, CAMPAIGN_MESSAGES.notFound) };
	if (!canLoadBonds(campaign.status)) {
		return {
			failure: bondFormFailure(form, 409, campaignLockedMessage(campaign.status), { values })
		};
	}
	return { campaign };
}

export const actions: Actions = {
	/** Printed pata: N >= 2 base numbers, typed as the campaign shows them. */
	printed: async ({ request, locals, params, url }) => {
		const formData = await request.formData();
		const values = readFormFields(formData, PATA_ENTRY_FIELDS);
		const { campaign, failure } = await campaignForAction(locals, params, url, 'pata', values);
		if (failure) return failure;

		const parsed = bondCreatePataSchema(campaignNumberingConfig(campaign)).safeParse({
			...values,
			campaignId: campaign.id,
			reason: ''
		});
		if (!parsed.success) return bondValidationFailure('pata', parsed.error, values);

		let id: string;
		try {
			id = await createBond(locals.supabase, parsed.data, {
				requestId: locals.requestId,
				permissions: locals.permissions
			});
		} catch (err) {
			return bondServiceFailure('pata', err, values);
		}
		redirect(303, `/campaigns/${campaign.id}/bonds/${id}`);
	},

	/** Manual grouping of N >= 2 picked simple bonds. */
	group: async ({ request, locals, params, url }) => {
		const formData = await request.formData();
		const values = readFormFields(formData, PATA_GROUP_FIELDS);
		const memberBondIds = formData
			.getAll('memberBondIds')
			.filter((value): value is string => typeof value === 'string');
		const { campaign, failure } = await campaignForAction(locals, params, url, 'group', values);
		if (failure) return failure;

		const parsed = bondGroupSchema.safeParse({
			...values,
			memberBondIds,
			campaignId: campaign.id,
			reason: ''
		});
		if (!parsed.success) return bondValidationFailure('group', parsed.error, values);

		// Friendly check of the picked bonds (named by their number, with a link to the pata a bond
		// already belongs to); the database checks again under lock.
		const ids = parsed.data.memberBondIds.map((id) => id.toLowerCase());
		const membersResult = await listGroupingMembers(locals.supabase, ids);
		if (membersResult.error) {
			console.error('[bonds] grouping members lookup failed', {
				requestId: locals.requestId,
				campaignId: campaign.id,
				error: membersResult.error
			});
			return bondFormFailure('group', 500, BOND_MESSAGES.internal, { values });
		}
		const invalid: GroupingMemberView[] = describeGroupingMembers(
			ids,
			membersResult.data,
			campaign.id,
			campaignNumberingConfig(campaign)
		).filter((member) => member.problem !== null);
		if (invalid.length > 0) {
			return bondFormFailure('group', 409, FIX_FIELDS_MESSAGE, {
				errors: { memberBondIds: invalid.map(groupingProblemMessage) },
				conflicts: conflictLinks(
					'memberBondIds',
					invalid.flatMap((member) =>
						member.pataId
							? [
									{
										number: 0,
										formatted: member.baseFormatted ?? '',
										bondId: member.pataId,
										numberKind: 'base' as const
									}
								]
							: []
					)
				).map((link) => ({ ...link, numbers: link.numbers.filter(Boolean) })),
				values
			});
		}

		let id: string;
		try {
			id = await groupBondsIntoPata(
				locals.supabase,
				{ ...parsed.data, memberBondIds: ids },
				{ requestId: locals.requestId, permissions: locals.permissions }
			);
		} catch (err) {
			return bondServiceFailure('group', err, values);
		}
		redirect(303, `/campaigns/${campaign.id}/bonds/${id}`);
	}
};
