import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { requirePermissionIn } from '$lib/server/auth/permissions';
import { buildBondRecord } from '$lib/server/bonds/record';
import {
	bondFormFailure,
	bondServiceFailure,
	bondValidationFailure,
	checkBondActionPermission,
	type BondFormResult
} from '$lib/server/bonds/route-helpers';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import {
	getBondById,
	getBondCampaignId,
	listBondNumbersByBondIds,
	listPataMemberships,
	type BondGroupHistoryEntry
} from '$lib/server/repositories/bonds';
import type { RepositoryResult } from '$lib/server/repositories/campaigns';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { annulBond, BOND_MESSAGES, ungroupPata } from '$lib/server/services/bonds';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';
import { BOND_RECORD_ACTION_FIELDS, bondAnnulSchema, bondUngroupSchema } from '$lib/schemas/bond';
import { readFormFields } from '$lib/schemas/campaign';

const isUuid = (value: string) => z.guid().safeParse(value).success;

/**
 * /campaigns/[id]/bonds/[bondId]: the bond record. For now general data, participating numbers
 * (padded with the campaign's digit count) and the manual pata membership / members with their
 * ungrouping history; the other sections of docs/screens.md "Bond record" come later.
 * Requires an active user with `campaign.view` and `bond.view` (else 403).
 *
 * Actions (the SQL functions re-check permission, status and campaign window). Both answer 404
 * without calling the database function unless the bond belongs to the URL's campaign:
 * - `?/ungroup`: an available manual pata (`bond.create`, reason required). The pata is annulled,
 *   its memberships are kept as history and its members are free again.
 * - `?/annul`: an available simple bond or printed pata that is not in a pata (`bond.annul`,
 *   reason required). Its numbers are released so they can be entered again.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'bond.view');
	if (!isUuid(params.id)) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	if (!isUuid(params.bondId)) error(404, { message: BOND_MESSAGES.bondNotFound });

	const fail500 = (cause: unknown): never => {
		console.error('[bonds] bond record load failed', {
			requestId: locals.requestId,
			bondId: params.bondId,
			error: cause
		});
		error(500, { message: 'Could not load the bond. Please try again.' });
	};

	const [campaignResult, bondResult] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getBondById(locals.supabase, params.bondId)
	]);
	if (campaignResult.error) fail500(campaignResult.error);
	if (bondResult.error) fail500(bondResult.error);
	const campaign = campaignResult.data;
	if (!campaign) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	const bond = bondResult.data;
	if (!bond || bond.campaignId !== campaign.id) {
		error(404, { message: BOND_MESSAGES.bondNotFound });
	}

	// Manual pata: all its memberships (history) and its members' numbers. Member of a manual
	// pata: that pata's active members and numbers, to name it.
	const isManualPata = bond.origin === 'manual_grouping';
	const pataId = isManualPata ? bond.id : (bond.activeGroup?.pataBondId ?? null);
	const membershipsResult: RepositoryResult<BondGroupHistoryEntry[]> = pataId
		? await listPataMemberships(locals.supabase, pataId)
		: { data: [], error: null };
	if (membershipsResult.error) fail500(membershipsResult.error);
	const memberships = membershipsResult.data ?? [];
	const memberIds = isManualPata
		? memberships.map((m) => m.memberBondId)
		: memberships.filter((m) => !m.ungroupedAt).map((m) => m.memberBondId);
	// No query when there are no members (see listBondNumbersByBondIds).
	const numbersResult = await listBondNumbersByBondIds(locals.supabase, memberIds);
	if (numbersResult.error) fail500(numbersResult.error);
	const numbers = numbersResult.data ?? [];

	return {
		campaign,
		record: buildBondRecord({
			campaign,
			bond,
			memberships: isManualPata ? memberships : [],
			memberNumbers: isManualPata ? numbers : [],
			parentPata: isManualPata || !pataId ? null : { memberIds, numbers },
			permissions: locals.permissions ?? []
		})
	};
};

/**
 * Actions: the bond must exist and belong to the campaign of the URL, else a 404 result (the same
 * one for a malformed id, a missing bond and a bond of another campaign, so nothing leaks about
 * other campaigns). Returns null when the action may proceed. Runs after the permission check.
 */
async function checkBondInCampaign(
	locals: App.Locals,
	params: { id: string; bondId: string },
	form: 'ungroup' | 'annul'
) {
	if (!isUuid(params.id) || !isUuid(params.bondId)) {
		return bondFormFailure(form, 404, BOND_MESSAGES.bondNotFound);
	}
	const { data: campaignId, error: loadError } = await getBondCampaignId(
		locals.supabase,
		params.bondId
	);
	if (loadError) {
		console.error('[bonds] bond scope check failed', {
			requestId: locals.requestId,
			bondId: params.bondId,
			error: loadError
		});
		return bondFormFailure(form, 500, 'Could not load the bond. Please try again.');
	}
	if (campaignId !== params.id) return bondFormFailure(form, 404, BOND_MESSAGES.bondNotFound);
	return null;
}

export const actions: Actions = {
	ungroup: async ({ request, locals, params, url }) => {
		const denied = checkBondActionPermission(locals, url, 'ungroup', 'bond.create');
		if (denied) return denied;
		const outOfScope = await checkBondInCampaign(locals, params, 'ungroup');
		if (outOfScope) return outOfScope;

		const values = readFormFields(await request.formData(), BOND_RECORD_ACTION_FIELDS);
		const parsed = bondUngroupSchema.safeParse({ ...values, pataBondId: params.bondId });
		if (!parsed.success) return bondValidationFailure('ungroup', parsed.error, values);

		try {
			await ungroupPata(locals.supabase, parsed.data, {
				requestId: locals.requestId,
				permissions: locals.permissions
			});
		} catch (err) {
			return bondServiceFailure('ungroup', err, values);
		}
		const result: BondFormResult = {
			form: 'ungroup',
			success: true,
			message: 'Pata ungrouped. It is annulled and its bonds are available on their own again.',
			errors: {}
		};
		return result;
	},

	annul: async ({ request, locals, params, url }) => {
		const denied = checkBondActionPermission(locals, url, 'annul', 'bond.annul');
		if (denied) return denied;
		const outOfScope = await checkBondInCampaign(locals, params, 'annul');
		if (outOfScope) return outOfScope;

		const values = readFormFields(await request.formData(), BOND_RECORD_ACTION_FIELDS);
		const parsed = bondAnnulSchema.safeParse({ ...values, bondId: params.bondId });
		if (!parsed.success) return bondValidationFailure('annul', parsed.error, values);

		try {
			await annulBond(locals.supabase, parsed.data, {
				requestId: locals.requestId,
				permissions: locals.permissions
			});
		} catch (err) {
			return bondServiceFailure('annul', err, values);
		}
		const result: BondFormResult = {
			form: 'annul',
			success: true,
			message: 'Bond annulled. Its numbers are free and can be entered again.',
			errors: {}
		};
		return result;
	}
};
