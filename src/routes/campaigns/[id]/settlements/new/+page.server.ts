import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { z } from 'zod';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import {
	hasPermissionIn,
	permissionsUnavailable,
	requirePermissionIn
} from '$lib/server/auth/permissions';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { listActiveCollectorOptions } from '$lib/server/repositories/parties';
import { openSettlement, SettlementServiceError } from '$lib/server/services/settlements';
import { SETTLEMENT_NOTES_MAX } from '$lib/domain/payments';
const uuid = z.guid();
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'Could not load permissions.' });
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'settlement.create');
	const [campaign, collectors] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		listActiveCollectorOptions(locals.supabase)
	]);
	if (campaign.error || collectors.error)
		error(500, { message: 'Could not load settlement form.' });
	if (!campaign.data) error(404, { message: 'Campaign not found.' });
	return {
		campaign: campaign.data,
		collectors: collectors.data ?? [],
		notesMax: SETTLEMENT_NOTES_MAX
	};
};
export const actions: Actions = {
	create: async ({ request, locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, { form: 'create', errors: {}, message: 'Could not load permissions.' });
		requireCampaignViewer(locals, url);
		if (!hasPermissionIn(locals.permissions, 'settlement.create'))
			return fail(403, {
				form: 'create',
				errors: {},
				message: 'You do not have permission to perform this action.'
			});
		const form = await request.formData();
		const values = {
			collectorId: String(form.get('collectorId') ?? '').trim(),
			notes: String(form.get('notes') ?? '').trim()
		};
		const parsed = z
			.object({ collectorId: uuid, notes: z.string().max(SETTLEMENT_NOTES_MAX) })
			.safeParse(values);
		if (!parsed.success)
			return fail(400, {
				form: 'create',
				values,
				errors: parsed.error.flatten().fieldErrors,
				message: 'Please correct the highlighted fields.'
			});
		let id: string;
		try {
			id = await openSettlement(
				locals.supabase,
				{
					campaignId: params.id,
					collectorId: parsed.data.collectorId,
					notes: parsed.data.notes || null
				},
				{ requestId: locals.requestId, permissions: locals.permissions }
			);
		} catch (err) {
			const e = err instanceof SettlementServiceError ? err : null;
			return fail(e?.status ?? 500, {
				form: 'create',
				values,
				errors: {},
				message: e?.message ?? 'Something went wrong. Please try again.'
			});
		}
		redirect(303, `/campaigns/${params.id}/settlements/${id}`);
	}
};
