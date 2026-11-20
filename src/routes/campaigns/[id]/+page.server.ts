import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import {
	availableCampaignTransitions,
	canEditCampaignDates,
	canEditCampaignName,
	canEditCampaignRules,
	canLoadBonds,
	CAMPAIGN_TRANSITION_PERMISSIONS,
	keepTimestampIfSameDay
} from '$lib/domain/campaigns';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import type { PermissionCode } from '$lib/server/auth/permission-codes';
import {
	campaignFormFailure,
	campaignFormSuccess,
	campaignServiceFailure,
	campaignValidationFailure,
	checkCampaignActionPermission,
	requireCampaignViewer
} from '$lib/server/campaigns/route-helpers';
import { campaignHasBonds } from '$lib/server/repositories/bonds';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	CAMPAIGN_MESSAGES,
	transitionCampaign,
	updateCampaignGeneral,
	updateCampaignRules
} from '$lib/server/services/campaigns';
import {
	CAMPAIGN_GENERAL_UPDATE_FIELDS,
	CAMPAIGN_RULES_UPDATE_FIELDS,
	CAMPAIGN_TRANSITION_FIELDS,
	campaignGeneralSchema,
	campaignRulesUpdateSchema,
	campaignTransitionSchema,
	readFormFields
} from '$lib/schemas/campaign';

const isUuid = (value: string) => z.guid().safeParse(value).success;

const TRANSITION_SUCCESS = {
	active: 'Campaign activated. Its rules are now frozen.',
	closing: 'Campaign moved to closing.',
	closed: 'Campaign closed.',
	annulled: 'Campaign annulled.'
} as const;

export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	if (!isUuid(params.id)) {
		error(404, { message: CAMPAIGN_MESSAGES.notFound });
	}

	const [result, bondsResult] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		campaignHasBonds(locals.supabase, params.id)
	]);
	if (result.error) {
		console.error('[campaigns] load failed', {
			requestId: locals.requestId,
			campaignId: params.id,
			error: result.error
		});
		error(500, { message: 'Could not load the campaign. Please try again.' });
	}
	if (!result.data) {
		error(404, { message: CAMPAIGN_MESSAGES.notFound });
	}
	// UI hint only (the database rejects a rules change once a bond exists): if the lookup fails
	// the page still renders, as if there were no bonds.
	if (bondsResult.error) {
		console.error('[campaigns] bond lookup failed', {
			requestId: locals.requestId,
			campaignId: params.id,
			error: bondsResult.error
		});
	}

	const campaign = result.data;
	const hasBonds = bondsResult.data ?? false;
	const permissions = locals.permissions ?? [];
	const canUpdate = hasPermissionIn(permissions, 'campaign.update');

	// UI hints only: the SQL functions enforce permissions and edit windows.
	return {
		campaign,
		/** Once a campaign has a bond (annulled ones included) its rules are frozen, even in draft. */
		hasBonds,
		can: {
			editName: canUpdate && canEditCampaignName(campaign.status),
			editDates: canUpdate && canEditCampaignDates(campaign.status),
			editRules:
				hasPermissionIn(permissions, 'campaign.update_rules') &&
				canEditCampaignRules(campaign.status) &&
				!hasBonds,
			transitions: availableCampaignTransitions(campaign.status, permissions),
			viewCommissions: hasPermissionIn(permissions, 'commission.view'),
			viewAudit: hasPermissionIn(permissions, 'audit.view'),
			viewBonds: hasPermissionIn(permissions, 'bond.view'),
			loadBonds: hasPermissionIn(permissions, 'bond.create') && canLoadBonds(campaign.status),
			// Reading needs X.view or X.manage (same rule as the RLS of collectors / buyers).
			viewCollectors:
				hasPermissionIn(permissions, 'collector.view') ||
				hasPermissionIn(permissions, 'collector.manage'),
			viewBuyers:
				hasPermissionIn(permissions, 'buyer.view') || hasPermissionIn(permissions, 'buyer.manage'),
			viewDeliveries:
				hasPermissionIn(permissions, 'bond.view') || hasPermissionIn(permissions, 'bond.assign'),
			viewSales:
				hasPermissionIn(permissions, 'sale.view') ||
				hasPermissionIn(permissions, 'sale.create') ||
				hasPermissionIn(permissions, 'bond.view'),
			viewSettlements: (
				[
					'settlement.view',
					'settlement.create',
					'settlement.update_open',
					'settlement.close',
					'settlement.correct'
				] as PermissionCode[]
			).some((permission) => hasPermissionIn(permissions, permission))
		}
	};
};

