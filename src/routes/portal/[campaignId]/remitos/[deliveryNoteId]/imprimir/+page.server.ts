import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireOwnCollector } from '$lib/server/auth/own-collector';
import { buildPrintableDeliveryNote } from '$lib/server/documents/delivery-note';
import { loadFailed, requireUuid } from '$lib/server/portal/route';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getDeliveryNote, listDeliveryNoteBonds } from '$lib/server/repositories/deliveries';

const NOT_FOUND = 'Remito no encontrado.';
const PARTIAL =
	'Este remito incluye bonos que ya no están a tu cargo, por eso no se puede imprimir desde el portal.';

/**
 * /portal/[campaignId]/remitos/[deliveryNoteId]/imprimir: printable delivery note of the signed-in
 * collector (SAN-153), the same document as the operator route. Own scope (`bond.view_own`): the collector
 * comes from the session, never from the URL. A note of another collector, of another campaign or an
 * unknown id answers 404 without telling which. The note carries no buyer or payment data.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	const collector = await requireOwnCollector(locals, url.pathname + url.search, 'bond.view_own');
	requireUuid(params.campaignId, NOT_FOUND);
	requireUuid(params.deliveryNoteId, NOT_FOUND);
	if (!collector) error(404, { message: NOT_FOUND });

	const [campaign, note] = await Promise.all([
		getCampaignById(locals.supabase, params.campaignId),
		getDeliveryNote(locals.supabase, params.campaignId, params.deliveryNoteId)
	]);
	if (campaign.error || note.error) loadFailed(locals, 'el remito', campaign.error ?? note.error);
	// RLS already limits delivery notes to the own collector; this is the explicit second check.
	if (!campaign.data || !note.data || note.data.note.collectorId !== collector.id)
		error(404, { message: NOT_FOUND });

	const bonds = await listDeliveryNoteBonds(
		locals.supabase,
		params.deliveryNoteId,
		note.data.note.issuedAt
	);
	if (bonds.error) loadFailed(locals, 'el remito', bonds.error);
	// Bonds returned or reassigned since are no longer readable by this collector: never print a partial note.
	if (bonds.data.length !== note.data.note.bondCount) error(404, { message: PARTIAL });

	return {
		// The registering user's profile is not readable by collectors: print the office, not a person.
		document: buildPrintableDeliveryNote(
			campaign.data,
			{ ...note.data.note, createdByName: 'Administración' },
			bonds.data
		)
	};
};
