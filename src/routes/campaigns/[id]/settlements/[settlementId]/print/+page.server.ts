import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getSettlementPrint } from '$lib/server/repositories/printable-payments';
import { buildPrintableSettlementDeliveryNote } from '$lib/server/documents/settlement-delivery-note';
const uuid = (v: string) => z.guid().safeParse(v).success;
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	const allowed = [
		'settlement.view',
		'settlement.create',
		'settlement.update_open',
		'settlement.close',
		'settlement.correct'
	];
	if (!locals.permissions?.some((p) => allowed.includes(p)))
		error(403, { message: 'Permission denied.' });
	if (!uuid(params.id) || !uuid(params.settlementId))
		error(404, { message: 'Settlement not found.' });
	const [campaign, settlement] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getSettlementPrint(locals.supabase, params.id, params.settlementId)
	]);
	if (campaign.error || settlement.error) {
		console.error('[settlements] print load failed', {
			requestId: locals.requestId,
			settlementId: params.settlementId,
			error: campaign.error ?? settlement.error
		});
		error(500, { message: 'Could not load the settlement.' });
	}
	if (!campaign.data) error(404, { message: 'Campaign not found.' });
	if (!settlement.data) error(404, { message: 'Settlement not found.' });
	return { document: buildPrintableSettlementDeliveryNote(campaign.data, settlement.data) };
};
