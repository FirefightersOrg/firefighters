import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { bondOption, isUuid, loadDeliveryCampaign } from '$lib/server/deliveries/route-helpers';
import { getDeliveryNote, listBondEntriesByIds } from '$lib/server/repositories/deliveries';

const NOTE_NOT_FOUND = 'Delivery note not found.';

/**
 * /campaigns/[id]/deliveries/[noteId]: one delivery note with its bonds and a link to the
 * printable version. Requires `campaign.view` and `bond.view` or `bond.assign`.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	if (!hasPermissionIn(locals.permissions, 'bond.assign')) {
		requirePermissionIn(locals.permissions, 'bond.view');
	}
	const campaign = await loadDeliveryCampaign(locals, params.id);
	if (!isUuid(params.noteId)) error(404, { message: NOTE_NOT_FOUND });

	const note = await getDeliveryNote(locals.supabase, campaign.id, params.noteId);
	if (note.error) fail500(locals, note.error);
	if (!note.data) error(404, { message: NOTE_NOT_FOUND });

	const bonds = await listBondEntriesByIds(locals.supabase, campaign.id, note.data.bondIds);
	if (bonds.error) fail500(locals, bonds.error);

	return {
		campaign,
		note: note.data.note,
		bonds: bonds.data.map((b) => bondOption(b, campaign))
	};
};

function fail500(locals: App.Locals, err: unknown): never {
	console.error('[deliveries] note load failed', { requestId: locals.requestId, error: err });
	error(500, { message: 'No se pudo cargar el remito. Volver a intentar.' });
}
