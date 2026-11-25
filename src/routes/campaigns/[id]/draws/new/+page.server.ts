import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	hasPermissionIn,
	permissionsUnavailable,
	requirePermissionIn
} from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { createDraw, DrawServiceError } from '$lib/server/services/draws';
import { DRAW_TYPES, type DrawType } from '$lib/domain/draws';
import { field, readDrawFields, validateDrawFields } from '$lib/server/draws/route-helpers';
import { GENERIC_ERROR_MESSAGE } from '$lib/copy';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'No se pudieron cargar los permisos.' });
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'draw.create');
	const campaign = await getCampaignById(locals.supabase, params.id);
	if (campaign.error) error(500, { message: 'No se pudo cargar el formulario del sorteo.' });
	if (!campaign.data) error(404, { message: 'Campaña no encontrada.' });
	return { campaign: campaign.data };
};
export const actions: Actions = {
	create: async ({ request, locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, {
				form: 'draw',
				errors: {},
				message: 'No se pudieron cargar los permisos.'
			});
		requireCampaignViewer(locals, url);
		if (!hasPermissionIn(locals.permissions, 'draw.create'))
			return fail(403, {
				form: 'draw',
				errors: {},
				message: 'No hay permiso para esta acción.'
			});
		const form = await request.formData();
		const drawType = field(form, 'drawType');
		const values = { drawType, ...readDrawFields(form) };
		if (!DRAW_TYPES.includes(drawType as DrawType))
			return fail(400, {
				form: 'draw',
				values,
				errors: { drawType: ['Elegir un tipo de sorteo.'] },
				message: 'Revisar los campos marcados.'
			});
		const campaign = await getCampaignById(locals.supabase, params.id);
		if (campaign.error)
			return fail(500, {
				form: 'draw',
				values,
				errors: {},
				message: 'No se pudo cargar la campaña.'
			});
		if (!campaign.data)
			return fail(404, { form: 'draw', values, errors: {}, message: 'Campaña no encontrada.' });
		const parsed = validateDrawFields(values, drawType as DrawType, campaign.data.installmentCount);
		if ('failure' in parsed) return parsed.failure;
		let drawId: string;
		try {
			drawId = await createDraw(
				locals.supabase,
				{
					campaignId: params.id,
					drawType: drawType as DrawType,
					...parsed.data
				},
				{ requestId: locals.requestId ?? null, permissions: locals.permissions ?? null }
			);
		} catch (cause) {
			const serviceError = cause instanceof DrawServiceError ? cause : null;
			return fail(serviceError?.status ?? 500, {
				form: 'draw',
				values,
				errors: {},
				message: serviceError?.message ?? GENERIC_ERROR_MESSAGE
			});
		}
		redirect(303, `/campaigns/${params.id}/draws/${drawId}`);
	}
};
