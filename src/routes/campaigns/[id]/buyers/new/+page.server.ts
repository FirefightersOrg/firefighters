import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { buyerDisplayName } from '$lib/domain/parties';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	findBuyersByIdentification,
	listActiveCollectorOptions
} from '$lib/server/repositories/parties';
import { createBuyer } from '$lib/server/services/parties';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';
import {
	duplicateFailure,
	partyFailure,
	requireBuyerManage,
	validateBuyer,
	buyerValues
} from '$lib/server/buyers/route-helpers';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'buyer.manage');
	if (!z.guid().safeParse(params.id).success) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	const [campaign, collectors] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		listActiveCollectorOptions(locals.supabase)
	]);
	if (campaign.error || collectors.error)
		error(500, { message: 'No se pudo cargar el formulario. Volver a intentar.' });
	if (!campaign.data) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	return {
		campaign: campaign.data,
		collectors: collectors.data ?? [],
		canViewCollectors:
			hasPermissionIn(locals.permissions, 'collector.view') ||
			hasPermissionIn(locals.permissions, 'collector.manage')
	};
};
export const actions: Actions = {
	default: async ({ request, locals, params, url }) => {
		const denied = requireBuyerManage(locals, url);
		if (denied) return denied;
		if (!z.guid().safeParse(params.id).success)
			return fail(404, {
				success: false,
				values: {},
				errors: {},
				message: CAMPAIGN_MESSAGES.notFound
			});
		const campaign = await getCampaignById(locals.supabase, params.id);
		if (campaign.error) return partyFailure(campaign.error, {});
		if (!campaign.data)
			return fail(404, {
				success: false,
				values: {},
				errors: {},
				message: CAMPAIGN_MESSAGES.notFound
			});
		const formData = await request.formData();
		const values = buyerValues(formData);
		const checked = formData.get('createAnyway') === 'on';
		const parsed = validateBuyer(values);
		if ('failure' in parsed) return parsed.failure;
		const duplicates = await findBuyersByIdentification(locals.supabase, parsed.data);
		if (duplicates.error) return partyFailure(duplicates.error, values);
		if ((duplicates.data?.length ?? 0) > 0 && !checked)
			return duplicateFailure(
				values,
				(duplicates.data ?? []).map((b) => ({ id: b.id, name: buyerDisplayName(b) }))
			);
		let id: string;
		try {
			id = await createBuyer(locals.supabase, parsed.data, {
				requestId: locals.requestId,
				permissions: locals.permissions
			});
		} catch (err) {
			return partyFailure(err, values);
		}
		redirect(303, `/campaigns/${params.id}/buyers/${id}`);
	}
};
