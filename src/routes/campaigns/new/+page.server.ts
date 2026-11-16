import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requirePermissionIn } from '$lib/server/auth/permissions';
import {
	campaignServiceFailure,
	campaignValidationFailure,
	checkCampaignActionPermission,
	requireCampaignViewer
} from '$lib/server/campaigns/route-helpers';
import { createCampaign } from '$lib/server/services/campaigns';
import {
	CAMPAIGN_CREATE_FIELDS,
	campaignCreateSchema,
	readFormFields
} from '$lib/schemas/campaign';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'campaign.create');
	return {};
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const denied = checkCampaignActionPermission(locals, url, 'create', 'campaign.create');
		if (denied) return denied;

		const values = readFormFields(await request.formData(), CAMPAIGN_CREATE_FIELDS);
		const parsed = campaignCreateSchema.safeParse(values);
		if (!parsed.success) {
			return campaignValidationFailure('create', parsed.error, values);
		}

		let id: string;
		try {
			id = await createCampaign(locals.supabase, parsed.data, { requestId: locals.requestId });
		} catch (err) {
			return campaignServiceFailure('create', err, values);
		}

		redirect(303, `/campaigns/${id}`);
	}
};
