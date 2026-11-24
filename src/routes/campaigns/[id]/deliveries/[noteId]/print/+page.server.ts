import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { buildPrintableDeliveryNote } from '$lib/server/documents/delivery-note';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getDocumentActorName } from '$lib/server/repositories/document-actors';
import { getDeliveryNote, listDeliveryNoteBonds } from '$lib/server/repositories/deliveries';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';

const getDeliveryNoteActor = (supabase: App.Locals['supabase'], id: string) =>
	getDocumentActorName(supabase, 'delivery_note', id);
const NOTE_NOT_FOUND = 'Delivery note not found.';
const isUuid = (value: string) => z.guid().safeParse(value).success;

/**
 * /campaigns/[id]/deliveries/[noteId]/print: the printable bond delivery note (SAN-56), in two
 * copies (original for administration, duplicate for the collector). Requires `campaign.view` and
 * `bond.view`.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'bond.view');
	if (!isUuid(params.id)) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	if (!isUuid(params.noteId)) error(404, { message: NOTE_NOT_FOUND });

	const [campaign, note, actor] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getDeliveryNote(locals.supabase, params.id, params.noteId),
		getDeliveryNoteActor(locals.supabase, params.noteId)
	]);
	if (campaign.error || note.error || actor.error)
		fail500(locals, params.noteId, campaign.error ?? note.error ?? actor.error);
	if (!campaign.data) error(404, { message: CAMPAIGN_MESSAGES.notFound });
	if (!note.data) error(404, { message: NOTE_NOT_FOUND });

	const bonds = await listDeliveryNoteBonds(
		locals.supabase,
		params.noteId,
		note.data.note.issuedAt
	);
	if (bonds.error) fail500(locals, params.noteId, bonds.error);
	if (bonds.data.length !== note.data.note.bondCount) {
		fail500(
			locals,
			params.noteId,
			new Error(`expected ${note.data.note.bondCount} bonds, read ${bonds.data.length}`)
		);
	}

	return {
		document: buildPrintableDeliveryNote(
			campaign.data,
			{ ...note.data.note, createdByName: actor.data },
			bonds.data
		)
	};
};

function fail500(locals: App.Locals, noteId: string, err: unknown): never {
	console.error('[deliveries] print load failed', {
		requestId: locals.requestId,
		noteId,
		error: err
	});
	error(500, { message: 'Could not load the delivery note. Please try again.' });
}
