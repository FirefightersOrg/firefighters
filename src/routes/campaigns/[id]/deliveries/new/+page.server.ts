import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { canDeliverBonds, campaignNumberingConfig } from '$lib/domain/campaigns';
import { DELIVERY_MAX_BONDS, DELIVERY_NOTES_MAX_LENGTH } from '$lib/domain/deliveries';
import { parseCampaignNumber } from '$lib/domain/numbering';
import { requireActiveUser } from '$lib/server/auth/guards';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import {
	bondOption,
	deliveryFailure,
	deliveryServiceFailure,
	isUuid,
	loadDeliveryCampaign,
	type DeliveryFormResult
} from '$lib/server/deliveries/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { findAvailableBonds } from '$lib/server/repositories/deliveries';
import { listActiveCollectorOptions } from '$lib/server/repositories/parties';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';
import { DELIVERY_MESSAGES, assignBondsToCollector } from '$lib/server/services/deliveries';

/**
 * /campaigns/[id]/deliveries/new: deliver available bonds to a collector (`bond.assign`, campaign
 * active). Bonds are added by number (base or associated), by base-number range or by
 * barcode/internal code (`?/lookup`), reviewed, and delivered in one note (`?/deliver`).
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'bond.assign');
	const campaign = await loadDeliveryCampaign(locals, params.id);
	const collectors = await listActiveCollectorOptions(locals.supabase);
	if (collectors.error) {
		console.error('[deliveries] collectors load failed', {
			requestId: locals.requestId,
			error: collectors.error
		});
		error(500, { message: 'No se pudieron cargar los cobradores. Volver a intentar.' });
	}
	return {
		campaign,
		collectors: collectors.data,
		// Without collector.view/manage the list is empty because of RLS, not because there are none.
		canSeeCollectors:
			hasPermissionIn(locals.permissions, 'collector.view') ||
			hasPermissionIn(locals.permissions, 'collector.manage'),
		canDeliver: canDeliverBonds(campaign.status),
		lockedMessage: canDeliverBonds(campaign.status)
			? null
			: 'Bonds can be delivered to collectors only while the campaign is active.'
	};
};

async function actionCampaign(locals: App.Locals, url: URL, id: string) {
	requireActiveUser(locals, url.pathname);
	if (!hasPermissionIn(locals.permissions, 'bond.assign')) {
		return { failure: deliveryFailure(403, DELIVERY_MESSAGES.permission) };
	}
	if (!isUuid(id)) return { failure: deliveryFailure(404, CAMPAIGN_MESSAGES.notFound) };
	const campaign = await getCampaignById(locals.supabase, id);
	if (campaign.error) {
		console.error('[deliveries] campaign lookup failed', {
			requestId: locals.requestId,
			error: campaign.error
		});
		return { failure: deliveryFailure(500, DELIVERY_MESSAGES.internal) };
	}
	if (!campaign.data) return { failure: deliveryFailure(404, CAMPAIGN_MESSAGES.notFound) };
	if (!canDeliverBonds(campaign.data.status)) {
		return {
			failure: deliveryFailure(
				409,
				'Bonds can be delivered to collectors only while the campaign is active.'
			)
		};
	}
	return { campaign: campaign.data };
}

/** A campaign number as typed ("0068" or "68"), or null when it is not one. */
function tryNumber(
	input: string,
	config: ReturnType<typeof campaignNumberingConfig>
): number | null {
	try {
		return parseCampaignNumber(input, config);
	} catch {
		return null;
	}
}

const text = (formData: FormData, name: string) => {
	const v = formData.get(name);
	return typeof v === 'string' ? v.trim() : '';
};

export const actions: Actions = {
	/** Find available bonds by number, range or code (nothing is written). */
	lookup: async ({ request, locals, params, url }) => {
		const found = await actionCampaign(locals, url, params.id);
		if ('failure' in found) return found.failure;
		const config = campaignNumberingConfig(found.campaign);
		const formData = await request.formData();
		const query = text(formData, 'query');
		const fromText = text(formData, 'from');
		const toText = text(formData, 'to');
		const values = { query, from: fromText, to: toText };

		let options: Parameters<typeof findAvailableBonds>[2];
		if (fromText || toText) {
			const from = tryNumber(fromText, config);
			const to = tryNumber(toText, config);
			if (from === null || to === null || from > to) {
				return deliveryFailure(400, 'Ingresar un rango válido de números base (desde ≤ hasta).', {
					errors: { range: ['Ingresar un rango válido de números base (desde ≤ hasta).'] },
					values
				});
			}
			options = { from, to };
		} else if (query) {
			const number = tryNumber(query, config);
			options = number !== null ? { number } : { code: query.slice(0, 200) };
		} else {
			return deliveryFailure(400, 'Ingresar un número, un código o un rango.', {
				errors: { query: ['Ingresar un número, un código o un rango.'] },
				values
			});
		}

		const bonds = await findAvailableBonds(locals.supabase, found.campaign.id, options);
		if (bonds.error) {
			console.error('[deliveries] lookup failed', {
				requestId: locals.requestId,
				error: bonds.error
			});
			return deliveryFailure(500, DELIVERY_MESSAGES.internal, { values });
		}
		const result: DeliveryFormResult = {
			success: true,
			message: bonds.data.items.length ? undefined : 'No available bond matches.',
			errors: {},
			values,
			found: bonds.data.items.map((b) => bondOption(b, found.campaign)),
			truncated: bonds.data.truncated
		};
		return result;
	},

	/** Deliver the selected bonds to the collector; opens the new note. */
	deliver: async ({ request, locals, params, url }) => {
		const found = await actionCampaign(locals, url, params.id);
		if ('failure' in found) return found.failure;
		const formData = await request.formData();
		const collectorId = text(formData, 'collectorId');
		const notes = text(formData, 'notes');
		const bondIds = formData.getAll('bondIds').filter((v): v is string => typeof v === 'string');
		const values = { collectorId, notes };
		const errors: Record<string, string[]> = {};
		if (!isUuid(collectorId)) errors.collectorId = ['Elegir el cobrador.'];
		if (bondIds.length === 0) errors.bondIds = ['Agregar al menos un bono.'];
		else if (bondIds.length > DELIVERY_MAX_BONDS || !bondIds.every(isUuid)) {
			errors.bondIds = [`At most ${DELIVERY_MAX_BONDS} bonds per delivery.`];
		}
		if (notes.length > DELIVERY_NOTES_MAX_LENGTH) {
			errors.notes = [`Notes are limited to ${DELIVERY_NOTES_MAX_LENGTH} characters.`];
		}
		if (Object.keys(errors).length) {
			return deliveryFailure(400, 'Revisar los campos marcados.', { errors, values });
		}

		let noteId: string;
		try {
			noteId = await assignBondsToCollector(
				locals.supabase,
				{
					campaignId: found.campaign.id,
					collectorId,
					bondIds: [...new Set(bondIds)],
					notes: notes || null
				},
				{ requestId: locals.requestId, permissions: locals.permissions }
			);
		} catch (err) {
			return deliveryServiceFailure(err, values);
		}
		redirect(303, `/campaigns/${found.campaign.id}/deliveries/${noteId}`);
	}
};
