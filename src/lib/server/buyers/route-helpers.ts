import { fail, redirect } from '@sveltejs/kit';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { PartyServiceError } from '$lib/server/services/parties';
import { buyerSchema, BUYER_FORM_FIELDS } from '$lib/schemas/buyer';
import { readFormFields } from '$lib/schemas/campaign';

export function buyerValues(formData: FormData) {
	const values = readFormFields(formData, BUYER_FORM_FIELDS);
	return { ...values, usualCollectorId: values.usualCollectorId || null };
}

export function validateBuyer(values: ReturnType<typeof buyerValues>) {
	const parsed = buyerSchema.safeParse(values);
	if (parsed.success) return { data: parsed.data };
	return {
		failure: fail(400, {
			success: false,
			values,
			errors: parsed.error.flatten().fieldErrors,
			message: 'Revisar los campos marcados.'
		})
	};
}

export function partyFailure(err: unknown, values: Record<string, unknown>) {
	if (err instanceof PartyServiceError) {
		return fail(err.status, {
			success: false,
			values,
			errors: err.field ? { [err.field]: [err.message] } : {},
			message: err.field ? 'Revisar los campos marcados.' : err.message
		});
	}
	console.error('[buyers] action failed', err);
	return fail(500, {
		success: false,
		values,
		errors: {},
		message: 'Algo salió mal. Volver a intentar.'
	});
}

export function requireBuyerManage(locals: App.Locals, url: URL) {
	requireCampaignViewer(locals, url);
	if (!hasPermissionIn(locals.permissions, 'buyer.manage')) {
		return fail(403, {
			success: false,
			values: {},
			errors: {},
			message: 'No hay permiso para realizar esta acción.'
		});
	}
	return null;
}

export function duplicateFailure(
	values: Record<string, unknown>,
	duplicates: { id: string; name: string }[]
) {
	return fail(409, {
		success: false,
		values,
		errors: {},
		duplicates,
		message:
			'Ya existe un comprador con esta identificación. Revisar los registros y confirmar para crearlo de todos modos.'
	});
}

export { redirect };
