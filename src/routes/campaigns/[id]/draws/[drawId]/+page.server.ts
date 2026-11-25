import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	hasPermissionIn,
	permissionsUnavailable,
	requirePermissionIn
} from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getCurrentDrawRoster, getDraw } from '$lib/server/repositories/draws';
import { annulDraw, completeDraw, DrawServiceError, updateDraw } from '$lib/server/services/draws';
import { freezeDrawRoster, generateDrawRoster } from '$lib/server/services/draw-rosters';
import { canTransitionDraw, DRAW_REASON_MAX } from '$lib/domain/draws';
import { field, readDrawFields, uuid, validateDrawFields } from '$lib/server/draws/route-helpers';
import { GENERIC_ERROR_MESSAGE } from '$lib/copy';

const canRead = (permissions: readonly string[] | null | undefined) =>
	[
		'draw.view',
		'draw.create',
		'draw.update',
		'draw.generate_roster',
		'draw.freeze_roster',
		'draw.load_winner'
	].some((permission) => hasPermissionIn(permissions, permission as never));
const serviceFailure = (cause: unknown, form: string, values: Record<string, string> = {}) => {
	const serviceError = cause instanceof DrawServiceError ? cause : null;
	return fail(serviceError?.status ?? 500, {
		form,
		values,
		errors: {},
		message: serviceError?.message ?? GENERIC_ERROR_MESSAGE
	});
};
async function scopedDraw(
	locals: App.Locals,
	params: { id: string; drawId: string },
	form: string
) {
	if (!uuid.safeParse(params.id).success || !uuid.safeParse(params.drawId).success)
		return { failure: fail(404, { form, errors: {}, message: 'Sorteo no encontrado.' }) };
	const result = await getDraw(locals.supabase, params.id, params.drawId);
	if (result.error) return { failure: serviceFailure(result.error, form) };
	if (!result.data)
		return { failure: fail(404, { form, errors: {}, message: 'Sorteo no encontrado.' }) };
	return { draw: result.data };
}
function guard(
	locals: App.Locals,
	permission: Parameters<typeof hasPermissionIn>[1],
	form: string
) {
	if (permissionsUnavailable(locals.permissions))
		return fail(500, { form, errors: {}, message: 'No se pudieron cargar los permisos.' });
	if (!hasPermissionIn(locals.permissions, permission))
		return fail(403, {
			form,
			errors: {},
			message: 'No hay permiso para esta acción.'
		});
	return null;
}
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'No se pudieron cargar los permisos.' });
	requireCampaignViewer(locals, url);
	if (!canRead(locals.permissions)) requirePermissionIn(locals.permissions, 'draw.view');
	if (!uuid.safeParse(params.drawId).success) error(404, { message: 'Sorteo no encontrado.' });
	const [campaign, draw] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getDraw(locals.supabase, params.id, params.drawId)
	]);
	if (campaign.error || draw.error) error(500, { message: 'No se pudo cargar el sorteo.' });
	if (!campaign.data) error(404, { message: 'Campaña no encontrada.' });
	if (!draw.data) error(404, { message: 'Sorteo no encontrado.' });
	const roster = await getCurrentDrawRoster(locals.supabase, draw.data.id);
	if (roster.error) error(500, { message: 'No se pudo cargar el padrón del sorteo.' });
	const scheduled = draw.data.status === 'scheduled';
	const generated = draw.data.status === 'roster_generated';
	return {
		campaign: campaign.data,
		draw: draw.data,
		roster: roster.data,
		reasonMax: DRAW_REASON_MAX,
		can: {
			edit: scheduled && hasPermissionIn(locals.permissions, 'draw.update'),
			annul:
				canTransitionDraw(draw.data.status, 'annulled', draw.data.drawType) &&
				hasPermissionIn(locals.permissions, 'draw.annul'),
			generate: scheduled && hasPermissionIn(locals.permissions, 'draw.generate_roster'),
			regenerate: generated && hasPermissionIn(locals.permissions, 'draw.generate_roster'),
			freeze: generated && hasPermissionIn(locals.permissions, 'draw.freeze_roster'),
			complete:
				draw.data.status === 'roster_frozen' && hasPermissionIn(locals.permissions, 'draw.complete')
		}
	};
};
export const actions: Actions = {
	update: async ({ request, locals, params, url }) => {
		const denied = guard(locals, 'draw.update', 'update');
		if (denied) return denied;
		requireCampaignViewer(locals, url);
		const scoped = await scopedDraw(locals, params, 'update');
		if ('failure' in scoped) return scoped.failure;
		const campaign = await getCampaignById(locals.supabase, params.id);
		if (campaign.error) return serviceFailure(campaign.error, 'update');
		if (!campaign.data)
			return fail(404, { form: 'update', errors: {}, message: 'Campaña no encontrada.' });
		const values = readDrawFields(await request.formData());
		const parsed = validateDrawFields(values, scoped.draw.drawType, campaign.data.installmentCount);
		if ('failure' in parsed) return parsed.failure;
		try {
			await updateDraw(
				locals.supabase,
				{ drawId: params.drawId, ...parsed.data },
				{
					requestId: locals.requestId ?? null,
					permissions: locals.permissions ?? null
				}
			);
			return { form: 'update', success: true, errors: {}, message: 'Sorteo actualizado.' };
		} catch (cause) {
			return serviceFailure(cause, 'update', values);
		}
	},
	annul: async ({ request, locals, params, url }) => {
		const denied = guard(locals, 'draw.annul', 'annul');
		if (denied) return denied;
		requireCampaignViewer(locals, url);
		const scoped = await scopedDraw(locals, params, 'annul');
		if ('failure' in scoped) return scoped.failure;
		const reason = field(await request.formData(), 'reason');
		if (!reason || [...reason].length > DRAW_REASON_MAX)
			return fail(400, {
				form: 'annul',
				values: { reason },
				errors: { reason: [`Use between 1 and ${DRAW_REASON_MAX} characters.`] },
				message: 'Revisar los campos marcados.'
			});
		try {
			await annulDraw(
				locals.supabase,
				{ drawId: params.drawId, reason },
				{
					requestId: locals.requestId ?? null,
					permissions: locals.permissions ?? null
				}
			);
			return { form: 'annul', success: true, errors: {}, message: 'Sorteo anulado.' };
		} catch (cause) {
			return serviceFailure(cause, 'annul', { reason });
		}
	},
	complete: async ({ locals, params, url }) => {
		const denied = guard(locals, 'draw.complete', 'complete');
		if (denied) return denied;
		requireCampaignViewer(locals, url);
		const scoped = await scopedDraw(locals, params, 'complete');
		if ('failure' in scoped) return scoped.failure;
		try {
			await completeDraw(
				locals.supabase,
				{ drawId: params.drawId },
				{
					requestId: locals.requestId ?? null,
					permissions: locals.permissions ?? null
				}
			);
			return { form: 'complete', success: true, errors: {}, message: 'Sorteo completado.' };
		} catch (cause) {
			return serviceFailure(cause, 'complete');
		}
	},
	generate: async ({ locals, params, url }) => {
		const denied = guard(locals, 'draw.generate_roster', 'generate');
		if (denied) return denied;
		requireCampaignViewer(locals, url);
		const scoped = await scopedDraw(locals, params, 'generate');
		if ('failure' in scoped) return scoped.failure;
		try {
			await generateDrawRoster(
				locals.supabase,
				{ drawId: params.drawId },
				{
					requestId: locals.requestId ?? null,
					permissions: locals.permissions ?? null
				}
			);
			return { form: 'generate', success: true, errors: {}, message: 'Padrón generado.' };
		} catch (cause) {
			return serviceFailure(cause, 'generate');
		}
	},
	freeze: async ({ request, locals, params, url }) => {
		const denied = guard(locals, 'draw.freeze_roster', 'freeze');
		if (denied) return denied;
		requireCampaignViewer(locals, url);
		const scoped = await scopedDraw(locals, params, 'freeze');
		if ('failure' in scoped) return scoped.failure;
		if (field(await request.formData(), 'confirm') !== 'yes')
			return fail(400, {
				form: 'freeze',
				errors: { confirm: ['Confirmar que este padrón debe quedar congelado.'] },
				message: 'Hace falta confirmar.'
			});
		try {
			await freezeDrawRoster(
				locals.supabase,
				{ drawId: params.drawId },
				{
					requestId: locals.requestId ?? null,
					permissions: locals.permissions ?? null
				}
			);
			return { form: 'freeze', success: true, errors: {}, message: 'Padrón congelado.' };
		} catch (cause) {
			return serviceFailure(cause, 'freeze');
		}
	}
};
