import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { campaignNumberingConfig, canLoadBonds } from '$lib/domain/campaigns';
import { formatCampaignNumber, calculateAssociatedNumber } from '$lib/domain/numbering';
import { requirePermissionIn } from '$lib/server/auth/permissions';
import {
	bondFormFailure,
	bondServiceFailure,
	bondValidationFailure,
	campaignLockedMessage,
	checkBondActionPermission,
	type BondFormResult
} from '$lib/server/bonds/route-helpers';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { BOND_MESSAGES, createBond } from '$lib/server/services/bonds';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';
import {
	BOND_ENTRY_FIELDS,
	BOND_ENTRY_INTENT_FIELD,
	bondCreateSimpleSchema,
	bondEntryIntent
} from '$lib/schemas/bond';
import { readFormFields } from '$lib/schemas/campaign';

const isUuid = (value: string) => z.guid().safeParse(value).success;

/**
 * /campaigns/[id]/bonds/new: manual entry of simple bonds, one base number at a time.
 * Requires an active user with `campaign.view` and `bond.create` (else 403). The form is only
 * offered while the campaign is a draft or active; `bond_create` enforces the permission, the
 * campaign status and the numbering rules again, and computes the associated number, the unit
 * count and the total value.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'bond.create');
	if (!isUuid(params.id)) {
		error(404, { message: CAMPAIGN_MESSAGES.notFound });
	}

	const result = await getCampaignById(locals.supabase, params.id);
	if (result.error) {
		console.error('[bonds] new bond load failed', {
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
	return {
		campaign,
		canLoad: canLoadBonds(campaign.status),
		lockedMessage: canLoadBonds(campaign.status) ? null : campaignLockedMessage(campaign.status)
	};
};

export const actions: Actions = {
	default: async ({ request, locals, params, url }) => {
		const denied = checkBondActionPermission(locals, url, 'create', 'bond.create');
		if (denied) return denied;
		if (!isUuid(params.id)) return bondFormFailure('create', 404, CAMPAIGN_MESSAGES.notFound);

		const formData = await request.formData();
		const values = readFormFields(formData, BOND_ENTRY_FIELDS);
		const intent = bondEntryIntent(formData.get(BOND_ENTRY_INTENT_FIELD));

		// The numbers are typed as the campaign shows them: its numbering config is needed to parse
		// and validate them before calling the database.
		const campaignResult = await getCampaignById(locals.supabase, params.id);
		if (campaignResult.error) {
			console.error('[bonds] campaign lookup failed', {
				requestId: locals.requestId,
				campaignId: params.id,
				error: campaignResult.error
			});
			return bondFormFailure('create', 500, BOND_MESSAGES.internal, { values });
		}
		const campaign = campaignResult.data;
		if (!campaign) return bondFormFailure('create', 404, CAMPAIGN_MESSAGES.notFound);
		if (!canLoadBonds(campaign.status)) {
			return bondFormFailure('create', 409, campaignLockedMessage(campaign.status), { values });
		}

		const config = campaignNumberingConfig(campaign);
		const parsed = bondCreateSimpleSchema(config).safeParse({
			...values,
			campaignId: campaign.id,
			reason: ''
		});
		if (!parsed.success) return bondValidationFailure('create', parsed.error, values);

		let id: string;
		try {
			id = await createBond(locals.supabase, parsed.data, {
				requestId: locals.requestId,
				permissions: locals.permissions
			});
		} catch (err) {
			return bondServiceFailure('create', err, values);
		}

		// "Save" goes back to the campaign: the bond record (/campaigns/[id]/bonds/[bondId]) does
		// not exist yet. SAN-25 switches this to the new bond's record once it adds that route.
		if (intent === 'save') {
			redirect(303, `/campaigns/${campaign.id}`);
		}

		const [base] = parsed.data.baseNumbers;
		const baseFormatted = formatCampaignNumber(base, config);
		const associatedFormatted = formatCampaignNumber(
			calculateAssociatedNumber(base, config),
			config
		);
		const result: BondFormResult = {
			form: 'create',
			success: true,
			message: `Bond ${baseFormatted} / ${associatedFormatted} saved.`,
			errors: {},
			created: { id, baseFormatted, associatedFormatted }
		};
		return result;
	}
};