export const actions: Actions = {
	update: async ({ request, locals, params, url }) => {
		const denied = checkCampaignActionPermission(locals, url, 'general', 'campaign.update');
		if (denied) return denied;
		if (!isUuid(params.id)) return campaignFormFailure('general', 404, CAMPAIGN_MESSAGES.notFound);

		const values = readFormFields(await request.formData(), CAMPAIGN_GENERAL_UPDATE_FIELDS);
		const parsed = campaignGeneralSchema.safeParse(values);
		if (!parsed.success) return campaignValidationFailure('general', parsed.error, values);

		// The form edits calendar days: keep a stored timestamp whose day did not change. If the
		// lookup fails, the submitted values are used as is (the SQL function still validates).
		const current = (await getCampaignById(locals.supabase, params.id)).data;
		const input = {
			...parsed.data,
			startsAt: keepTimestampIfSameDay(parsed.data.startsAt, current?.startsAt ?? null),
			endsAt: keepTimestampIfSameDay(parsed.data.endsAt, current?.endsAt ?? null)
		};

		try {
			const changed = await updateCampaignGeneral(locals.supabase, params.id, input, {
				requestId: locals.requestId
			});
			return campaignFormSuccess('general', changed ? 'Changes saved.' : 'No changes to save.');
		} catch (err) {
			return campaignServiceFailure('general', err, values);
		}
	},

	rules: async ({ request, locals, params, url }) => {
		const denied = checkCampaignActionPermission(locals, url, 'rules', 'campaign.update_rules');
		if (denied) return denied;
		if (!isUuid(params.id)) return campaignFormFailure('rules', 404, CAMPAIGN_MESSAGES.notFound);

		// The rules form must be explicitly confirmed (`confirmRulesChange=yes`): every saved change
		// is audited (old and new values) by `campaign_update_rules`, which also enforces
		// `campaign.update_rules` and the draft-only edit window. It also carries the version it was
		// loaded at (`expectedUpdatedAt`): a stale form is rejected with a 409, nothing written.
		const values = readFormFields(await request.formData(), CAMPAIGN_RULES_UPDATE_FIELDS);
		const parsed = campaignRulesUpdateSchema.safeParse(values);
		if (!parsed.success) return campaignValidationFailure('rules', parsed.error, values);

		try {
			const changed = await updateCampaignRules(locals.supabase, params.id, parsed.data, {
				requestId: locals.requestId
			});
			return campaignFormSuccess('rules', changed ? 'Rules saved.' : 'No changes to save.');
		} catch (err) {
			return campaignServiceFailure('rules', err, values);
		}
	},

	transition: async ({ request, locals, params, url }) => {
		const values = readFormFields(await request.formData(), CAMPAIGN_TRANSITION_FIELDS);
		const parsed = campaignTransitionSchema.safeParse(values);
		// The permission depends on the target status. An unparseable target still requires a
		// signed-in campaign viewer before the validation error is returned.
		const permission = parsed.success
			? CAMPAIGN_TRANSITION_PERMISSIONS[parsed.data.toStatus]
			: 'campaign.view';
		const denied = checkCampaignActionPermission(locals, url, 'transition', permission);
		if (denied) return denied;
		if (!parsed.success) return campaignValidationFailure('transition', parsed.error, values);
		if (!isUuid(params.id)) {
			return campaignFormFailure('transition', 404, CAMPAIGN_MESSAGES.notFound);
		}

		try {
			await transitionCampaign(locals.supabase, params.id, parsed.data, {
				requestId: locals.requestId
			});
		} catch (err) {
			return campaignServiceFailure('transition', err, values);
		}
		return campaignFormSuccess('transition', TRANSITION_SUCCESS[parsed.data.toStatus]);
	}
};
