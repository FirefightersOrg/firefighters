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
import { listSettlements } from '$lib/server/repositories/settlements';
import { openSettlement, SettlementServiceError } from '$lib/server/services/settlements';
import { SETTLEMENT_NOTES_MAX } from '$lib/domain/payments';
import { GENERIC_ERROR_MESSAGE } from '$lib/copy';
const uuid = z.guid();
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'No se pudieron cargar los permisos.' });
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'settlement.create');
	const [campaign, collectors, open] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		listActiveCollectorOptions(locals.supabase),
		// A collector has one open settlement at a time: the page sends there instead of opening another.
		listSettlements(locals.supabase, params.id, { status: 'open' })
	]);
	if (campaign.error || collectors.error)
		error(500, { message: 'No se pudo cargar el formulario de la rendición.' });
	if (!campaign.data) error(404, { message: 'Campaña no encontrada.' });
	return {
		campaign: campaign.data,
		collectors: collectors.data ?? [],
		/** Open settlements under the caller's RLS; empty when they cannot be read (the form still works). */
		openSettlements: (open.data ?? []).map((settlement) => ({
			id: settlement.id,
			collectorId: settlement.collectorId,
			settlementNumber: settlement.settlementNumber
		})),
		/** `?intent=payment`: reached from «Registrar pago», so the page is worded around the payment. */
		forPayment: url.searchParams.get('intent') === 'payment',
		/** `?collector=<id>`: reached from a bond's record, so its collector comes chosen. */
		preselectedCollectorId:
			(collectors.data ?? []).find((c) => c.id === url.searchParams.get('collector'))?.id ?? null,
		notesMax: SETTLEMENT_NOTES_MAX
	};
};
export const actions: Actions = {
	create: async ({ request, locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, {
				form: 'create',
				errors: {},
				message: 'No se pudieron cargar los permisos.'
			});
		requireCampaignViewer(locals, url);
		if (!hasPermissionIn(locals.permissions, 'settlement.create'))
			return fail(403, {
				form: 'create',
				errors: {},
				message: 'No hay permiso para esta acción.'
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
				message: 'Revisar los campos marcados.'
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
				{ requestId: locals.requestId, permissions: locals.permissions ?? null }
			);
		} catch (err) {
			const e = err instanceof SettlementServiceError ? err : null;
			return fail(e?.status ?? 500, {
				form: 'create',
				values,
				errors: {},
				message: e?.message ?? GENERIC_ERROR_MESSAGE
			});
		}
		redirect(303, `/campaigns/${params.id}/settlements/${id}`);
	}
};
