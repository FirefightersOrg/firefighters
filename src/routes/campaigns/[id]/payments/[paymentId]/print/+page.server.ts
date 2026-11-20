import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { PageServerLoad } from './$types';
import { requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getPaymentCertificate } from '$lib/server/repositories/printable-payments';
import { buildPrintablePaymentCertificate } from '$lib/server/documents/payment-certificate';
const uuid = (v: string) => z.guid().safeParse(v).success;
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'payment.view');
	if (!uuid(params.id) || !uuid(params.paymentId)) error(404, { message: 'Payment not found.' });
	const [campaign, found] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getPaymentCertificate(locals.supabase, params.id, params.paymentId)
	]);
	if (campaign.error || found.error) {
		console.error('[payments] print load failed', {
			requestId: locals.requestId,
			paymentId: params.paymentId,
			error: campaign.error ?? found.error
		});
		error(500, { message: 'Could not load the payment.' });
	}
	if (!campaign.data) error(404, { message: 'Campaign not found.' });
	if (!found.data || found.data.status !== 'confirmed')
		error(404, { message: 'Payment certificate is only available for confirmed payments.' });
	return { document: buildPrintablePaymentCertificate(campaign.data, found.data.payment) };
};
