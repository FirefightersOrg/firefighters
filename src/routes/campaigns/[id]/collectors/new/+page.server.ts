import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { listAvailableCollectorProfileOptions } from '$lib/server/repositories/parties';
import { PartyServiceError, createCollector } from '$lib/server/services/parties';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';
import { COLLECTOR_FORM_FIELDS, collectorSchema } from '$lib/schemas/collector';
import { readFormFields } from '$lib/schemas/campaign';
import { GENERIC_ERROR_MESSAGE } from '$lib/copy';

const uuid = (value: string) => z.guid().safeParse(value).success;
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'collector.manage');
	if (!uuid(params.id)) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	const [campaign, profiles] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		listAvailableCollectorProfileOptions(locals.supabase)
	]);
	if (campaign.error || profiles.error)
		error(500, { message: 'No se pudo cargar el formulario. Volver a intentar.' });
	if (!campaign.data) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	return { campaign: campaign.data, profiles: profiles.data ?? [] };
};
export const actions: Actions = {
	default: async ({ request, locals, params, url }) => {
		requireCampaignViewer(locals, url);
		requirePermissionIn(locals.permissions, 'collector.manage');
		if (!uuid(params.id)) return fail(404, { message: CAMPAIGN_MESSAGES.notFound });
		const values = readFormFields(await request.formData(), COLLECTOR_FORM_FIELDS);
		const parsed = collectorSchema.safeParse(values);
		if (!parsed.success)
			return fail(400, {
				values,
				errors: parsed.error.flatten().fieldErrors,
				message: 'Revisar el formulario.'
			});
		let collectorId: string;
		try {
			collectorId = await createCollector(locals.supabase, parsed.data, {
				requestId: locals.requestId,
				permissions: locals.permissions
			});
		} catch (err) {
			const party = err instanceof PartyServiceError ? err : null;
			return fail(party?.status ?? 500, {
				values,
				errors: party?.field ? { [party.field]: [party.message] } : {},
				message: party?.message ?? GENERIC_ERROR_MESSAGE
			});
		}
		redirect(303, `/campaigns/${params.id}/collectors/${collectorId}`);
	}
};
